const crypto = require('crypto');
const axios = require('axios');

const {
  trimAny,
  getParamsString,
} = require('../../helpers/utils');

/**
 * Docs: https://fameex-docs.github.io/docs/api/spot/en/#introduction
 */

// Error codes: https://fameex-docs.github.io/docs/api/spot/en/#error-message
const httpErrorCodeDescriptions = {
  112002: 'API single key traffic exceeds limit',
  112005: 'API request frequency exceeded',
  112007: 'API-Key creation failed',
  112008: 'API-Key remark name already exists',
  112009: 'The number of API-Key creation exceeds the limit (a single user can create up to 5 APIs)',
  112010: 'API-Key is invalid (the time limit for a single Key is 60 natural days)',
  112011: 'API request IP access is restricted (the bound IP is inconsistent with the request IP)',
  112015: 'Signature error',
  112020: 'Wrong signature',
  112021: 'Wrong signature version',
  112022: 'Signature timestamp error',
  112047: 'The spot API interface is temporarily inaccessible',
  112048: 'The futures API interface is temporarily inaccessible',
  230030: 'Please operate after KYC certification',
};

const statusCodes = {
  ok: 200,
  zero: '0',
};

const versioning = {
  v1: '/v1',
  v2: '/v2',
};

module.exports = function() {
  let WEB_BASE = 'https://api.fameex.com';
  let config = {
    apiKey: '',
    secret_key: '',
    tradePwd: '',
  };
  let log = {};

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
      (data.code === statusCodes.ok || data.code === statusCodes.zero || Array.isArray(data));

    console.log({ data });

    const error = {
      code: data?.code ?? 'No error code',
      msg: httpErrorCodeDescriptions[data?.code] ?? data?.msg ?? 'Unknown error',
    };

    const reqParameters = queryString || '{ No parameters }';

    try {
      if (success) {
        resolve(data.data);
      } else {
        const fameexErrorInfo = `[${error.code}] ${trimAny(error.msg, ' .')}`;

        const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${fameexErrorInfo}` : String(responseOrError);

        if (typeof data === 'object') {
          data.fameexErrorInfo = fameexErrorInfo;
        }

        if (httpCode === statusCodes.ok) {
          log.log(`FameEX processed a request to ${url} with data ${reqParameters}, but with error: ${error.msg}. Resolving…`);
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
   * @returns {*}
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
      };

      if (type === 'post') {
        httpOptions.data = stringifiedData;
      } else {
        httpOptions.params = data;
      }

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
   * @returns {*}
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
     * !NOT IMPLEMENTED!
     * !This is a template for API, at the moment it is impossible to implement, due to problems on the FameEX side
     * @param {String} base Transaction currency (uppercase, such as "BTC")
     * @param {String} quote Denominated currency (uppercase, such as "USDT")
     * @param {String} side Order Direction 1-Buy 2-Sell
     * @param {Number[]} orderTypes List of order types 1-limit price 2-market price 3-stop profit stop loss 4-tracking order 5-Maker only
     * @param {String} state Order status 7-uncompleted 8-completed 9-completed or partially cancelled
     * @param {String} startTime Start timestamp, seconds
     * @param {String} endTime End timestamp, seconds
     * @param {String} pageno Pagination, the first few pages (1 <= pageNum)
     * @param {String} pageSize Pagination, the number of pages (1 <= pageSize <=500)
     * @param {String} strategyId Strategy Id
     * @param {String} strategyType Strategy type
     * @return {Promise<Array>}
     */
    getOrders(
        base,
        quote,
        side,
        orderTypes,
        state,
        startTime,
        endTime,
        pageno,
        pageSize,
        strategyId,
        strategyType,
    ) {
      const data = {
        base,
        quote,
        side,
        orderTypes,
        state,
        startTime,
        endTime,
      };

      if (pageno) {
        data.pageno = pageno;
      }

      if (pageSize) {
        data.pageSize = pageSize;
      }

      if (strategyId) {
        data.strategyId = strategyId;
      }

      if (strategyType) {
        data.strategyType = strategyType;
      }

      return protectedRequest('post', `${versioning.v1}/api/spot/orderlist`, data);
    },

    /**
     * Get order details
     * https://fameex-docs.github.io/docs/api/spot/en/#get-order-details
     * @param {String} symbol The name of the currency pair, such as "BTC-USDT"
     * @param {String} orderId Order ID (orderId and clientOid must and can only be filled in)
     * @param {String} clientOid User-made order ID (orderId and clientOid must be filled in only one)
     * @return {Promise<Object>}
     */
    async getOrderDetails(symbol, orderId, clientOid) {
      const data = {
        symbol,
      };

      if (orderId) {
        data.orderId = orderId;
      }

      if (clientOid) {
        data.clientOid = clientOid;
      }

      return protectedRequest('post', `${versioning.v1}/api/spot/orderdetail`, data);
    },

    /**
     * Get transaction details
     * https://fameex-docs.github.io/docs/api/spot/en/#get-transaction-details
     * !NOT IMPLEMENTED!
     * !This is a template for API, at the moment it is impossible to implement, due to problems on the FameEX side
     * @param {String} base Transaction currency (uppercase, such as "BTC")
     * @param {String} quote Denominated currency (uppercase, such as "USDT")
     * @param {String} orderId Order ID
     * @param {Number} side Order Direction 1-Buy 2-Sell
     * @param {Number[]} orderTypes List of order types 1- limit price 2- market price 3- stop profit stop loss 4- tracking order 5- Maker only
     * @param {Number} pageno Pagination, the first few pages (1 <= pageNum)
     * @param {Number} pageSize Pagination, the number of pages (1 < pageSize <= 500)
     * @param {Number} startTime Start timestamp, seconds
     * @param {Number} endTime End timestamp, seconds
     * @param {String} strategyId Strategy Id
     * @param {int} strategyType Strategy type
     * @return {Promise<Object>}
     */
    async getTransactionDetails(
        base,
        quote,
        orderId,
        side,
        orderTypes,
        pageno,
        pageSize,
        startTime,
        endTime,
        strategyId,
        strategyType,
    ) {
      const data = {
        pageno,
        pageSize,
      };

      if (base) {
        data.base = base;
      }

      if (quote) {
        data.quote = quote;
      }

      if (orderId) {
        data.orderId = orderId;
      }

      if (side) {
        data.side = side;
      }

      if (orderTypes) {
        data.orderTypes = orderTypes;
      }

      if (startTime) {
        data.startTime = startTime;
      }

      if (endTime) {
        data.endTime = endTime;
      }

      if (strategyId) {
        data.strategyId = strategyId;
      }

      if (strategyType) {
        data.strategyType = strategyType;
      }

      return protectedRequest('post', `${versioning.v1}/api/spot/fills`, data);
    },

    /**
     * Create order
     * https://fameex-docs.github.io/docs/api/spot/en/#new-order
     * @param {String} symbol For example, the name of the currency pair: "BTC-USDT"
     * @param {Number} side Order Direction 1-Buy 2-Sell
     * @param {Number} orderType Order Type 1-Limit Price 2-Market Price 3-Take Profit and Stop Loss 4-Tracking Order 5-Maker Only
     * @param {String} amount Entrusted quantity (trading amount when buying at market price) (amount >= 1)
     * @param {String} clientOid User-made order ID
     * @param {String} price Commission price
     * @param {String} triggerPrice Trigger price
     * @param {String} backRatio Track the percentage of commissioned callbacks
     * @return {Promise<Object>}
     */
    addOrder(
        symbol,
        side,
        orderType,
        amount,
        clientOid,
        price,
        triggerPrice,
        backRatio,
    ) {
      const data = {
        symbol,
        side,
        orderType,
        amount,
      };

      if (clientOid) {
        data.clientOid = clientOid;
      }

      if (price) {
        data.price = price;
      }

      if (triggerPrice) {
        data.triggerPrice = triggerPrice;
      }

      if (backRatio) {
        data.backRatio = backRatio;
      }

      return protectedRequest('post', `${versioning.v1}/api/spot/orders`, data);
    },

    // TODO: test some cases
    /**
     * Cancel order
     * https://fameex-docs.github.io/docs/api/spot/en/#cancel-order
     * @param {String} symbol For example, the name of the currency pair: "BTC-USDT"
     * @param {String} orderId Order ID (orderId and clientOid must and can only be filled in)
     * @param {String} clientOid User-made order ID (orderId and clientOid must be filled in only one)
     * @return {Promise<Object>}
     */
    cancelOrder(symbol, orderId, clientOid) {
      const data = {
        symbol,
      };

      if (orderId) {
        data.orderId = orderId;
      }

      if (clientOid) {
        data.clientOid = clientOid;
      }

      return protectedRequest('post', `${versioning.v1}/api/spot/cancel_orders`, data);
    },

    // TODO: test some cases
    /**
     * Cancel all order for specific symbol
     * https://coinstore-openapi.github.io/en/index.html#one-click-cancellation
     * @param {String} symbol For example, the name of the currency pair: "BTC-USDT"
     * @param {String[]} orderIds Order ID (orderId and clientOid must and can only be filled in)
     * @param {String[]} clientOids User-made order ID (orderId and clientOid must be filled in only one)
     * @return {Promise<Array>}
     */
    cancelAllOrders(symbol, orderIds, clientOids) {
      const data = {
        symbol,
      };

      if (orderIds?.length) {
        data.orderIds = orderIds;
      }

      if (clientOids?.length) {
        data.clientOids = clientOids;
      }

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
     * @param {String} symbol Name of the trading pair, example: "BTC-USDT"
     * @return {Promise<Array>}
    */
    ticker(symbol) {
      const params = {};

      if (symbol) {
        params.symbol = symbol;
      }

      return publicRequest('get', `/api${versioning.v2}/ticker/24hr`, params);
    },

    /**
     * Get depth data
     * https://fameex-docs.github.io/docs/api/spot/en/#full-depth-returned-for-a-given-market-pair
     * @param {String} symbol A pair such as "BTC_USDT"
     * @param {String} level eg: 3
     * @param {String} depth Orders depth quantity: [0,5,10,20,50,100,500] Not defined or 0 = full order book Depth = 100 means 50 for each bid/ask side.
     * @return {Promise<Object>}
     */
    orderBook(symbol, level, depth) {
      const params = {
        market_pair: symbol,
      };

      if (level) {
        params.level = level;
      }

      if (depth) {
        params.depth = depth;
      }

      return publicRequest('get', `${versioning.v2}/public/orderbook/market_pair`, params);
    },

    /**
     * Get the latest trades record
     * https://fameex-docs.github.io/docs/api/spot/en/#recent-trades-list
     * @param {String} symbol Name of the trading pair, example: BTC-USDT
     * @param {Number} limit Default value is 100, max 100
     * @return {Promise<Array>}
     */
    getTradesHistory(symbol, limit) {
      const params = {
        symbol,
      };

      if (limit) {
        params.limit = limit;
      }

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
