const crypto = require('crypto');
const axios = require('axios');

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
};

let WEB_BASE = ''; // To be set in setConfig()
const WEB_BASE_PREFIX = '/api/v2';
let config = {
  'apiKey': '',
  'secret_key': '',
};
let log = {};

// Docs
// https://github.com/P2pb2b-team/p2pb2b-api-docs/blob/master/api-doc.md

const notValidStatuses = [ // https://github.com/P2pb2b-team/p2pb2b-api-docs/blob/master/errors.md
  401, // Invalid auth
  429, // Too many requests
  423, // Temporary block
  500, // Service temporary unavailable
];

function publicRequest(path, data) {
  let url = `${WEB_BASE}${path}`;
  const params = [];
  for (const key in data) {
    const v = data[key];
    params.push(key + '=' + v);
  }
  const paramsString = params.join('&');
  if (paramsString) {
    url = url + '?' + paramsString;
  }

  return new Promise((resolve, reject) => {
    try {
      const httpOptions = {
        url: url,
        method: 'get',
        timeout: 10000,
        headers: DEFAULT_HEADERS,
      };

      axios(httpOptions)
          .then(function(response) {
            resolve(response.data);
          })
          .catch(function(error) {
            // We can get 4xx with data
            if (error.response && typeof error.response.data === 'object' && Object.keys(error.response.data).length !== 0) {
              const data = error.response.data;
              log.log(`Request to ${url} failed. ${error}. Reply data: ${JSON.stringify(data)}.`);
              if (notValidStatuses.includes(error.response.status)) {
                reject(data);
              } else {
                resolve(data);
              }
            } else {
              log.log(`Request to ${url} failed. ${error}.`);
              reject(error);
            }
          });

    } catch (err) {
      log.log(`Processing of request to ${url} failed. ${err.toString()}.`);
      reject(err.toString());
    }
  });
}

function protectedRequest(path, data) {
  const url = `${WEB_BASE}${path}`;

  return new Promise((resolve, reject) => {
    try {

      data = {
        ...data,
        request: `${WEB_BASE_PREFIX}${path}`,
        nonce: Date.now(),
      };

      const body = getBody(data);

      const headers = {
        ...DEFAULT_HEADERS,
        'X-TXC-APIKEY': config.apiKey,
        'X-TXC-PAYLOAD': getPayload(body),
        'X-TXC-SIGNATURE': getSignature(getPayload(body)),
      };

      const httpOptions = {
        url,
        method: 'post',
        timeout: 10000,
        data,
        headers,
      };

      axios(httpOptions)
          .then(function(response) {
            resolve(response.data);
          })
          .catch(function(error) {
            // We can get 4xx with data
            if (error.response && typeof error.response.data === 'object' && Object.keys(error.response.data).length !== 0) {
              const data = error.response.data;
              log.log(`Request to ${url} with data ${body} failed. ${error}. Reply data: ${JSON.stringify(data)}.`);
              if (notValidStatuses.includes(error.response.status)) {
                reject(data);
              } else {
                resolve(data);
              }
            } else {
              log.log(`Request to ${url} with data ${body} failed. ${error}.`);
              reject(error);
            }
          });

    } catch (err) {
      log.log(`Processing of request to ${url} with data ${body} failed. ${err.toString()}.`);
      reject(err.toString());
    }
  });
}

const getBody = (data) => {
  return JSON.stringify(data);
};

const getPayload = (body) => {
  return new Buffer.from(body).toString('base64');
};

const getSignature = (payload) => {
  return crypto.createHmac('sha512', config.secret_key).update(payload).digest('hex');
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
    return protectedRequest('/account/balances', data);
  },

  /**
   * Query account active orders
   * @param {String} pair required
   * @param {Number} limit min 1, default 50, max 100
   * @param {Number} offset min 0, default 0, max 10000
   * @return {Object}
   */
  getOrders: function(pair, offset = 0, limit = 100) {
    const data = {};
    if (pair) data.market = pair;
    if (offset) data.offset = offset;
    if (limit) data.limit = limit;

    return protectedRequest('/orders', data);
  },

  /**
   * Places a Limit order
   * @param {String} pair
   * @param {String} amount
   * @param {String} price
   * @param {String} side 'buy' or 'sell'
   */
  addOrder: function(pair, amount, price, side) {
    const data = {};
    data.market = pair;
    data.price = price;
    data.amount = amount;
    data.side = side;
    return protectedRequest('/order/new', data);
  },

  /**
   * Cancel an order
   * @param {String} orderId
   * @param {String} pair
   * @return {Object}
   */
  cancelOrder: function(orderId, pair) {
    const data = {};
    data.orderId = orderId;
    data.market = pair;
    return protectedRequest('/order/cancel', data);
  },

  /**
   * Get trade details for a ticker (market rates)
   * @param {String} pair
   * @return {Object}
   */
  ticker: function(pair) {
    const data = {};
    data.market = pair;
    return publicRequest('/public/ticker', data);
  },

  /**
   * Get market depth
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
   * Get info on all markets
   * @return string
   */
  markets: function() {
    const data = {};
    return publicRequest('/public/markets', data);
  },

};


module.exports = EXCHANGE_API;
