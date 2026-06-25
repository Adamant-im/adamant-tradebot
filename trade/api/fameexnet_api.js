/**
 * Connector to the FameEx.net API.
 * Intended for use with `trader_fameexnet.js` only.
 *
 * @module trade/api/bybit_api
 * @typedef {import('axios').AxiosResponse<T>} AxiosResponse<T>
 * @typedef {import('axios').AxiosError<unknown>} AxiosError<unknown>
 * @template T
 */

'use strict';

/**
 * @typedef {import('types/fameexnet.d').Response} Response
 * @typedef {import('types/fameexnet/balances.d').default} Balances
 * @typedef {import('types/fameexnet/currencies.d').default} Currencies
 * @typedef {import('types/fameexnet/currencies.d').default} MarketInfo
 * @typedef {import('types/fameexnet/market-tickers.d').default} Markets
 * @typedef {import('types/fameexnet/order-all.d').default} OrderAll
 * @typedef {import('types/fameexnet/order-book.d').default} OrderBook
 * @typedef {import('types/fameexnet/order-cancel-few.d').default} OrderCancelFew
 * @typedef {import('types/fameexnet/order-cancel-one.d').default} OrderCancelOne
 * @typedef {import('types/fameexnet/order-place.d').default} OrderPlace
 * @typedef {import('types/fameexnet/trade-history.d').default} TradeHistory
 * @typedef {Balances & Currencies & MarketInfo & Markets & OrderAll & OrderAll[number] & OrderBook &
 *   OrderCancelFew & OrderCancelOne & OrderPlace & Response & TradeHistory} ResponseData
 */

const JsonParseBigInt = require('json-parse-bigint');
const nodeCrypto = require('crypto');
/** @type {import('axios').AxiosInstance} */
// @ts-ignore: axios is a callable instance
const axios = require('axios');

const {
  trimAny,
  getParamsString,
} = require('../../helpers/utils');

const { errorCodeDescriptions, httpErrorCodeDescriptions } = require('./fameexnet_errors');

const REQUEST_TIMEOUT = 5_000;

/**
 * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node
 */
