const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');

const DEFAULT_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36',
};

let WEB_BASE = '';
let config = {
  'apiKey': '',
  'secret_key': '',
  'tradePwd': '',
};
let log = {};

// https://apidocv2.bitz.ai/en/

const wrongAccountErrors = [ // https://apidoc.bit-z.com/en/Error-code/Error-code-comparison-table.html
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

function market_api(path, data) {
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

function sign_api(path, data) {
  const url = `${WEB_BASE}${path}`;
  data = setSign(data);
  return new Promise((resolve, reject) => {
    try {

      const form = new FormData();
      Object.keys(data).forEach((key) => {
        form.append(key, data[key]);
      });

      const httpOptions = {
        timeout: 10000,
        // headers: DEFAULT_HEADERS,
        headers: form.getHeaders(),
      };

      axios.post(url, form, httpOptions)
          .then(function(response) {
            try {
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
            log.log(`Request to ${url} with data ${data} failed. ${error}.`);
            reject(error);
          }); // axios

    } catch (err) {
      log.log(`Processing of request to ${url} with data ${JSON.stringify(data)} failed. ${err}.`);
      reject(null);
    }
  });
}

function setSign(params) {
  let keys = Object.keys(params);
  const n = keys.length;
  keys = keys.sort();
  let sign = '';
  for (let i = 0; i < n; i++) {
    if (sign !== '') sign = sign + '&';
    sign = sign + keys[i] + '=' + params[keys[i]];
  }
  sign = sign + config.secret_key;
  sign = crypto.createHash('md5').update(sign).digest('hex').toLowerCase();
  params.sign = sign;
  return params;
}

function getSignBaseParams() {
  const timestamp = Math.round(new Date().getTime() / 1000) + '';
  return {
    'apiKey': config.apiKey,
    'timeStamp': timestamp,
    'nonce': timestamp.substr(-6),
  };
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
     * 个人资产 (Get user open orders)
     * ------------------------------------------------------------------
     */
  getUserAssets: function() {
    const data = getSignBaseParams();
    return sign_api('/Assets/getUserAssets', data);
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

    return sign_api('/Trade/getUserNowEntrustSheet', data);
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

    return sign_api('/Trade/getUserHistoryEntrustSheet', data);
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
    return sign_api('/Trade/addEntrustSheet', data);
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
    return sign_api('/Trade/MarketTrade', data);
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
    return sign_api('/Trade/getCoinAddress', data);
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
    return sign_api('/Trade/getEntrustSheetInfo', data);
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
    return sign_api('/Trade/cancelEntrustSheet', data);
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
    return sign_api('/Trade/cancelAllEntrustSheet', data);
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
    return market_api('/Market/ticker', data);
  },
  /**
     * ------------------------------------------------------------------
     * 获取所有牌价数据 (Get the price of all symbol)
     * ------------------------------------------------------------------
     */
  tickerall: function() {
    const data = {};
    return market_api('/Market/tickerall', data);
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
    return market_api('/Market/order', data);
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
    // no limit/size parameter according to docs
    // https://apidoc.bit-z.com/market-quotation-data/Get-depth-data.html
    return market_api('/Market/depth', data);
  },
  /**
     * ------------------------------------------------------------------
     * 获取深度数据 (Get depth data)
     * @param symbol        string eth_btc
     * @param resolution    string [1min 、5min 、15min 、30min 、60min、 4hour 、 1day 、5day 、1week、 1mon]
     * @param size          number 1 ~ 300 (can empty)
     * ------------------------------------------------------------------
     */
  kline: function(symbol, resolution, size) {
    const data = {};
    data['symbol'] = symbol;
    data['resolution'] = resolution;
    if (size) data['size'] = size;
    return market_api('/Market/kline', data);
  },
  /**
     * ------------------------------------------------------------------
     * 获取所有交易对的详细信息 (Get the details of all symbols)
     * ------------------------------------------------------------------
     */
  symbolList: function() {
    const data = {};
    return market_api('/Market/symbolList', data);
  },


};


module.exports = EXCHANGE_API;
