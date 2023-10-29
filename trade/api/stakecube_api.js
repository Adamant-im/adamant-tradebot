const crypto = require('crypto');
const axios = require('axios');

module.exports = function() {
  let WEB_BASE = 'https://stakecube.io/api/v2';
  let config = {
    apiKey: '',
    secret_key: '',
    tradePwd: '',
  };
  let log = {};

  // In case if error message includes these words, consider request as failed
  const doNotResolveErrors = [
    'nonce', // ~invalid nonce. last nonce used: 1684169723966
    'pending', // ~pending process need to finish
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

    const scData = responseOrError?.data || responseOrError?.response?.data;

    /**
      {
        success: true,
        result: {
          ...
        },
        error: '',
        timestamp: 1682773618,
        timestampConverted: '2023-04-29 13:06:58', (UTC)
        executionTime: 0.25620508193969727
      }
    */

    const scStatus = scData?.success;
    const scError = scData?.error;

    const scErrorInfo = scStatus ? '[No error code]' : `[${scError}]`;
    const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${scErrorInfo}` : String(responseOrError);
    const reqParameters = queryString || bodyString || '{ No parameters }';

    try {
      if (scStatus) {
        resolve(scData);
      } else if ([200, 201].includes(httpCode) && scData) {
        if (doNotResolveErrors.some((e) => scError.includes(e))) {
          scData.errorMessage = errorMessage;
          log.warn(`Request to ${url} with data ${reqParameters} failed: ${errorMessage}. Rejecting…`);
          reject(errorMessage);
        } else {
          // For spot/myOpenOrder with no open orders API returns 200 OK, success: false, result: [], error: 'no data'
          scData.errorMessage = errorMessage;
          log.log(`StakeCube processed a request to ${url} with data ${reqParameters}, but with error: ${errorMessage}. Resolving…`);
          resolve(scData);
        }
      } else if ([404].includes(httpCode)) {
        log.warn(`Request to ${url} with data ${reqParameters} failed: ${errorMessage}. Not found. Rejecting…`);
        reject(errorMessage);
      } else {
        log.warn(`Request to ${url} with data ${reqParameters} failed: ${errorMessage}. Rejecting…`);
        reject(errorMessage);
      }
    } catch (e) {
      log.warn(`Error while processing response of request to ${url} with data ${reqParameters}: ${e}. Data object I've got: ${JSON.stringify(scData)}.`);
      reject(`Unable to process data: ${JSON.stringify(scData)}. ${e}`);
    }
  };

  /**
   * Makes a request to private (auth) endpoint
   * @param {String} path Endpoint
   * @param {Object} data Request params
   * @param {String} type Request type: get, post, delete
   * @returns {*}
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
      log.error(`Error while generating request signature: ${e}`);
      return Promise.reject(e);
    }

    const bodyString = queryString;

    if (queryString && type !== 'post') {
      url = url + '?' + queryString;
    }

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url,
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

  /**
   * Makes a request to public endpoint
   * @param {String} path Endpoint
   * @param {Object} data Request params
   * @param {String} path Endpoint
   * @returns {*}
   */
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
        url,
        method: type,
        timeout: 20000,
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
   * @returns {String}
   */
  function setSign(secret, str) {
    return crypto
        .createHmac('sha256', secret)
        .update(`${str}`)
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
          secret_key: secretKey,
          tradePwd,
        };
      }
    },

    /**
     * Account: Returns general information about your StakeCube account, including wallets, balances, fee-rate in percentage and your account username
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/user.md#account
     */
    getUserData() {
      return protectedRequest('/user/account', {}, 'get');
    },

    /**
     * Returns a list of your currently open orders, their IDs, their market pair, and other relevant order information
     * @param {String} symbol In StakeCube format as BTC_USDT
     * @param {Number} limit Number of records to return. Default is 100.
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#my-open-orders
     */
    getOrders(symbol, limit = 1000) {
      const data = {
        market: symbol,
        limit,
      };

      return protectedRequest('/exchange/spot/myOpenOrder', data, 'get');
    },

    /**
     * Creates an exchange limit order on the chosen market, side, price and amount
     * Note: market orders are not supported via API
     * @param {String} symbol In StakeCube format as BTC_USDT
     * @param {Number} amount Order amount in coin1
     * @param {Number} price Order price
     * @param {String} side 'BUY' or 'SELL'. StakeCube supports only uppercase side parameter.
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#order
     */
    addOrder(symbol, amount, price, side) {
      const data = {
        market: symbol,
        side: side.toUpperCase(),
        price,
        amount,
      };

      return protectedRequest('/exchange/spot/order', data, 'post');
    },

    /**
     * Cancels an order by its unique ID
     * @param {String|Number} orderId Example: 5547806
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#cancel
     */
    cancelOrder(orderId) {
      const data = {
        orderId: +orderId,
      };

      return protectedRequest('/exchange/spot/cancel', data, 'post');
    },

    /**
     * Cancels all orders in a chosen market pair
     * @param {String} symbol In StakeCube format as BTC_USDT
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#cancel-all
     */
    cancelAllOrders(symbol) {
      const data = {
        market: symbol,
      };

      return protectedRequest('/exchange/spot/cancelAll', data, 'post');
    },

    /**
     * Returns orderbook data for a specified market pair
     * @param {String} symbol Trading pair in StakeCube format as BTC_USDT
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#orderbook
     */
    orderBook(symbol) {
      const data = {
        market: symbol,
      };

      return publicRequest('/exchange/spot/orderbook', data, 'get');
    },

    /**
     * Returns the last trades of a specified market pair
     * @param {String} symbol Trading pair in StakeCube format as BTC_USDT
     * @param {Number} limit Number of records to return. Default: 100, Minimum: 1, Maximum: 1000.
     * @return {Promise<Array<Object>>} Last trades
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#trades
     */
    getTradesHistory(symbol, limit = 300) {
      const data = {
        market: symbol,
        limit,
      };

      return publicRequest('/exchange/spot/trades', data, 'get');
    },

    /**
     * Returns a list of all markets
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#markets
     */
    markets() {
      return publicRequest('/exchange/spot/markets', {}, 'get');
    },

    /**
     * Returns info on a specified market
     * Note: same endpoint as for markets()
     * @param {String} symbol In StakeCube format as DOGE_SCC
     * @return {Promise<Object>}
     * https://github.com/stakecube-hub/stakecube-api-docs/blob/master/rest-api/exchange.md#markets
     */
    ticker(symbol) {
      const data = {
        market: symbol,
      };

      return publicRequest('/exchange/spot/markets', data, 'get');
    },
  };

  return EXCHANGE_API;
};

module.exports.axios = axios; // for setup axios mock adapter
