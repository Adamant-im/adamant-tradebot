const api = require('../../modules/api');
const config = require('../../modules/configReader');
const adm_utils = require('./adm_utils');
const log = require('../log');
const db = require('../../modules/DB');
const Store = require('../../modules/Store');

module.exports = {
	unix() {
		return new Date().getTime();
	},
	sendAdmMsg(address, msg, type = 'message') {
		if (msg) {
			try {
				return api.send(config.passPhrase, address, msg, type).success || false;
			} catch (e) {
				return false;
			}
		}
	},
	thousandSeparator(num, doBold) {
		var parts = (num + '').split('.'),
			main = parts[0],
			len = main.length,
			output = '',
			i = len - 1;

		while (i >= 0) {
			output = main.charAt(i) + output;
			if ((len - i) % 3 === 0 && i > 0) {
				output = ' ' + output;
			}
			--i;
		}

		if (parts.length > 1) {
			if (doBold) {
				output = `**${output}**.${parts[1]}`;
			} else {
				output = `${output}.${parts[1]}`;
			}
		}
		return output;
	},
	async getAddressCryptoFromAdmAddressADM(coin, admAddress) {
		try {
			if (this.isERC20(coin)) {
				coin = 'ETH';
			}
			const resp = await api.syncGet(`/api/states/get?senderId=${admAddress}&key=${coin.toLowerCase()}:address`);
			if (resp && resp.success) {
				if (resp.transactions.length) {
					return resp.transactions[0].asset.state.value;
				} else {
					return 'none';
				};
			};
		} catch (e) {
			log.error(' in getAddressCryptoFromAdmAddressADM(): ' + e);
			return null;
		}
	},
	async userDailyValue(senderId){
		return (await db.paymentsDb.find({
			transactionIsValid: true,
			senderId: senderId,
			needToSendBack: false,
			inAmountMessageUsd: {$ne: null},
			date: {$gt: (this.unix() - 24 * 3600 * 1000)} // last 24h
		})).reduce((r, c) => {
			return +r + +c.inAmountMessageUsd;
		}, 0);
	},
	async updateAllBalances(){
		try {
			await this.ADM.updateBalance();
		} catch (e){}
	},
	async getLastBlocksNumbers() {
		const data = {
			ADM: await this.ADM.getLastBlockNumber(),
		};
		return data;
	},
	isKnown(coin){
		return config.known_crypto.includes(coin);
	},
	isAccepted(coin){
		return config.accepted_crypto.includes(coin);
	},
	isExchanged(coin){
		return config.exchange_crypto.includes(coin);
	},
	isFiat(coin){
		return ['USD', 'RUB', 'EUR', 'CNY', 'JPY'].includes(coin);
	},
	isHasTicker(coin){ // if coin has ticker like COIN/OTHERCOIN or OTHERCOIN/COIN
		const pairs = Object.keys(Store.currencies).toString();
		return pairs.includes(',' + coin + '/') || pairs.includes('/' + coin);
	},
	isERC20(coin){
		return config.erc20.includes(coin.toUpperCase());
	},
	/*	
		Returns a trade pair, coin1 and coin2, and decimals
		Or coin1 only, if aPair is not a pair, and letCoin1only = true
		If not isPairParsed, then aPair is not a valid trading pair, and default pair returned
	*/
	getPairObject(aPair, letCoin1only = false) {

		try {

			let pair = (aPair || '').toUpperCase().trim();
			let coin1Decimals = 8;
			let coin2Decimals = 8;
			let isPairParsed = true;
			let coin1, coin2;
		
			if (!pair || pair.indexOf('/') === -1 || pair === config.pair) {

				// aPair is not a pair, or is a default pair

				if (pair !== config.pair) {
					isPairParsed = false;
				}

				if ((pair.indexOf('/') === -1) && letCoin1only) {

					// aPair is not a pair, may be a coin only
					coin1 = pair;
					if (coin1 === config.coin1) {
						coin1Decimals = config.coin1Decimals;		
					}
					pair = null;
					coin2 = null;

				} else { 
					
					// Set a default trading pair
					pair = config.pair;
					coin1Decimals = config.coin1Decimals;
					coin2Decimals = config.coin2Decimals;

				}

			}
		
			if (pair) {
				coin1 = pair.substr(0, pair.indexOf('/')); 
				coin2 = pair.substr(pair.indexOf('/') + 1, pair.length);
			}
		
			return {
				pair,
				coin1,
				coin2,
				coin1Decimals,
				coin2Decimals,
				isPairParsed
			}
			
		} catch (e) {
			log.warn(`Error in getPairObject() of ${this.getModuleName(module.id)} module: ${e}.`);
			return false;
		}

	},
	randomValue(low, high, doRound = false) {
		let random = Math.random() * (high - low) + low;
		if (doRound)
			random = Math.round(random);
		return random;
	},
	randomDeviation(number, deviation) {
		const min = number - number * deviation;
		const max = number + number * deviation;
		return Math.random() * (max - min) + min;
	},
	getOrderBookInfo(orderBook, customSpreadPercent, targetPrice) {

		try {

			if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0])
				return false;
			
			const highestBid = orderBook.bids[0].price;
			const lowestAsk = orderBook.asks[0].price

			let typeTargetPrice, amountTargetPrice = 0, targetPriceOrdersCount = 0, amountTargetPriceQuote = 0;
			if (targetPrice) {
				if (targetPrice > highestBid && targetPrice < lowestAsk) {
					typeTargetPrice = 'inSpread';
				} else if (targetPrice < highestBid) {
					typeTargetPrice = 'sell';
				} else if (targetPrice > lowestAsk) {
					typeTargetPrice = 'buy';
				}
			}

			const spread = lowestAsk - highestBid;
			const averagePrice = (lowestAsk + highestBid) / 2;
			const spreadPercent = spread / averagePrice * 100;

			let downtrendAveragePrice = highestBid + this.randomValue(0, 0.15) * spread;
			if (downtrendAveragePrice >= lowestAsk)
				downtrendAveragePrice = highestBid;

			let uptrendAveragePrice = lowestAsk - this.randomValue(0, 0.15) * spread;
			if (uptrendAveragePrice <= highestBid)
				uptrendAveragePrice = lowestAsk;

			let middleAveragePrice = averagePrice - this.randomValue(-0.3, 0.3) * spread;
			if (middleAveragePrice >= lowestAsk || middleAveragePrice <= highestBid)
				middleAveragePrice = averagePrice;

			let liquidity = [];
			liquidity.percent2 = {};
			liquidity.percent2.spreadPercent = 2;
			liquidity.percent5 = {};
			liquidity.percent5.spreadPercent = 5;
			liquidity.percent10 = {};
			liquidity.percent10.spreadPercent = 10;
			liquidity.percentCustom = {};
			liquidity.percentCustom.spreadPercent = customSpreadPercent;
			liquidity.full = {};
			liquidity.full.spreadPercent = 0;

			for (const key in liquidity) {
				liquidity[key].bidsCount = 0;
				liquidity[key].amountBids = 0;
				liquidity[key].amountBidsQuote = 0;
				liquidity[key].asksCount = 0;
				liquidity[key].amountAsks = 0;
				liquidity[key].amountAsksQuote = 0;
				liquidity[key].totalCount = 0;
				liquidity[key].amountTotal = 0;
				liquidity[key].amountTotalQuote = 0;
				liquidity[key].lowPrice = averagePrice - averagePrice * liquidity[key].spreadPercent/100;
				liquidity[key].highPrice = averagePrice + averagePrice * liquidity[key].spreadPercent/100;
				liquidity[key].spread = averagePrice * liquidity[key].spreadPercent / 100;
				// average price is the same for any spread
			}

			for (const bid of orderBook.bids) {

				for (const key in liquidity) {
					if (!liquidity[key].spreadPercent || bid.price > liquidity[key].lowPrice) {
						liquidity[key].bidsCount += 1;
						liquidity[key].amountBids += bid.amount;
						liquidity[key].amountBidsQuote += bid.amount * bid.price;
						liquidity[key].totalCount += 1;
						liquidity[key].amountTotal += bid.amount;
						liquidity[key].amountTotalQuote += bid.amount * bid.price;
					}
				}
				if (typeTargetPrice === 'sell' && bid.price >= targetPrice) {
					amountTargetPrice += bid.amount;
					amountTargetPriceQuote += bid.amount * bid.price;
					targetPriceOrdersCount += 1;
				}

			}

			for (const ask of orderBook.asks) {

				for (const key in liquidity) {
					if (!liquidity[key].spreadPercent || ask.price < liquidity[key].highPrice) {
						liquidity[key].asksCount += 1;
						liquidity[key].amountAsks += ask.amount;
						liquidity[key].amountAsksQuote += ask.amount * ask.price;
						liquidity[key].totalCount += 1;
						liquidity[key].amountTotal += ask.amount;
						liquidity[key].amountTotalQuote += ask.amount * ask.price;
					}
				}
				if (typeTargetPrice === 'buy' && ask.price <= targetPrice) {
					amountTargetPrice += ask.amount;
					amountTargetPriceQuote += ask.amount * ask.price;
					targetPriceOrdersCount += 1;
				}

			}

			let smartBid = this.getSmartPrice(orderBook.bids, 'bids', liquidity);
			let smartAsk = this.getSmartPrice(orderBook.asks, 'asks', liquidity);
			
			return {
				highestBid,
				lowestAsk,
				smartBid,
				smartAsk,
				spread,
				spreadPercent,
				averagePrice,
				liquidity,
				downtrendAveragePrice,
				uptrendAveragePrice,
				middleAveragePrice,
				typeTargetPrice,
				amountTargetPrice,
				amountTargetPriceQuote,
				targetPriceOrdersCount
			}

		} catch (e) {
			log.warn(`Error in getOrderBookInfo() of ${this.getModuleName(module.id)} module: ${e}.`);
			return false;
		}
	},
	getSmartPrice(items, type, liquidity) {

		try {

			let smartPrice;
			let c_m1 = 0;
			let a = 0, a_m1 = 0, t = 0;
			let c = 0, c_a = 0, c_a_m1 = 0, c_c_m1 = 0, c_t = 0, s = 0;
			let prev_c_c_m1 = 0, prev_s = 0, prev_c_t = 0;
			
			const enough_c_t = 0.02;
			let table = [];
			

			// console.log(liquidity['full']);

			for (let i = 0; i < items.length; i++) {

				const el = items[i];
				const el_m1 = i === 0 ? false : items[i-1];
				if (type === 'asks') {
					a = el.amount;
					a_m1 = el_m1 ? el_m1.amount : false;
					t = liquidity['full'].amountAsks;
				} else {
					a = el.amount * el.price;
					a_m1 = el_m1 ? el_m1.amount * el_m1.price : false;
					t = liquidity['full'].amountBidsQuote;
				}
				
				prev_c_c_m1 = c_c_m1;
				prev_c_t = c_t;
				prev_s = s;

				c_m1 = c;
				c += a;
				c_a = c / a;
				c_a_m1 = a_m1 ? c / a_m1 : false;
				c_c_m1 = c_m1 === 0 ? false : c / c_m1;
				c_t = c / t;
				s = c_c_m1 * c_t;

				if (!smartPrice && s < prev_s && prev_c_t > enough_c_t) {
					smartPrice = el_m1.price;
				}
				// console.log(ask.price.toFixed(4), ask.amount.toFixed(4), c.toFixed(2), c_a.toFixed(2), c_a_m1 ? c_a_m1.toFixed(2) : false, c_c_m1 ? c_c_m1.toFixed(2) : false, c_t.toFixed(2));

				if (i < 20) {
					table.push({
						price: el.price.toFixed(8), 
						a: a.toFixed(8), 
						c: +c.toFixed(8), 
						c_a: +c_a.toFixed(2), 
						c_a_m1: c_a_m1 ? +c_a_m1.toFixed(2) : false, 
						c_c_m1: c_c_m1 ? +c_c_m1.toFixed(2) : false, 
						c_t: +c_t.toFixed(5),
						s: +s.toFixed(5)
					});
				}

			}

			// console.table(table);
			// console.log(`smartPrice for ${type}: ${smartPrice}`);
			return smartPrice;

		} catch (e) {
			log.warn(`Error in getSmartPrice() of ${this.getModuleName(module.id)} module: ${e}.`);
			return false;
		}

	},
	getOrdersStats(orders) { 

		// order is an object of ordersDb
		// type: type,
		// price: price,
		// coin1Amount: coin1Amount,
		// coin2Amount: coin2Amount,
				
		let bidsTotalAmount = 0, asksTotalAmount = 0, 
			bidsTotalQuoteAmount = 0, asksTotalQuoteAmount = 0, 
			totalAmount = 0, totalQuoteAmount = 0,
			asksCount = 0, bidsCount = 0, totalCount = 0;
		for (const order of orders) {
			if (order.type === 'buy') {
				bidsTotalAmount += order.coin1Amount;
				bidsTotalQuoteAmount += order.coin2Amount;
				bidsCount += 1;
			}
			if (order.type === 'sell') {
				asksTotalAmount += order.coin1Amount;
				asksTotalQuoteAmount += order.coin2Amount;
				asksCount += 1;
			}
			totalAmount += order.coin1Amount;
			totalQuoteAmount += order.coin2Amount;
			totalCount += 1;
		}

		return {
			bidsTotalAmount, asksTotalAmount, 
			bidsTotalQuoteAmount, asksTotalQuoteAmount, 
			totalAmount, totalQuoteAmount,
			asksCount, bidsCount, totalCount
		}
	},
	getPrecision(decimals) {
		return +(Math.pow(10, -decimals).toFixed(decimals))
	},
	isOrderOutOfSpread(order, orderBookInfo) {

		// order is an object of ordersDb
		// type: type,
		// price: price,

		const laxityPercent = 30;
		let minPrice = orderBookInfo.liquidity.percentCustom.lowPrice - orderBookInfo.liquidity.percentCustom.spread * laxityPercent / 100;
		let maxPrice = orderBookInfo.liquidity.percentCustom.highPrice + orderBookInfo.liquidity.percentCustom.spread * laxityPercent / 100;
		// console.log('isOrderOutOfSpread:', order.price, orderBookInfo.liquidity.percentCustom.lowPrice, orderBookInfo.liquidity.percentCustom.highPrice);
		// console.log('isOrderOutOfSpread with laxity:', order.price, minPrice, maxPrice);

		return (order.price < minPrice) || (order.price > maxPrice);

	},
	getModuleName(id) {
		let n = id.lastIndexOf("\\");
		if (n === -1)
			n = id.lastIndexOf("/");
		if (n === -1)
			return ''
		else
			return id.substring(n + 1);
	},
	parseRangeOrValue(str) {

		if (!str) {
			return {
				isRange: false,
				isValue: false
			}
		}
		
		let from, to, value;
		if (str.indexOf('-') > -1) { // hyphen
			[from, to] = str.split('-');
		} else if (str.indexOf('—') > -1) { // long dash
			[from, to] = str.split('—');
		} else if (str.indexOf('–') > -1) { // short dash
			[from, to] = str.split('–');
		} else if (str.indexOf('−') > -1) { // minus
			[from, to] = str.split('−');
		} else {
			value = +str;
			if (!value || value === Infinity) {
				return {
					isRange: false,
					isValue: false
				}
			} else {
				return {
					isRange: false,
					isValue: true,
					value
				}
			}
		}

		from = +from;
		to = +to;

		if (!from || from === Infinity || !to || to === Infinity) {
			return {
				isRange: false,
				isValue: false
			}
		}
		
		return {
			isRange: true,
			isValue: false,
			from,
			to
		};

	},
	difference(a, b) {
		if (!a || !b || !a[0] || !b[0]) return false;
		let obj2;
		let diff = [];
		b.forEach(obj2 => {
			obj1 = a.filter(crypto => crypto.code === obj2.code)[0];
			if (!obj1) {
				a.push({
					code: obj2.code,
					total: 0
				})
			}
		});
		a.forEach(obj1 => {
			obj2 = b.filter(crypto => crypto.code === obj1.code)[0];
			if (obj2) {
				if (obj1.total != obj2.total) {
					diff.push({
						code: obj1.code,
						prev: obj2.total,
						now: obj1.total
					})
				}
			} else {
				diff.push({
					code: obj1.code,
					prev: 0,
					now: obj1.total
				})
			}
		});
		return diff;
	},
	ADM: adm_utils
};
