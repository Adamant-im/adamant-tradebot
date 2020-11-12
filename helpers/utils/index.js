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
	getPairObj(aPair, letCoin1only = false) {

		let pair = (aPair || '').toUpperCase().trim();
		let coin1Decimals = 8;
		let coin2Decimals = 8;
		let isPairFromParam = true;
		let coin1, coin2;
	
		if (!pair || pair.indexOf('/') === -1 || pair === config.pair) { // Set default pair
			if (pair != config.pair)
				isPairFromParam = false;
			if ((pair.indexOf('/') === -1) && letCoin1only) { // Not a pair, may be a coin only
				coin1 = pair;
				if (coin1 === config.coin1)
					coin1Decimals = config.coin1Decimals;		
				pair = null;
				coin2 = null;
			} else { // A pair
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
			isPairFromParam
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
	getOrderBookInfo(orderBook, customSpreadPercent) {

		if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0])
			return false;
		
		const highestBid = orderBook.bids[0].price;
		const lowestAsk = orderBook.asks[0].price
		// const lowestOrderPrice = orderBook.bids[orderBook.bids.length-1].price;
		// const highestOrderPrice = orderBook.asks[orderBook.asks.length-1].price;

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
		}

		return {
			highestBid,
			lowestAsk,
			spread,
			spreadPercent,
			averagePrice,
			// lowestOrderPrice,
			// highestOrderPrice,
			liquidity,
			downtrendAveragePrice,
			uptrendAveragePrice,
			middleAveragePrice
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
	ADM: adm_utils
};
