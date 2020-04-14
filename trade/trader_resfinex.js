const RESFINEX = require('./resfinex_api');
const apiServer = 'https://api.resfinex.com';
const log = require('../helpers/log');
const $u = require('../helpers/utils');

// API endpoints:
// https://api.resfinex.com/

module.exports = (apiKey, secretKey, pwd) => {

	RESFINEX.setConfig(apiServer, apiKey, secretKey, pwd);
	
	return {
		getBalances(nonzero = true) {
			return new Promise((resolve, reject) => {
				RESFINEX.getUserAssets().then(function (data) {
					try {
						// console.log(data);
						let assets = JSON.parse(data).data;
						if (!assets)
							assets = [];
						let result = [];
						assets.forEach(crypto => {
							result.push({
								code: crypto.sym,
								free: crypto.total - crypto.inorder,
								freezed: +crypto.inorder
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
				RESFINEX.getUserNowEntrustSheet(pair_.coin1, pair_.coin2).then(function (data) {
					try {
						// console.log(2);
						// console.log(data);

						let openOrders = JSON.parse(data).data;
						if (!openOrders)
							openOrders = [];

						let result = [];
						openOrders.forEach(order => {
							result.push({
								orderid: order.orderId,
								symbol: order.pair,
								price: order.price,
								side: order.side, // SELL or BUY
								type: order.type, // LIMIT or MARKET, etc.
								timestamp: order.timestamp,
								amount: order.amount,
								executedamount: order.filled,
								status: order.status, // OPEN, etc.
								uid: order.orderId,
								// coin2Amount: order.total,
								// coinFrom: order.baseCurrency,
								// coinTo: order.quoteCurrency
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
				RESFINEX.cancelEntrustSheet(orderId).then(function (data) {
					try {
						// console.log(data);
						if (JSON.parse(data).status === 'ok') {
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
				RESFINEX.ticker(pair_.pair).then(function (data) {
					data = JSON.parse(data).data;
					// console.log(data);
					data = data.filter(symbol => symbol.pair === pair_.pair)[0];
					// console.log(data);
					try {
						RESFINEX.orderBook(pair_.pair).then(function (data2) {
							data2 = JSON.parse(data2).data;
							// console.log(data2);
							try {
								if (data2) {
									resolve({
										ask: +data2.asks[0].price,
										bid: +data2.bids[0].price,

										volume: +data.volumeBase,
										volume_Coin2: +data.volume,
										high: +data.high,
										low: +data.low
									});
								} else {
									resolve(false);
								}
							} catch (e) {
								resolve(false);
								log.warn('Error while making getRates() orderBook() request: ' + e);
							};
						});
					} catch (e) {
						resolve(false);
						log.warn('Error while making getRates() ticker() request: ' + e);
					};
				});
			});
		},
		placeOrder(orderType, pair, price, coin1Amount, limit = 1, coin2Amount, pairObj) {

			let pair_ = formatPairName(pair);
			let output = '';
			let message;
			let order = {};

			let side = (orderType === 'sell') ? 'SELL' : 'BUY';

			if (!coin1Amount && coin2Amount && price) { // both LIMIT and MARKET order amount are in coin1
				coin1Amount = coin2Amount / price;
			}

			if (pairObj) { // Set precision (decimals)				
				if (coin1Amount) {
					coin1Amount = +coin1Amount.toFixed(pairObj.coin1Decimals);
				}
				if (coin2Amount) {
					coin2Amount = +coin2Amount.toFixed(pairObj.coin2Decimals)
				}
				if (price)
					price = +price.toFixed(pairObj.coin2Decimals);
			}

			if (limit) { // Limit order
				output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at ${price} ${pair_.coin2.toUpperCase()}.`;

				return new Promise((resolve, reject) => {
					RESFINEX.addEntrustSheet(pair_.pair, +coin1Amount, +price, side, 'LIMIT').then(function (data) {
						try {						
							// console.log(data);
							let result = JSON.parse(data);
							if (result.data && result.data.orderId) {
								message = `Order placed to ${output} Order Id: ${result.data.orderId}.`; 
								log.info(message);
								order.orderid = result.data.orderId;
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
	
			} else { // Market order
				let size = 0;
				if (orderType === 'sell') {
					if (coin1Amount) {
						size = coin1Amount;
						output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market.`;
					} else {
						message = `Unable to place order to ${orderType} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market. Set ${pair_.coin1.toUpperCase()} amount.`;
						log.warn(message);
						order.orderid = false;
						order.message = message;
						return order;
					}
				} else { // buy
					if (coin1Amount) {
						size = coin1Amount;
						output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market.`;
					} else {
						message = `Unable to place order to ${orderType} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market. Set ${pair_.coin1.toUpperCase()} amount.`;
						log.warn(message);
						order.orderid = false;
						order.message = message;
						return order;
					}
				}

				return new Promise((resolve, reject) => {
					RESFINEX.addEntrustSheet(pair_.pair, +coin1Amount, '', side, 'MARKET').then(function (data) {
						try {						
							// console.log(data);
							let result = JSON.parse(data);
							if (result.data && result.data.orderId) {
								message = `Order placed to ${output} Order Id: ${result.data.orderId}.`; 
								log.info(message);
								order.orderid = result.data.orderId;
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
			}
		} // placeOrder()

	}
}

function formatPairName(pair) {
	if (pair.indexOf('-') > -1)
		pair = pair.replace('-', '_').toUpperCase();
	else 
		pair = pair.replace('/', '_').toUpperCase();
	const[coin1, coin2] = pair.split('_');	
	return {
		pair,
		coin1: coin1.toUpperCase(),
		coin2: coin2.toUpperCase()
	};
}
