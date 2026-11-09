// @ts-check
'use strict';

/**
 * @typedef {import('../../types/azbit/api.d.js').AzbitError} AzbitError
 * @typedef {import('../../types/azbit/api.d.js').AzbitBalances} AzbitBalances
 * @typedef {import('../../types/azbit/api.d.js').AzbitAccount} AzbitAccount
 * @typedef {import('../../types/azbit/api.d.js').AzbitKeyInfo} AzbitKeyInfo
 * @typedef {import('../../types/azbit/api.d.js').AzbitOrder} AzbitOrder
 * @typedef {import('../../types/azbit/api.d.js').AzbitCreateResult} AzbitCreateResult
 * @typedef {import('../../types/azbit/api.d.js').AzbitQueryResult} AzbitQueryResult
 * @typedef {import('../../types/azbit/api.d.js').AzbitTicker} AzbitTicker
 * @typedef {import('../../types/azbit/api.d.js').AzbitBookLevel} AzbitBookLevel
 * @typedef {import('../../types/azbit/api.d.js').AzbitDeal} AzbitDeal
 * @typedef {import('../../types/azbit/api.d.js').AzbitCandle} AzbitCandle
 * @typedef {import('../../types/azbit/api.d.js').AzbitChain} AzbitChain
 * @typedef {import('../../types/azbit/api.d.js').AzbitDeposit} AzbitDeposit
 * @typedef {import('../../types/azbit/api.d.js').AzbitCommissions} AzbitCommissions
 * @typedef {import('../../types/azbit/api.d.js').AzbitMarket} AzbitMarket
 * @typedef {import('../../types/azbit/api.d.js').AzbitCurrency} AzbitCurrency
 * @typedef {import('../../types/azbit/api.d.js').AzbitNetworkCommissions} AzbitNetworkCommissions
 * @typedef {import('axios').AxiosResponse} AxiosResponse
 * @typedef {'get' | 'post' | 'delete'} AzbitHttpMethod
 * @typedef {{log: Function, info: Function, warn: Function, error: Function}} AzbitLogger
 */

const nodeCrypto = require('node:crypto');
const axios = require('axios').default;

/**
 * Create an isolated Azbit spot REST client with byte-exact request signing
 * @returns Endpoint methods returning raw payloads or typed business rejections
 */
