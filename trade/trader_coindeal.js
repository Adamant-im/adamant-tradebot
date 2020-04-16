const COINDEAL = require('./coindeal_api');
const apiServer = 'https://apigateway.coindeal.com';
const log = require('../helpers/log');
const $u = require('../helpers/utils');

// API endpoints:
// https://apigateway.coindeal.com

module.exports = (apiKey, secretKey, pwd) => {

	COINDEAL.setConfig(apiServer, apiKey, secretKey, pwd);
	
	return {
		getBalances(nonzero = true) {
			return new Promise((resolve, reject) => {
				COINDEAL.getUserAssets().then(function (data) {
					try {
						// console.log(data);
						let assets = JSON.parse(data);
						if (!assets)
							assets = [];
						let result = [];
						assets.forEach(crypto => {
							result.push({
								code: crypto.symbol,
								free: +crypto.available,
								freezed: +crypto.reserved,
								btc: +crypto.estimatedBalanceBtc,
								usd: +crypto.estimatedBalanceUsd
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
				COINDEAL.getUserNowEntrustSheet(pair_.coin1, pair_.coin2).then(function (data) {
						try {
						// console.log(data);
						// console.log(2);

						let openOrders = JSON.parse(data);
						if (!openOrders)
							openOrders = [];

						let result = [];
						openOrders.forEach(order => {
							result.push({
								orderid: order.id,
								symbol: order.symbol,
								price: order.price,
								side: order.side, // sell or buy
								type: order.type, // limit or market, etc.
								timestamp: order.createdAt,
								amount: order.cumQuantity,
								executedamount: order.cumQuantity - order.quantity,
								status: order.status,
								uid: order.clientOrderId,
								// coin2Amount: order.total,
								coinFrom: order.baseCurrency,
								coinTo: order.quoteCurrency
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
				COINDEAL.cancelEntrustSheet(orderId).then(function (data) {
					try {
						// console.log(data);
						if (JSON.parse(data).id) {
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
				COINDEAL.stats().then(function (data2) {
					data2 = JSON.parse(data2)[pair_.coin1 + '_' + pair_.coin2];
					// console.log(data2);
					try {
						if (data2) {
							resolve({
								volume: +data2.baseVolume,
								volume_Coin2: +data2.quoteVolume,
								high: +data2.high24hr,
								low: +data2.low24hr,
								ask: +data2.lowestAsk,
								bid: +data2.highestBid
							});
						} else {
							resolve(false);
						}
					} catch (e) {
						resolve(false);
						log.warn('Error while making getRates() stats() request: ' + e);
					};
				});
			});
		},

		placeOrder(orderType, pair, price, coin1Amount, limit = 1, coin2Amount, pairObj) {

			let pair_ = formatPairName(pair);
			let output = '';
			let message;
			let order = {};

			let type = (orderType === 'sell') ? 'sell' : 'buy';

			if (pairObj) { // Set precision (decimals)		
				if (coin1Amount) {
					coin1Amount = (+coin1Amount).toFixed(pairObj.coin1Decimals);
				}
				if (coin2Amount) {
					coin2Amount = (+coin2Amount).toFixed(pairObj.coin2Decimals)
				}
				if (price)
					price = (+price).toFixed(pairObj.coin2Decimals);
			}

			if (limit) { // Limit order
				output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at ${price} ${pair_.coin2.toUpperCase()}.`;

				return new Promise((resolve, reject) => {
					COINDEAL.addEntrustSheet(pair_.pair, coin1Amount, price, type).then(function (data) {
						try {						
							// console.log(data);
							let result = JSON.parse(data);
							if (result && result.id) {
								message = `Order placed to ${output} Order Id: ${result.id}.`; 
								log.info(message);
								order.orderid = result.id;
								order.message = message;
                                resolve(order);	
							} else {
								message = `Unable to place order to ${output} Check parameters and balances. Description: ${result.message}`;
								if (result.errors && result.errors.errors)
									message += `: ${result.errors.errors.join(', ')}`;
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
						size = coin1Amount
						output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market.`;
					} else {
						message = `Unable to place order to ${orderType} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market. Set ${pair_.coin1.toUpperCase()} amount.`;
						log.warn(message);
						order.orderid = false;
						order.message = message;
						return order;
					}
				} else { // buy
					if (coin2Amount) {
						size = coin2Amount
						output = `${orderType} ${pair_.coin1} for ${coin2Amount} ${pair_.coin2.toUpperCase()} at Market Price on ${pair} market.`;
					} else {
						message = `Unable to place order to ${orderType} ${pair_.coin1.toUpperCase()} for ${pair_.coin2.toUpperCase()} at Market Price on ${pair} market. Set ${pair_.coin2.toUpperCase()} amount.`;
						log.warn(message);
						order.orderid = false;
						order.message = message;
						return order;
					}
				}

                message = `Unable to place order to ${output} CoinDeal doesn't support Market orders yet.`; 
                log.warn(message);
                order.orderid = false;
                order.message = message;
                return order;	

			}
		}
	}
}

function formatPairName(pair) {
    let pair_, coin1, coin2;
	if (pair.indexOf('-') > -1) {
        pair_ = pair.replace('-', '').toUpperCase();
        [coin1, coin2] = pair.split('-');
    } else if (pair.indexOf('_') > -1) {
        pair_ = pair.replace('_', '').toUpperCase();
        [coin1, coin2] = pair.split('_');
    } else {
        pair_ = pair.replace('/', '').toUpperCase();
        [coin1, coin2] = pair.split('/');
    }
	
	return {
		pair: pair_,
		coin1: coin1.toUpperCase(),
		coin2: coin2.toUpperCase()
	};
}
