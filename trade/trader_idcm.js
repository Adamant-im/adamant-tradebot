const utf8 = require('utf8');
const crypto = require("crypto");
const request = require('request');
const log = require('../helpers/log');
const $u = require('../helpers/utils');

const base_url = 'https://api.IDCM.io:8323/api/v1/';

module.exports = (PubK, PrivK) => {

	return {
		getBalances(nonzero = true) {
			return new Promise((resolve, reject) => {
				req('getuserinfo', {}, function (data) {
					try {
						if (nonzero) {
							data = data.filter(crypto => crypto.free || crypto.freezed); 
						}
						resolve(data);
					} catch (e) { 					
						resolve(false);
						log.warn('Error while making getBalances() request: ' + e);
					};
				});
			});
		},
		getRates(pair) {
			pair_ = formatPairName(pair);
			return new Promise((resolve, reject) => {
				req('getticker', {Symbol: pair_}, function (data) {
					try {
						resolve({
							ask: +data.sell,
							bid: +data.buy,
							volume: +data.vol,
							high: +data.high,
							low: +data.low
						});
					} catch (e) {
						resolve(false);
						log.warn('Error while making getRates() request: ' + e);
					};
				});
			});
		},
		getOpenOrders(pair) {
			pair_ = formatPairName(pair);
			return new Promise((resolve, reject) => {
				req('getorderinfo', {Symbol: pair_}, function (data) {
					try {
						resolve(JSON.parse(data).data);
						// Statuses: -2 cancelled, -1 invalid, 0 pending, 1 partial, 2 full trade, 3 executed
					} catch (e) {
						resolve(false);
						log.warn('Error while making getOpenOrders() request: ' + e);
					};
				});
			});
		},
		placeOrder(orderType, pair, price, coin1Amount, limit = 1, coin2Amount, pairObj) {

			let pair_ = formatPairName(pair);
			const coins = $u.getCoinsFromPair(pair);
			let type = (orderType === 'sell') ? 1 : 0;

			let opt;
			let output = '';

			if (pairObj) { // Set precision (decimals)
				if (coin1Amount) {
					coin1Amount = +coin1Amount.toFixed(pairObj.coin1Decimals);
					if (price)
						price = +price.toFixed(pairObj.coin2Decimals);
				}
				if (coin2Amount) {
					coin2Amount = +coin2Amount.toFixed(pairObj.coin2Decimals)
					if (price)
						price = +price.toFixed(pairObj.coin1Decimals);
				}
			}
			
			if (limit) { // Limit order
				opt = {
					Symbol: pair_,		// Amount should be integer for ADM
					Size: coin1Amount, // Amount to buy/sell for coin1. Min 0.2 ETH/BTC ETH/USDT, 1 ADM/BTC.
					Price: price,
					Side: type, // 1 for sell. 0 for buy.
					Type: 1 // 1 for limit price. 0 for Market price.
				}
				output = `${orderType} ${coin1Amount} ${coins.coin} at ${price} ${coins.coin2}.`;
			} else { // Market order
				if (coin1Amount) {
					opt = {
						Symbol: pair_,
						Size: coin1Amount, // Amount to buy/sell for coin1. Min 0.2 ETH/BTC ETH/USDT, 1 ADM/BTC.
						Side: type, // 1 for sell. 0 for buy.
						Type: 0 // 1 for limit price. 0 for Market price.
					};
					output = `${orderType} ${coin1Amount} ${coins.coin} at Market Price on ${coins.pair} market.`;
					console.log(opt);
				} else {
					opt = {
						Symbol: pair_,
						Amount: coin2Amount, // Amount to buy/sell for coin2 for Market order
						Side: type, // 1 for sell. 0 for buy.
						Type: 0 // 1 for limit price. 0 for Market price.
					};	
					output = `${orderType} ${coins.coin} for ${coin2Amount} ${coins.coin2} at Market Price on ${coins.pair} market.`;
				}
			}


			return new Promise((resolve, reject) => {
				req('trade', opt, function (data) {
					let message;
					let order = {};
					try {						
						if (data) {
							// console.log(data);
							message = `Order placed to ${output} Order Id: ${data.orderid}.`; 
							log.info(message);
							order.orderid = data.orderid;
							order.message = message;
							resolve(order);
						} else {
							message = `Unable to place order to ${output} Check parameters and balances.`;
							log.warn(message);
							order.orderid = false;
							order.message = message;
							resolve(order);
						}
					} catch (e) {
						message = 'Error while making placeOrder() request: ' + e;
						log.warn(message);
						order.orderid = false;
						order.message = message;
						resolve(order);
					};
				});
			});
		},
		cancelOrder(orderId, orderType, pair) {
			let pair_ = formatPairName(pair);
			let type;
			if (typeof orderType === 'string')
				type = (orderType === 'sell') ? 1 : 0;
			else
				type = orderType;
			return new Promise((resolve, reject) => {
				req('cancel_order', {OrderID: orderId, Symbol: pair_, Side: Number(type)}, function (data) {
					try {
						// data is always true
						// console.log(data);
						log.info(`Cancelling order ${orderId}..`);
						resolve(data);
					} catch (e) {
						resolve(false);
						log.warn('Error while making cancelOrder() request: ' + e);
					};				
				});
			});
		}		
	}
    
    // Makes a request to IDCM api endpoint
	function req(method, content, cb) {
		content = JSON.stringify(content);
		const sign = signHmacSha384(PrivK, content);
		const opt = {
			url: base_url + method,
			headers: {
				'Content-Type': 'application/json',
				'X-IDCM-APIKEY': PubK,
				'X-IDCM-SIGNATURE': sign,
				'X-IDCM-INPUT': content
			}
		};
		
		request.post(opt, (error, response, body) => {
			if (error) {
				log.warn('Error while making post request: ' + error);
				resolve(false);
			}
			try {
				if (method !== 'getorderinfo') {
					cb(JSON.parse(body).data);
				} else {
					cb(body);
				}
			} catch (e) {
				log.warn('Exception while making post request: ' + e);
				cb(false);
			}
		});
	}
}

function signHmacSha384(secret, str) {
	const sign = crypto.createHmac('sha384', utf8.encode(secret))
	.update(utf8.encode(str))
	.digest('base64');
	return sign;	
}

function formatPairName(pair) {
	if (pair.indexOf('_') > -1)
		pair = pair.replace('_', '-').toUpperCase();
	else 
		pair = pair.replace('/', '-').toUpperCase();
	return pair;
}