module.exports = function() {
  let baseUrl = 'https://data.azbit.com/api';
  const metadataBaseUrl = 'https://api2.azbit.com/api';
  let publicKey = '';
  let privateKey = '';
  let publicOnly = false;
  /** @type {Pick<AzbitLogger, 'warn'>} */
  let log = { warn() {} };

  /**
   * Classify an HTTP response or sanitize a transport failure without exposing signing headers
   * Temporary failures throw; final rejections resolve as AzbitError for the caller to interpret.
   * @template T
   * @param {AxiosResponse | Error} responseOrError HTTP result or transport exception
   * @param {AzbitHttpMethod} method Request verb for diagnostics
   * @param {string} path Endpoint path without credentials
   * @param {boolean} [emptySuccess] Whether this endpoint explicitly treats an empty response as success
   * @returns {T | AzbitError} Raw payload, explicit empty success or final rejection
   */
  function handleResponse(responseOrError, method, path, emptySuccess = false) {
    if (responseOrError instanceof Error) {
      // Axios errors carry headers and signatures in config: never propagate the original object.
      const code = axios.isAxiosError(responseOrError) ? responseOrError.code : 'transport failure';
      throw new Error(`Azbit ${method.toUpperCase()} ${path} transport failed — ${code || 'unknown transport failure'}`);
    }

    const response = responseOrError;
    const { status, data } = response;
    const message = typeof data === 'string' ? data :
      data?.errorsString || data?.Message || data?.message || (data?.errors ? JSON.stringify(data.errors) : response.statusText);

    const isTemporaryHttpError = status < 200 || (status >= 300 && status < 400) ||
      status >= 500 || [408, 423, 429].includes(status);

    if (isTemporaryHttpError) {
      throw new Error(`Azbit ${method.toUpperCase()} ${path} request failed — HTTP ${status} ${message || 'no response message'}`);
    }

    if (status >= 400 || data?.succeeded === false) {
      if ([401, 403].includes(status)) {
        log.warn(`Azbit ${method.toUpperCase()} ${path} authentication or authorization failed: ` +
          `HTTP ${status} [${message || 'no response message'}]`);
      }

      return {
        azbitErrorInfo: `HTTP ${status} — ${message || 'request rejected without a response message'}`,
        httpStatus: status,
        logicError: data?.logicError,
        code: data?.Code ?? data?.code,
      };
    }

    if (emptySuccess && (data === '' || data === undefined || status === 204)) return /** @type {T} */ (true);

    // Do not turn false, null, or missing read payloads into a successful boolean.
    return data;
  }

  /**
   * Build the exact URL used both on the wire and in the signature
   * @param {string} path Endpoint path relative to /api
   * @param {object} params Query parameters; undefined values are omitted
   * @param {string} [requestBaseUrl] API base; defaults to the signed/public trading API
   * @returns {string} Encoded request URL
   */
  function getRequestUrl(path, params, requestBaseUrl = baseUrl) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }

    return requestBaseUrl + path + (query.size ? `?${query}` : '');
  }

  /**
   * Send once and route every HTTP response or transport error through handleResponse
   * Mutations are never blindly retried after a timeout.
   * @template T
   * @param {AzbitHttpMethod} method HTTP verb
   * @param {string} path Endpoint path for diagnostics
   * @param {string} url Exact request URL
   * @param {Record<string, string>} [headers] Authentication headers for protected requests
   * @param {string} [payload] Already serialized body; omitted for bodyless requests
   * @param {boolean} [emptySuccess] Whether an empty response is the endpoint's success contract
   * @returns {Promise<T | AzbitError>} Classified response or sanitized rejection
   */
  async function sendRequest(method, path, url, headers = {}, payload, emptySuccess = false) {
    let response;
    try {
      response = await axios({
        url,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        data: payload,
        timeout: 10000,
        maxRedirects: 0,
        validateStatus: () => true,
      });
    } catch (error) {
      return handleResponse(error instanceof Error ? error : new Error('transport failure'), method, path, emptySuccess);
    }

    return handleResponse(response, method, path, emptySuccess);
  }

  /**
   * Read a public endpoint without attaching credentials
   * @template T
   * @param {AzbitHttpMethod} method HTTP verb
   * @param {string} path Endpoint path relative to /api
   * @param {object} [params] Query parameters; undefined values are omitted
   * @param {string} [requestBaseUrl] API base for official public metadata hosted on api2.azbit.com
   * @returns {Promise<T | AzbitError>} Raw exchange payload or classified failure
   */
  function publicRequest(method, path, params = {}, requestBaseUrl = baseUrl) {
    return sendRequest(method, path, getRequestUrl(path, params, requestBaseUrl));
  }

  /**
   * Sign a private request using the exact URL and serialized body sent to Azbit
   * GET and DELETE requests without a body sign the empty string and transmit no JSON body.
   * @template T
   * @param {AzbitHttpMethod} method HTTP verb
   * @param {string} path Endpoint path relative to /api
   * @param {object} [params] Query parameters; undefined values are omitted
   * @param {object} [body] Request body, serialized once for signing and transmission
   * @param {boolean} [emptySuccess] Whether an empty response is the endpoint's success contract
   * @returns {Promise<T | AzbitError>} Raw exchange payload or classified failure
   */
  async function protectedRequest(method, path, params = {}, body, emptySuccess = false) {
    if (publicOnly || !publicKey || !privateKey) {
      const reason = publicOnly ? 'client is in public-only mode' :
        !publicKey && !privateKey ? 'public and private keys are missing' : !publicKey ? 'public key is missing' : 'private key is missing';
      throw new Error(`Azbit private API is not configured — ${reason}`);
    }

    const url = getRequestUrl(path, params);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = {
      'API-PublicKey': publicKey,
      'API-Signature': nodeCrypto.createHmac('sha256', privateKey).update(publicKey + url + (payload ?? '')).digest('hex'),
    };

    return sendRequest(method, path, url, headers, payload, emptySuccess);
  }

  return {
    /**
     * Configure this client; credentials never escape through error objects
     * @param {string} apiServer HTTPS origin
     * @param {string} apiKey Public signing key
     * @param {string} secretKey Private HMAC key
     * @param {string} tradePwd Unused compatibility parameter
     * @param {AzbitLogger} logger Logger supplied by the trader
     * @param {boolean} [onlyPublic] Disable signed methods
     * @returns {void}
     */
    setConfig(apiServer, apiKey, secretKey, tradePwd, logger, onlyPublic = false) {
      if (apiServer) baseUrl = apiServer.replace(/\/$/, '') + '/api';
      if (logger && typeof logger.warn === 'function') log = logger;
      publicOnly = onlyPublic;
      publicKey = onlyPublic ? '' : apiKey;
      privateKey = onlyPublic ? '' : secretKey;
    },

    /**
     * Read the main spot wallet; the published REST endpoint has no account selector
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1wallets~1balances/get
     * @returns {Promise<AzbitBalances | AzbitError>} Available and order-blocked balances
     */
    getBalances() {
      return protectedRequest('get', '/wallets/balances', {});
    },

    /**
     * List UTA identities; accountType, not the editable name, identifies the main account
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1uta~1accounts/get
     * @returns {Promise<AzbitAccount[] | AzbitError>} UTA balances and account types
     */
    getAccounts() {
      return protectedRequest('get', '/uta/accounts', {});
    },

    /**
     * Inspect permissions without exercising trading or withdrawal rights
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1user~1api-keys~1current/get
     * @returns {Promise<AzbitKeyInfo | AzbitError>} Sensitive key metadata; do not log raw
     */
    getApiKeyInfo() {
      return protectedRequest('get', '/user/api-keys/current', {});
    },

    /**
     * Read spot orders; this endpoint has no documented pagination
     * @param {string} [pair] Native pair such as ADM_USDT; omit for all pairs
     * @param {'all'|'active'|'canceled'} [status] Server filter; the API spells `canceled` with one l
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1user~1orders/get
     * @returns {Promise<AzbitOrder[] | AzbitError>} Complete matching list
     */
    getOrders(pair, status) {
      return protectedRequest('get', '/user/orders', { currencyPairCode: pair, status });
    },

    /**
     * Read one order with its fills; empty deals do not prove zero execution
     * @param {string} orderId Exchange GUID
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1orders~1{orderId}~1deals/get
     * @returns {Promise<AzbitOrder | AzbitError>} Order or rejection
     */
    getOrderDeals(orderId) {
      return protectedRequest('get', `/orders/${encodeURIComponent(orderId)}/deals`, {});
    },

    /**
     * Place a spot limit order using the structured v200 result
     * The operation prose advertises isMarket, but both creation routes ignored that property in live verification.
     * @param {string} market Native pair
     * @param {number} amount Base quantity
     * @param {number} price Quote price per base unit
     * @param {'buy'|'sell'} side Direction
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1v200~1orders/post
     * @returns {Promise<AzbitCreateResult | AzbitError>} Result envelope
     */
    addOrder(market, amount, price, side) {
      return protectedRequest('post', '/v200/orders', {}, {
        side,
        currencyPairCode: market,
        amount,
        price,
      });
    },

    /**
     * Cancel the remaining quantity of one order
     * @param {string} orderId Exchange GUID
     * @param {string} [accountId] UTA ID; omission targets the main account
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1v200~1orders~1{orderId}/delete
     * @returns {Promise<AzbitQueryResult | AzbitError>} succeeded or stable logicError
     */
    cancelOrder(orderId, accountId) {
      return protectedRequest('delete', `/v200/orders/${encodeURIComponent(orderId)}`, { accountId });
    },

    /**
     * Use the exchange bulk cancellation endpoint, scoped to one pair
     * @param {string} pair Native pair, required to avoid accidental account-wide cancellation
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1orders/delete
     * @returns {Promise<boolean | AzbitError>} Empty HTTP success normalized to true
     */
    cancelAllOrders(pair) {
      if (!pair) return Promise.reject(new Error('Azbit bulk cancellation requires a pair'));

      return protectedRequest('delete', '/orders', { currencyPairCode: pair }, undefined, true);
    },

    /**
     * Read a spot ticker
     * @param {string} pair Native pair
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1tickers/get
     * @returns {Promise<AzbitTicker[] | AzbitError>} Ticker list
     */
    ticker(pair) {
      return publicRequest('get', '/tickers', { currencyPairCode: pair });
    },

    /**
     * Read ungrouped depth (up to 40 levels per side)
     * @param {string} pair Native pair
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1orderbook/get
     * @returns {Promise<AzbitBookLevel[] | AzbitError>} Book levels
     */
    orderBook(pair) {
      return publicRequest('get', '/orderbook', { currencyPairCode: pair });
    },

    /**
     * Read public trades, never private account executions
     * @param {string} pair Native pair
     * @param {number} [pageSize] Trades per page (200 verified live)
     * @param {number} [pageNumber] One-based page index
     * @param {string} [sinceDate] Inclusive UTC ISO lower bound
     * @param {string} [endDate] UTC ISO upper bound
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1deals/get
     * @returns {Promise<AzbitDeal[] | AzbitError>} Trade list
     */
    getTradesHistory(pair, pageSize = 200, pageNumber = 1, sinceDate, endDate) {
      return publicRequest('get', '/deals', { currencyPairCode: pair, pageSize, pageNumber, sinceDate, endDate });
    },

    /**
     * Read native candles over a server-filtered UTC interval
     * @param {string} pair Native pair
     * @param {string} interval minute, minutes3/5/15/30, hour, hour4, day, month, or year
     * @param {string} start Inclusive UTC ISO range start
     * @param {string} end UTC ISO range end
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1ohlc/get
     * @returns {Promise<AzbitCandle[] | AzbitError>} Sparse candle list
     */
    getCandlesHistory(pair, interval, start, end) {
      return publicRequest('get', '/ohlc', { interval, currencyPairCode: pair, start, end });
    },

    /**
     * Read listed currency codes; network and availability metadata are not included
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1currencies/get
     * @returns {Promise<string[] | AzbitError>} Currency codes
     */
    getCurrencies() {
      return publicRequest('get', '/currencies');
    },

    /**
     * Read detailed currency, availability and chain metadata used by the Azbit web application
     * The newer data API exposes currency codes only; this official API2 route retains the detailed schema.
     * @see https://api2.azbit.com/swagger/v1/swagger.json#/paths/~1api~1currencies/get
     * @returns {Promise<AzbitCurrency[] | AzbitError>} Detailed currency definitions
     */
    getCurrenciesDetails() {
      return publicRequest('get', '/currencies', {}, metadataBaseUrl);
    },

    /**
     * Read per-chain deposit fees, withdrawal fees and minimum withdrawal amounts
     * @see https://api2.azbit.com/swagger/v1/swagger.json#/paths/~1api~1currency-pairs~1network-commissions/get
     * @returns {Promise<AzbitNetworkCommissions[] | AzbitError>} Network fee schedule
     */
    getNetworkCommissions() {
      return publicRequest('get', '/currency-pairs/network-commissions', {}, metadataBaseUrl);
    },

    /**
     * Read the chain ID dictionary for deposit address normalization
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1currencies~1chains/get
     * @returns {Promise<AzbitChain[] | AzbitError>} Chain names
     */
    getChains() {
      return publicRequest('get', '/currencies/chains');
    },

    /**
     * Read deposit addresses without moving funds
     * @param {string} coin Currency code
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1deposit-address~1{currencyCode}/get
     * @returns {Promise<AzbitDeposit[] | AzbitError>} Addresses including memo and chain
     */
    getDepositAddress(coin) {
      return protectedRequest('get', `/deposit-address/${encodeURIComponent(coin)}`, {});
    },

    /**
     * Read the account's commission schedule
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1currencies~1user~1commissions/get
     * @returns {Promise<AzbitCommissions | AzbitError>} Currency-level commissions
     */
    getFees() {
      return protectedRequest('get', '/currencies/user/commissions', {});
    },

    /**
     * Read effective spot minimums and precision
     * @see https://data.azbit.com/swagger/v1/swagger.json#/paths/~1api~1currencies~1pairs/get
     * @returns {Promise<AzbitMarket[] | AzbitError>} Pair rules
     */
    markets() {
      return publicRequest('get', '/currencies/pairs');
    },
  };
};

module.exports.axios = axios;
