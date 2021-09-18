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

const wrongAccountErrors = [ // https://github.com/P2pb2b-team/p2pb2b-api-docs/blob/master/errors.md
  -105, // Invalid api signature
  -109, // Invalid secretKey
  -111, // Current IP is not in the range of trusted IP
  -117, // The apikey expires
  -100015, // Trade password error
  -200003, // Please set trade password
  -200005, // This account can not trade
  -200032, // Please contact customer service
  -300069, // api_key is illegal
  -300103, // Trade password error
  -300046, // Please bind your email first
  -300007, // Please turn on SMS verification or Google verification
  -200003, // Please set the transaction password first
  -100015, // Incorrect transaction password
];

function publicRequest(path, data) {
  let url = `${WEB_BASE}${path}`;
  const pars = [];
  for (const key in data) {
    const v = data[key];
    pars.push(key + '=' + v);
  }
  const p = pars.join('&');
  url = url + '?' + p;
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
            try {
              const data = response.data;
              if (data.status === 200) {
                resolve(data);
              } else {
                resolve(data); // f. e., it may return -103, if no order found
              }
            } catch (e) {
              log.warn(`Error while processing response of request to ${url}: ${e}. Data object I've got: ${data}.`);
              reject(`Unable to process data: ${data}`);
            }
          })
          .catch(function(error) {
            log.log(`Request to ${url} with data ${pars} failed. ${error}.`);
            reject(error);
          }); // axios

    } catch (err) {
      log.log(`Processing of request to ${url} with data ${pars} failed. ${err}.`);
      reject(null);
    }
  });
}

function protectedRequest(path, data) {
  const url = `${WEB_BASE}${path}`;

  return new Promise((resolve, reject) => {
    try {

      data = {
        request: `${WEB_BASE_PREFIX}${path}`,
        nonce: Date.now(),
      };

      const headers = {
        'Content-Type': 'application/json',
        'X-TXC-APIKEY': config.apiKey,
        'X-TXC-PAYLOAD': getPayload(getBody(data)),
        'X-TXC-SIGNATURE': getSignature(getPayload(getBody(data))),
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
            try {
              // console.log('response', response);
              const data = response.data;
              if (data.status === 200) {
                resolve(data);
              } else if (wrongAccountErrors.includes(data.status)) {
                reject(`Bit-Z declined a request to ${url} because of wrong account data. Make sure API keys are correct, not expired, bot's IP set as trusted, trade password is set. Reply data: ${data}.`);
              } else {
                resolve(data); // f. e., it may return -103, if no order found
              }
            } catch (e) {
              log.warn(`Error while processing response of request to ${url}: ${e}. Data object I've got: ${data}.`);
              reject(`Unable to process data: ${data}`);
            }
          })
          .catch(function(error) {
            // console.log('error', error);
            log.log(`Request to ${url} with data ${data} failed. ${error}.`);
            reject(error);
          }); // axios

    } catch (err) {
      log.log(`Processing of request to ${url} with data ${JSON.stringify(data)} failed. ${err}.`);
      reject(null);
    }
  });
}

const buildData = (data) => {
  return {
    ...data,
    request: endpoint,
    nonce: parseInt(Date.now() / 1000).toString(),
  };
};

const getBody = (data) => {
  return JSON.stringify(data);
};

const getPayload = (body) => {
  return new Buffer.from(body).toString('base64');
};

const getSignature = (payload) => {
  return crypto.createHmac('sha512', config.secret_key).update(payload).digest('hex');
};

