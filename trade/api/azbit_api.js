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
    apiKey: '',
    secret_key: '',
  };
  let log = {};

  const notValidStatuses = [
    401, // ~Invalid auth, payload, nonce
    429, // Too many requests
    423, // Temporary block
    500, // Service temporary unavailable
    // 404, ~Not found: for getOrderDeals()
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
    const azbitStatus = httpCode === 200 ? true : false; // Azbit doesn't return any special status on success
    const azbitErrorCode = 'No error code'; // Azbit doesn't have error codes

    // Azbit returns string in case of error, or { errors }
    let azbitErrorMessage;
    if (azbitData) {
      if (azbitData.errors) {
        azbitErrorMessage = JSON.stringify(azbitData.errors);
      }

      if (typeof azbitData === 'string') {
        azbitErrorMessage = azbitData;
      }

      if (azbitData.status === 404 && url.includes('/deals')) {
        azbitErrorMessage = 'Order not found';
      }
    }

    const azbitErrorInfo = `[${azbitErrorCode}] ${utils.trimAny(azbitErrorMessage, ' .')}`;

    const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${azbitErrorInfo}` : String(responseOrError);
    const reqParameters = queryString || bodyString || '{ No parameters }';

    try {
      if (azbitStatus) {
        resolve(azbitData || azbitStatus); // If cancel request is successful, azbitData is undefined :)
      } else if (azbitErrorMessage) {
        if (notValidStatuses.includes(httpCode)) {
          log.log(`Azbit request to ${url} with data ${reqParameters} failed: ${errorMessage}. Rejecting…`);
          reject({ azbitErrorInfo });
        } else {
          log.log(`Azbit processed a request to ${url} with data ${reqParameters}, but with error: ${errorMessage}. Resolving…`);
          resolve({ azbitErrorInfo });
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
        url,
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
    let queryString;

    try {
      if (method === 'get') {
        bodyString = '';
        queryString = getParamsString(data);
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
        method,
        url,
        timeout: 10000,
        headers,
        data,
      };

      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, bodyString, queryString, urlBase))
          .catch((error) => handleResponse(error, resolve, reject, bodyString, queryString, urlBase));
    });
  }

  const getBody = (data) => {
    return utils.isObjectNotEmpty(data) ? JSON.stringify(data) : '';
  };

  const getSignature = (url, payload) => {
    return crypto.createHmac('sha256', config.secret_key).update(config.apiKey + url + payload).digest('hex');
  };

  const EXCHANGE_API = {
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
     * List of user balances for all currencies
     * @return {Object} { balances, balancesBlockedInOrder, balancesInCurrencyOfferingsVesting?, withdrawalLimits, currencies }
     * https://docs.azbit.com/docs/public-api/wallet#apiwalletsbalances
     */
    async getBalances() {
      const data = {};
      return protectedRequest('/wallets/balances', data, 'get');
    },

    /**
     * Query account orders
     * @param {String} pair In Azbit format as ETH_USDT
     * @param {String} status ["all", "active", "cancelled"]. Optional.
     * @return {Object}
     * https://docs.azbit.com/docs/public-api/orders#apiuserorders
     *
     */
    getOrders(pair, status) {
      const data = {};

      if (pair) data.currencyPairCode = pair;
      if (status) data.status = status;

      return protectedRequest('/user/orders', data, 'get');
    },

    /**
     * Query order deals
     * @param {String} orderId Exchange's orderId as '70192a8b-c34e-48ce-badf-889584670507'
     * @return {Object} { deals[], id, isCanceled and other order details }
     * https://docs.azbit.com/docs/public-api/orders#apiordersorderiddeals
     * Order doesn't exist: 404, { status: 404 }
     * Wrong orderId (not a GUID): 400, { status: 400, errors: { ... } }
     * No deals: { deals: [], ... }
     * Cancelled order: { deals: [...], isCanceled: true, ... }
     */
    getOrderDeals(orderId) {
      return protectedRequest(`/orders/${orderId}/deals`, {}, 'get');
    },

    /**
     * Places a order
     * @param {String} market In Azbit format as ETH_USDT
     * @param {Number} amount Order amount in coin1
     * @param {Number} price Order price
     * @param {String} side 'buy' or 'sell'
     * @return {Object} Order GUID in case if success. Example: "e2cd407c-28c8-4768-bd73-cd7357fbccde".
     * https://docs.azbit.com/docs/public-api/orders#post
     */
    addOrder(market, amount, price, side) {
      const data = {
        side,
        currencyPairCode: market,
        amount,
        price,
      };

      return protectedRequest('/orders', data, 'post');
    },

    /**
     * Cancel an order
     * @param {String} orderId Example: '70192a8b-c34e-48ce-badf-889584670507'
     * @return {Object} Success response with no data
     * https://docs.azbit.com/docs/public-api/orders#delete-1
     */
    cancelOrder(orderId) {
      return protectedRequest(`/orders/${orderId}`, {}, 'delete');
    },

    /**
     * Cancel all orders for currency pair
     * @param {String} pair In Azbit format as ETH_USDT
     * @returns {Object} Success response with no data. Never mind, if no success, no data as well. Same 200 status.
     * https://docs.azbit.com/docs/public-api/orders#delete
     */
    cancelAllOrders(pair) {
      return protectedRequest(`/orders?currencyPairCode=${pair}`, {}, 'delete');
    },

    /**
     * Get trade details for a ticker (market rates)
     * @param {String} pair In Azbit format as ETH_USDT
     * @return {Object}
     * https://docs.azbit.com/docs/public-api/tickers#apitickers
     */
    ticker(pair) {
      const data = {
        currencyPairCode: pair,
      };

      return publicRequest('/tickers', data);
    },

    /**
     * Get market depth, 40 bids + 40 asks
     * Note: returns [] for a wrong trade pair
     * @param pair In Azbit format as ETH_USDT
     * @return {Object}
     * https://docs.azbit.com/docs/public-api/orders#apiorderbook
     */
    orderBook(pair) {
      const data = {
        currencyPairCode: pair,
      };

      return publicRequest('/orderbook', data);
    },

    /**
     * Get trades history
     * Note: returns [] for a wrong trade pair
     * @param pair In Azbit format as ETH_USDT
     * @param pageSize Number of trades to return. Max is 200.
     * @param pageNumber Page number. Optional.
     * @return {Object} Last trades
     * https://docs.azbit.com/docs/public-api/deals#apideals
     */
    getTradesHistory(pair, pageSize = 200, pageNumber) {
      const data = {
        pageSize,
        currencyPairCode: pair,
      };

      if (pageNumber) data.pageNumber = pageNumber;

      return publicRequest('/deals', data);
    },

    /**
     * Get all crypto currencies
     * Note: v1 endpoint returns only coin tickers.
     * v1 /wallets/balances and v2 https://api2.azbit.com/api/currencies offer much more, but never mind.
     * @returns {Object}
     * https://docs.azbit.com/docs/public-api/currency#apicurrencies
     */
    getCurrencies() {
      const data = {};
      return publicRequest('/currencies', data);
    },

    /**
     * Get user deposit address
     * @param coin As BTC
     * @returns {Object}
     * https://docs.azbit.com/docs/public-api/wallet#apideposit-addresscurrencycode
     */
    getDepositAddress(coin) {
      return protectedRequest(`/deposit-address/${coin}`, {}, 'get');
    },

    /**
     * Get trade fees
     * @returns {Object}
     * https://docs.azbit.com/docs/public-api/currency#apicurrenciesusercommissions
     */
    getFees() {
      return protectedRequest('/currencies/user/commissions', {}, 'get');
    },

    /**
     * Get info on all markets
     * @returns {Object}
     * https://docs.azbit.com/docs/public-api/currency#apicurrenciespairs
     */
    async markets() {
      const data = {};
      return publicRequest('/currencies/pairs', data);
    },
  };

  return EXCHANGE_API;
};
