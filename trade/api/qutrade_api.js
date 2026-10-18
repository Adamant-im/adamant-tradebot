'use strict';

const crypto = require('crypto');
const axios = require('axios');

const DEFAULT_BASE_URL = 'https://qutrade.io/api/v2';
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// All connector instances in this process share the exchange's request budget.
// Leave a margin beyond the documented one-second windows, measured after responses.
const serverStates = new Map();
const REQUEST_GAP_MS = 1500;

function getServerState(server) {
  if (!serverStates.has(server)) {
    serverStates.set(server, {
      queue: Promise.resolve(), nextAllowedAt: 0, tonces: new Map(), pendingPublic: new Map(),
    });
  }
  return serverStates.get(server);
}

function scheduleRequest(server, endpoint, task) {
  const state = getServerState(server);
  const request = state.queue.catch(() => undefined).then(async () => {
    const delay = state.nextAllowedAt - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    let cooldown = REQUEST_GAP_MS;
    try {
      return await task(state);
    } catch (error) {
      const status = error.response?.status || error.status;
      if (status === 429) {
        const retryAfter = error.response?.headers?.['retry-after'];
        const retryDelay = Number.isFinite(Number(retryAfter)) ?
          Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        cooldown = Math.max(3000, Number.isFinite(retryDelay) ? retryDelay : 0);
      }
      if (error.isQutradeError) throw error;

      // Never expose Axios request config, signed bodies, or authentication headers.
      const data = error.response?.data;
      const details = [data?.message, data?.details].filter((value) => typeof value === 'string').join(': ');
      const safeError = new Error(`Qutrade ${endpoint} request failed${status ? ` (HTTP ${status})` : ''}${details ? `: ${details}` : '.'}`);
      safeError.status = status;
      throw safeError;
    } finally {
      // No automatic retries: a failed order submission may already have reached the exchange.
      state.nextAllowedAt = Date.now() + cooldown;
    }
  });
  state.queue = request.catch(() => undefined);
  return request;
}

/**
 * Creates a Qutrade v2 REST client.
 * Public methods resolve the exchange response envelope `{ result, payload }`.
 * Private requests are serialized so strictly increasing tonce values reach Qutrade in order.
 * @returns {Object} Qutrade API methods and configuration setter
 */
