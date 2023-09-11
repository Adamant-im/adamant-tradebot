const crypto = require('crypto');
const axios = require('axios');

const {
  trimAny,
  getParamsString,
} = require('../../helpers/utils');

/**
 * Docs: https://fameex-docs.github.io/docs/api/spot/en/#introduction
 * !WARNING!
 * It should be noted that some methods may cause problems because the documentation is not up to date:
 *   - some of the methods do not exist anymore;
 *   - there are no descriptions for many error codes;
 *   - parameters, their types and their mandatory values do not correspond to reality;
 *   - also some methods return an invalid data set.
 *
 * Several problematic APIs:
 *   - `v1/api/spot/fills` duplicates orders, because of which their number does not correspond to reality, should use `v1/api/spot/orderlist`;
 *   - `v1/api/spot/orderlist` pageno parameter does not exist, instead you should send pageNum, startTime and endTime are not mandatory, but pageSize and pageNum are mandatory, in addition pageNum, pageSize, side and state are numeric values, not strings as specified in the documentation;
 *   - `v1/api/orders_pending` no longer exists.
 */
module.exports = function() {
  let WEB_BASE = 'https://api.fameex.com';
  let config = {
    apiKey: '',
    secret_key: '',
    tradePwd: '',
  };
  let log = {};

  // Error codes: https://fameex-docs.github.io/docs/api/spot/en/#error-message
  const httpErrorCodeDescriptions = {
    112002: 'API single key traffic exceeds limit',
    112005: 'API request frequency exceeded',
    112009: 'The number of API-Key creation exceeds the limit (a single user can create up to 5 APIs)',
    112010: 'API-Key is invalid (the time limit for a single Key is 60 natural days)',
    112011: 'API request IP access is restricted (the bound IP is inconsistent with the request IP)',
    112015: 'Signature error',
    112020: 'Wrong signature',
    112021: 'Wrong signature version',
    112022: 'Signature timestamp error',
    112047: 'The spot API interface is temporarily inaccessible',
    112048: 'The futures API interface is temporarily inaccessible',
    112400: 'Parameter error',
    280006: 'Parameter error',
    230030: 'Please operate after KYC certification',
    280033: 'There are no cancelable orders',
  };

  const temporaryErrorsCodes = [
    112002,
    112005,
    112009,
    112010,
    112015,
    112020,
    112021,
    112022,
    112047,
    112048,
    230030,
  ];

  const statusCodes = {
    ok: 200,
    zero: '0',
  };

  const versioning = {
    v1: '/v1',
    v2: '/v2',
  };

  /**
   * Handles response from API
   * @param {Object} responseOrError
   * @param resolve
   * @param reject
   * @param {String} bodyString
   * @param {String} queryString
   * @param {String} url
   */
  const handleResponse = (responseOrError, resolve, reject, queryString, url) => {
    const httpCode = responseOrError?.status ?? responseOrError?.response?.status;
    const httpMessage = responseOrError?.statusText ?? responseOrError?.response?.statusText;

    const data = responseOrError?.data ?? responseOrError?.response?.data;
    const success = httpCode === statusCodes.ok &&
      (data.code === statusCodes.ok || (data.code === statusCodes.zero) || Array.isArray(data)) &&
      data.data?.timestamp !== 0;

    const error = {
      code: data?.code ?? 'No error code',
      msg: httpErrorCodeDescriptions[data?.code] ?? data?.msg ?? 'Unknown error',
    };

    const reqParameters = queryString || '{ No parameters }';

    try {
      if (success) {
        resolve(data);
      } else {
        const fameexErrorInfo = `[${error.code}] ${trimAny(error.msg, ' .')}`;

        const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${fameexErrorInfo}` : String(responseOrError);

        if (typeof data === 'object') {
          data.fameexErrorInfo = fameexErrorInfo;
        }

        if (httpCode === statusCodes.ok && !temporaryErrorsCodes.includes(data?.code) && data.data?.timestamp !== 0) {
          log.log(`FameEX processed a request to ${url} with data ${reqParameters}, but with error: [${error.code}] ${error.msg}. Resolving…`);
          resolve(data);
        } else {
          log.warn(`Request to ${url} with data ${reqParameters} failed. details: ${errorMessage}. Rejecting…`);

          reject(errorMessage);
        }
      }
    } catch (error) {
      log.warn(`Error while processing response of request to ${url} with data ${reqParameters}: ${error}. Data object I've got: ${JSON.stringify(data)}.`);
      reject(`Unable to process data: ${JSON.stringify(data)}. ${error}`);
    }
  };

  /**
   * Makes a request to private (auth) endpoint
   * @param {String} type Request type: get, post, delete
   * @param {String} path Endpoint
   * @param {Object} data Request params
   * @returns {Promise<any>}
   */
  function protectedRequest(type, path, data) {
    const url = `${WEB_BASE}${path}`;

    const bodyString = getParamsString(data);
    const stringifiedData = JSON.stringify(data);

    const timestamp = Date.now();

    const signPayload = type === 'post' ?
      stringifiedData :
      bodyString.length ?
        `?${bodyString}` :
        '';

    const method = type.toUpperCase();

    const sign = getSignature(config.secret_key, timestamp, method, path, signPayload);

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url,
        method: type,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'AccessKey': config.apiKey,
          'SecretKey': config.secret_key,
          'Timestamp': timestamp,
          'SignatureVersion': 'v1.0',
          'SignatureMethod': 'HmacSHA256',
          'Signature': sign,
        },
        data: type === 'post' ? stringifiedData : undefined,
        params: type === 'post' ? undefined : data,
      };

      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, bodyString, url))
          .catch((error) => handleResponse(error, resolve, reject, bodyString, url));
    });
  }

  /**
   * Makes a request to public endpoint
   * @param {String} type Request type: get, post, delete
   * @param {String} path Endpoint
   * @param {Object} data Request params
   * @returns {Promise<any>}
   */
  function publicRequest(type, path, params) {
    const url = `${WEB_BASE}${path}`;

    const queryString = getParamsString(params);

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url,
        params,
        method: type,
        timeout: 10000,
      };

      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, queryString, url))
          .catch((error) => handleResponse(error, resolve, reject, queryString, url));
    });
  }

  /**
   * Get a signature for a FameEX request
   * https://fameex-docs.github.io/docs/api/spot/en/#signature
   * @param {String} secret API secret key
   * @param {Number} timestamp Unix timestamp
   * @param {String} method GET or POST
   * @param {String} requestPath Request interface path
   * @param {String} payload Data to sign
   * @returns {String}
   */
  function getSignature(secret, timestamp, method, requestPath, payload) {
    return crypto.createHmac('sha256', secret)
        .update(timestamp + method + requestPath + payload)
        .digest('hex');
  };

  const EXCHANGE_API = {
    setConfig(apiServer, apiKey, secretKey, tradePwd, logger, publicOnly = false) {
      if (apiServer) {
        WEB_BASE = apiServer;
      }

      if (logger) {
        log = logger;
      }

      if (!publicOnly) {
        config = {
          apiKey,
          tradePwd,
          secret_key: secretKey,
        };
      }
    },

    /**
     * Get user assets balance
     * https://fameex-docs.github.io/docs/api/spot/en/#get-wallet-info
     * @return {Promise<Array>}
     */
    getBalances() {
      return protectedRequest('get', `${versioning.v1}/api/account/wallet`, {});
    },

    /**
     * Get a list of orders
     * https://fameex-docs.github.io/docs/api/spot/en/#get-a-list-of-orders
     * !POSSIBLE IMPLEMENTATION ERRORS!
     * !At the moment it is impossible to implement this functional correctly, due to problems on the FameEX side
     * @param {String} base Transaction currency (uppercase, such as "BTC")
     * @param {String} quote Denominated currency (uppercase, such as "USDT")
     * @param {Number[]} orderTypes List of order types 1-limit price 2-market price 3-stop profit stop loss 4-tracking order 5-Maker only
     * @param {Number} state Order status 7-uncompleted 8-completed 9-completed or partially cancelled
     * @param {Number} pageNum Pagination, the first few pages (1 <= pageNum)
     * @param {Number} pageSize Pagination, the number of pages (1 <= pageSize <=500)
     * @return {Promise<Array>}
     */
    getOrders(
        base,
        quote,
        orderTypes,
        state,
        pageNum,
        pageSize,
    ) {
      const data = {
        base,
        quote,
        orderTypes,
        state,
        pageNum,
        pageSize,
      };

      return protectedRequest('post', `${versioning.v1}/api/spot/orderlist`, data);
    },

    /**
     * Get order details
     * https://fameex-docs.github.io/docs/api/spot/en/#get-order-details
     * @param {String} symbol The name of the currency pair, such as "BTC-USDT"
     * @param {String} orderId Example: '10918742125338689536'
     * @return {Promise<Object>}
     */
    async getOrderDetails(symbol, orderId) {
      const data = {
        symbol,
        orderId,
      };

      return protectedRequest('post', `${versioning.v1}/api/spot/orderdetail`, data);
    },

    /**
     * Create order
     * https://fameex-docs.github.io/docs/api/spot/en/#new-order
     * @param {String} symbol In FameEX format as 'BTC-USDT'
     * @param {String} amount Entrusted quantity (trading amount when buying at market price) (amount >= 1)
     * @param {String} quote Entrusted quantity (trading amount when buying at market price) (quote >= 1)
     * @param {String} price Commission price
     * @param {Number} side Order Direction 1-Buy 2-Sell
     * @param {Number} orderType Order Type 1-Limit Price 2-Market Price 3-Take Profit and Stop Loss 4-Tracking Order 5-Maker Only
     * @return {Promise<Object>}
     */
    addOrder(
        symbol,
        amount,
        quote,
        price,
        side,
        orderType,
    ) {
      const data = {
        symbol,
        side,
        orderType,
        amount: amount || quote,
      };

      if (price !== null) {
        data.price = String(price);
      }

      return protectedRequest('post', `${versioning.v1}/api/spot/orders`, data);
    },

    /**
     * Cancel order
     * https://fameex-docs.github.io/docs/api/spot/en/#cancel-order
     * @param {String} symbol In FameEX format as 'BTC-USDT'
     * @param {String} orderId Example: '10918742125338689536'
     * @return {Promise<Object>}
     */
    cancelOrder(symbol, orderId) {
      const data = {
        symbol,
        orderId,
      };

      return protectedRequest('post', `${versioning.v1}/api/spot/cancel_orders`, data);
    },

    /**
     * Cancel all order for specific symbol
     * https://coinstore-openapi.github.io/en/index.html#one-click-cancellation
     * @param {String} symbol In FameEX format as 'BTC-USDT'
     * @return {Promise<Array>}
     */
    cancelAllOrders(symbol) {
      const data = {
        symbol,
      };

      return protectedRequest('post', `${versioning.v1}/api/spot/cancel_orders_all`, data);
    },

    /**
     * Get the deposit address
     * https://fameex-docs.github.io/docs/api/spot/en/#get-the-deposit-address
     * @param {String} coinType Currency type USDT
     * @param {String} chainType Chain type ERC20
     * @return {Promise<Object>}
     */
    getDepositAddress(coinType, chainType) {
      const params = {
        coinType,
        chainType,
      };

      return protectedRequest('get', `${versioning.v1}/api/account/deposit/address`, params);
    },

    /**
     * All trading currencies supported by FameEX
     * https://fameex-docs.github.io/docs/api/spot/en/#get-all-transaction-currencies
     * @return {Promise<Object>}
     */
    currenciesWithNetwork() {
      return protectedRequest('get', `${versioning.v1}/common/currencys`, {});
    },

    /**
     * List currencies
     * https://fameex-docs.github.io/docs/api/spot/en/#detailed-summary-for-each-currency
     * @return {Promise<Object>}
     */
    currencies() {
      return publicRequest('get', `${versioning.v2}/public/assets`, {});
    },

    /**
     * Ticker for all trading pairs in the market
     * https://fameex-docs.github.io/docs/api/spot/en/#24hr-ticker-price-change-statistics
     * @return {Promise<Array>}
    */
    ticker() {
      return publicRequest('get', `/api${versioning.v2}/ticker/24hr`, {});
    },

    /**
     * Get depth data
     * https://fameex-docs.github.io/docs/api/spot/en/#full-depth-returned-for-a-given-market-pair
     * @param {String} symbol In FameEX format as "BTC_USDT"
     * @param {String} [level=0] eg: 3
     * @param {String} [depth=0] Orders depth quantity: [0,5,10,20,50,100,500] Not defined or 0 = full order book Depth = 100 means 50 for each bid/ask side.
     * @return {Promise<Object>}
     */
    orderBook(symbol, level = 0, depth = 0) {
      const params = {
        market_pair: symbol,
        level,
        depth,
      };

      return publicRequest('get', `${versioning.v2}/public/orderbook/market_pair`, params);
    },

    /**
     * Get the latest trades record
     * https://fameex-docs.github.io/docs/api/spot/en/#recent-trades-list
     * @param {String} symbol In FameEX format as 'BTC-USDT'
     * @param {Number} [limit=100] Default value is 100, max 100
     * @return {Promise<Array>}
     */
    getTradesHistory(symbol, limit = 100) {
      const params = {
        symbol,
        limit,
      };

      return publicRequest('get', `/api/${versioning.v2}/trades`, params);
    },

    /**
     * Get all trading currency pairs
     * https://fameex-docs.github.io/docs/api/spot/en/#get-all-trading-currency-pairs
     * @return {Promise<Array>}
     */
    markets() {
      return publicRequest('get', `${versioning.v1}/common/symbols`, {});
    },
  };

  return EXCHANGE_API;
};

module.exports.axios = axios; // for setup axios mock adapter
