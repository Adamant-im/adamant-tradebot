var CryptoJS = require('crypto-js');
const request = require('request');
const log = require('../helpers/log');
const DEFAULT_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36"
}

var WEB_BASE = '';
var config = {
    'auth-token': '',
    'auth-secret': ''
};

function api(path, r_data, do_sign, type, do_stringify) {
    var url = `${WEB_BASE}${path}`; 
    var pars = [];
    for (let key in r_data) {
        let v = r_data[key];
        pars.push(key + "=" + v);
    }
    var p = pars.join("&");
    if (p && type != 'post')
        url = url + "?" + p;
    let headersWithSign = DEFAULT_HEADERS;
    if (do_sign)
        headersWithSign = Object.assign({"login-token": config["auth-token"], "x-auth-sign": setSign(r_data)}, DEFAULT_HEADERS);

    return new Promise((resolve, reject) => {
        try {
            var httpOptions = {
                url: url,
                method: type,
                timeout: 15000,
                headers: headersWithSign,
                form: do_stringify ? JSON.stringify(r_data) : {data: r_data}
            }

            // console.log("api-httpOptions:", httpOptions);
            request(httpOptions, function(err, res, data) {
                if (err) {
                    reject(err);
                } else {
                    // console.log(`api() request result: ${data}`)
                    resolve(data);
                }
            }).on('error', function(err) {
                log.log(`Request to ${url} with data ${pars} failed. ${err}.`);
                reject(null);
            });
        } catch(err) {
            log.log(`Processing of request to ${url} with data ${pars} failed. ${err}.`);
            reject(null);    
        }
    });
}

function setSign(params) {
    // console.log(params);
    let keys = Object.keys(params);
    let n = keys.length;
    keys = keys.sort();
    let sign = '';
    for (let i = 0; i < n; i++) {
        sign = sign + params[keys[i]];
    }
    sign = sign + config["auth-secret"];
    sign = CryptoJS.SHA256(sign).toString(CryptoJS.enc.Hex);
    return sign;
}

var EXCHANGE_API = {

    setConfig: async function(apiServer, username, password) {
        if (!WEB_BASE) {
            WEB_BASE = apiServer;
            let loginReq = await this.login(username, password).catch(err => {
                log.log(`Login API request (apiServer: ${apiServer}, username: ${username}) failed. ${err}. Exiting. Try to restart the bot.`);
                process.exit(0);
            });

            var res = JSON.parse(loginReq);
            if (res.status === false) {
                log.log(`API auth (apiServer: ${apiServer}, username: ${username}) failed: ${res}. Exiting. Check login credentials in the config-file.`);
                process.exit(0);
            }

            config = {
                'auth-token': res.token,
                'auth-secret': res.data.secret
            };
            // console.log(config);
        }
    },

    /**
     * ------------------------------------------------------------------
     * Login for API access
     * ------------------------------------------------------------------
     */
    login: function(username, password) {
        var data = {};
        data.username = username;
        data.password = password;
        return api("/login", data, false, 'post', false);
    },

    /**
     * ------------------------------------------------------------------
     * Get balances
     * ------------------------------------------------------------------
     */
    getUserAssets: function() {
        var data = {};
        data.request_id = Date.now().toString();
        return api("/private/balances", data, true, 'post', true);
    },

    /**
     * ------------------------------------------------------------------
     * Get open orders
     * ------------------------------------------------------------------
     */
    getUserNowEntrustSheet: function() {
        var data = {};
        data.request_id = Date.now().toString();
        // not size/limit parameter
        // https://docs.atomars.com/#api-Private_API-Active_Orders
        return api("/private/orders", data, true, 'post', true);
    },

    /**
     * ------------------------------------------------------------------
     * Place an order
     * @param pair        string "BTCUSDT"
     * @param volume        amount, float
     * @param rate         price, float
     * @param type          Buy/Sell (0/1)
     * @param type_trade    Limit/Market/Stop Limit/Quick Market (0/1/2/3)
     * ------------------------------------------------------------------
     */
    addEntrustSheet: function(pair, amount, price, type, type_trade) {
        var data = {};
        data.request_id = Date.now().toString();
        data.pair = pair;
        if (price)
            data.rate  = price
        else
            data.rate  = 0;
        data.volume = amount;
        data.type   = type;
        data.type_trade   = type_trade;
        return api("/private/create-order", data, true, 'post', true);
    },

    /**
     * ------------------------------------------------------------------
     * Get a deposit address
     * @param coin        string "ADM"
     * @param createNew   string, Flag to get new address (0 - old address, 1 - new address)
     * ------------------------------------------------------------------
     */
    getDepositAddress: function(coin, createNew = 0) {
        var data = {};
        data.request_id = Date.now().toString();
        data.iso = coin;
        data.new = createNew;
        return api("/private/get-address", data, true, 'post', true);
    },

    /**
     * ------------------------------------------------------------------
     * Get details for an order
     * @param orderId    string 
     * https://docs.atomars.com/#api-Private_API-Get_Order
     * ------------------------------------------------------------------
     */
    getEntrustSheetInfo: function(orderId) {
        var data = {};
        data.request_id = Date.now().toString();
        data.order_id = orderId;
        return api("/private/get-order", data, true, 'post', true);
    },

    /**
     * ------------------------------------------------------------------
     * Cancel the order
     * @param order_id    string 
     * ------------------------------------------------------------------
     */
    cancelEntrustSheet: function(order_id) {
        var data = {};
        data.request_id = Date.now().toString();
        data.order_id = order_id.toString();
        return api("/private/delete-order", data, true, 'post', true);
    },

    /**
     * ------------------------------------------------------------------
     * Get pair data
     * @param pair    BTCUSDT
     * ------------------------------------------------------------------
     */
    ticker: function(pair) {
        var data = {};
        data.pair = pair;
        return api("/public/ticker", data, false, 'get', false);
    },

    /**
     * ------------------------------------------------------------------
     * Get all tickers
     * https://docs.atomars.com/#api-Public_API-Ticker_List
     * ------------------------------------------------------------------
     */
    tickerall: function() {
        var data = {};
        return api("/public/symbols", data, false, 'get', false);
    },

    /**
     * ------------------------------------------------------------------
     * Get depth data
     * @param pair  BTCUSDT
     * ------------------------------------------------------------------
     */
    orderBook: function(pair) {
        var data = {};
        data.pair = pair;
        // no limit/size parameter according to docs
        // https://docs.atomars.com/#api-Public_API-Order_Book
        return api("/public/book", data, false, 'get', false);
    }

}

module.exports = EXCHANGE_API;