const crypto = require('crypto');
const axios = require('axios');
const logger = require('../../helpers/log');
const utils = require('../../helpers/utils');

module.exports = function() {
  const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
  };

  let WEB_BASE = 'https://data.azbit.com'; // To be set in setConfig()
  const WEB_BASE_PREFIX = '/api';
  let config = {
    'apiKey': '',
    'secret_key': '',
  };
  let log = logger;

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
    const httpCode = responseOrError?.response?.status || responseOrError?.status;
    const httpMessage = responseOrError?.response?.statusText || responseOrError?.statusText;
    let azbitData = responseOrError?.response?.data || responseOrError?.data;

    /*
      Axios Response struct:
      status, statusText, headers, config, request, data
     */

    //log.log('responseOrError keys : ' + JSON.stringify(Object.keys(responseOrError)));
    //log.log('[ResponseOrError] status: ' + responseOrError.status + ' statusText: ' + httpMessage);
    //log.log('[ResponseOrError] data: ' + JSON.stringify(azbitData));
    const azbitErrorMessage = JSON.stringify(azbitData?.errors) || azbitData;
    const azbitErrorInfo = `${utils.trimAny(azbitErrorMessage, ' .')}`;

    const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${azbitErrorInfo}` : String(responseOrError);
    const reqParameters = queryString || bodyString || '{ No parameters }';

    try {
      if (httpCode === 200 && httpMessage === 'OK') {
        resolve(azbitData);
      } else
      if (notValidStatuses.includes(httpCode)) {
        log.log(`Azbit request to ${url} with data ${reqParameters} failed: ${errorMessage}. Rejecting…`);
        reject(azbitData);
      } else {
        log.log(`Azbit processed a request to ${url} with data ${reqParameters}, but with error: ${errorMessage}. Resolving…`);
        azbitData = Object.assign(azbitData, );
        resolve(azbitData, {errors: errorMessage});
      }
    } catch (e) {
      log.warn(`Error while processing response of request to ${url} with data ${reqParameters}: ${e}. Data object I've got: ${JSON.stringify(azbitData)}.`);
      reject(`Unable to process data: ${JSON.stringify(azbitData)}. ${e}`);
    }
  };

  function getQueryStringFromData(data) {
    const params = [];
    for (const key in data) {
      const v = data[key];
      params.push(key + '=' + v);
    }
    return params.join('&');
  }

  function makeUrlFromData(url, data) {
    const queryString = getQueryStringFromData(data);
    if (queryString) {
      url = url + '?' + queryString;
    }
    return url;
  }

  function publicRequest(path, data) {
    let url = `${WEB_BASE}${path}`;
    const urlBase = url;
    const queryString = getQueryStringFromData(data);
    url = makeUrlFromData(url, data);

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url: url,
        method: 'get',
        timeout: 10000,
        headers: DEFAULT_HEADERS,
      };

      console.log('queryString: ' + queryString + 'typeof: ' + typeof queryString);
      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, undefined, queryString, urlBase))
          .catch((error) => handleResponse(error, resolve, reject, undefined, queryString, urlBase));
    });
  }

  function protectedRequest(path, data, method='get') {
    let url = `${WEB_BASE}${path}`;
    const urlBase = url;

    let headers;
    let bodyString;

    try {
      if (method.toLowerCase() === 'get') {
        bodyString = '';
        url = makeUrlFromData(url, data);
      } else {
        if (Object.keys(data).length > 0) {
          bodyString = getBody(data);
        }
        else {
          bodyString = '';
        }
      }
      const signature = getSignature(url, bodyString)
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
      let httpOptions = {
        method: method,
        url: url,
        timeout: 10000,
        headers: headers,
      };
      if (method.toLowerCase() !== 'get' && Object.keys(data).length > 0) {
        httpOptions = Object.assign(httpOptions, { data: data });
      }

      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, bodyString, undefined, urlBase))
          .catch((error) => handleResponse(error, resolve, reject, bodyString, undefined, urlBase));
    });
  }

  const getBody = (data) => {
    return JSON.stringify(data);
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
      return protectedRequest('/user/orders', data);
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
      return protectedRequest(`/deposit-address/${coin}`, data);
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
     * @return string
     */
    markets: async function() {
      const data = {};
      return publicRequest('/currencies/pairs', data);
    },

  };

  return EXCHANGE_API;
};
