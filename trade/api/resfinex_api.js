const crypto = require('crypto');
const axios = require('axios');

module.exports = function() {
  let WEB_BASE = 'https://api.resfinex.com'; // Default, may be changed on init
  let config = {
    'apiKey': '',
    'secret_key': '',
    'tradePwd': '',
  };
  let log = {};

  function sign_api(path, data, type = 'get') {

    const nonce = Date.now();
    let url = `${WEB_BASE}${path}`;
    const pars = [];
    for (const key in data) {
      const v = data[key];
      pars.push(key + '=' + v);
    }
    const queryString = pars.join('&');
    if (queryString && type !== 'post') {
      url = url + '?' + queryString;
    }

    const bodyString = JSON.stringify(data);
    const signPayload = type === 'get' ? queryString : bodyString;
    const sign = setSign(config.secret_key, `${signPayload}_${nonce}_${path}`);

    return new Promise((resolve, reject) => {
      try {

        const httpOptions = {
          url: url,
          method: type,
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'Token': config.apiKey,
            'Nonce': nonce + '',
            'Signature': sign,
            'Type': 'api',
          },
          data: type === 'get' ? undefined : bodyString,
        };

        axios(httpOptions)
            .then(function(response) {
              try {
                const data = response.data;
                if (data) {
                  if (data.status === 'error' && data.code === 429) { // 'API Call limit rate, please try again later
                    log.log(`Request to ${url} with data ${bodyString} failed. Got error message: ${data.msg}.`);
                    reject(`Got error message: ${data.msg}`);
                  } else {
                    resolve(data);
                  }
                } else {
                  log.log(`Request to ${url} with data ${bodyString} failed. Unable to parse data: ${JSON.stringify(data)}.`);
                  reject(`Unable to parse data: ${JSON.stringify(data)}`);
                }
              } catch (e) {
                if (e instanceof SyntaxError) {
                  log.log(`Request to ${url} with data ${bodyString} failed. Unable to parse data: ${JSON.stringify(data)}. Exception: ${e}`);
                  reject(`Unable to parse data: ${JSON.stringify(data)}`);
                } else {
                  log.warn(`Error while processing response of request to ${url} with data ${bodyString}: ${e}. Data object I've got: ${JSON.stringify(data)}.`);
                  reject(`Unable to process data: ${JSON.stringify(data)}`);
                }
              }
            })
            .catch(function(error) {
              // 'Order not found' goes here as it returns 404
              if (error.response && typeof error.response.data === 'object' && Object.keys(error.response.data).length !== 0) {
                resolve(error.response.data);
              } else {
                log.log(`Request to ${url} with data ${pars} failed. ${error}: ${JSON.stringify(error?.response?.data)}`);
                reject(error);
              }
            }); // axios

      } catch (err) {
        log.log(`Processing of request to ${url} with data ${bodyString} failed. ${err}.`);
        reject(null);
      }
    });
  }

  function public_api(path, data, type = 'get') {

    let url = `${WEB_BASE}${path}`;
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
      try {
        const httpOptions = {
          url: url,
          method: type,
          timeout: 10000,
        };

        axios(httpOptions)
            .then(function(response) {
              try {
                const data = response.data;
                if (data) {
                  if (data.status === 'error' && data.code === 429) { // 'API Call limit rate, please try again later
                    log.log(`Request to ${url} with data ${queryString} failed. Got error message: ${data.msg}.`);
                    reject(`Got error message: ${data.msg}`);
                  } else {
                    resolve(data);
                  }
                } else {
                  log.log(`Request to ${url} with data ${queryString} failed. Unable to parse data: ${JSON.stringify(data)}.`);
                  reject(`Unable to parse data: ${data}`);
                }
              } catch (e) {
                if (e instanceof SyntaxError) {
                  log.log(`Request to ${url} with data ${queryString} failed. Unable to parse data: ${JSON.stringify(data)}. Exception: ${e}`);
                  reject(`Unable to parse data: ${JSON.stringify(data)}`);
                } else {
                  log.warn(`Error while processing response of request to ${url} with data ${queryString}: ${e}. Data object I've got: ${JSON.stringify(data)}.`);
                  reject(`Unable to process data: ${JSON.stringify(data)}`);
                }
              };
            })
            .catch(function(error) {
              // We can get 404 with data
              if (error.response && typeof error.response.data === 'object' && Object.keys(error.response.data).length !== 0) {
                resolve(error.response.data);
              } else {
                log.log(`Request to ${url} with data ${queryString} failed. ${error}: ${JSON.stringify(error?.response?.data)}`);
                reject(error);
              }
            }); // axios

      } catch (err) {
        log.log(`Request to ${url} with data ${queryString} failed. ${err}.`);
        reject(null);
      }
    });
  }

  function setSign(secret, str) {
    const sign = crypto
        .createHmac('sha256', secret)
        .update(`${str}`)
        .digest('hex');
    return sign;
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
          'tradePwd': tradePwd || '',
        };
      }

    },

    /**
     * List of user balances for all currencies
     * @return {Object}
     */
    getUserAssets: function() {
      return sign_api('/account/balances', {}, 'post');
    },

    /**
     * Query account active orders
     * @param {String} coinFrom
     * @param {String} coinFrom
     * @return {Object}
     */
    getUserNowEntrustSheet: function(coinFrom, coinTo) {
      const data = {};
      data.pair = coinFrom + '_' + coinTo;
      // size/limit not documented, but 'limit' works; max is 200
      // https://docs.resfinex.com/guide/rest-auth-endpoints.html#post-get-open-orders
      // data.offset = 150; // doesn't work
      // there must be a hint combining buy+sell types separately [data.side: BUY or SELL]
      data.limit = 200;
      return sign_api('/order/open_orders', data, 'post');
    },

    /**
     * Places a Limit order
     * @param {String} pair
     * @param {String} amount
     * @param {String} price
     * @param {String} side
     * @param {String} type
     */
    addEntrustSheet: function(pair, amount, price, side, type) {
      const data = {};
      data.pair = pair;
      if (price) {
        data.price = price;
      }
      data.amount = amount;
      data.side = side;
      data.type = type;
      return sign_api('/order/place_order', data, 'post');
    },

    /**
     * Cancel an order
     * @param {String} orderId
     * @return {Object}
     */
    cancelEntrustSheet: function(orderId) {
      const data = {};
      data.orderId = orderId;
      return sign_api(`/order/cancel_order`, data, 'post');
    },

    /**
     * Get trade details for a ticker (market rates)
     * @return {Object}
     */
    ticker: function() {
      return public_api(`/engine/ticker`);
    },

    /**
     * Get market depth
     * https://docs.resfinex.com/guide/rest-public-endpoints.html#get-orderbook
     * @param pair
     * @param {Number} limit min 1, default 50, max 100
     * @return {Object}
     */
    orderBook: function(pair, limit) {
      const data = {};
      data.pair = pair;
      if (limit) {
        data.size = limit;
      } else {
        data.size = 1000; // Default limit/size is 500; no limit according to docs
      }
      return public_api(`/engine/depth`, data);
    },

    /**
     * Get trades history
     * @param pair Trading pair, like BTC_USDT
     * @return {Array of Object} Last 100 trades
     */
    getTradesHistory: function(pair) {
      const data = {};
      data.pair = pair;
      // Resfinex doesn't provide 'size' ot 'limit' params; I've tried them
      // Resfinex always returns 100 last trades
      return public_api(`/engine/history`, data);
    },

    /**
     * Get info on all markets
     * @return string
     */
    markets: function() {
      const data = {};
      return public_api('/config', data);
    },


  };

  return EXCHANGE_API;
};
