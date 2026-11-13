// @ts-check
'use strict';

/**
 * Qutrade v2 REST transport
 * @typedef {import('axios').AxiosResponse} AxiosResponse
 * @typedef {import('axios').AxiosError} AxiosError
 * @typedef {typeof import('json-parse-bigint').default} QutradeJsonParser
 * @typedef {import('../../types/qutrade/api.d.js').QutradeParameters} QutradeParameters
 * @typedef {import('../../types/qutrade/api.d.js').QutradeLogger} QutradeLogger
 * @typedef {import('../../types/qutrade/api.d.js').QutradeMarket} QutradeMarket
 * @typedef {import('../../types/qutrade/api.d.js').QutradeOrder} QutradeOrder
 * @typedef {import('../../types/qutrade/api.d.js').QutradeBalance} QutradeBalance
 * @typedef {import('../../types/qutrade/api.d.js').QutradeCurrency} QutradeCurrency
 * @typedef {import('../../types/qutrade/api.d.js').QutradeDepth} QutradeDepth
 * @typedef {import('../../types/qutrade/api.d.js').QutradeTrade} QutradeTrade
 * @typedef {import('../../types/qutrade/api.d.js').QutradeCandle} QutradeCandle
 * @typedef {import('../../types/qutrade/api.d.js').QutradeDepositAddress} QutradeDepositAddress
 * @typedef {import('../../types/qutrade/api.d.js').QutradeSide} QutradeSide
 * @typedef {import('../../types/qutrade/api.d.js').QutradeOrderType} QutradeOrderType
 */
/** @template T @typedef {import('../../types/qutrade/api.d.js').QutradeResponse<T>} QutradeResponse */

const crypto = require('crypto');
const axios = require('axios').default;
const parseBigInt = /** @type {QutradeJsonParser} */ (/** @type {unknown} */ (require('json-parse-bigint')));
const { httpErrorCodeDescriptions } = require('./qutrade_errors');

/** A sanitized failure that never retains signed Axios configuration */
class QutradeRequestError extends Error {
  /** @param {string} message Safe diagnostic @param {number} status HTTP status @param {boolean} uncertain Mutation may have executed */
  constructor(message, status, uncertain) {
    super(message);
    this.status = status;
    this.uncertain = uncertain;
  }
}

/** @param {unknown} value Raw body @returns {unknown} Lossless JSON or original malformed body */
function parseResponse(value) {
  if (typeof value !== 'string') return value;
  try {
    return parseBigInt(value);
  } catch {
    return value;
  }
}

/**
 * Validate the live two-document cancellation response
 * The first document is a legacy acknowledgement containing only cancelled IDs and the result flag.
 * @param {string} text Unparsed HTTP 200 body
 * @returns {QutradeResponse<QutradeOrder[]>|undefined} The matching v2 envelope
 */
function parseCancellationEnvelope(text) {
  const boundary = text.indexOf('}') + 1;
  if (!boundary || boundary === text.length) return undefined;

  try {
    const legacy = parseBigInt(text.slice(0, boundary));
    const current = parseBigInt(text.slice(boundary));
    const ids = legacy?.list_canceled_order_id;
    const rows = current?.payload;
    if (legacy?.result !== 'success' || Object.keys(legacy).length !== 2 || !Array.isArray(ids) ||
        current?.result !== 'success' || !Array.isArray(rows)) return undefined;
    if (!ids.every((id) => (typeof id === 'string' || Number.isSafeInteger(id)) && /^[1-9]\d*$/.test(String(id)))) {
      return undefined;
    }

    const legacyIds = new Set(ids.map(String));
    const cancelledIds = rows.filter((row) => row?.status === 'canceled').map((row) => String(row.order_id));
    if (legacyIds.size !== ids.length || cancelledIds.length !== ids.length || new Set(cancelledIds).size !== ids.length ||
        !cancelledIds.every((id) => legacyIds.has(id))) return undefined;

    return current;
  } catch {
    return undefined;
  }
}

const DEFAULT_BASE_URL = 'https://qutrade.io/api/v2';
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// Share rate limits, signing order and identical in-flight public reads across clients.
// Pacing is endpoint-specific; /depth and /create_order permit 10 requests per second.
const serverStates = new Map();

