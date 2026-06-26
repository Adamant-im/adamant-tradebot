const nodeCrypto = require('node:crypto');

/** @type {import('axios').AxiosInstance} */
// @ts-ignore: axios is a callable instance
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
   * Handles response from API.
   * @param {Object} responseOrError Response object or error from axios
   * @param {Function} resolve Promise resolve function
   * @param {Function} reject Promise reject function
   * @param {string} bodyString Request body as string
   * @param {string} queryString URL query parameters
   * @param {string} url Request URL
   */
  const handleResponse = (responseOrError, resolve, reject, bodyString, queryString, url) => {
    const httpCode = responseOrError?.status || responseOrError?.response?.status;
    const httpMessage = responseOrError?.statusText || responseOrError?.response?.statusText;

    const azbitData = responseOrError?.data || responseOrError?.response?.data;
    // Azbit doesn't return any special status on success, only HTTP 200
    const azbitStatus = httpCode === 200 ? true : false;
    // Azbit doesn't have error codes in response
    const azbitErrorCode = 'No error code';

    // Azbit returns string in case of error, or { errors } object
    let azbitErrorMessage;
    if (azbitData) {
      if (azbitData.errors) {
        azbitErrorMessage = JSON.stringify(azbitData.errors);
      }

      if (typeof azbitData === 'string') {
        azbitErrorMessage = azbitData;
      }

      // Special handling for order deals endpoint 404 errors
      if (azbitData.status === 404 && url.includes('/deals')) {
        azbitErrorMessage = 'Order not found';
      }
    }

    const azbitErrorInfo = `[${azbitErrorCode}] ${utils.trimAny(azbitErrorMessage, ' .')}`;

    const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${azbitErrorInfo}` : String(responseOrError);
    const reqParameters = queryString || bodyString || '{ No parameters }';

    try {
      if (azbitStatus) {
        // For cancel requests, azbitData may be undefined
        resolve(azbitData || azbitStatus);
      } else if (azbitErrorMessage) {
        // Reject on critical HTTP errors, resolve on processable errors
        if (notValidStatuses.includes(httpCode)) {
          log.log(`Azbit request to ${url} with data ${reqParameters} failed: ${errorMessage}. Rejecting…`);
          reject({ azbitErrorInfo });
        } else {
          log.log(`Azbit processed request to ${url} with data ${reqParameters}, but returned an error: ${errorMessage}. Resolving…`);
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
   * Creates a URL params string as: key1=value1&key2=value2.
   * @param {Object} data Request params
   * @returns {string} URL-encoded query string
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
   * Creates a full URL with params as https://data.azbit.com/api/endpoint?key1=value1&key2=value2.
   * @param {string} url Base URL
   * @param {Object} data Request params
   * @returns {string} Full URL with query parameters
   */
  function getUrlWithParams(url, data) {
    const queryString = getParamsString(data);

    if (queryString) {
      url = url + '?' + queryString;
    }

    return url;
  }

  /**
   * Makes a request to public endpoint.
   * @param {string} path Endpoint path
   * @param {Object} data Request params
   * @returns {Promise<*>} Promise resolving to API response
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
   * Makes a request to private (authenticated) endpoint.
   * @param {string} path Endpoint path
   * @param {Object} data Request params
   * @param {string} method Request type: get, post, delete
   * @returns {Promise<*>} Promise resolving to API response
   */
  function protectedRequest(path, data, method) {
    let url = `${WEB_BASE}${path}`;
    const urlBase = url;

    let headers;
    let bodyString;
    let queryString;

    try {
      // For GET requests, use query params; for POST/DELETE, use body
      if (method === 'get') {
        bodyString = '';
        queryString = getParamsString(data);
        url = getUrlWithParams(url, data);
      } else {
        bodyString = getBody(data);
      }

      // Generate HMAC-SHA256 signature for authentication
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
    return nodeCrypto.createHmac('sha256', config.secret_key).update(config.apiKey + url + payload).digest('hex');
  };

  const EXCHANGE_API = {
    /**
     * Sets API configuration.
     * @param {string} apiServer API server base URL
     * @param {string} apiKey API key
     * @param {string} secretKey Secret key for signing
     * @param {string} tradePwd Trading password (not used for Azbit)
     * @param {Object} logger Logger instance
     * @param {boolean} publicOnly Whether to configure only public endpoints
     */
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
     * Retrieves list of user balances for all currencies.
     * @returns {Promise<Object>} Object containing balances, balancesBlockedInOrder, balancesInCurrencyOfferingsVesting, withdrawalLimits, currencies
     * @see https://docs.azbit.com/docs/public-api/wallet#apiwalletsbalances
     */
    async getBalances() {
      const data = {};
      return protectedRequest('/wallets/balances', data, 'get');
    },

    /**
     * Queries account orders.
     * @param {string} pair Trading pair in Azbit format as ETH_USDT
     * @param {string} status Order status filter: "all", "active", or "cancelled" (optional)
     * @returns {Promise<Object>} Array of orders
     * @see https://docs.azbit.com/docs/public-api/orders#apiuserorders
     */
    getOrders(pair, status) {
      const data = {};

      if (pair) data.currencyPairCode = pair;
      if (status) data.status = status;

      return protectedRequest('/user/orders', data, 'get');
    },

    /**
     * Queries order deals (fills).
     * @param {string} orderId Exchange order ID as '70192a8b-c34e-48ce-badf-889584670507'
     * @returns {Promise<Object>} Object containing deals array, id, isCanceled, and other order details. Returns 404 if order doesn't exist, 400 if orderId is invalid (not a GUID). No deals: { deals: [], ... }. Cancelled order: { deals: [...], isCanceled: true, ... }.
     * @see https://docs.azbit.com/docs/spot/orders#apiordersorderiddeals
     */
    getOrderDeals(orderId) {
      return protectedRequest(`/orders/${orderId}/deals`, {}, 'get');
    },

    /**
     * Places an order.
     * @param {string} market Trading pair in Azbit format as ETH_USDT
     * @param {string | number} amount Order amount in coin1
     * @param {string | number} price Order price
     * @param {string} side Order side: 'buy' or 'sell'
     * @returns {Promise<string|Object>} Order GUID on success (e.g., "e2cd407c-28c8-4768-bd73-cd7357fbccde"); error object with `azbitErrorInfo` on failure
     * @see https://docs.azbit.com/docs/public-api/orders#post
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
     * Cancels an order.
     * @param {string} orderId Order ID (e.g., '70192a8b-c34e-48ce-badf-889584670507')
     * @returns {Promise<Object>} Success response with no data
     * @see https://docs.azbit.com/docs/public-api/orders#delete-1
     */
    cancelOrder(orderId) {
      return protectedRequest(`/orders/${orderId}`, {}, 'delete');
    },

    /**
     * Cancels all orders for a currency pair.
     * @param {string} pair Trading pair in Azbit format as ETH_USDT
     * @returns {Promise<Object>} Success response with no data (returns 200 status regardless of success)
     * @see https://docs.azbit.com/docs/public-api/orders#delete
     */
    cancelAllOrders(pair) {
      return protectedRequest(`/orders?currencyPairCode=${pair}`, {}, 'delete');
    },

    /**
     * Retrieves trade details for a ticker (market rates).
     * @param {string} pair Trading pair in Azbit format as ETH_USDT
     * @returns {Promise<Object>} Ticker data with price and volume information
     * @see https://docs.azbit.com/docs/public-api/tickers#apitickers
     */
    ticker(pair) {
      const data = {
        currencyPairCode: pair,
      };

      return publicRequest('/tickers', data);
    },

    /**
     * Retrieves market depth (40 bids + 40 asks).
     * @param {string} pair Trading pair in Azbit format as ETH_USDT
     * @returns {Promise<Object>} Order book with bids and asks arrays (returns empty array for invalid pair)
     * @see https://docs.azbit.com/docs/public-api/orders#apiorderbook
     */
    orderBook(pair) {
      const data = {
        currencyPairCode: pair,
      };

      return publicRequest('/orderbook', data);
    },

    /**
     * Retrieves recent trades history.
     * @param {string} pair Trading pair in Azbit format as ETH_USDT
     * @param {number} pageSize Number of trades to return (max 200)
     * @param {number} [pageNumber] Page number (optional)
     * @returns {Promise<Object>} Array of recent trades (returns empty array for invalid pair)
     * @see https://docs.azbit.com/docs/public-api/deals#apideals
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
     * Retrieves all available crypto currencies.
     * Note: This v1 endpoint returns only coin tickers. The v1 /wallets/balances and v2 https://api2.azbit.com/api/currencies endpoints offer more detailed information.
     * @returns {Promise<Object>} Array of currency codes
     * @see https://docs.azbit.com/docs/public-api/currency#apicurrencies
     */
    getCurrencies() {
      const data = {};
      return publicRequest('/currencies', data);
    },

    /**
     * Retrieves user deposit address for a cryptocurrency.
     * @param {string} coin Currency code (e.g., BTC)
     * @returns {Promise<Object>} Deposit address information
     * @see https://docs.azbit.com/docs/public-api/wallet#apideposit-addresscurrencycode
     */
    getDepositAddress(coin) {
      return protectedRequest(`/deposit-address/${coin}`, {}, 'get');
    },

    /**
     * Retrieves trade fees for the user.
     * @returns {Promise<Object>} User's trading fee information
     * @see https://docs.azbit.com/docs/public-api/currency#apicurrenciesusercommissions
     */
    getFees() {
      return protectedRequest('/currencies/user/commissions', {}, 'get');
    },

    /**
     * Retrieves information on all available trading pairs.
     * @returns {Promise<Object>} Array of market/trading pair information
     * @see https://docs.azbit.com/docs/public-api/currency#apicurrenciespairs
     */
    async markets() {
      const data = {};
      return publicRequest('/currencies/pairs', data);
    },
  };

  return EXCHANGE_API;
};
