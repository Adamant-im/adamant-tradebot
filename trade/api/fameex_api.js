const crypto = require('crypto');
const axios = require('axios');

const {
  trimAny,
  getParamsString,
} = require('../../helpers/utils');

/**
 * Docs: https://fameex-docs.github.io/docs/api/spot/en/#introduction
 */

// Error codes: https://fameex-docs.github.io/docs/api/spot/en/#error-message
const httpErrorCodeDescriptions = {
  112002: 'API single key traffic exceeds limit',
  112005: 'API request frequency exceeded',
  112007: 'API-Key creation failed',
  112008: 'API-Key remark name already exists',
  112009: 'The number of API-Key creation exceeds the limit (a single user can create up to 5 APIs)',
  112010: 'API-Key is invalid (the time limit for a single Key is 60 natural days)',
  112011: 'API request IP access is restricted (the bound IP is inconsistent with the request IP)',
  112015: 'Signature error',
  112020: 'Wrong signature',
  112021: 'Wrong signature version',
  112022: 'Signature timestamp error',
  112047: 'The spot API interface is temporarily inaccessible',
  112048: 'The futures API interface is temporarily inaccessible',
  230030: 'Please operate after KYC certification',
};

const statusCodes = {
  ok: 200,
  zero: '0',
};

const versioning = {
  v1: '/v1',
  v2: '/v2',
};

module.exports = function() {
  let WEB_BASE = 'https://api.fameex.com';
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
    const success = httpCode === statusCodes.ok && (data.code === statusCodes.ok || data.code === statusCodes.zero);

    console.log({ data });

    const error = {
      code: data?.code ?? 'No error code',
      msg: httpErrorCodeDescriptions[data?.code] ?? data?.msg ?? 'Unknown error',
    };

    const reqParameters = queryString || '{ No parameters }';

    try {
      if (success) {
        resolve(data.data);
      } else {
        const fameexErrorInfo = `[${error.code}] ${trimAny(error.msg, ' .')}`;

        const errorMessage = httpCode ? `${httpCode} ${httpMessage}, ${fameexErrorInfo}` : String(responseOrError);

        if (typeof data === 'object') {
          data.fameexErrorInfo = fameexErrorInfo;
        }

        if (httpCode === statusCodes.ok) {
          log.log(`FameEX processed a request to ${url} with data ${reqParameters}, but with error: ${error.msg}. Resolving…`);
          resolve(data);
        } else {
          log.warn(`Request to ${url} with data ${reqParameters} failed. details: ${errorMessage}. Rejecting…`);

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
    const stringifiedData = JSON.stringify(data);

    const timestamp = Date.now();

    const signPayload = type === 'post' ? stringifiedData : '';

    const method = type.toUpperCase();

    const sign = getSignature(config.secret_key, timestamp, method, path, signPayload);

    return new Promise((resolve, reject) => {
      const httpOptions = {
        url,
        method: type,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'AccessKey': config.apiKey,
          'SecretKey': config.secret_key,
          'Timestamp': timestamp,
          'SignatureVersion': 'v1.0',
          'SignatureMethod': 'HmacSHA256',
          'Signature': sign,
        },
      };

      if (type === 'post') {
        httpOptions.data = stringifiedData;
      } else {
        httpOptions.params = data;
      }

      axios(httpOptions)
          .then((response) => handleResponse(response, resolve, reject, bodyString, url))
          .catch((error) => handleResponse(error, resolve, reject, bodyString, url));
    });
  }

  /**
   * Makes a request to public endpoint
   * @param {String} type Request type: get, post, delete
   * @param {String} path Endpoint
   * @param {Object} data Request params
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
   * Get a signature for a FameEX request
   * https://fameex-docs.github.io/docs/api/spot/en/#signature
   * @param {String} secret API secret key
   * @param {Number} timestamp Unix timestamp
   * @param {String} method GET or POST
   * @param {String} requestPath Request interface path
   * @param {String} payload Data to sign
   * @returns {String}
   */
  function getSignature(secret, timestamp, method, requestPath, payload) {
    return crypto.createHmac('sha256', secret)
        .update(timestamp + method + requestPath + payload)
        .digest('hex');
  };

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
     * Get user assets balance
     * https://fameex-docs.github.io/docs/api/spot/en/#get-wallet-info
     * @return {Promise<Array>}
     */
    getBalances() {
      return protectedRequest('get', `${versioning.v1}/api/account/wallet`, {});
    },
    /**
     * All trading currencies supported by FameEX
     * https://fameex-docs.github.io/docs/api/spot/en/#get-all-transaction-currencies
     * @return {Promise<Object>}
     */
    currencies() {
      return protectedRequest('get', `${versioning.v1}/common/currencys`, {});
    },

    /**
     * List currencies
     * https://fameex-docs.github.io/docs/api/spot/en/#detailed-summary-for-each-currency
     * @return {Promise<Object>}
     */
    currenciesPublic() {
      return publicRequest('get', `${versioning.v2}/public/assets`, {});
    },

  return EXCHANGE_API;
};

module.exports.axios = axios; // for setup axios mock adapter
