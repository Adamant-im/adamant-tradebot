const crypto = require('crypto');
const axios = require('axios');
const utils = require('../../helpers/utils');

module.exports = function() {
  const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
  };

  let WEB_BASE = ''; // To be set in setConfig()
  const WEB_BASE_PREFIX = '/api';
  let config = {
    'apiKey': '',
    'secret_key': '',
  };
  let log = {};

  const notValidStatuses = [
    401, // ~Invalid auth, payload, nonce
    429, // Too many requests
    423, // Temporary block
    500, // Service temporary unavailable
    // 400, ~Processed with an error
    // 422, ~Data validation error
  ];

  /**
   * Handles response from API
   * @param {Object} responseOrError
   * @param resolve
   * @param reject
   * @param {String} bodyString
   * @param {String} queryString
   * @param {String} url
   */
  const handleResponse = (responseOrError, resolve, reject, bodyString, queryString, url) => {
    const httpCode = responseOrError?.status || responseOrError?.response?.status;
    const httpMessage = responseOrError?.statusText || responseOrError?.response?.statusText;

    const azbitData = responseOrError?.data || responseOrError?.response?.data;
    console.log('');
    console.log('');
    console.log(httpCode);
    console.log(url);
    console.log(azbitData);


    const azbitStatus = httpCode === 200 && azbitData ? true : false; // Azbit doesn't return any special status on success
    const azbitErrorCode = 'No error code'; // Azbit doesn't have error codes
    const azbitErrorMessage = typeof azbitData === 'string' ? azbitData : undefined; // Azbit returns string in case of error
    const azbitErrorInfo = `[${azbitErrorCode}] ${utils.trimAny(azbitErrorMessage, ' .')}`;

    const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${azbitErrorInfo}` : String(responseOrError);
    const reqParameters = queryString || bodyString || '{ No parameters }';

    try {
      if (azbitStatus) {
        resolve(azbitData);
      } else if (azbitErrorMessage) {
        azbitData.azbitErrorInfo = azbitErrorInfo;

        if (notValidStatuses.includes(httpCode)) {
          log.log(`Azbit request to ${url} with data ${reqParameters} failed: ${errorMessage}. Rejecting…`);
          reject(azbitData);
        } else {
          log.log(`Azbit processed a request to ${url} with data ${reqParameters}, but with error: ${errorMessage}. Resolving…`);
          resolve(azbitData);
        }
      } else {
        log.warn(`Request to ${url} with data ${reqParameters} failed: ${errorMessage}. Rejecting…`);
        reject(errorMessage);
      }
    } catch (e) {
      log.warn(`Error while processing response of request to ${url} with data ${reqParameters}: ${e}. Data object I've got: ${JSON.stringify(azbitData)}.`);
      reject(`Unable to process data: ${JSON.stringify(azbitData)}. ${e}`);
    }
  };

  /**
   * Creates an url params string as: key1=value1&key2=value2
   * @param {Object} data Request params
   * @returns {String}
   */
  function getParamsString(data) {
    const params = [];

    for (const key in data) {
      const v = data[key];
      params.push(key + '=' + v);
    }

    return params.join('&');
  }

  /**
   * Creates a full url with params as https://data.azbit.com/api/endpoint?key1=value1&key2=value2
   * @param {Object} data Request params
   * @returns {String}
   */
  function getUrlWithParams(url, data) {
    const queryString = getParamsString(data);

    if (queryString) {
      url = url + '?' + queryString;
    }

    return url;
  }

  /**
   * Makes a request to public endpoint
   * @param {String} path Endpoint
   * @param {Object} data Request params
   * @returns {*}
   */
  function publicRequest(path, data) {
    let url = `${WEB_BASE}${path}`;
    const urlBase = url;

    const queryString = getParamsString(data);
    url = getUrlWithParams(url, data);

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url: url,
        method: 'get',
        timeout: 10000,
        headers: DEFAULT_HEADERS,
      };
      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, undefined, queryString, urlBase))
          .catch((error) => handleResponse(error, resolve, reject, undefined, queryString, urlBase));
    });
  }

  /**
   * Makes a request to private (auth) endpoint
   * @param {String} path Endpoint
   * @param {Object} data Request params
   * @param {String} method Request type: get, post, delete
   * @returns {*}
   */
  function protectedRequest(path, data, method) {
    let url = `${WEB_BASE}${path}`;
    const urlBase = url;

    let headers;
    let bodyString;

    try {
      if (method === 'get') {
        bodyString = '';
        url = getUrlWithParams(url, data);
      } else {
        bodyString = getBody(data);
      }

      const signature = getSignature(url, bodyString);

      headers = {
        ...DEFAULT_HEADERS,
        'API-PublicKey': config.apiKey,
        'API-Signature': signature.toString().trim(),
      };
    } catch (err) {
      log.log(`Processing of request to ${url} with data ${bodyString} failed. ${err}.`);
      return Promise.reject(err.toString());
    }

    return new Promise((resolve, reject) => {
      const httpOptions = {
        method: method,
        url: url,
        timeout: 10000,
        headers: headers,
        data,
      };

      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, bodyString, undefined, urlBase))
          .catch((error) => handleResponse(error, resolve, reject, bodyString, undefined, urlBase));
    });
  }

  const getBody = (data) => {
    return utils.isObjectNotEmpty(data) ? JSON.stringify(data) : '';
  };

  const getSignature = (url, payload) => {
    return crypto.createHmac('sha256', config.secret_key).update(config.apiKey + url + payload).digest('hex');
  };

  const EXCHANGE_API = {
    setConfig: function(apiServer, apiKey, secretKey, tradePwd, logger, publicOnly = false) {
      if (apiServer) {
        WEB_BASE = apiServer + WEB_BASE_PREFIX;
      }

      if (logger) {
        log = logger;
      }

      if (!publicOnly) {
        config = {
          'apiKey': apiKey,
          'secret_key': secretKey,
        };
      }
    },

    /**
     * List of user balances for all currencies
     * @return {Object}
     */
    getBalances: async function() {
      const data = {};
      return protectedRequest('/wallets/balances', data, 'get');
    },

    /**
     * Query account active orders
     * @param {String} pair In Azbit format as ETH_USDT
     * @param {String} status ["all", "active", "cancelled"]
     * @return {Object}
     *
     */
    getOrders: function(pair, status='active') {
      const data = {};
      if (pair) data.currencyPairCode = pair;
      data.status = status;
      return protectedRequest('/user/orders', data, 'get');
    },

    /**
     * Places a order
     * @param {String} market In Azbit format as ETH_USDT
     * @param {Number} amount Order amount
     * @param {Number} price Order price
     * @param {String} side 'buy' or 'sell'
     */
    addOrder: function(market, amount, price, side) {
      const data = {
        side: side,
        currencyPairCode: market,
        amount: amount,
        price: price,
      };

      return protectedRequest('/orders', data, 'post');
    },

    /**
     * Cancel an order
     * @param {String} orderId
     * @return {Object}
     */
    cancelOrder: function(orderId) {
      const data = {};
      return protectedRequest(`/orders/${orderId}`, data, 'delete');
    },

    /**
     * Cancel all orders for currency pair
     * @param {String} pair
     * @returns {Object} Success response with no data
     */

    cancelAllOrders: function(pair) {
      const data = {};
      return protectedRequest(`/orders?currencyPairCode=${pair}`, data, 'delete');
    },

    /**
     * Get trade details for a ticker (market rates)
     * @param {String} pair
     * @return {Object}
     */
    ticker: function(pair) {
      const data = {};
      data.currencyPairCode = pair;
      return publicRequest('/tickers', data);
    },

    /**
     * Get market depth
     * @param pair
     * @return {Object}
     */
    orderBook: function(pair) {
      const data = {};
      data.currencyPairCode = pair;
      // if (limit) data.limit = limit;
      // if (interval) data.interval = interval;
      return publicRequest('/orderbook', data);
    },

    /**
     * Get trades history
     * @param pair Trading pair, like BTC_USDT
     * @param page
     * @param pageSize
     * @return {Object} Last trades
     */
    getTradesHistory: function(pair, page, pageSize = 500) {
      const data = {
        pageNumber: page,
        pageSize: pageSize,
        currencyPairCode: pair,
      };
      return publicRequest(`/deals`, data);
    },

    /**
     * Get all crypto currencies
     * @returns {Object}
     */

    getCurrencies() {
      const data = {};
      return publicRequest('/currencies', data);
    },

    /**
     * Get user deposit address
     * @param coin
     * @returns {Object}
     */

    getDepositAddress: function(coin) {
      const data = {};
      return protectedRequest(`/deposit-address/${coin}`, data, 'get');
    },

    /**
     * Get currency pairs commissions
     * @returns {Object}
     */

    getFees: function() {
      const data = {};
      return publicRequest('/currencies/commissions', data);
    },

    /**
     * Get info on all markets
     * @returns {Object}
     */
    markets: async function() {
      const data = {};
      return publicRequest('/currencies/pairs', data);
    },
  };

  return EXCHANGE_API;
};