/** @param {string} server API origin @returns Shared per-process IP budget */
function getServerState(server) {
  if (!serverStates.has(server)) {
    serverStates.set(server, {
      endpointQueues: new Map(),
      privateInFlight: new Map(),
      nextAllowed: new Map(),
      cooldownUntil: 0,
      tonces: new Map(),
      pendingPublic: new Map(),
    });
  }
  return serverStates.get(server);
}

/**
 * Pace each endpoint independently and serialize signed requests only while they are in flight
 * @template T
 * @param {string} server API origin
 * @param {string} endpoint Endpoint without query
 * @param {(state: ReturnType<typeof getServerState>) => Promise<T>} task One HTTP operation
 * @param {string} [key] Credential for tonce ordering; omit for public reads
 * @returns {Promise<T>} Operation result; mutations are never retried
 */
function scheduleRequest(server, endpoint, task, key) {
  const state = getServerState(server);
  const previous = state.endpointQueues.get(endpoint) || Promise.resolve();
  const request = previous.then(async () => {
    for (;;) {
      const delay = Math.max(state.cooldownUntil, state.nextAllowed.get(endpoint) || 0) - Date.now();
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      const inFlight = key && state.privateInFlight.get(key);
      if (inFlight) {
        await inFlight;
        continue;
      }

      const operation = Promise.resolve().then(() => task(state));
      if (key) state.privateInFlight.set(key, operation.catch(() => undefined));

      try {
        return await operation;
      } finally {
        if (key) state.privateInFlight.delete(key);
        const gap = ['/depth', '/create_order'].includes(endpoint) ? 110 : 1100;
        state.nextAllowed.set(endpoint, Date.now() + gap);
      }
    }
  });

  const settled = request.catch(() => undefined);
  state.endpointQueues.set(endpoint, settled);
  void settled.then(() => {
    if (state.endpointQueues.get(endpoint) === settled) state.endpointQueues.delete(endpoint);
  });

  return request;
}

/**
 * Creates a Qutrade v2 REST client.
 * Public methods resolve the exchange response envelope `{ result, payload }`.
 * Private requests are serialized so strictly increasing tonce values reach Qutrade in order.
 * @returns Qutrade API methods and configuration setter
 */