function getSignBaseParams() {
  // const timestamp = Math.round(new Date().getTime() / 1000) + '';
  return {
    // 'apiKey': config.apiKey,
    // 'timeStamp': timestamp,
    // 'nonce': timestamp.substr(-6),
  };
}

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
     * ------------------------------------------------------------------
     * @return {Object} List of user balances for all currencies
     * ------------------------------------------------------------------
     */
  getBalances: function() {
    const data = getSignBaseParams();
    return protectedRequest('/account/balances', data);
  },
  /**
     * ------------------------------------------------------------------
     * 获取个人当前委托单列表 (Get user open orders)
     * ------------------------------------------------------------------
     */
  getUserNowEntrustSheet: function(coinFrom, coinTo, type, page, pageSize, startTime, endTime) {
    const data = getSignBaseParams();
    if (coinFrom) data.coinFrom = coinFrom;
    if (coinTo) data.coinTo = coinTo;
    if (type) data.type = type;

    if (startTime) data.startTime = startTime;
    if (endTime) data.endTime = endTime;

    // limit/site parameter is pageSize; Number of records per page Maximum 100
    // https://apidoc.bit-z.com/market-trade-data/Get-now-trust.html
    if (page) data.page = page;
    if (pageSize) {
      data.pageSize = pageSize;
    } else {
      data.pageSize = 100;
    }

    return protectedRequest('/Trade/getUserNowEntrustSheet', data);
  },
  /**
     * ------------------------------------------------------------------
     * 获取个人历史委托单列表 (Get user history entrust)
     * ------------------------------------------------------------------
     */
  getUserHistoryEntrustSheet: function(coinFrom, coinTo, type, page, pageSize, startTime, endTime) {
    const data = getSignBaseParams();
    if (coinFrom) data.coinFrom = coinFrom;
    if (coinTo) data.coinTo = coinTo;
    if (type) data.type = type;

    if (page) data.page = page;
    if (pageSize) data.pageSize = pageSize;
    if (startTime) data.startTime = startTime;
    if (endTime) data.endTime = endTime;

    data.pageSize = 100;

    return protectedRequest('/Trade/getUserHistoryEntrustSheet', data);
  },
  /**
     * ------------------------------------------------------------------
     * 提交委托单 (Place a Limit order)
     * @param symbol        string "eth_btc"
     * @param amount        float
     * @param price         float
     * @param type          string  "1":"buy"   "2":"sale"
     * ------------------------------------------------------------------
     */
  addEntrustSheet: function(symbol, amount, price, type) {
    const data = getSignBaseParams();
    data.symbol = symbol;
    data.price = price;
    data.number = amount;
    data.type = type;
    data.tradePwd = config.tradePwd;// #
    return protectedRequest('/Trade/addEntrustSheet', data);
  },
  /**
     * ------------------------------------------------------------------
     * (Place a Market order)
     * @param symbol        string "eth_btc"
     * @param total        float, Incoming amount at the time of purchase, incoming quantity at the time of sale
     * @param type          int  "1":"buy"   "2":"sale"
     * ------------------------------------------------------------------
     */
  addMarketOrder: function(symbol, total, type) {
    const data = getSignBaseParams();
    data.symbol = symbol;
    data.total = total;
    data.type = type;
    data.tradePwd = config.tradePwd;// #
    return protectedRequest('/Trade/MarketTrade', data);
  },
  /**
     * ------------------------------------------------------------------
     * (Get a deposit address)
     * @param coin        string "coin name"
     * @param type          string, optional  accepted value: erc20,omni
     * ------------------------------------------------------------------
     */
  getDepositAddress: function(coin, type) {
    const data = getSignBaseParams();
    data.coin = coin.toLowerCase();
    if (type) data.type = type;
    return protectedRequest('/Trade/getCoinAddress', data);
  },
  /**
     * ------------------------------------------------------------------
     * 提交委托单详情 (Get the detail of an order)
     * @param entrustSheetId    string
     * ------------------------------------------------------------------
     */
  getEntrustSheetInfo: function(entrustSheetId) {
    const data = getSignBaseParams();
    data.entrustSheetId = entrustSheetId;
    return protectedRequest('/Trade/getEntrustSheetInfo', data);
  },
  /**
     * ------------------------------------------------------------------
     * 撤销委托单 (Cancel the order)
     * @param entrustSheetId    string
     * ------------------------------------------------------------------
     */
  cancelEntrustSheet: function(entrustSheetId) {
    const data = getSignBaseParams();
    data.entrustSheetId = entrustSheetId;
    return protectedRequest('/Trade/cancelEntrustSheet', data);
  },
  /**
     * ------------------------------------------------------------------
     * 批量撤销委托单 (cancel the all entrust)
     * @param ids    string     "id1,id2,id3"
     * ------------------------------------------------------------------
     */
  cancelAllEntrustSheet: function(ids) {
    const data = getSignBaseParams();
    data.ids = ids;
    return protectedRequest('/Trade/cancelAllEntrustSheet', data);
  },


  /**
     * ------------------------------------------------------------------
     * 获取牌价数据 (Get the price data)
     * @param symbol    eth_btc
     * ------------------------------------------------------------------
     */
  ticker: function(symbol) {
    const data = {};
    data.symbol = symbol;
    return publicRequest('/Market/ticker', data);
  },
  /**
     * ------------------------------------------------------------------
     * 获取所有牌价数据 (Get the price of all symbol)
     * ------------------------------------------------------------------
     */
  tickerall: function() {
    const data = {};
    return publicRequest('/Market/tickerall', data);
  },
  /**
     * ------------------------------------------------------------------
     * 获取最新交易记录 (Get the last orders)
     * @param symbol    eth_btc
     * ------------------------------------------------------------------
     */
  orders: function(symbol) {
    const data = {};
    data.symbol = symbol;
    return publicRequest('/Market/order', data);
  },
  /**
     * ------------------------------------------------------------------
     * 获取深度数据 (Get depth data)
     * @param symbol    eth_btc
     * ------------------------------------------------------------------
     */
  orderBook: function(symbol) {
    const data = {};
    data.symbol = symbol;
    return publicRequest('/Market/depth', data);
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
