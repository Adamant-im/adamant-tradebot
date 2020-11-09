const request = require('request');
const DEFAULT_HEADERS = {
    "Accept": "application/json"
}

var WEB_BASE = ''; // API server like https://apigateway.coindeal.com
var config = {
    'apiKey': '',
    'secret_key': '',
    'tradePwd': ''
};

function sign_api(path, data, type = 'get') {
    var url = `${WEB_BASE}${path}`; 
    var pars = [];
    for (let key in data) {
        let v = data[key];
        pars.push(key + "=" + v);
    }
    var p = pars.join("&");
    if (p && type != 'post')
        url = url + "?" + p;
    let headersWithSign = Object.assign({"Authorization": setSign()}, DEFAULT_HEADERS);

    return new Promise((resolve, reject) => {
        try {
            var httpOptions = {
                url: url,
                method: type,
                timeout: 7000,
                headers: headersWithSign
            }
            if (type === 'post') {
                headersWithSign = Object.assign(headersWithSign, {"Content-Type": "multipart/form-data"});
                httpOptions = Object.assign(httpOptions, {"formData": data});
            }

            // console.log(httpOptions);
            request(httpOptions, function(err, res, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            }).on('error', function(err) {
                console.log(`Error while executing sign_api() request to ${url}: ${err}`);
                reject(null);
            });
        } catch(err) {
            console.log(`Exception while executing sign_api() request to ${url}: ${err}`);
            reject(null);
        }
    });
}

function public_api(url, data, type = 'get') {
    return new Promise((resolve, reject) => {
        try {
            var httpOptions = {
                url: url,
                method: type,
                timeout: 10000,
            }
            request(httpOptions, function(err, res, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            }).on('error', function(err) {
                console.log(`Error while executing public_api() request to ${url}: ${err}`);
                reject(null);
            });
        } catch(err) {
            console.log(`Exception while executing public_api() request to ${url}: ${err}`);
            reject(null);    
        }
    });
}

function setSign() {
    signString = 'Basic ';
    signString += Buffer.from(config.apiKey + ':' + config.secret_key).toString('base64');
    return signString;
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
     * (Get user balances)
     * ------------------------------------------------------------------
     */
    getUserAssets: function() {
        return sign_api("/api/v1/trading/balance");
    },
    /**
     * ------------------------------------------------------------------
     * (Get user open orders)
     * ------------------------------------------------------------------
     */
    getUserNowEntrustSheet: function(coinFrom, coinTo) {
        let data = {};
        data.symbol = coinFrom + coinTo;
        // no limit/size parameter according to docs
        // https://apigateway.coindeal.com/api/doc#operation/v1getOrder
        return sign_api("/api/v1/order", data);
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
        var data = {};
        data.symbol = symbol;
        data.price  = price;
        data.quantity = amount;
        data.side   = side;
        data.type   = 'limit';
        return sign_api("/api/v1/order", data, 'post');
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
        let data = {};
        // default limit/size is 100; 
        // no limit according to docs; 0 - full orderbook otherwise number of levels
        // https://apigateway.coindeal.com/api/doc#operation/v1getPublicOrderbookCurrencyPair
        if (size) 
            data.limit = size;
        else
            data.limit = 0;
        return sign_api(`/api/v1/public/orderbook/${symbol}`, data);
    },

    /**
     * ------------------------------------------------------------------
     * (Get the deposit address)
     * @param symbol    ADM
     * ------------------------------------------------------------------
     */
    getDepositAddress: function(symbol) {
        let data = {};
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
    }

    

}


module.exports = EXCHANGE_API;