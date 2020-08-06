var CryptoJS = require('crypto-js');
const request = require('request');
const DEFAULT_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36"
}

var WEB_BASE = '';
var config = {
    'apiKey': '',
    'secret_key': '',
    'tradePwd': ''
};

function market_api(path, data) {
    var url = `${WEB_BASE}${path}`; 
    var pars = [];
    for (let key in data) {
        let v = data[key];
        pars.push(key + "=" + v);
    }
    var p = pars.join("&");
    url = url + "?" + p;
    return new Promise((resolve, reject) => {
        try{
            var httpOptions = {
                url: url,
                method: 'get',
                timeout: 3000,
                headers: DEFAULT_HEADERS,
            }
            // log('-------------httpOptions-----------');
            // log(httpOptions);
            request.get(httpOptions, function(err, res, data) {
                if (err) {
                    reject(err);
                } else {
                    if (res.statusCode == 200) {
                        resolve(data);
                    } else {
                        reject(res.statusCode);
                    }
                }
            }).on('error', function(err){
                console.log('http get err:'+url);
                reject(null);
            });
        }catch(err){
            console.log('http get err:'+url);
            reject(null);    
        }
    });
}

function sign_api(path, data) {
    var url = `${WEB_BASE}${path}`; 
    data = setSign(data);
    return new Promise((resolve, reject) => {
        try{
            var httpOptions = {
                url: url,
                form: data,
                method: 'post',
                timeout: 3000,
                headers: DEFAULT_HEADERS,
            };
            // log('-------------httpOptions-----------');
            // log(httpOptions);
            request(httpOptions, function(err, res, data) {
                if (err) {
                    reject(err);
                } else {
                    if (res.statusCode == 200) {
                        resolve(data);
                    } else {
                        reject(res.statusCode);
                    }
                }
            }).on('error', function(err){
                console.log('http form_post err:'+err);
                reject(null);
            });
        }catch(err){
            console.log('http form_post err:'+err);
            reject(null);    
        }
    });
}

function setSign(params) {
    var pars = [];
    let keys = Object.keys(params);
    let n = keys.length;
    keys = keys.sort();
    let sign = '';
    for (let i = 0; i < n; i++) {
        if (sign != '') sign = sign + "&";
        sign = sign + keys[i] + "=" + params[keys[i]];
    }
    //
    sign = sign + config.secret_key;
    sign = CryptoJS.MD5(sign).toString().toLowerCase();
    params.sign = sign;
    return params;
}

function getSignBaseParams() {
    let timestamp = Math.round(new Date().getTime() / 1000) + "";
    return {
        "apiKey": config.apiKey,
        "timeStamp": timestamp,
        "nonce": timestamp.substr(-6)
    };
}

