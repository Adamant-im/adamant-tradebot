const axios = require('axios');

const {
  trimAny,
  getParamsString,
} = require('../../helpers/utils');

/**
 * Docs: https://nonkyc.io/api
 */

/**
 * Error codes: https://nonkyc.io/api
 * isTemporary means that we consider the request is temporary failed and we'll repeat it later with success possibility
 */
const errorCodeDescriptions = {
  400: {
    description: 'Unknown error',
    details: 'An unknown error occurred somewhere in the system',
  },
  402: {
    description: 'Method not found',
    details: 'The requested API method was not found',
  },
  403: {
    description: 'Action is forbidden for account',
  },
  429: {
    description: 'Too many requests',
    details: 'Action is being rate limited for account',
    isTemporary: true,
  },
  500: {
    description: 'Internal Server Error',
    isTemporary: true,
  },
  503: {
    description: 'Service Unavailable',
    details: 'Try it again later',
    isTemporary: true,
  },
  504: {
    description: 'Gateway Timeout',
    details: 'Check the result of your request later',
    isTemporary: true,
  },
  1001: {
    description: 'Authorization required',
  },
  1002: {
    description: 'Authorization failed',
  },
  1003: {
    description: 'Action is forbidden for this API key',
    details: 'Check permissions for API key',
  },
  1004: {
    description: 'Unsupported authorisation method',
    details: 'Use Basic authentication',
  },
  2001: {
    description: 'Symbol not found',
  },
  2002: {
    description: 'Currency not found',
  },
  10001: {
    description: 'Validation error',
    details: 'Input not valid',
  },
  20001: {
    description: 'Insufficient funds',
    details: 'Insufficient funds for creating order or any account operation',
  },
  20002: {
    description: 'Order not found',
    details: 'Attempt to get active order that not existing, filled, canceled or expired.',
  },
  20003: {
    description: 'Limit exceeded',
    details: 'Withdrawal limit exceeded',
  },
  20004: {
    description: 'Transaction not found',
    details: 'Requested transaction not found',
  },
  20005: {
    description: 'Payout not found',
  },
  20006: {
    description: 'Payout already committed',
  },
  20007: {
    description: 'Payout already rolled back',
  },
  20008: {
    description: 'Duplicate clientOrderId',
  },
  20010: {
    description: 'Address generation error',
    details: 'Unable to generate a new deposit address. Try request later.',
  },
  20011: {
    description: 'Withdrawal not found',
    details: 'The referenced withdrawal was not found.',
  },
  20012: {
    description: 'Withdrawals disabled',
    details: 'Withdrawals are disabled for this currency or system wide. Check system status page.',
  },
  20013: {
    description: 'Withdrawal amount below minimum',
    details: 'Minimum withdrawal amount for any currency is Withdraw Fee * 2.',
  },
  20014: {
    description: 'Withdrawal address invalid',
    details: 'Ensure the address you are withdrawing to is correct.',
  },
  20015: {
    description: 'Payment ID Required',
    details: 'This currency requires a paymentId when making a withdrawal request.',
  },
  20016: {
    description: 'Invalid confirmation code',
    details: 'The provided confirmation code is incorrect.',
  },
  20017: {
    description: 'Withdraw already confirmed',
    details: 'The withdrawal request has already been confirmed.',
  },
};