module.exports = function() {
  let baseUrl = DEFAULT_BASE_URL;
  let apiKey = '';
  let apiSecret = '';

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
   * @param {Object<string, string|number|boolean>} parameters Request parameters
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
   * Validates and returns a successful Qutrade response envelope.
   * @param {Object} response Axios response
   * @param {string} endpoint API path for diagnostics
   * @returns {Object} Qutrade response envelope
   */
  function unwrapResponse(response, endpoint) {
    const data = response?.data;
    if (!data || data.result !== 'success') {
      const details = [data?.message, data?.details].filter(Boolean).join(': ');
      const type = Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data;
      const keys = data && typeof data === 'object' ? Object.keys(data).slice(0, 12).join(',') : '';
      const summary = `HTTP ${response?.status || 'unknown'}, body ${type}, keys [${keys}], result type ${typeof data?.result}`;
      const suffix = details ? `: ${details}` : ` (invalid response: ${summary}).`;
      const error = new Error(`Qutrade ${endpoint} failed${data?.code ? ` (${data.code})` : ''}${suffix}`);
      error.status = Number(data?.code) || response?.status;
      error.isQutradeError = true;
      throw error;
    }
    return data;
  }

  /**
   * Sends a public GET request, sharing pacing and in-flight identical reads across instances.
   * @param {string} endpoint API path
   * @param {Object<string, string|number|boolean>} parameters Query parameters
   * @returns {Promise<Object>} Qutrade response envelope
   */
  function publicRequest(endpoint, parameters = {}) {
    const server = baseUrl;
    const queryString = serializeParameters(parameters);
    const url = `${server}${endpoint}${queryString ? `?${queryString}` : ''}`;
    const state = getServerState(server);
    if (state.pendingPublic.has(url)) return state.pendingPublic.get(url);

    const request = scheduleRequest(server, endpoint, async () => {
      const response = await axios({ url, method: 'get', timeout: 15000 });
      return unwrapResponse(response, endpoint);
    });
    const tracked = request.finally(() => state.pendingPublic.delete(url));
    state.pendingPublic.set(url, tracked);
    return tracked;
  }

  /**
   * Sends a serialized authenticated POST request with Ed25519 signing.
   * @param {string} endpoint API path
   * @param {Object<string, string|number|boolean>} parameters POST parameters excluding tonce
   * @returns {Promise<Object>} Qutrade response envelope
   */
  function protectedRequest(endpoint, parameters = {}, signal) {
    const server = baseUrl;
    const requestKey = apiKey;
    let signingKey;
    try {
      if (!/^[\da-f]{64}$/i.test(requestKey)) throw new Error('Qutrade API key must be 64 hexadecimal characters.');
      signingKey = createPrivateKey(apiSecret);
    } catch (error) {
      return Promise.reject(error);
    }

    return scheduleRequest(server, endpoint, async (state) => {
      signal?.throwIfAborted();
      const tonce = Math.max(Date.now(), (state.tonces.get(requestKey) || 0) + 1);
      state.tonces.set(requestKey, tonce);
      const requestParameters = { ...parameters, tonce };
      const body = serializeParameters(requestParameters);
      const signature = crypto.sign(null, Buffer.from(endpoint + body, 'utf8'), signingKey).toString('hex');
      const response = await axios({
        url: `${server}${endpoint}`,
        method: 'post',
        timeout: 15000,
        signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'API-KEY': requestKey,
          'API-SIGN': signature,
        },
        data: body,
      });
      return unwrapResponse(response, endpoint);
    });

  }

  return {
    /**
     * Sets the Qutrade API credentials and server URL.
     * @param {string} server API base URL
     * @param {string} key 64-character public key in hex
     * @param {string} secret Ed25519 private key in hex
     * @param {string} _password Unused compatibility parameter
     * @param {Object} log Logger used by the bot (reserved for connector compatibility)
     * @param {boolean} [publicOnly=false] Do not configure private API credentials
     * @returns {void}
     */
    setConfig(server, key, secret, _password, log, publicOnly = false) {
      if (server) baseUrl = server.replace(/\/$/, '');
      void log;
      if (!publicOnly) {
        apiKey = key || '';
        apiSecret = secret || '';
      }
    },

    /** @returns {Promise<Object>} All Qutrade spot markets or the requested pair */
    markets(pair) {
      return publicRequest('/spot_markets', pair ? { pair: pair.replace('/', '_').toUpperCase() } : {});
    },

    /** @returns {Promise<Object>} Qutrade order-depth response */
    orderBook(pair, limit = 100) {
      return publicRequest('/depth', { pair: pair.replace('/', '_').toUpperCase(), limit });
    },

    /** @returns {Promise<Object>} Qutrade account-balance response */
    balances(hideZeros = true) {
      return protectedRequest('/balances', { hide_zeros: hideZeros });
    },

    /** @returns {Promise<Object>} Qutrade open-orders response */
    openOrders(pair) {
      return protectedRequest('/open_orders', pair ? { pair: pair.replace('/', '_').toUpperCase() } : {});
    },

    /** @returns {Promise<Object>} Pending stop orders for the requested pair */
    pendingOrders(pair) {
      return protectedRequest('/pending_orders', { pair: pair.replace('/', '_').toUpperCase() });
    },

    /** @returns {Promise<Object>} Recent order history, used to verify missing orders */
    orderHistory(pair, minTimestamp = 1) {
      return protectedRequest('/order_history', {
        pair: pair.replace('/', '_').toUpperCase(), min_timestamp_create: minTimestamp, limit: 1000,
      });
    },

    /** @returns {Promise<Object>} Qutrade create-order response */
    createOrder(parameters, signal) {
      return protectedRequest('/create_order', parameters, signal);
    },

    /**
     * Cancels one or more order IDs with Qutrade's comma-separated order_id parameter.
     * @param {Array<string|number>} orderIds Order identifiers to cancel
     * @returns {Promise<Object>} Qutrade cancellation response
     */
    cancelOrders(orderIds) {
      return protectedRequest('/cancel_orders', { order_id: orderIds.map(String).join(',') });
    },

    /** @returns {Promise<Object>} Qutrade cancel-all response */
    cancelAllOrders() {
      return protectedRequest('/cancel_all_orders');
    },
  };
};