module.exports = function() {
  let baseUrl = DEFAULT_BASE_URL;
  let apiKey = '';
  let apiSecret = '';
  /** @type {QutradeLogger} */
  let logger = { log() {}, info() {}, warn() {}, error() {} };

  /**
   * Converts a Qutrade Ed25519 secret key from hex to a Node.js private key.
   * Qutrade's NaCl example uses a 64-byte secret key; 32-byte Ed25519 seeds are also accepted.
   * @param {string} secretHex Hex-encoded seed or NaCl secret key
   * @returns {crypto.KeyObject} Ed25519 private key
   */
  function createPrivateKey(secretHex) {
    if (typeof secretHex !== 'string' || !/^(?:[\da-f]{64}|[\da-f]{128})$/i.test(secretHex)) {
      throw new Error('Qutrade API secret must be 64 or 128 hexadecimal characters.');
    }

    const secretBytes = Buffer.from(secretHex, 'hex');
    const seed = secretBytes.subarray(0, 32);
    const key = crypto.createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
      format: 'der',
      type: 'pkcs8',
    });

    if (secretBytes.length === 64) {
      const derivedPublicKey = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
      if (!crypto.timingSafeEqual(derivedPublicKey, secretBytes.subarray(32))) {
        throw new Error('Qutrade API secret key has a mismatched Ed25519 public-key suffix.');
      }
    }

    return key;
  }

  /**
   * Serializes request parameters in the same sorted URL-encoded format used for the body and signature.
   * @param {QutradeParameters} parameters Request parameters
   * @returns {string} Sorted URL-encoded query string
   */
  function serializeParameters(parameters) {
    const sortedParameters = Object.keys(parameters)
        .filter((key) => parameters[key] !== undefined && parameters[key] !== null)
        .sort()
        .reduce((sorted, key) => {
          sorted[key] = String(parameters[key]);
          return sorted;
        }, {});

    return new URLSearchParams(sortedParameters).toString();
  }

  /**
   * Classify both public and private responses without exposing request credentials
   * @template T
   * @param {AxiosResponse|AxiosError} responseOrError HTTP response or transport error
   * @param {string} endpoint Endpoint for diagnostics
   * @returns {QutradeResponse<T>} Success envelope or definitive business refusal
   */
  function handleResponse(responseOrError, endpoint) {
    const response =
      'response' in responseOrError ?
        responseOrError.response :
        'data' in responseOrError ?
          responseOrError :
          undefined;
    const status = response?.status;
    let data = response?.data;
    if (status === 200 && ['/cancel_orders', '/cancel_all_orders'].includes(endpoint) && typeof data === 'string') {
      data = parseCancellationEnvelope(data) ?? data;
    }

    const code = Number(data?.code);
    const accessFailure = [401, 403, 408, 429].includes(status) || [401, 403, 408, 429].includes(code);
    const serverFailure = status >= 500 || code >= 500;

    if (
      status === 200 &&
      !accessFailure &&
      !serverFailure &&
      data?.result === 'success' &&
      !(code >= 400) &&
      Object.hasOwn(data, 'payload')
    ) {
      return data;
    }

    if (status === 429 || code === 429) {
      const retryAfter = response?.headers?.['retry-after'];
      const retryMs = /^\d+(\.\d+)?$/.test(String(retryAfter)) ?
        Number(retryAfter) * 1000 :
        Date.parse(String(retryAfter)) - Date.now();
      const state = getServerState(baseUrl);
      const retryAt = Date.now() + Math.max(3000, Number.isFinite(retryMs) ? retryMs : 0);
      state.cooldownUntil = Math.max(state.cooldownUntil, retryAt);
    }

    const refused = data?.result === 'error' && Number.isInteger(code) && code >= 400 && code < 500;
    // Definitive HTTP access/throttle refusals take precedence over a contradictory body.
    const httpRefusal = [401, 403, 429].includes(status);
    const uncertain = !httpRefusal && (serverFailure || !status || status === 408 || code === 408 || !refused);

    const text = [data?.message, data?.details].filter((v) => typeof v === 'string').join(': ');
    const description = httpErrorCodeDescriptions[status]?.description ||
      (status ? 'Unverified response' : 'Transport error');
    const transportCode = !status && 'code' in responseOrError && /^[A-Z0-9_]+$/.test(responseOrError.code) ?
      responseOrError.code : undefined;
    const message =
      `Qutrade ${endpoint}: HTTP ${status || 'unavailable'} ${description}` +
      `${Number.isInteger(code) ? ` [${code}]` : ''}${text ? `: ${text}` : ''}${transportCode ? ` (${transportCode})` : ''}`;
    logger.warn(message);

    if (!accessFailure && !serverFailure && status && refused) return data;
    throw new QutradeRequestError(message, status, uncertain);
  }

  /**
   * Sends a public GET request, sharing pacing and in-flight identical reads across instances.
   * @param {string} endpoint API path
   * @param {QutradeParameters} parameters Query parameters
   * @template T
   * @returns {Promise<QutradeResponse<T>>} Qutrade response envelope
   */
  function publicRequest(endpoint, parameters = {}) {
    const server = baseUrl;
    const queryString = serializeParameters(parameters);
    const url = `${server}${endpoint}${queryString ? `?${queryString}` : ''}`;
    const state = getServerState(server);
    if (state.pendingPublic.has(url)) return state.pendingPublic.get(url);

    const request = scheduleRequest(server, endpoint, async () => {
      const response = await axios({ url, method: 'get', timeout: 15000, transformResponse: [parseResponse] }).catch(
          (error) => error,
      );
      return handleResponse(response, endpoint);
    });
    const tracked = request.finally(() => state.pendingPublic.delete(url));
    state.pendingPublic.set(url, tracked);
    return tracked;
  }

  /**
   * Sends a serialized authenticated POST request with Ed25519 signing.
   * @param {string} endpoint API path
   * @param {QutradeParameters} parameters POST parameters excluding tonce
   * @template T
   * @returns {Promise<QutradeResponse<T>>} Qutrade response envelope
   */
  function protectedRequest(endpoint, parameters = {}) {
    const server = baseUrl;
    const requestKey = apiKey;
    let signingKey;
    try {
      if (!/^[\da-f]{64}$/i.test(requestKey)) throw new Error('Qutrade API key must be 64 hexadecimal characters.');
      signingKey = createPrivateKey(apiSecret);
    } catch (error) {
      return Promise.reject(new QutradeRequestError(String(error), undefined, false));
    }

    return scheduleRequest(server, endpoint, async (state) => {
      const tonce = Math.max(Date.now(), (state.tonces.get(requestKey) || 0) + 1);
      state.tonces.set(requestKey, tonce);
      const requestParameters = { ...parameters, tonce };
      const body = serializeParameters(requestParameters);
      const signature = crypto.sign(null, Buffer.from(endpoint + body, 'utf8'), signingKey).toString('hex');
      const response = await axios({
        url: `${server}${endpoint}`,
        method: 'post',
        timeout: 15000,
        transformResponse: [parseResponse],
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'API-KEY': requestKey,
          'API-SIGN': signature,
        },
        data: body,
      }).catch((error) => error);
      return handleResponse(response, endpoint);
    }, requestKey);
  }

  return {
    /**
     * Sets the Qutrade API credentials and server URL.
     * @param {string} server API base URL
     * @param {string} key 64-character public key in hex
     * @param {string} secret Ed25519 private key in hex
     * @param {string} _password Unused compatibility parameter
     * @param {QutradeLogger} log Logger with credential-free diagnostics
     * @param {boolean} [publicOnly=false] Do not configure private API credentials
     * @returns {void}
     */
    setConfig(server, key, secret, _password, log, publicOnly = false) {
      if (server) baseUrl = server.replace(/\/$/, '');
      if (log) logger = log;
      apiKey = publicOnly ? '' : key || '';
      apiSecret = publicOnly ? '' : secret || '';
    },

    /**
     * @param {string} [pair] Native BASE_QUOTE symbol; omit for all markets
     * @returns {Promise<QutradeResponse<Record<string,QutradeMarket>>>} Fresh market metadata and ticker
     * @see https://qutrade.io/en/?api_documentation_v2#spot_markets
     */
    markets(pair) {
      return publicRequest('/spot_markets', { pair });
    },

    /**
     * @returns {Promise<QutradeResponse<Record<string,QutradeCurrency>>>} Currency/network metadata
     * @see https://qutrade.io/en/?api_documentation_v2#cryptocurrencies
     */
    currencies() {
      return publicRequest('/cryptocurrencies');
    },

    /**
     * @param {string} pair Native pair
     * @param {number} [limit=100] Depth levels, at most 100
     * @returns {Promise<QutradeResponse<Record<string,QutradeDepth>>>} Aggregated price levels
     * @see https://qutrade.io/en/?api_documentation_v2#depth
     */
    orderBook(pair, limit = 100) {
      return publicRequest('/depth', { pair, limit });
    },

    /**
     * @param {boolean} [hideZeros=true] Hide zero-total currencies
     * @returns {Promise<QutradeResponse<Record<string,QutradeBalance>>>} Main-wallet balances
     * @see https://qutrade.io/en/?api_documentation_v2#balances
     */
    balances(hideZeros = true) {
      return protectedRequest('/balances', { hide_zeros: hideZeros });
    },

    /**
     * Read generated deposit addresses for one currency
     * @param {string} currency Exchange asset code
     * @returns {Promise<QutradeResponse<Record<string,QutradeDepositAddress[]>>>} Addresses grouped by currency
     * @see https://qutrade.io/en/?api_documentation_v2#deposit_addresses
     */
    depositAddresses(currency) {
      return protectedRequest('/deposit_addresses', { currency });
    },

    /**
     * @param {string} pair Native pair
     * @returns {Promise<QutradeResponse<QutradeOrder[]>>} Complete unpaginated active-order snapshot
     * @see https://qutrade.io/en/?api_documentation_v2#open_orders
     */
    openOrders(pair) {
      return protectedRequest('/open_orders', { pair });
    },

    /**
     * @param {string} pair Native pair
     * @returns {Promise<QutradeResponse<QutradeOrder[]>>} Pending stop orders
     * @see https://qutrade.io/en/?api_documentation_v2#pending_orders
     */
    pendingOrders(pair) {
      return protectedRequest('/pending_orders', { pair });
    },

    /**
     * @param {string} pair Native pair
     * @param {number} [minTimestamp=1] Inclusive creation time, seconds
     * @param {number} [maxTimestamp=9999999999] Inclusive upper bound, seconds
     * @param {number} [limit=1000] At most 1000 records
     * @returns {Promise<QutradeResponse<QutradeOrder[]>>} Newest-first history page
     * @see https://qutrade.io/en/?api_documentation_v2#order_history
     */
    orderHistory(pair, minTimestamp = 1, maxTimestamp = 9999999999, limit = 1000) {
      return protectedRequest('/order_history', {
        pair,
        min_timestamp_create: minTimestamp,
        max_timestamp_create: maxTimestamp,
        limit,
      });
    },

    /**
     * @param {string} pair Native pair
     * @param {QutradeSide} side Order direction
     * @param {QutradeOrderType} type limit or market for this adapter
     * @param {string} baseAmount Base target; omit for quote-sized markets
     * @param {string} quoteAmount Quote target; only one target for markets
     * @param {string} price Limit price; omit for markets
     * @param {string} label 1–25 ASCII alphanumeric characters; NOT an idempotency key
     * @returns {Promise<QutradeResponse<QutradeOrder>>} Full placed order
     * @see https://qutrade.io/en/?api_documentation_v2#create_order
     */
    createOrder(pair, side, type, baseAmount, quoteAmount, price, label) {
      return protectedRequest('/create_order', {
        pair,
        side,
        type,
        label,
        requested_base_amount: baseAmount,
        requested_quote_amount: quoteAmount,
        requested_price: price,
      });
    },

    /**
     * @param {string[]} orderIds Exchange IDs, encoded as one comma-separated form value
     * @returns {Promise<QutradeResponse<QutradeOrder[]>>} Cancellation evidence
     * @see https://qutrade.io/en/?api_documentation_v2#cancel_orders
     */
    cancelOrders(orderIds) {
      return protectedRequest('/cancel_orders', { order_id: orderIds.join(',') });
    },

    /**
     * @param {string} pair Required scope; never cancel other markets
     * @param {QutradeSide} [side] Optional direction
     * @returns {Promise<QutradeResponse<QutradeOrder[]>>} Cancelled orders, empty when none exist
     * @see https://qutrade.io/en/?api_documentation_v2#cancel_all_orders
     */
    cancelAllOrders(pair, side) {
      return protectedRequest('/cancel_all_orders', { pair, side });
    },

    /**
     * @param {string} pair Native pair
     * @param {number} [limit=300] Recent public executions, at most 1000
     * @returns {Promise<QutradeResponse<QutradeTrade[]>>} Public market trades
     * @see https://qutrade.io/en/?api_documentation_v2#trading_history
     */
    trades(pair, limit = 300) {
      return publicRequest('/trading_history', { pair, limit });
    },

    /**
     * @param {string} pair Native pair
     * @param {string} resolution 15, 1H, 1D, 1W or 1M
     * @param {number} [since=1] Inclusive lower opening time in seconds
     * @param {number} [until=9999999999] Inclusive upper opening time in seconds
     * @param {number} [limit=1000] Number of candles, at most 1000
     * @returns {Promise<QutradeResponse<QutradeCandle[]>>} Native candles
     * @see https://qutrade.io/en/?api_documentation_v2#candles_history
     */
    candles(pair, resolution, since = 1, until = 9999999999, limit = 1000) {
      return publicRequest('/candles_history', { pair, resolution, min_timestamp: since, max_timestamp: until, limit });
    },
  };
};

module.exports.axios = axios;
module.exports.QutradeRequestError = QutradeRequestError;
