const BITZ = require('./bit-z_api');
const apiServer = 'https://apiv2.bitz.com';
const log = require('../helpers/log');
const $u = require('../helpers/utils');

// API endpoints:
// https://apiv2.bitz.com
// https://apiv2.bit-z.pro
// https://api.bitzapi.com
// https://api.bitzoverseas.com
// https://api.bitzspeed.com

module.exports = (apiKey, secretKey, pwd) => {

	BITZ.setConfig(apiServer, apiKey, secretKey, pwd);
	
	return {
		getBalances(nonzero = true) {
			return new Promise((resolve, reject) => {
				BITZ.getUserAssets().then(function (data) {
					try {
						// console.log(data);
						let assets = JSON.parse(data).data.info;
						if (!assets)
							assets = [];
						let result = [];
						assets.forEach(crypto => {
							result.push({
								code: crypto.name.toUpperCase(),
								free: +crypto.over,
								freezed: +crypto.lock,
								btc: +crypto.btc,
								usd: +crypto.usd
							});
						})
						if (nonzero) {
							result = result.filter(crypto => crypto.free || crypto.freezed); 
						}
						// console.log(result);
						resolve(result);
					} catch (e) { 					
						resolve(false);
						log.warn('Error while making getBalances() request: ' + e);
					};
				});
			});
		},
		getOpenOrders(pair) {
			pair_ = formatPairName(pair);
			return new Promise((resolve, reject) => {
				BITZ.getUserNowEntrustSheet(pair_.coin1, pair_.coin2).then(function (data) {
						try {
						// console.log(data);
						// console.log(2);

						let openOrders = JSON.parse(data).data.data;
						if (!openOrders)
							openOrders = [];

						let result = [];
						openOrders.forEach(order => {
							result.push({
								orderid: order.id,
								symbol: order.coinFrom + '_' + order.coinTo,
								price: order.price,
								side: order.flag,
								type: 1, // limit
								timestamp: order.created,
								amount: order.number,
								executedamount: order.numberDeal,
								status: order.status,
								uid: order.uid,
								coin2Amount: order.total,
								coinFrom: order.coinFrom,
								coinTo: order.coinTo
							});
						})
						// console.log(result[0]);
						// console.log(3);
							
						resolve(result);
						
					} catch (e) {
						resolve(false);
						log.warn('Error while making getOpenOrders() request: ' + e);
					};
				});
			});
		},
		cancelOrder(orderId) {
			return new Promise((resolve, reject) => {
				BITZ.cancelEntrustSheet(orderId).then(function (data) {
					try {
						// console.log(data);
						if (JSON.parse(data).data) {
							log.info(`Cancelling order ${orderId}..`);
							resolve(true);
						} else {
							log.info(`Order ${orderId} not found. Unable to cancel it.`);
							resolve(false);
						}
					} catch (e) {
						resolve(false);
						log.warn('Error while making cancelOrder() request: ' + e);
					};				
				});
			});
		},
		getRates(pair) {
			pair_ = formatPairName(pair);
			return new Promise((resolve, reject) => {
				BITZ.ticker(pair_.pair).then(function (data) {
					// console.log(data);
					data = JSON.parse(data).data;
					try {
						if (data) {
							resolve({
								ask: +data.askPrice,
								bid: +data.bidPrice,
								volume: +data.volume,
								volume_Coin2: +data.quoteVolume,
								high: +data.high,
								low: +data.low,
								askQty: +data.askQty,
								bidQty: +data.bidQty,
								dealCount: +data.dealCount,
								coin1Decimals: +data.numberPrecision,
								coin2Decimals: +data.pricePrecision,
								firstId: data.firstId,
								lastId: data.lastId
							});
						} else {
							resolve(false);
						}
					} catch (e) {
						resolve(false);
						log.warn('Error while making getRates() request: ' + e);
					};
				});
			});
		},

		placeOrder(orderType, pair, price, coin1Amount, limit = 1, coin2Amount) {

			let pair_ = formatPairName(pair);
			let output = '';

			let type = (orderType === 'sell') ? 2 : 1;

			if (limit) { // Limit order
				output = `${orderType} ${coin1Amount} ${pair_.coin1} at ${price} ${pair_.coin2}.`;

				return new Promise((resolve, reject) => {
					BITZ.addEntrustSheet(pair_.pair, +coin1Amount, +price, type).then(function (data) {
						try {						
							// console.log(data);
							let result = JSON.parse(data).data;
							if (result) {
								log.info(`Order placed to ${output} Order Id: ${result.id}.`);
								resolve(result.id);
							} else {
								resolve(false);
								log.warn(`Unable to place order to ${output} Check parameters and balances.`);
							}
						} catch (e) {
							resolve(false);
							log.warn('Error while making placeOrder() request: ' + e);
						};
					});
				});
	
			} else { // Market order
				let size = 0;
				if (orderType === 'sell') {
					if (coin1Amount) {
						size = coin1Amount
						output = `${orderType} ${coin1Amount} ${pair_.coin1} at Market Price on ${pair_.pair} market.`;
					} else {
						log.warn(`Unable to place order to ${orderType} ${pair_.coin1} at Market Price on ${pair_.pair} market. Set ${pair_.coin1} amount.`);
						return false;
					}
				} else { // buy
					if (coin2Amount) {
						size = coin2Amount
						output = `${orderType} ${pair_.coin1} for ${coin2Amount} ${pair_.coin2} at Market Price on ${pair_.pair} market.`;
					} else {
						log.warn(`Unable to place order to ${orderType} ${pair_.coin1} for ${pair_.coin2} at Market Price on ${pair_.pair} market. Set ${pair_.coin2} amount.`);
						return false;
					}
				}

				return new Promise((resolve, reject) => {
					BITZ.addMarketOrder(pair_.pair, +size, type).then(function (data) {
						try {						
							// console.log(data);
							let result = JSON.parse(data).data;
							if (result) {
								log.info(`Order placed to ${output} Order Id: ${result.id}.`);
								resolve(result.id);
							} else {
								resolve(false);
								log.warn(`Unable to place order to ${output} Check parameters and balances.`);
							}
						} catch (e) {
							resolve(false);
							log.warn('Error while making placeOrder() request: ' + e);
						};
					});
				});
			}
		}, // placeOrder()
		getOrderBook(pair) {
			// depth(symbol)

		},
		getDepositAddress(coin) {
			return new Promise((resolve, reject) => {
				BITZ.getDepositAddress(coin).then(function (data) {
					try {
						// console.log(data);
						const address = JSON.parse(data).data.wallet;
						if (address) {
							resolve(address);
						} else {
							resolve(false);
						}
					} catch (e) {
						resolve(false);
						log.warn('Error while making getDepositAddress() request: ' + e);
					};				
				});
			});

		}
	}
}

function formatPairName(pair) {
	if (pair.indexOf('-') > -1)
		pair = pair.replace('-', '_').toLowerCase();
	else 
		pair = pair.replace('/', '_').toLowerCase();
	const[coin1, coin2] = pair.split('_');	
	return {
		pair,
		coin1: coin1.toLowerCase(),
		coin2: coin2.toLowerCase()
	};
}
