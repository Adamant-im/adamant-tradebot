const request = require('request');
// const log = require('../helpers/log');
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

function sign_api(path, data, type = 'get') {
  let url = `${WEB_BASE}${path}`;
  const pars = [];
  for (const key in data) {
    const v = data[key];
    pars.push(key + '=' + v);
  }
  const p = pars.join('&');
  if (p && type != 'post') {
    url = url + '?' + p;
  }
  let headersWithSign = Object.assign({ 'Authorization': setSign() }, DEFAULT_HEADERS);

  return new Promise((resolve, reject) => {
    try {
      let httpOptions = {
        url: url,
        method: type,
        timeout: 10000,
        headers: headersWithSign,
      };
      if (type === 'post') {
        headersWithSign = Object.assign(headersWithSign, { 'Content-Type': 'multipart/form-data' });
        httpOptions = Object.assign(httpOptions, { 'formData': data });
      }

      // console.log(httpOptions);
      request(httpOptions, function(err, res, data) {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      }).on('error', function(err) {
        log.log(`Request to ${url} with data ${JSON.stringify(data)} failed. ${err}.`);
        reject(null);
      });
    } catch (err) {
      log.log(`Processing of request to ${url} with data ${JSON.stringify(data)} failed. ${err}.`);
      reject(null);
    }
  });
}

function public_api(url, data, type = 'get') {
  return new Promise((resolve, reject) => {
    try {
      const httpOptions = {
        url: url,
        method: type,
        timeout: 10000,
      };
      request(httpOptions, function(err, res, data) {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      }).on('error', function(err) {
        log.log(`Request to ${url} failed. ${err}.`);
        reject(null);
      });
    } catch (err) {
      log.log(`Processing of request to ${url} failed. ${err}.`);
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
    return sign_api('/api/v1/trading/balance');
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
    return sign_api('/api/v1/order', data);
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
    return sign_api('/api/v1/order', data, 'post');
  },
  /**
     * ------------------------------------------------------------------
     * (Place a Market order)
     * @param symbol        string "ADMBTC"
     * @param total        float, Incoming amount at the time of purchase, incoming quantity at the time of sale
     * @param type          int  "1":"buy"   "2":"sale"
     * ------------------------------------------------------------------
     */
  // addMarketOrder: function(symbol, total, type) {
  //     var data = getSignBaseParams();
  //     data.symbol = symbol;
  //     data.total  = total;
  //     data.type   = type;
  //     data.tradePwd = config.tradePwd;//#
  //     return sign_api("/Trade/MarketTrade", data);
  // },
  /**
     * ------------------------------------------------------------------
     * (Cancel the order)
     * @param entrustSheetId    string
     * ------------------------------------------------------------------
     */
  cancelEntrustSheet: function(entrustSheetId) {
    return sign_api(`/api/v1/order/${entrustSheetId}`, null, 'delete');
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
    return public_api(`${WEB_BASE}/api/v1/public/orderbook/${symbol}`, data);
  },

  /**
     * ------------------------------------------------------------------
     * (Get the deposit address)
     * @param symbol    ADM
     * ------------------------------------------------------------------
     */
  getDepositAddress: function(symbol) {
    const data = {};
    return sign_api(`/api/v1/deposits/${symbol}/addresses`, data);
  },

  /**
     * ------------------------------------------------------------------
     * (Get stats)
     * @param symbol    eth_btc
     * ------------------------------------------------------------------
     */
  stats: function(symbol) {
    return public_api(`https://coinmarketcap.coindeal.com/api/v1/ticker`);
  },


};


module.exports = EXCHANGE_API;
