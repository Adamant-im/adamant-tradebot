const axios = require('axios');

const {
  getParamsString,
} = require('../../helpers/utils');

/**
 * Docs: https://developer.bitcastle.io/document
 */

module.exports = function() {
  let WEB_BASE = 'https://developer.bitcastle.io';
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
   * @param {String} queryString
   * @param {String} url
   */
  const handleResponse = (responseOrError, resolve, reject, queryString, url) => {
    const httpCode = responseOrError?.status ?? responseOrError?.response?.status;
    const httpMessage = responseOrError?.statusText ?? responseOrError?.response?.statusText;

    const data = responseOrError?.data ?? responseOrError?.response?.data;

    const success = httpCode === 200 && !data?.error;

    const error = {
      code: data?.statusCode ?? data?.error_code ?? 'No error code',
      description: data?.error ?? data?.msg ?? 'No error details',
      details: handleErrorDetails(data) ?? 'No error message',
    };

    error.message = error.description + (error.details ? ` (${error.details})` : '');

    const reqParameters = queryString || '{ No parameters }';

    try {
      if (success || success === true) {
        resolve(data);
      } else {
        const bitcastleErrorInfoString = `[${error.code}] ${error.message || 'No error message'}`;
        const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${bitcastleErrorInfoString}` : String(responseOrError);

        if (typeof data === 'object') {
          data.bitcastleErrorInfo = bitcastleErrorInfoString;
        }

        if (httpCode === 400) {
          log.log(`Bitcastle processed a request to ${url} with data ${reqParameters}, but with error: ${errorMessage}. Resolving…`);

          resolve(data);
        } else {
          log.warn(`Request to ${url} with data ${reqParameters} failed. Details: ${errorMessage}. Rejecting…`);

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

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url,
        method: type,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'x-bce-apikey': config.apiKey,
        },
        data: type === 'post' ? data : undefined,
        params: type === 'get' ? data : undefined,
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
   * @param {Object} params Request params
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
   * Bitcastle has different error description formats for various endpoint
   * @param data
   * @returns {String|undefined}
   */
  function handleErrorDetails(data) {
    if (data?.message) {
      if (Array.isArray(data?.message)) {
        return data?.message?.join(', ');
      } else {
        return data?.message;
      }
    } else if (data?.errors) {
      return data?.errors.map((error) => error.msg).join(', ');
    }
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
     * Get user balances
     * https://developer.bitcastle.io/document#tag/Balance/operation/Get%20user%20balances
     * @return {Promise<Object>}
     */
    getBalances() {
      return protectedRequest('get', '/balance/v2/balance-account', {});
    },

    /**
     * The List Open Orders API allows you to retrieve a list of open or pending orders.
     * https://developer.bitcastle.io/document#tag/Spot-Trading/operation/List%20open%20orders
     * @param {String} coin Example: 'BTC'
     * @param {String} currency Example: 'USDT'
     * @param {Number} [limit=1000] Max: 1000
     * @return {Promise<Object>}
     */
    getOrders(coin, currency, limit = 1000) {
      const params = {
        coin,
        currency,
        take: limit,
      };

      return protectedRequest('get', '/exchange/order/v1/order/open-order', params);
    },

    /**
     * Get user's order by order_id.
     * https://developer.bitcastle.io/document#tag/Spot-Trading/operation/Get%20order%20by%20id
     * @param {String} orderId Example: '112321'
     * @returns {Promise<Object>}
     */
    getOrder(orderId) {
      const params = {
        order_id: orderId,
      };

      return protectedRequest('get', '/exchange/order/v1/order-a-bug-here', params);
    },

    /**
     * Open new Order
     * https://developer.bitcastle.io/document#tag/Spot-Trading/operation/Open%20order
     * @param {String} coin Example: 'BTC'
     * @param {String} currency Example: 'USDT'
     * @param {String} amount Base coin amount
     * @param {String} price Order price
     * @param {String} side buy or sell
     * @param {String} type market or limit
     * @return {Promise<Object>}
     */
    addOrder(coin, currency, amount, price, side, type) {
      const data = {
        coin,
        currency,
        order_type: side === 'buy' ? 1 : 2,
        order_class: type === 'market' ? 1 : 2,
        price: String(price),
        volume: String(amount),
      };

      return protectedRequest('post', '/exchange/order/v1/order', data);
    },

    /**
     * The Cancel Open Order API allows you to cancel an open or pending orders by list of IDs
     * https://developer.bitcastle.io/document#tag/Spot-Trading/operation/Cancel%20orders%20by%20ids
     * @param {Array<String>} orderIds Example: '112321'
     * @return {Promise<Object>}
     */
    cancelOrders(orderIds) {
      const data = {
        ids: orderIds,
      };

      return protectedRequest('post', '/exchange/order/v1/order/cancel', data);
    },

    /**
     * Market related statistics for all markets for the last 24 hours
     * https://developer.bitcastle.io/document#tag/Markets/operation/Get%2024h%20tickers
     * @param {String} coin Example: 'BTC'
     * @param {String} currency Example: 'USDT'
     * @return {Promise<Object>}
     */
    ticker(coin, currency) {
      const params = {
        coin,
        currency,
      };

      return publicRequest('get', '/exchange/orderbook/v1/ticker/24h', params);
    },

    /**
     * Order book depth of any given trading pair, split into two different arrays for bid and ask orders
     * https://developer.bitcastle.io/document#tag/Markets/operation/Get%20orderbook
     * @param {String} coin Example: 'BTC'
     * @param {String} currency Example: 'USDT'
     * @param {Number} [limit=100] Max: 100, Default: 100
     * @return {Promise<Object>}
     */
    orderBook(coin, currency, limit = 100) {
      const params = {
        coin,
        currency,
        precision: 0.01,
        take: limit,
      };

      return publicRequest('get', '/exchange/orderbook/v1/orderbook', params);
    },

    /**
     * Used to return data on historical completed trades for a given market pair
     * https://developer.bitcastle.io/document#tag/Markets/operation/Get%20historical%20trades
     * @param {String} coin Example: 'BTC'
     * @param {String} currency Example: 'USDT'
     * @return {Promise<Object>}
     */
    getTradesHistory(coin, currency) {
      return publicRequest('get', `/exchange/orderbook/v1/cg/v1/historical_trades/${coin}_${currency}`, {});
    },

    /**
     * Market related statistics for all markets for the last 24 hours
     * https://developer.bitcastle.io/document#tag/Markets/operation/Get%20Pairs
     * @return {Promise<[]>}
    */
    markets() {
      return publicRequest('get', '/exchange/orderbook/v1/cg/v1/pairs', {});
    },
  };

  return EXCHANGE_API;
};

module.exports.axios = axios; // for setup axios mock adapter
