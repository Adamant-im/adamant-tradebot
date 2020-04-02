const crypto = require("crypto")
const request = require('request');

let WEB_BASE = "https://api.resfinex.com"; // API server like https://api.resfinex.com/
var config = {
    'apiKey': '',
    'secret_key': '',
    'tradePwd': ''
};

function sign_api(path, data, type = 'get') {

    const nonce = Date.now()
    var url = `${WEB_BASE}${path}`; 
    var pars = [];
    for (let key in data) {
        let v = data[key];
        pars.push(key + "=" + v);
    }
    var queryString = pars.join("&");
    if (queryString && type != 'post') {
        url = url + "?" + queryString;
    }
    
    const bodyString = JSON.stringify(data);
    const signPayload = type === "get" ? queryString : bodyString;
    const sign = setSign(config.secret_key, `${signPayload}_${nonce}_${path}`);
    // console.log('sign string: ', `${signPayload}_${nonce}_${path}`);

    return new Promise((resolve, reject) => {
        try {

            var httpOptions = {
                url: url,
                method: type,
                timeout: 5000,
                headers: {
                    'Content-Type': "application/json",
                    'Token': config.apiKey,
                    'Nonce': nonce + '',
                    'Signature': sign,
                    "Type": "api"
                },
                body: type === "get" ? undefined : bodyString
            }

            // console.log(httpOptions);
            request(httpOptions, function(err, res, data) {
                // console.log(data);
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            }).on('error', function(err) {
                console.log('Request err: ' + url);
                reject(null);
            });
        } catch(err) {
            console.log('Promise error: ' + url);
            reject(null);    
        }
    });
}

function public_api(path, data, type = 'get') {

    var url = `${WEB_BASE}${path}`; 
    var pars = [];
    for (let key in data) {
        let v = data[key];
        pars.push(key + "=" + v);
    }
    var queryString = pars.join("&");
    if (queryString && type != 'post') {
        url = url + "?" + queryString;
    }

    return new Promise((resolve, reject) => {
        try {
            var httpOptions = {
                url: url,
                method: type,
                timeout: 10000,
            }
            // console.log(httpOptions);

            request(httpOptions, function(err, res, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
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

function setSign(secret, str) {
	const sign = crypto
    .createHmac('sha256', secret)
    .update(`${str}`)
    .digest("hex");
	return sign;	
}

var EXCHANGE_API = {
    setConfig : function(apiServer,apiKey,secretKey,tradePwd) {
        WEB_BASE = apiServer;
        config = {
            'apiKey': apiKey,
            'secret_key': secretKey,
            'tradePwd': tradePwd || '',
        };
    },

    /**
     * ------------------------------------------------------------------
     * (Get user balances)
     * ------------------------------------------------------------------
     */
    getUserAssets: function() {
        return sign_api("/account/balances", {}, 'post');
    },
    /**
     * ------------------------------------------------------------------
     * (Get user open orders)
     * ------------------------------------------------------------------
     */
    getUserNowEntrustSheet: function(coinFrom, coinTo) {
        let data = {};
        data.pair = coinFrom + "_" + coinTo;
        return sign_api("/order/open_orders", data, 'post');
    },
    /**
     * ------------------------------------------------------------------
     * (Place an order)
     * @param symbol        string "ADM_USDT"
     * @param amount        float
     * @param price         float
     * @param side          string  BUY, SELL
     * @param type          string  MARKET, LIMIT
     * ------------------------------------------------------------------
     */
    addEntrustSheet: function(symbol, amount, price, side, type) {
        var data = {};
        data.pair = symbol;
        if (price)
            data.price  = price;
        data.amount = amount;
        data.side   = side;
        data.type   = type;
        return sign_api("/order/place_order", data, 'post');
    },
    /**
     * ------------------------------------------------------------------
     * (Cancel the order)
     * @param entrustSheetId    string 
     * ------------------------------------------------------------------
     */
    cancelEntrustSheet: function(entrustSheetId) {
        let data = {};
        data.orderId = entrustSheetId;
        return sign_api(`/order/cancel_order`, data, 'post');
    },

    /**
     * ------------------------------------------------------------------
     * (Get the price data)
     * @param symbol    ADM_BTC
     * ------------------------------------------------------------------
     */
    ticker: function(symbol) {
        return public_api(`/engine/ticker`);
    },
    /**
     * ------------------------------------------------------------------
     * (Get stats)
     * @param symbol    eth_btc
     * ------------------------------------------------------------------
     */
    orderBook: function(symbol, size = 1) {
        let data = {};
        data.pair = symbol;
        data.size = size;
        return public_api(`/engine/depth`, data);
    }

}

module.exports = EXCHANGE_API;