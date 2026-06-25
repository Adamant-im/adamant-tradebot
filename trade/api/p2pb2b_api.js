const nodeCrypto = require('node:crypto');
const utils = require('../../helpers/utils');

/** @type {import('axios').AxiosInstance} */
// @ts-ignore: axios is a callable instance
const axios = require('axios');

module.exports = function() {
  const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
  };

  let WEB_BASE = ''; // To be set in setConfig()
  const WEB_BASE_PREFIX = '/api/v2';
  let config = {
    apiKey: '',
    secret_key: '',
  };
  let log = {};

  const { errorCodeDescriptions, httpErrorCodeDescriptions } = require('./p2pb2b_errors');

  /**
   * Handles response from API (both success and error).
   *
   * Decides whether to resolve or reject the original Promise based on:
   *  - HTTP status code
   *  - P2PB2B payload fields: `success`, `errorCode`, `status`, `message`
   *
   * @param {import('axios').AxiosResponse|import('axios').AxiosError|any} responseOrError
   * @param {(value: any) => void} resolve
   * @param {(reason?: any) => void} reject
   * @param {string|undefined} queryString Parameters string for logging (query string for GET or serialized body for POST)
   * @param {string} url Base URL without query
   * @returns {void}
   */
  const handleResponse = (responseOrError, resolve, reject, bodyString, queryString, url) => {
    const httpCode = responseOrError?.status ?? responseOrError?.response?.status;
    const httpMessage = responseOrError?.statusText ?? responseOrError?.response?.statusText;

    const httpCodeInfo = httpErrorCodeDescriptions[httpCode] ?? httpErrorCodeDescriptions[String(httpCode)?.[0]];

    const p2bData = responseOrError?.data ?? responseOrError?.response?.data ?? responseOrError;
    const success = p2bData?.success === true;

    const p2bErrorCode = p2bData?.errorCode || p2bData?.status || 'No error code';
    const errorCodeInfo = errorCodeDescriptions[p2bErrorCode];
    const errorMessageFromData = p2bData?.message ?? p2bData?.errors?.message?.[0];

    const error = {
      code: p2bErrorCode,
      message: errorMessageFromData || errorCodeInfo?.description || 'No error message',
    };

    const reqParameters = queryString || bodyString || '{ No parameters }';

    try {
      if (success) {
        resolve(p2bData);
        return;
      }

      const p2bErrorInfo = `[${error.code}] ${utils.trimAny(error.message, ' .')}`;
      const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${p2bErrorInfo}` : String(responseOrError);

      if (p2bData && typeof p2bData === 'object') {
        // Attach human-readable error info
        p2bData.p2bErrorInfo = p2bErrorInfo;
      }

      const isTemporary = Boolean(httpCodeInfo?.isTemporary) || Boolean(errorCodeInfo?.isTemporary);

      if (httpCode && !isTemporary) {
        log.log(`P2PB2B processed a request to ${url} with data ${reqParameters}, but with error: ${errorMessage}. Resolving…`);

        resolve(p2bData);
      } else {
        log.warn(`Request to ${url} with data ${reqParameters} failed: ${errorMessage}. Rejecting…`);

        reject(errorMessage);
      }
    } catch (errorProcessing) {
      log.warn(`Error while processing response of request to ${url} with data ${reqParameters}: ${errorProcessing}. Data object I've got: ${JSON.stringify(p2bData)}.`,
      );
      reject(`Unable to process data: ${JSON.stringify(p2bData)}. ${errorProcessing}`);
    }
  };

  /**
   * Sends a public (unauthenticated) GET request to the P2PB2B API.
   *
   * @param {string} path Endpoint path (without base URL), e.g. `/public/ticker`
   * @param {Object} [data={}] Query parameters object
   * @returns {Promise<any>} Promise resolving to parsed P2PB2B response
   */
  const publicRequest = (path, data = {}) => {
    let url = `${WEB_BASE}${path}`;
    const urlBase = url;

    const params = [];
    for (const key in data) {
      const v = data[key];
      params.push(`${key}=${v}`);
    }

    const queryString = params.join('&');
    if (queryString) {
      url = `${url}?${queryString}`;
    }

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url,
        method: 'get',
        timeout: 20000,
        headers: DEFAULT_HEADERS,
      };

      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, undefined, queryString, urlBase))
          .catch((error) => handleResponse(error, resolve, reject, undefined, queryString, urlBase));
    });
  };

  /**
   * Sends a private (authenticated) POST request to the P2PB2B API.
   *
   * Automatically adds:
   *   - `request` (path with `/api/v2` prefix)
   *   - `nonce` (current timestamp)
   *   - Authentication headers (`X-TXC-APIKEY`, `X-TXC-PAYLOAD`, `X-TXC-SIGNATURE`)
   *
   * @param {string} path Endpoint path (without base URL), e.g. `/orders`
   * @param {Object} [data={}] Request payload object
   * @returns {Promise<any>} Promise resolving to parsed P2PB2B response
   */
  const protectedRequest = (path, data = {}) => {
    const url = `${WEB_BASE}${path}`;
    const urlBase = url;

    let headers;
    let bodyString;

    try {
      data = {
        ...data,
        request: `${WEB_BASE_PREFIX}${path}`,
        nonce: Date.now(),
      };

      bodyString = getBody(data);
      const payload = getPayload(bodyString);
      const signature = getSignature(payload);

      headers = {
        ...DEFAULT_HEADERS,
        'X-TXC-APIKEY': config.apiKey,
        'X-TXC-PAYLOAD': payload,
        'X-TXC-SIGNATURE': signature,
      };
    } catch (err) {
      log.log(`Processing of request to ${url} with data ${bodyString} failed. ${err}.`);
      return Promise.reject(err.toString());
    }

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url,
        method: 'post',
        timeout: 20000,
        data,
        headers,
      };

      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, bodyString, undefined, urlBase))
          .catch((error) => handleResponse(error, resolve, reject, bodyString, undefined, urlBase));
    });
  };

  /**
   * Serializes the payload object to JSON.
   *
   * @param {Object} data Body object
   * @returns {string} JSON string representation
   */
  const getBody = (data) => JSON.stringify(data);

  /**
   * Encodes body JSON string into base64 payload string.
   *
   * @param {string} body JSON body string
   * @returns {string} Base64-encoded payload
   */
  const getPayload = (body) => Buffer.from(body).toString('base64');

  /**
   * Creates HMAC-SHA512 signature for the given payload.
   *
   * @param {string} payload Base64-encoded payload
   * @returns {string} Hex-encoded signature
   */
  const getSignature = (payload) =>
    nodeCrypto.createHmac('sha512', config.secret_key).update(payload).digest('hex');

  const EXCHANGE_API = {
    /**
     * Sets API configuration: base URL, keys and logger.
     *
     * @param {string} apiServer Base API server URL, e.g. `https://api.p2pb2b.com`
     * @param {string} apiKey Public API key
     * @param {string} secretKey Secret API key
     * @param {string} tradePwd Trading password (not used in REST v2, reserved)
     * @param {{log: Function, warn: Function}|undefined} logger Logger instance
     * @param {boolean} [publicOnly=false] If true, skip private API configuration
     * @returns {void}
     */
    setConfig(apiServer, apiKey, secretKey, tradePwd, logger, publicOnly = false) {
      if (apiServer) {
        WEB_BASE = apiServer + WEB_BASE_PREFIX;
      }

      if (logger) {
        log = logger;
      }

      if (!publicOnly) {
        config = {
          apiKey,
          secret_key: secretKey,
        };
      }
    },

    /**
     * Returns list of user balances for all currencies.
     *
     * @returns {Promise<any>} Raw P2PB2B response with balances
     */
    getBalances() {
      const data = {};
      return protectedRequest('/account/balances', data);
    },

    /**
     * Queries active orders of the account.
     *
     * @param {string} [pair] Market symbol in P2PB2B format, e.g. `ETH_USDT`
     * @param {number} [offset=0] Offset, min 0, max 10000
     * @param {number} [limit=100] Limit, min 1, default 50, max 100
     * @returns {Promise<any>} Raw P2PB2B response with orders list
     * @see https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md#open-orders
     */
    getOrders(pair, offset = 0, limit = 100) {
      const data = {};
      if (pair) data.market = pair;
      if (offset) data.offset = offset;
      if (limit) data.limit = limit;

      return protectedRequest('/orders', data);
    },

    /**
     * Queries orders history of the account.
     * Note, it seems only filled (not even partially filled) are returning.
     * Only the transaction records in the **past 3 month** can be queried.
     *
     * @param {string} pair Market symbol in P2PB2B format, e.g. `ETH_USDT`
     * @param {number} startTimeMs Time from
     * @param {number} endTimeMs Time to; Greater value than `startTimeMs`. The time between startTime and endTime can't be longer than 24 hours (86400 seconds).
     * @param {number} [offset=0] Offset, min 0, max 10000
     * @param {number} [limit=100] Limit, min 1, default 50, max 100
     * @returns {Promise<any>} Raw P2PB2B response with orders list
     * @see https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md#orders-history-by-market
     */
    getFinishedOrders(pair, startTimeMs, endTimeMs, offset = 0, limit = 100) {
      const data = {
        market: pair,
        startTime: Math.round(startTimeMs / 1000), // Exchange operates with timestamps in seconds (fractional numbers not allowed)
        endTime: Math.round(endTimeMs / 1000),
      };

      if (offset) data.offset = offset;
      if (limit) data.limit = limit;

      return protectedRequest('/account/market_order_history', data);
    },

    /**
     * Queries order deals for a specific order.
     * Note, it seems only fills for fully filled orders are returning.
     *
     * Notes:
     *  - Results are cached; just-filled orders may temporarily return `[]`.
     *  - Invalid orderId: `{ success: false, errorCode: 3080, message: 'Invalid orderId value', ... }`
     *  - No deals / cancelled / non-existent: `{ success: true, result: { offset: 0, limit: 100, records: [] }, ... }`
     *
     * @param {string|number} orderId Exchange order ID, e.g. `120531775560`
     * @param {number} [offset=0] Min 0, max 10000
     * @param {number} [limit=100] Min 1, default 50, max 100
     * @returns {Promise<any>} Raw P2PB2B response with deals data
     * @see https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md#deals-by-order-id
     */
    getOrderDeals(orderId, offset = 0, limit = 100) {
      const data = {
        orderId,
        offset,
        limit,
      };

      return protectedRequest('/account/order', data);
    },

    /**
     * Places a Limit order. Market orders are not supported in this adapter.
     *
     * @param {string} market Market in P2PB2B format, e.g. `ETH_USDT`
     * @param {string} amount Order amount in base currency
     * @param {string} price Order price in quote currency
     * @param {'buy'|'sell'} side Order side
     * @returns {Promise<any>} Raw P2PB2B response with order placement result
     * @see https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md#create-order
     */
    addOrder(market, amount, price, side) {
      const data = {
        market,
        amount,
        price,
        side,
      };

      return protectedRequest('/order/new', data);
    },

    /**
     * Cancels an order.
     *
     * @param {string|number} orderId Exchange order ID, e.g. 171906478744
     * @param {string} market Market in P2PB2B format, e.g. `ETH_USDT`
     * @returns {Promise<any>} Raw P2PB2B response with cancellation result
     * @see https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md#cancel-order
     */
    cancelOrder(orderId, market) {
      const data = {
        orderId,
        market,
      };

      return protectedRequest('/order/cancel', data);
    },

    /**
     * Returns ticker data (market rates) for a given market.
     *
     * @param {string} market Market symbol, e.g. `BTC_USDT`
     * @returns {Promise<any>} Raw P2PB2B response with ticker data
     * @see https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md#ticker
     */
    ticker(market) {
      const data = {
        market,
      };

      return publicRequest('/public/ticker', data);
    },

    /**
     * Returns order book (market depth) for a given market.
     *
     * @param {string} pair Market symbol, e.g. `BTC_USDT`
     * @param {number} [limit=100] Min 1, default 500, max 1000
     * @param {number} [interval=0]
     *   One of: 0, 0.00000001, 0.0000001, 0.000001, 0.00001, 0.0001, 0.001, 0.01, 0.1, 1
     * @returns {Promise<any>} Raw P2PB2B response with depth data
     * @see https://github.com/P2pb2b-team/p2pb2b-api-docs/blob/master/api-doc.md#depth-result
     */
    orderBook(pair, limit = 100, interval = 0) {
      const data = {
        market: pair,
      };
      if (limit) data.limit = limit;
      if (interval) data.interval = interval;

      return publicRequest('/public/depth/result', data);
    },

    /**
     * Returns trades history for a market.
     * Results are cached for ~5 seconds.
     *
     * @param {string} market Trading pair, e.g. `BTC_USDT`
     * @param {number} [lastId=1] Executed order ID (mandatory by docs). If `lastId = 1`, API usually returns latest trades.
     * @param {number} [limit=100] Min 1, default 50, max 100
     * @returns {Promise<any>} Raw P2PB2B response with trades history
     * @see https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md#history
     */
    getTradesHistory(market, lastId = 1, limit = 100) {
      const data = {
        market,
        lastId,
        limit,
      };

      return publicRequest('/public/history', data);
    },

    /**
     * Returns info about all markets.
     *
     * @returns {Promise<any>} Raw P2PB2B response with markets metadata
     * @see https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md#markets
     */
    markets() {
      const data = {};
      return publicRequest('/public/markets', data);
    },
  };

  return EXCHANGE_API;
};
