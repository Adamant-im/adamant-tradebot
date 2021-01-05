const crypto = require("crypto")
const request = require('request');
// const log = require('../helpers/log');

let WEB_BASE = "https://api.resfinex.com"; // API server like https://api.resfinex.com/
var config = {
    'apiKey': '',
    'secret_key': '',
    'tradePwd': ''
};
var log = {};

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
                timeout: 10000,
                headers: {
                    'Content-Type': "application/json",
                    'Token': config.apiKey,
                    'Nonce': nonce + '',
                    'Signature': sign,
                    "Type": "api"
                },
                body: type === "get" ? undefined : bodyString
            }

            request(httpOptions, function(err, res, data) {
                if (err) {
                    reject(err);
                } else {

                    try {

                        let response = JSON.parse(data);
                        if (response) {
                            if (response.status === 'error' && response.code === 429) { // 'API Call limit rate, please try again later
                                // console.log(response);
                                log.log(`Request to ${url} with data ${bodyString} failed. Got error message: ${response.msg}.`);
                                reject(`Got error message: ${response.msg}`);
                            } else {
                                resolve(data);
                            }
                        } else {
                            log.log(`Request to ${url} with data ${bodyString} failed. Unable to parse data: ${data}.`);
                            reject(`Unable to parse data: ${data}`);
                        }

                    } catch (e) {
                        if (e instanceof SyntaxError) {
                            log.log(`Request to ${url} with data ${bodyString} failed. Unable to parse data: ${data}. Exception: ${e}`);
                            reject(`Unable to parse data: ${data}`);
                        } else {
                            log.warn(`Error while processing response of request to ${url} with data ${bodyString}: ${e}. Data object I've got: ${data}.`);
                            reject(`Unable to process data: ${data}`);
                        }
                    };
                    
                }
            }).on('error', function(err) {
                log.log(`Request to ${url} with data ${bodyString} failed. ${err}.`);
                reject(null);
            });

        } catch(err) {
            log.log(`Processing of request to ${url} with data ${bodyString} failed. ${err}.`);
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

                    try {

                        let response = JSON.parse(data);
                        if (response) {
                            if (response.status === 'error' && response.code === 429) { // 'API Call limit rate, please try again later
                                // console.log(response);
                                log.log(`Request to ${url} with data ${queryString} failed. Got error message: ${response.msg}.`);
                                reject(`Got error message: ${response.msg}`);
                            } else {
                                resolve(data);
                            }
                        } else {
                            log.log(`Request to ${url} with data ${queryString} failed. Unable to parse data: ${data}.`);
                            reject(`Unable to parse data: ${data}`);
                        }

                    } catch (e) {
                        if (e instanceof SyntaxError) {
                            log.log(`Request to ${url} with data ${queryString} failed. Unable to parse data: ${data}. Exception: ${e}`);
                            reject(`Unable to parse data: ${data}`);
                        } else {
                            log.warn(`Error while processing response of request to ${url} with data ${queryString}: ${e}. Data object I've got: ${data}.`);
                            reject(`Unable to process data: ${data}`);
                        }
                    };

                }
            }).on('error', function(err) {
                log.log(`Request to ${url} with data ${queryString} failed. ${err}.`);
                reject(null);
            });
        } catch(err) {
            log.log(`Request to ${url} with data ${queryString} failed. ${err}.`);
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

    setConfig: function(apiServer, apiKey, secretKey, tradePwd, logger, publicOnly = false) {
        WEB_BASE = apiServer;
        log = logger;
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
        // size/limit not documented, but limit fits
        // https://docs.resfinex.com/guide/rest-auth-endpoints.html#post-get-open-orders
        data.limit = 200;
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
    orderBook: function(symbol, size) {
        let data = {};
        data.pair = symbol;
        // default limit/size is 500; no limit according to docs
        // https://docs.resfinex.com/guide/rest-public-endpoints.html#get-orderbook
        if (size) 
            data.size = size;
        else 
            data.size = 1000;
        return public_api(`/engine/depth`, data);
    }

}

module.exports = EXCHANGE_API;