module.exports = function() {
  let WEB_BASE = 'https://openapi.fameex.net';
  let config = {
    apiKey: '',
    secret_key: '',
    tradePwd: '',
  };
  let log = {};

  /**
   * Handle response from API.
   * @param {AxiosResponse<Response> & AxiosError<Response>} responseOrError Axios response or error object
   * @param {(data: {}) => void} resolve Request promise resolve method
   * @param {(error: string) => void} reject Request promise reject method
   * @param {string} queryString URL query string with search parameters
   * @param {string} url URL without parameters
   */
  const handleResponse = (responseOrError, resolve, reject, queryString, url) => {
    const httpCode = responseOrError?.status ?? responseOrError?.response?.status;
    const httpMessage = responseOrError?.statusText ?? responseOrError?.response?.statusText;

    /** @type {Response} */
    const response = responseOrError?.data ?? responseOrError?.response?.data;

    const fameEXErrorCode = /** @type {number} */ response?.code;
    const fameEXErrorCodeSuccess = fameEXErrorCode === 0 || fameEXErrorCode === undefined;

    const success = httpCode === 200 && fameEXErrorCodeSuccess;

    const fameEXError = errorCodeDescriptions[fameEXErrorCode];
    const fameEXErrorDetails = {
      code: fameEXErrorCode ?? 'No error code',
      msg: fameEXError?.description ?? response?.msg ?? 'Unknown error',
    };

    const httpCodeInfo = httpErrorCodeDescriptions[httpCode] ?? httpErrorCodeDescriptions[httpCode?.toString()[0]];

    const reqParameters = queryString || '{ No parameters }';

    try {
      if (success) {
        resolve(response.data || response); // Missed the moment when FemeEX started returning data inside a separate 'data' field
      } else {
        const fameexErrorInfo = `[${fameEXErrorDetails.code}] ${trimAny(fameEXErrorDetails.msg, ' .')}`;
        const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${fameexErrorInfo}` : String(responseOrError);

        if (typeof response === 'object') {
          response.fameexErrorInfo = fameexErrorInfo;
        }

        if (httpCode && !httpCodeInfo?.isTemporary && !fameEXError?.isTemporary) {
          log.log(`FameEX processed a request to ${url} with data ${reqParameters}, but with error: ${errorMessage}. Resolving…`);
          resolve(response);
        } else {
          log.warn(`Request to ${url} with data ${reqParameters} failed. details: ${errorMessage}. Rejecting…`);

          reject(errorMessage);
        }
      }
    } catch (error) {
      log.warn(`Error while processing response of request to ${url} with data ${reqParameters}: ${error}. Data object I've got: ${JSON.stringify(response)}.`);
      reject(`Unable to process data: ${JSON.stringify(response)}. ${error}`);
    }
  };

  /**
   * Make request to a private (authorized) endpoint.
   * @param {'get' | 'post'} method Request method
   * @param {string} path URL endpoint path
   * @param {{}} [params] Request data to send
   * @returns {Promise<ResponseData>}
   */
  function protectedRequest(method, path, params = {}) {
    const url = `${WEB_BASE}${path}`;
    const bodyString = getParamsString(params);
    /**
     * Batch cancel endpoint requires BigInt to be stringified from object.
     * The problem is `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt` in this case.
     * Modern solution with `JSON.rawJSON` is not applicable here as it was introduced in Node.js version 21.
     * Replacement callback here removes quotes from order id strings to make them BigInts.
     */
    const stringifiedData = path === '/sapi/v1/batchCancel' ?
      JSON.stringify(params).replace(/"\d+"/g, (match) => match.slice(1, -1)) :
      JSON.stringify(params);
    const timestamp = Date.now();
    const signPayload = method === 'post' ?
      stringifiedData :
      bodyString.length ?
        `?${bodyString}` :
        '';
    const sign = getSignature(config.secret_key, timestamp, /** @type {'GET' | 'POST'} */ (method.toUpperCase()), path, signPayload);

    return new Promise((resolve, reject) => {
      const httpOptions = {
        data: method === 'post' ? stringifiedData : undefined,
        headers: {
          'Content-Type': 'application/json',
          'X-CH-APIKEY': config.apiKey,
          'X-CH-SIGN': sign,
          'X-CH-TS': timestamp,
        },
        method,
        params: method === 'post' ? undefined : params,
        timeout: REQUEST_TIMEOUT,
        transformResponse: (data) => {
          /**
           * FameEx.net API requires order identifiers to be parsed and stringified as `BigInt`.
           */
          return /** @type {JsonParseBigInt.default} */ (
            /** @type {unknown} */ (JsonParseBigInt)
          )(data);
        },
        url,
      };

      axios(httpOptions)
          .then((response) => handleResponse(
              /** @type {AxiosResponse<Response> & AxiosError<Response>} */ (response), resolve, reject, bodyString, url))
          .catch((error) => handleResponse(error, resolve, reject, bodyString, url));
    });
  }

  /**
   * Make request to a public endpoint.
   * @param {'get' | 'post'} method Request method
   * @param {string} path URL endpoint path
   * @param {{}} [params] Request data to send
   * @returns {Promise<ResponseData>}
   */
  function publicRequest(method, path, params = {}) {
    const url = `${WEB_BASE}${path}`;

    const queryString = getParamsString(params);

    return new Promise((resolve, reject) => {
      const httpOptions = {
        headers: {
          'Accept-Encoding': 'application/gzip',
        },
        method,
        params,
        timeout: REQUEST_TIMEOUT,
        url,
      };

      axios(httpOptions)
          .then((response) => handleResponse(
              /** @type {AxiosResponse<Response> & AxiosError<Response>} */ (response), resolve, reject, queryString, url))
          .catch((error) => handleResponse(error, resolve, reject, queryString, url));
    });
  }

  /**
   * Get signature for a FameEx.net request.
   * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#signed-trade-and-user_data-endpoint-security
   * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#example-of-signature
   * @param {string} secret API secret for HMAC
   * @param {number} timestamp Unix timestamp
   * @param {'GET' | 'POST'} method Request method
   * @param {string} requestPath Request interface path
   * @param {string} payload Data to sign
   * @returns {string}
   */
  function getSignature(secret, timestamp, method, requestPath, payload) {
    return nodeCrypto.createHmac('sha256', secret)
        .update(timestamp + method + requestPath + payload)
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
     * Get user assets balance.
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#account-information-deprecated
     * This one returns 404 page not found
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#account-information-recommended
     * This one requires list of coins to get balances for
     * @param {string} symbols List of coins to get balances for. E.g, 'USDT,BTC,ETH'. Max 20 coins.
     * @return {Promise<Balances>}
     */
    getBalances(symbols) {
      const params = {
        symbols,
      };

      return protectedRequest('get', '/sapi/v1/account/balance', params);
    },

    /**
     * Get a list of orders.
     * `JsonParseBigInt` allows us to use v1 endpoint which requires order in BigInt.
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#current-order
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#current-order-v2
     * @param {string} symbol Trading pair symbol (uppercase, such as "BTCUSDT")
     * @param {number} [limit] Maximum: 1000
     * @return {Promise<OrderAll>}
     */
    getOrders(symbol, limit = 1000) {
      const params = {
        limit,
        symbol,
      };

      return protectedRequest('get', '/sapi/v1/openOrders', params);
    },

    /**
     * Get order details.
     * `JsonParseBigInt` allows us to use v1 endpoint which requires order in BigInt.
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#order-query
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#order-query-v2
     * @param {string} symbol The name of the currency pair, such as "BTCUSDT"
     * @param {string} orderId Example: '10918742125338689536'
     * @return {Promise<OrderAll[number]>}
     */
    getOrder(symbol, orderId) {
      const params = {
        orderId,
        symbol,
      };

      return protectedRequest('get', '/sapi/v1/order', params);
    },

    /**
     * Create order.
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#create-a-new-order
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#create-a-new-order-v2
     * @param {string} symbol In FameEx.net format as 'BTCUSDT'
     * @param {string} amount Entrusted quantity (trading amount when buying at market price) (amount >= 1)
     * @param {string} quote Entrusted quantity (trading amount when buying at market price) (quote >= 1)
     * @param {string} price Commission price
     * @param {'BUY' | 'SELL'} side Order direction
     * @param {'LIMIT' | 'MARKET'} type Order type
     * @return {Promise<OrderPlace>}
     */
    addOrder(symbol, amount, quote, price, side, type) {
      const params = {
        side,
        symbol,
        type,
        volume: amount || quote,
      };

      if (price) {
        params.price = price;
      }

      return protectedRequest('post', '/sapi/v1/order', params);
    },

    /**
     * Cancel order.
     * `JsonParseBigInt` allows us to use v1 endpoint which requires order in BigInt.
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#cancel-order
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#cancel-order-v2
     * @param {string} symbol In FameEx.net format as 'BTCUSDT'
     * @param {string} orderId Example: '10918742125338689536'
     * @return {Promise<OrderCancelOne>}
     */
    cancelOrder(symbol, orderId) {
      const params = {
        orderId,
        symbol,
      };

      return protectedRequest('post', '/sapi/v1/cancel', params);
    },

    /**
     * Cancel all orders for a specific symbol.
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#bulk-cancel-orders
     * @param {string} symbol In FameEx.net format as 'BTCUSDT'
     * @param {string[] | number[]} orderIds Example: ['10918742125338689536'].
     *   Note: Max 10 orders at a time. @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#is-there-a-limit-on-the-number-of-orders-or-cancellations-that-can-be-processed-in-bulk
     * @return {Promise<OrderCancelFew>}
     */
    cancelAllOrders(symbol, orderIds) {
      const params = {
        orderIds,
        symbol,
      };

      return protectedRequest('post', '/sapi/v1/batchCancel', params);
    },

    /**
     * Ticker for all trading pairs in the market
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#market-ticker
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#market-ticker-v2
     * @param {string} symbol In FameEx.net format as 'BTCUSDT'
     * @return {Promise<Markets>}
    */
    ticker(symbol) {
      const params = { symbol };

      return publicRequest('get', '/sapi/v1/ticker', params);
    },

    /**
     * Get depth data.
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#order-book
     * @param {string} symbol In FameEx.net format as 'BTCUSDT'
     * @param {number} [limit=100] Default: 100; maximum: 100
     * @return {Promise<OrderBook>}
     */
    orderBook(symbol, limit = 100) {
      const params = {
        limit,
        symbol,
      };

      return publicRequest('get', '/sapi/v1/depth', params);
    },

    /**
     * Get the latest trades record.
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#recent-transactions
     * @param {string} symbol In FameEx.net format as 'BTCUSDT'
     * @param {number} [limit=100] Default value is 100, maximum 100
     * @return {Promise<TradeHistory>}
     */
    getTradesHistory(symbol, limit = 100) {
      const params = {
        limit,
        symbol,
      };

      return publicRequest('get', '/sapi/v1/trades', params);
    },

    /**
     * Get all trading currency pairs.
     * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#symbol-pair-list
     * @return {Promise<MarketInfo>}
     */
    markets() {
      return publicRequest('get', '/sapi/v1/symbols');
    },
  };

  return EXCHANGE_API;
};

module.exports.axios = axios; // for setup axios mock adapter
