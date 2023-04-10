const crypto = require('crypto');
const axios = require('axios');

module.exports = function() {
  let WEB_BASE = 'https://stakecube.io/api/v2';
  let config = {
    'apiKey': '',
    'secret_key': '',
    'tradePwd': '',
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
  const handleResponse = (responseOrError, resolve, reject, bodyString, queryString, url) => {
    const httpCode = responseOrError?.status || responseOrError?.response?.status;
    const httpMessage = responseOrError?.statusText || responseOrError?.response?.statusText;

    const scData = responseOrError?.data || responseOrError?.response?.data;

    const scResult = scData?.result;
    const scStatus = scData?.success;
    const scError = scData?.error;
    const scErrorInfo = scStatus ? `[No error code]` : `[${scError}]`;

    const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${scErrorInfo}` : String(responseOrError);
    const reqParameters = queryString || bodyString || '{ No parameters }';

    try {
      if ([200, 201].includes(httpCode) && scData && scStatus) {
        resolve(scResult);
      } else if ([200, 201].includes(httpCode) && scData) {
        scResult.errorMessage = scError;
        resolve(scResult);
      } else if ([404].includes(httpCode)) {
        log.warn(`Request to ${url} with data ${reqParameters} failed: ${errorMessage}. Invalid request. Rejecting…`);
        reject(errorMessage);
      }
    } catch (e) {
      log.warn(`Error while processing response of request to ${url} with data ${reqParameters}: ${e}. Data object I've got: ${JSON.stringify(scData)}.`);
      reject(`Unable to process data: ${JSON.stringify(scData)}. ${e}`);
    }
  };

  /**
   * @param {String} path
   * @param {Object} data
   * @param {String} type
   * @returns {Promise<never>|Promise<unknown>}
   */
  function protectedRequest(path, data, type = 'get') {
    let url = `${WEB_BASE}${path}`;
    const urlBase = url;

    const pars = [];
    for (const key in data) {
      const v = data[key];
      pars.push(key + '=' + v);
    }

    let queryString = pars.join('&');

    try {
      const nonce = Date.now();
      queryString = queryString.length === 0 ? `nonce=${nonce}` : `nonce=${nonce}&` + queryString;

      const sign = setSign(config.secret_key, queryString);

      queryString = queryString + `&signature=${sign}`;
    } catch (e) {
      log.error(`An error occurred while generating  request signature: ${e}`);
      return Promise.reject(e);
    }

    const bodyString = queryString;

    if (queryString && type !== 'post') {
      url = url + '?' + queryString;
    }

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url: url,
        method: type,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-API-KEY': config.apiKey,
        },
        data: type === 'get' || type === 'delete' ? undefined : bodyString,
      };

      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, bodyString, queryString, urlBase))
          .catch((error) => handleResponse(error, resolve, reject, bodyString, queryString, urlBase));
    });
  }

  function publicRequest(path, data, type = 'get') {
    let url = `${WEB_BASE}${path}`;
    const urlBase = url;

    const pars = [];
    for (const key in data) {
      const v = data[key];
      pars.push(key + '=' + v);
    }

    const queryString = pars.join('&');
    if (queryString && type !== 'post') {
      url = url + '?' + queryString;
    }

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url: url,
        method: type,
        timeout: 30000,
      };

      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, undefined, queryString, urlBase))
          .catch((error) => handleResponse(error, resolve, reject, undefined, queryString, urlBase));
    });
  }

  /**
   * Sign string
   * @param {String} secret
   * @param {String} str
   * @returns {string}
   */
  function setSign(secret, str) {
    return crypto
        .createHmac('sha256', secret)
        .update(`${str}`)
        .digest('hex');
  }

  const EXCHANGE_API = {
    setConfig: function(apiServer, apiKey, secretKey, tradePwd, logger, publicOnly = false) {
      if (apiServer) {
        WEB_BASE = apiServer;
      }

      if (logger) {
        log = logger;
      }

      if (!publicOnly) {
        config = {
          'apiKey': apiKey,
          'secret_key': secretKey,
          'tradePwd': tradePwd,
        };
      }
    },

    /**
     * User data including: wallets with balances and deposit addresses, exchange fee
     * @return {Promise<Object>}
     * https://www.gate.io/docs/developers/apiv4/en/#list-spot-accounts
     */
    getUserData: function() {
      return protectedRequest('/user/account', {}, 'get');
    },

    /**
     * Query account active orders
     * @param {String} symbol In StakeCube format as BTC_USDT
     * @param {Number} limit Number of records to return. Default is 100.
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#my-open-orders
     */
    getOrders: async function(symbol, limit = 100) {
      const data = {
        market: symbol,
        limit,
      };

      return protectedRequest('/exchange/spot/myOpenOrder', data, 'get');
    },

    /**
     * Places an order
     * @param {String} symbol In StakeCube format as BTC_USDT
     * @param {Number} amount Order amount in coin1
     * @param {Number} price Order price
     * @param {String} side 'BUY' or 'SELL'. StakeCube supports only uppercase side parameter.
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#order
     */
    addOrder: function(symbol, amount, price, side) {
      const data = {
        market: symbol,
        side: side.toUpperCase(),
        price,
        amount,
      };

      return protectedRequest('/exchange/spot/order', data, 'post');
    },

    /**
     * Cancel an order
     * @param {String} orderId Example 285088438163
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#cancel
     */
    cancelOrder: function(orderId) {
      const data = {
        orderId,
      };

      return protectedRequest('/exchange/spot/cancel', data, 'post');
    },

    /**
     * Cancel all orders
     * @param {String} symbol In StakeCube format as BTC_USDT
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#cancel-all
     */
    cancelAllOrders: function(symbol) {
      const data = {
        market: symbol,
      };

      return protectedRequest('/exchange/spot/cancelAll', data, 'post');
    },

    /**
     * Get market depth
     * @param {String} symbol Trading pair in StakeCube format as BTC_USDT
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#orderbook
     */
    orderBook: function(symbol) {
      const data = {
        market: symbol,
      };

      return publicRequest('/exchange/spot/orderbook', data, 'get');
    },

    /**
     * Get trades history
     * @param {String} symbol Trading pair in StakeCube format as BTC_USDT
     * @param {Number} limit Number of records to return. Default: 100, Minimum: 1, Maximum: 1000.
     * @return {Promise<Array<Object>>} Last trades
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#trades
     */
    getTradesHistory: function(symbol, limit ) {
      const data = {
        market: symbol,
        limit,
      };

      return publicRequest('/exchange/spot/trades', data, 'get');
    },

    /**
     * Get info on all markets
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#markets
     */
    markets: function() {
      return publicRequest('/exchange/spot/markets', {}, 'get');
    },

    /**
     * Get trade info for a ticker
     * @param {String} symbol In StakeCube format as DOGE_SCC
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#markets
     */
    ticker: function(symbol) {
      const data = {
        market: symbol,
      };

      return publicRequest('/exchange/spot/markets', data, 'get');
    },
  };

  return EXCHANGE_API;
};

module.exports.axios = axios; // for setup axios mock adapter