module.exports = function() {
  let WEB_BASE = 'https://nonkyc.io/api/v2';
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

    const nonkycError = data?.error;
    const nonkycErrorInfo = errorCodeDescriptions[nonkycError?.code];

    const success = httpCode === 200 && !nonkycError;

    const error = {
      code: nonkycError?.code ?? 'No error code',
      description: trimAny(nonkycError?.message ?? nonkycErrorInfo?.description ?? '', ' .'),
      details: trimAny(nonkycError?.description ?? nonkycErrorInfo?.details ?? '', ' .'),
    };

    error.message = error.description + (error.details ? ` (${error.details})` : '');

    const reqParameters = queryString || '{ No parameters }';

    try {
      if (success) {
        resolve(data);
      } else {
        const nonkycErrorInfo = `[${error.code}] ${error.message || 'No error message'}`;
        const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${nonkycErrorInfo}` : String(responseOrError);

        if (typeof data === 'object') {
          data.nonkycErrorInfo = nonkycErrorInfo;
        }

        if (httpCode && !nonkycErrorInfo?.isTemporary) {
          log.log(`Nonkyc processed a request to ${url} with data ${reqParameters}, but with error: ${errorMessage}. Resolving…`);

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

    const auth = 'Basic ' + Buffer.from(`${config.apiKey}:${config.secret_key}`).toString('base64');

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url,
        method: type,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: auth,
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
     * Get detailed account balance information
     * https://nonkyc.io/api#/Account/get_balances
     * @return {Promise<[]>}
     */
    getBalances() {
      return protectedRequest('get', '/balances', {});
    },

    /**
     * Get a list of your 'active' spot market orders
     * https://nonkyc.io/api#/Account/get_getorders
     * @param {String} symbol In NonKYC format as BTC_USDT
     * @param {Number} [limit=500] Max: 500
     * @param {Number} [offset=0]
     * @return {Promise<[]>}
     */
    getOrders(symbol, limit = 500, offset = 0) {
      const params = {
        symbol,
        status: 'active',
        limit,
        skip: offset,
      };

      return protectedRequest('get', '/getorders', params);
    },

    /**
     * Get an order by id
     * https://nonkyc.io/api#/Account/get_getorder__orderId_
     * @param {String} orderId Example: '655f28a1f6849a420b2e913d'
     * @returns {Promise<Object>}
     */
    async getOrder(orderId) {
      return protectedRequest('get', `/getorder/${orderId}`, {});
    },

    /**
     * Make a new spot market order
     * https://nonkyc.io/api#/Account/post_createorder
     * @param {String} symbol In NonKYC format as BTC_USDT
     * @param {String} amount Base coin amount
     * @param {String} price Order price
     * @param {String} side buy or sell
     * @param {String} type market or limit
     * @return {Promise<Object>}
     */
    addOrder(symbol, amount, price, side, type) {
      const data = {
        symbol,
        side,
        type,
        price,
        quantity: amount,
      };

      return protectedRequest('post', '/createorder', data);
    },

    /**
     * Cancel an open spot trade order
     * https://nonkyc.io/api#/Account/post_cancelorder
     * @param {String} orderId Example: '655f28a1f6849a420b2e913d'
     * @return {Promise<Object>}
     */
    cancelOrder(orderId) {
      const data = {
        id: orderId,
      };

      return protectedRequest('post', '/cancelorder', data);
    },

    /**
     * Cancel a batch of open orders in a spot market
     * https://nonkyc.io/api#/Account/post_cancelallorders
     * @param {String} symbol In NonKYC format as BTC_USDT
     * @param {String} [side='all'] 'buy', 'sell' or 'all'
     * @return {Promise<Object>}
     */
    cancelAllOrders(symbol, side = 'all') {
      const data = {
        symbol,
        side,
      };

      return protectedRequest('post', '/cancelallorders', data);
    },

    /**
     * Market related statistics for single market for the last 24 hours
     * https://nonkyc.io/api#/Aggregator%20Datafeed%20Format/get_ticker__symbol_
     * @param {String} symbol In NonKYC format as BTC_USDT
     * @return {Promise<Object>}
     */
    ticker(symbol) {
      return publicRequest('get', `/ticker/${symbol}`, {});
    },

    /**
     * Order book of any given market trading pair, split into two different arrays for bid and for ask orders
     * https://nonkyc.io/api#/Aggregator%20Datafeed%20Format/get_orderbook
     * @param {String} symbol In NonKYC format as BTC_USDT
     * @param {Number} [limit=400] Bids 1/2 and Asks 1/2. Default is 100.
     * @return {Promise<Object>}
     */
    orderBook(symbol, limit = 400) {
      const params = {
        ticker_id: symbol,
        depth: limit,
      };

      return publicRequest('get', '/orderbook', params);
    },

    /**
     * Historical market trade data for any given trading pair
     * https://nonkyc.io/api#/Aggregator%20Datafeed%20Format/get_historical_trades
     * @param {String} symbol In NonKYC format as BTC_USDT
     * @param {Number} [limit=500]
     * @return {Promise<[]>}
     */
    getTradesHistory(symbol, limit = 500) {
      const params = {
        ticker_id: symbol,
        limit,
      };

      return publicRequest('get', '/historical_trades', params);
    },

    /**
     * Get list of markets
     * https://nonkyc.io/api#/Public/get_market_getlist
     * @return {Promise<[]>}
    */
    markets() {
      return publicRequest('get', '/market/getlist', {});
    },

    /**
     * Get a list of assets
     * https://nonkyc.io/api#/Public/get_asset_getlist
     * @return {Promise<[]>}
    */
    currencies() {
      return publicRequest('get', '/asset/getlist', {});
    },

    /**
     * Get your deposit address
     * https://nonkyc.io/api#/Account/get_getdepositaddress__ticker_
     * @param {String} ticker As ETH-ERC20, ADM
     * @return {Promise<Object>}
     */
    getDepositAddress(ticker) {
      return protectedRequest('get', `/getdepositaddress/${ticker}`, {});
    },

    /**
     * Make a new withdrawal request
     * https://nonkyc.io/api#/Account/post_createwithdrawal
     * @param {String} ticker As ETH-ERC20, ADM
     * @param {Number} quantity
     * @param {String} cryptoAddress Crypto address to withdraw funds to
     * @return {Promise<Object>}
     */
    addWithdrawal(ticker, quantity, cryptoAddress) {
      const data = {
        ticker,
        quantity,
        address: cryptoAddress,
      };

      return protectedRequest('post', '/createwithdrawal', data);
    },

    /**
     * Get a list of your account withdrawals
     * https://nonkyc.io/api#/Account/get_getwithdrawals
     * @param {String} coin As BTC
     * @param {Number} [limit=500] Min: 1. Max: 500.
     * @param {Number} [offset=0]
     * @return {Promise<[]>}
     */
    getWithdrawalHistory(coin, limit = 500, offset = 0) {
      const params = {
        ticker: coin,
        limit,
        skip: offset,
      };

      return protectedRequest('get', '/getwithdrawals', params);
    },

    /**
     * Get a list of your account deposits
     * https://nonkyc.io/api#/Account/get_getdeposits
     * @param {String} ticker As BTC
     * @param {Number} [limit=500] Min: 1. Max: 500.
     * @param {Number} [offset=0]
     * @return {Promise<[]>}
     */
    getDepositHistory(ticker, limit = 500, offset = 0) {
      const params = {
        ticker,
        limit,
        skip: offset,
      };

      return protectedRequest('get', '/getdeposits', params);
    },

  };

  return EXCHANGE_API;
};

module.exports.axios = axios; // for setup axios mock adapter