var EXCHANGE_API = {
    setConfig : function(apiServer,apiKey,secretKey,tradePwd){
        WEB_BASE = apiServer;
        config = {
            'apiKey': apiKey ,
            'secret_key': secretKey ,
            'tradePwd': tradePwd || '',
        };
    },

    /**
     * ------------------------------------------------------------------
     * 个人资产 (Get user open orders)
     * ------------------------------------------------------------------
     */
    getUserAssets: function() {
        var data = getSignBaseParams();
        return sign_api("/Assets/getUserAssets", data);
    },
    /**
     * ------------------------------------------------------------------
     * 获取个人当前委托单列表 (Get user open orders)
     * ------------------------------------------------------------------
     */
    getUserNowEntrustSheet: function(coinFrom,coinTo,type,page,pageSize,startTime,endTime) {
        var data = getSignBaseParams();
        if(coinFrom) data.coinFrom = coinFrom;
        if(coinTo) data.coinTo = coinTo;
        if(type) data.type = type;

        if(page) data.page = page;
        if(pageSize) data.pageSize = pageSize;
        if(startTime) data.startTime = startTime;
        if(endTime) data.endTime = endTime;

        data.pageSize = 100;

        return sign_api("/Trade/getUserNowEntrustSheet", data);
    },
    /**
     * ------------------------------------------------------------------
     * 获取个人历史委托单列表 (Get user history entrust)
     * ------------------------------------------------------------------
     */
    getUserHistoryEntrustSheet: function(coinFrom,coinTo,type,page,pageSize,startTime,endTime) {
        var data = getSignBaseParams();
        if(coinFrom) data.coinFrom = coinFrom;
        if(coinTo) data.coinTo = coinTo;
        if(type) data.type = type;

        if(page) data.page = page;
        if(pageSize) data.pageSize = pageSize;
        if(startTime) data.startTime = startTime;
        if(endTime) data.endTime = endTime;

        data.pageSize = 100;

        return sign_api("/Trade/getUserHistoryEntrustSheet", data);
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
        var data = getSignBaseParams();
        data.symbol = symbol;
        data.price  = price;
        data.number = amount;
        data.type   = type;
        data.tradePwd = config.tradePwd;//#
        return sign_api("/Trade/addEntrustSheet", data);
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
        var data = getSignBaseParams();
        data.symbol = symbol;
        data.total  = total;
        data.type   = type;
        data.tradePwd = config.tradePwd;//#
        return sign_api("/Trade/MarketTrade", data);
    },
        /**
     * ------------------------------------------------------------------
     * (Get a deposit address)
     * @param coin        string "coin name"
     * @param type          string, optional  accepted value: erc20,omni
     * ------------------------------------------------------------------
     */
    getDepositAddress: function(coin, type) {
        var data = getSignBaseParams();
        data.coin = coin;
        if(type) data.type   = type;
        return sign_api("/Trade/getCoinAddress", data);
    },
    /**
     * ------------------------------------------------------------------
     * 提交委托单详情 (Get the detail of an order)
     * @param entrustSheetId    string 
     * ------------------------------------------------------------------
     */
    getEntrustSheetInfo: function(entrustSheetId) {
        var data = getSignBaseParams();
        data.entrustSheetId = entrustSheetId;
        return sign_api("/Trade/getEntrustSheetInfo", data);
    },
    /**
     * ------------------------------------------------------------------
     * 撤销委托单 (Cancel the order)
     * @param entrustSheetId    string 
     * ------------------------------------------------------------------
     */
    cancelEntrustSheet: function(entrustSheetId) {
        var data = getSignBaseParams();
        data.entrustSheetId = entrustSheetId;
        return sign_api("/Trade/cancelEntrustSheet", data);
    },
    /**
     * ------------------------------------------------------------------
     * 批量撤销委托单 (cancel the all entrust)
     * @param ids    string     "id1,id2,id3"
     * ------------------------------------------------------------------
     */
    cancelAllEntrustSheet: function(ids) {
        var data = getSignBaseParams();
        data.ids = ids;
        return sign_api("/Trade/cancelAllEntrustSheet", data);
    },



    /**
     * ------------------------------------------------------------------
     * 获取牌价数据 (Get the price data)
     * @param symbol    eth_btc
     * ------------------------------------------------------------------
     */
    ticker: function(symbol) {
        var data = {};
        data.symbol = symbol;
        return market_api("/Market/ticker", data);
    },
    /**
     * ------------------------------------------------------------------
     * 获取所有牌价数据 (Get the price of all symbol)
     * ------------------------------------------------------------------
     */
    tickerall: function() {
        var data = {};
        return market_api("/Market/tickerall", data);
    },
    /**
     * ------------------------------------------------------------------
     * 获取最新交易记录 (Get the last orders)
     * @param symbol    eth_btc
     * ------------------------------------------------------------------
     */
    orders: function(symbol) {
        var data = {};
        data.symbol = symbol;
        return market_api("/Market/order", data);
    },
    /**
     * ------------------------------------------------------------------
     * 获取深度数据 (Get depth data)
     * @param symbol    eth_btc
     * ------------------------------------------------------------------
     */
    orderBook: function(symbol) {
        var data = {};
        data.symbol = symbol;
        return market_api("/Market/depth", data);
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
        var data = {};
        data['symbol'] = symbol;
        data['resolution'] = resolution;
        if(size) data['size'] = size;
        return market_api("/Market/kline", data);
    },
    /**
     * ------------------------------------------------------------------
     * 获取所有交易对的详细信息 (Get the detail of erery symbol)
     * ------------------------------------------------------------------
     */
    symbolList: function() {
        var data = {};
        return market_api("/Market/symbolList", data);
    }


}


module.exports = EXCHANGE_API;