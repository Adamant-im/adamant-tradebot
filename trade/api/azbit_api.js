const crypto = require('crypto');
const axios = require('axios');
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
  let log = {};

  // https://github.com/P2pb2b-team/p2pb2b-api-docs/blob/master/errors.md
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
    const httpCode = responseOrError?.status;
    const httpMessage = responseOrError?.statusText;
    const azbitData = responseOrError?.data;

    //console.log('responseOrError: ' + JSON.stringify(responseOrError));
    console.log('ResponseOrError.status: ' + responseOrError.status);
    console.log('ResponseOrError.code: ' + responseOrError?.response?.code);
    //console.log('azbitData: ' + JSON.stringify(azbitData));
    const azbitErrorMessage = utils.trimAny(azbitData?.message || azbitData?.errors?.message?.[0], '. ');
    const azbitErrorInfo = `${utils.trimAny(azbitErrorMessage, ' .')}`;

    const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${azbitErrorInfo}` : String(responseOrError);
    const reqParameters = queryString || bodyString || '{ No parameters }';

    try {
      if (azbitData) {
        if (httpCode === 200 && httpMessage === 'OK')
          resolve(azbitData);
        else
          if (notValidStatuses.includes(httpCode)) {
            log.log(`Azbit request to ${url} with data ${reqParameters} failed: ${errorMessage}. Rejecting…`);
            reject(azbitData);
          } else {
            log.log(`Azbit processed a request to ${url} with data ${reqParameters}, but with error: ${errorMessage}. Resolving…`);
            resolve(azbitData);
          }
      }
      else {
        log.warn(`Request to ${url} with data ${reqParameters} failed: ${errorMessage}. Rejecting…`);
        reject(errorMessage);
      }
    } catch (e) {
      log.warn(`Error while processing response of request to ${url} with data ${reqParameters}: ${e}. Data object I've got: ${JSON.stringify(azbitData)}.`);
      reject(`Unable to process data: ${JSON.stringify(azbitData)}. ${e}`);
    }
  };

  function getQueryStringFromData(data) {
    let params = [];
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

  function protectedRequest(path, method='GET', data) {
    let url = `${WEB_BASE}${path}`;
    const urlBase = url;

    let headers;
    let bodyString;

    try {

      /*data = {
        ...data,
        request: `${WEB_BASE_PREFIX}${path}`,
        nonce: Date.now(),
      };*/
      if (method.toLowerCase() === 'get') {
        bodyString = '';
        url = makeUrlFromData(url, data);
      }
      else {
        bodyString = getBody(data);
      }

      console.log('url: ' + JSON.stringify(url) + '  bodyString: ' + bodyString);
      headers = {
        ...DEFAULT_HEADERS,
        'API-PublicKey': config.apiKey,
        'API-Signature': getSignature(url, bodyString),
      };
    } catch (err) {
      log.log(`Processing of request to ${url} with data ${bodyString} failed. ${err}.`);
      return Promise.reject(err.toString());
    }

    return new Promise((resolve, reject) => {
      let httpOptions = {
        url: url,
        timeout: 30000,
        headers: headers,
      };
      if (method.toLowerCase() !== 'get') {
        httpOptions = Object.assign(httpOptions, data, {method: method});
      }

      axios(httpOptions)
        .then((response) => handleResponse(response, resolve, reject, bodyString, undefined, urlBase))
        .catch((error) => handleResponse(error, resolve, reject, bodyString, undefined, urlBase));
    });
  }

  const getBody = (data) => {
    return JSON.stringify(data);
  };

  const getPayload = (body) => {
    return new Buffer.from(body).toString('base64');
  };

  const getSignature = (url, payload) => {
    console.log('signature data: ' + config.apiKey + url + payload);
    return crypto.createHmac('sha256', config.secret_key).update(config.apiKey + url + payload).digest('hex');
    //return crypto.createHmac('sha512', config.secret_key).update(payload).digest('hex');
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
    getBalances: function() {
      const data = {};
      return protectedRequest('/wallets/balances', 'get', data);
    },

    /**
     * Query account active orders
     * @param {String} pair In P2PB2B format as ETH_USDT
     * @param {Number} limit min 1, default 50, max 100
     * @param {Number} offset min 0, default 0, max 10000
     * @return {Object}
     * https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md#order-list
     */
    getOrders: function(pair, offset = 0, limit = 100) {
      const data = {};
      if (pair) data.currencyPairCode = pair;
      data.status = "active";
      if (offset) data.offset = offset;
      if (limit) data.limit = limit;

      return protectedRequest('/user/orders', data);
    },

    /**
     * Places a Limit order. P2PB2B doesn't support market orders.
     * @param {String} market In P2PB2B format as ETH_USDT
     * @param {String} amount Order amount
     * @param {String} price Order price
     * @param {String} side 'buy' or 'sell'
     * https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md#create-order
     */
    addOrder: function(market, amount, price, side) {
      const data = {
        market,
        amount: String(amount),
        price: String(price),
        side,
      };

      return protectedRequest('/order/new', data);
    },

    /**
     * Cancel an order
     * @param {String} orderId
     * @param {String} market
     * @return {Object}
     */
    cancelOrder: function(orderId, market) {
      const data = {
        orderId,
        market,
      };

      return protectedRequest('/order/cancel', data);
    },

    /**
     * Get trade details for a ticker (market rates)
     * @param {String} market
     * @return {Object}
     */
    ticker: function(market) {
      const data = {
        market,
      };

      return publicRequest('/public/ticker', data);
    },

    /**
     * Get market depth
     * https://github.com/P2pb2b-team/p2pb2b-api-docs/blob/master/api-doc.md#depth-result
     * @param pair
     * @param {Number} limit min 1, default 50, max 100
     * @param {Number} interval One of 0, 0.00000001, 0.0000001, 0.000001, 0.00001, 0.0001, 0.001, 0.01, 0.1, 1. Default 0.
     * @return {Object}
     */
    orderBook: function(pair, limit = 100, interval = 0) {
      const data = {};
      data.market = pair;
      if (limit) data.limit = limit;
      if (interval) data.interval = interval;
      return publicRequest('/public/depth/result', data);
    },

    /**
     * Get trades history
     * Results are cached for ~5s
     * @param market Trading pair, like BTC_USDT
     * @param pageSize
     * @return {Object} Last trades
     * https://github.com/P2B-team/p2b-api-docs/blob/master/api-doc.md#history
     */
    getTradesHistory: function(market, pageSize = 500) {
      const data = {
        market,
        pageSize,
      };

      return publicRequest(`/deals`, data);
    },

    /**
     * Get info on all markets
     * @return string
     */
    markets: function() {
      const data = {};
      return publicRequest('/currencies/pairs', data);
    },

  };

  return EXCHANGE_API;
};
