const axios = require('axios');
const FormData = require('form-data');

const DEFAULT_HEADERS = {
  'Accept': 'application/json',
};

let WEB_BASE = ''; // API server like https://apigateway.coindeal.com
let config = {
  'apiKey': '',
  'secret_key': '',
  'tradePwd': '',
};
let log = {};

function protectedRequest(path, data, type = 'get') {
  let url = `${WEB_BASE}${path}`;
  const params = [];
  for (const key in data) {
    const v = data[key];
    params.push(key + '=' + v);
  }
  const paramsString = params.join('&');
  if (paramsString && type !== 'post') {
    url = url + '?' + paramsString;
  }
  let headersWithSign = Object.assign({ 'Authorization': setSign() }, DEFAULT_HEADERS);

  return new Promise((resolve, reject) => {
    try {

      let httpOptions;

      if (type === 'get' || type === 'delete') {

        httpOptions = {
          url: url,
          method: type,
          timeout: 10000,
          headers: headersWithSign,
        };

        axios(httpOptions)
            .then(function(response) {
              const data = response.data;
              resolve(data);
            })
            .catch(function(error) {
              // We can get 404 with data
              if (error.response && typeof error.response.data === 'object' && Object.keys(error.response.data).length !== 0) {
                log.log(`${type.toUpperCase()}-request to ${url} with data ${JSON.stringify(data)} failed. ${error}. Reply data: ${JSON.stringify(error.response.data)}.`);
                resolve(error.response.data);
              } else {
                log.log(`${type.toUpperCase()}-request to ${url} with data ${JSON.stringify(data)} failed. ${error}.`);
                reject(error);
              }
            });
      } else { // post
        const form = new FormData();
        Object.keys(data).forEach((key) => {
          form.append(key, data[key]);
        });

        headersWithSign = Object.assign(headersWithSign, form.getHeaders());
        httpOptions = {
          timeout: 10000,
          headers: headersWithSign,
        };

        axios.post(url, form, httpOptions)
            .then(function(response) {
              const data = response.data;
              resolve(data);
            })
            .catch(function(error) {
              // We can get 404 with data
              if (error.response && typeof error.response.data === 'object' && Object.keys(error.response.data).length !== 0) {
                log.log(`${type.toUpperCase()}-request to ${url} with data ${JSON.stringify(data)} failed. ${error}. Reply data: ${JSON.stringify(error.response.data)}.`);
                resolve(error.response.data);
              } else {
                log.log(`${type.toUpperCase()}-request to ${url} with data ${JSON.stringify(data)} failed. ${error}.`);
                reject(error);
              }
            });
      }
    } catch (err) {
      log.log(`Processing of ${type}-request to ${url} with data ${JSON.stringify(data)} failed. ${err}.`);
      reject(null);
    }
  });
}

function publicRequest(url, data, type = 'get') {
  return new Promise((resolve, reject) => {
    try {
      const httpOptions = {
        url: url,
        method: type,
        timeout: 10000,
      };
      axios(httpOptions)
          .then(function(response) {
            const data = response.data;
            resolve(data);
          })
          .catch(function(error) {
            // We can get 404 with data
            if (error.response && typeof error.response.data === 'object' && Object.keys(error.response.data).length !== 0) {
              log.log(`${type.toUpperCase()}-request to ${url} failed. ${error}. Reply data: ${JSON.stringify(error.response.data)}.`);
              resolve(error.response.data);
            } else {
              log.log(`${type.toUpperCase()}-request to ${url} failed. ${error}.`);
              reject(error);
            }
          });

    } catch (err) {
      log.log(`Processing of ${type}-request to ${url} failed. ${err}.`);
      reject(null);
    }
  });
}

function setSign() {
  signString = 'Basic ';
  signString += Buffer.from(config.apiKey + ':' + config.secret_key).toString('base64');
  return signString;
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
     * ------------------------------------------------------------------
     * (Get user balances)
     * ------------------------------------------------------------------
     */
  getUserAssets: function() {
    return protectedRequest('/api/v1/trading/balance');
  },
  /**
     * ------------------------------------------------------------------
     * (Get user open orders)
     * ------------------------------------------------------------------
     */
  getUserNowEntrustSheet: function(coinFrom, coinTo) {
    const data = {};
    data.symbol = coinFrom + coinTo;
    // no limit/size parameter according to docs
    // https://apigateway.coindeal.com/api/doc#operation/v1getOrder
    return protectedRequest('/api/v1/order', data);
  },
  /**
     * ------------------------------------------------------------------
     * (Place a Limit order)
     * @param symbol        string "ADMBTC"
     * @param amount        float
     * @param price         float
     * @param side          string  buy, sell
     * ------------------------------------------------------------------
     */
  addEntrustSheet: function(symbol, amount, price, side) {
    const data = {};
    data.symbol = symbol;
    data.price = price;
    data.quantity = amount;
    data.side = side;
    data.type = 'limit';
    return protectedRequest('/api/v1/order', data, 'post');
  },
  /**
     * ------------------------------------------------------------------
     * (Cancel the order)
     * @param entrustSheetId    string
     * ------------------------------------------------------------------
     */
  cancelEntrustSheet: function(entrustSheetId) {
    const data = {};
    return protectedRequest(`/api/v1/order/${entrustSheetId}`, data, 'delete');
  },

  /**
     * ------------------------------------------------------------------
     * (Get the price data)
     * @param symbol    ADMBTC
     * ------------------------------------------------------------------
     */
  orderBook: function(symbol, size) {
    const data = {};
    // default limit/size is 100;
    // no limit according to docs; 0 - full orderbook otherwise number of levels
    // https://apigateway.coindeal.com/api/doc#operation/v1getPublicOrderbookCurrencyPair
    if (size) {
      data.limit = size;
    } else {
      data.limit = 0;
    }
    return publicRequest(`${WEB_BASE}/api/v1/public/orderbook/${symbol}`, data);
  },

  /**
     * ------------------------------------------------------------------
     * (Get the deposit address)
     * @param symbol    ADM
     * ------------------------------------------------------------------
     */
  getDepositAddress: function(symbol) {
    const data = {};
    return protectedRequest(`/api/v1/deposits/${symbol}/addresses`, data);
  },

  /**
     * ------------------------------------------------------------------
     * (Get stats)
     * @param symbol    eth_btc
     * ------------------------------------------------------------------
     */
  stats: function(symbol) {
    return publicRequest(`https://coinmarketcap.coindeal.com/api/v1/ticker`);
  },


};


module.exports = EXCHANGE_API;
