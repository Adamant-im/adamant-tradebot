const crypto = require('crypto');
const axios = require('axios');

const {
  trimAny,
  getParamsString,
} = require('../../helpers/utils');

/**
 * Docs: https://coinstore-openapi.github.io/
 */

// Error codes: https://coinstore-openapi.github.io/en/#error-message
const httpErrorCodeDescriptions = {
  400: 'Invalid request format',
  401: 'Invalid API Key',
  404: 'Service not found',
  429: 'Too many visits',
  500: 'Internal server error',
};

module.exports = function() {
  let WEB_BASE = 'https://api.coinstore.com';
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
    const success = httpCode === 200 && +data.code === 0;

    const error = {
      code: data?.code ?? 'No error code',
      msg: data?.msg ?? data?.message ?? 'No error message',
    };

    const reqParameters = queryString || '{ No parameters }';

    try {
      if (success) {
        resolve(data.data);
      } else {
        const coinstoreErrorInfo = `[${error.code}] ${trimAny(error.msg, ' .')}`;
        const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${coinstoreErrorInfo}` : String(responseOrError);

        if (typeof data === 'object') {
          data.coinstoreErrorInfo = coinstoreErrorInfo;
        }

        if (httpCode === 200) {
          log.log(`Coinstore processed a request to ${url} with data ${reqParameters}, but with error: ${errorMessage}. Resolving…`);
          resolve(data);
        } else {
          const errorDescription = httpErrorCodeDescriptions[httpCode] ?? 'Unknown error';

          log.warn(`Request to ${url} with data ${reqParameters} failed. ${errorDescription}, details: ${errorMessage}. Rejecting…`);

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

    const signPayload = type === 'post' ? stringifiedData : bodyString;
    const sign = getSignature(config.secret_key, timestamp, signPayload);

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url,
        method: type,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'X-CS-APIKEY': config.apiKey,
          'X-CS-EXPIRES': timestamp,
          'X-CS-SIGN': sign,
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
   * Get a signature for a Coinstore request
   * https://coinstore-openapi.github.io/en/#signature-authentication
   * @param {String} secret API secret key
   * @param {Number} timestamp Unix timestamp
   * @param {String} payload Data to sign
   * @returns {String}
   */
  function getSignature(secret, timestamp, payload) {
    const key = crypto.createHmac('sha256', secret)
        .update(Math.floor(timestamp / 30000).toString()) // X-CS-EXPIRES is a 13-bit timestamp, which needs to be divided by 30000 to obtain a class timestamp
        .digest('hex');

    return crypto
        .createHmac('sha256', key)
        .update(payload)
        .digest('hex');
  }

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
     * https://coinstore-openapi.github.io/en/index.html#assets-balance
     * @return {Promise<Array>}
     */
    getBalances() {
      return protectedRequest('post', '/api/spot/accountList', {});
    },

    /**
     * Get current order v2 version
     * https://coinstore-openapi.github.io/en/index.html#get-current-orders-v2
     * @param {String} symbol In Coinstore format as BTCUSDT
     * @return {Promise<Array>}
     */
    getOrders(symbol) {
      const params = {
        symbol,
      };

      return protectedRequest('get', '/api/v2/trade/order/active', params);
    },

    /**
     * Get order information v2
     * https://coinstore-openapi.github.io/en/index.html#get-order-information-v2
     * @param {String} orderId Example: '1771215607820588'
     * @returns {Promise<Array>}
     */
    async getOrder(orderId) {
      const params = {
        ordId: orderId,
      };

      return protectedRequest('get', '/api/v2/trade/order/orderInfo', params);
    },

    /**
     * Create order
     * https://coinstore-openapi.github.io/en/index.html#create-order
     * @param {String} symbol In Coinstore format as BTCUSDT
     * @param {String} amount Base coin amount
     * @param {String} quote Quote coin amount
     * @param {String} price Order price
     * @param {String} side buy or sell
     * @param {String} type market or limit
     * @return {Promise<Object>}
     */
    addOrder(symbol, amount, quote, price, side, type) {
      const data = {
        symbol,
        side: side.toUpperCase(),
        ordType: type.toUpperCase(),
        ordPrice: +price,
        timestamp: Date.now(),
      };

      if (type === 'market' && side === 'buy') {
        data.ordAmt = +quote;
      } else if ((type === 'market' && side === 'sell') || type === 'limit') {
        data.ordQty = +amount;
      }

      return protectedRequest('post', '/api/trade/order/place', data);
    },

    /**
     * Cancel orders
     * https://coinstore-openapi.github.io/en/index.html#cancel-orders
     * @param {String} orderId Example: '1771215607820588'
     * @param {String} symbol In Coinstore format as BTCUSDT
     * @return {Promise<Object>}
     */
    cancelOrder(orderId, symbol) {
      const data = {
        ordId: orderId,
        symbol,
      };

      return protectedRequest('post', '/api/trade/order/cancel', data);
    },

    /**
     * Cancel all order for specific symbol
     * https://coinstore-openapi.github.io/en/index.html#one-click-cancellation
     * @param {String} symbol In Coinstore format as BTCUSDT
     * @return {Promise<Array>}
     */
    cancelAllOrders(symbol) {
      const data = {
        symbol,
      };

      return protectedRequest('post', '/api/trade/order/cancelAll', data);
    },

    /**
     * List currencies
     * Coinstore's docs doesn't describe this endpoint
     * Returned data is not full and doesn't include decimals, precision, min amounts, etc
     * @return {Promise<Object>}
     */
    currencies() {
      return publicRequest('get', '/v3/public/assets', {});
    },

    /**
     * Ticker for all trading pairs in the market
     * https://coinstore-openapi.github.io/en/index.html#ticker
     * @return {Promise<Array>}
    */
    ticker() {
      return publicRequest('get', '/api/v1/market/tickers', {});
    },

    /**
     * Get depth data
     * https://coinstore-openapi.github.io/en/index.html#get-depth
     * @param {String} symbol In Coinstore format as BTCUSDT
     * @return {Promise<Object>}
     */
    orderBook(symbol) {
      const params = {
        depth: 100, // The number of depths, such as "5, 10, 20, 50, 100", default 20
      };

      return publicRequest('get', `/api/v1/market/depth/${symbol}`, params);
    },

    /**
     * Get the latest trades record
     * https://coinstore-openapi.github.io/en/index.html#latest-trades
     * @param {String} symbol In Coinstore format as BTCUSDT
     * @return {Promise<Array>}
     */
    getTradesHistory(symbol) {
      const params = {
        size: 100, // Number of data bars, [1,100]
      };

      return publicRequest('get', `/api/v1/market/trade/${symbol}`, params);
    },

  };

  return EXCHANGE_API;
};

module.exports.axios = axios; // for setup axios mock adapter
