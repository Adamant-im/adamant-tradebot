const fs = require('fs');
const Store = require('../modules/Store');
const $u = require('../helpers/utils');
const config = require('./configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('../trade/tradeParams_' + config.exchange);
const traderapi = require('../trade/trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const orderCollector = require('../trade/orderCollector');
const getStats = require('../trade/orderStats');

module.exports = async (cmd, tx, itx) => {

	if (itx.isProcessed) return;
	log.info('Got new command Tx to process: ' + cmd);
	try {
		let res = [];
		const group = cmd
			.trim()
			.replace(/    /g, ' ')
			.replace(/   /g, ' ')
			.replace(/  /g, ' ')
			.split(' ');
		const methodName = group.shift().trim().toLowerCase().replace('\/', '');
		const m = commands[methodName];
		if (m) {
			res = await m(group, tx);
		} else {
			res.msgSendBack = `I don’t know */${methodName}* command. ℹ️ You can start with **/help**.`;
		}
		if (!tx) {
			return res.msgSendBack;
		}
		if (tx) {
            itx.update({isProcessed: true}, true);
            if (res.msgNotify)
                notify(res.msgNotify, res.notifyType);
            if (res.msgSendBack)
                $u.sendAdmMsg(tx.senderId, res.msgSendBack);
            saveConfig();
        }
	} catch (e) {
		tx = tx || {};
		log.error('Error while processing command ' + cmd + ' from senderId ' + tx.senderId + '. Tx Id: ' + tx.id + '. Error: ' + e);
	}
}

function start(params) {
	const type = (params[0] || '').trim();
	if (!type || !type.length || !["mm"].includes(type)) {
        return {
            msgNotify: '',
            msgSendBack: `Indicate trade type, _mm_ for market making. Example: */start mm*.`,
            notifyType: 'log'
		} 
	}
	if (type === "mm") {
		if (!tradeParams.mm_isActive) {
			tradeParams.mm_isActive = true;
			if (tradeParams.mm_isOrderBookActive) {
				msgNotify = `${config.notifyName} set to start market making & order book building for ${config.pair}.`;
				msgSendBack = `Starting market making & order book building for ${config.pair} pair.`;
			} else {
				msgNotify = `${config.notifyName} set to start market making for ${config.pair}. Order book building is disabled.`;
				msgSendBack = `Starting market making for ${config.pair} pair. Note, order book building is disabled. To enable, type */enable ob*.`;
			}
	
			return {
				msgNotify,
				msgSendBack,
				notifyType: 'log'
			}
		} else {
			tradeParams.mm_isActive = true;
			return {
				msgNotify: '',
				msgSendBack: `Market making for ${config.pair} pair is active already.`,
				notifyType: 'log'
			}
		}
	}
}

function stop(params) {
	const type = (params[0] || '').trim();
	if (!type || !type.length || !["mm"].includes(type)) {
        return {
            msgNotify: '',
            msgSendBack: `Indicate trade type, _mm_ for market making. Example: */stop mm*.`,
            notifyType: 'log'
		} 
	}
	if (type === "mm") {
		if (tradeParams.mm_isActive) {
			tradeParams.mm_isActive = false;
			return {
				msgNotify: `${config.notifyName} stopped market making & order book building for ${config.pair} pair.`,
				msgSendBack: `Market making & order book building for ${config.pair} pair is disabled now.`,
				notifyType: 'log'
			}
		} else {
			tradeParams.mm_isActive = false;
			return {
				msgNotify: '',
				msgSendBack: `Market making for ${config.pair} pair is disabled already.`,
				notifyType: 'log'
			} 
		}
	}
}

function enable(params) {
	const type = (params[0] || '').trim();
	if (!type || !type.length || !["ob"].includes(type)) {
        return {
            msgNotify: '',
            msgSendBack: `Indicate option, _ob_ for order book building. Example: */enable ob 15*.`,
            notifyType: 'log'
		} 
	}
	const value = +params[1];
	if (type === "ob") {
		tradeParams.mm_isOrderBookActive = true;
		if (value && value != Infinity)
			tradeParams.mm_orderBookOrdersCount = value;
		else if (!value.length && !tradeParams.mm_orderBookOrdersCount)
			value = 15; // default for mm_orderBookOrdersCount
		let msgNotify, msgSendBack;
		if (tradeParams.mm_isActive) {
			msgNotify = `${config.notifyName} enabled order book building for ${config.pair} pair with ${tradeParams.mm_orderBookOrdersCount} maximum number of orders.`;
			msgSendBack = `Order book building is enabled for ${config.pair} pair with ${tradeParams.mm_orderBookOrdersCount} maximum number of orders.`;
		} else {
			msgNotify = `${config.notifyName} enabled order book building for ${config.pair} pair with ${tradeParams.mm_orderBookOrdersCount} maximum number of orders. Market making and order book building are not started yet.`;
			msgSendBack = `Order book building is enabled for ${config.pair} pair with ${tradeParams.mm_orderBookOrdersCount} maximum number of orders. To start market making and order book building, type */start mm*.`;
		}
		return {
			msgNotify,
			msgSendBack,
			notifyType: 'log'
		}
	}
}

function disable(params) {
	const type = (params[0] || '').trim();
	if (!type || !type.length || !["ob"].includes(type)) {
        return {
            msgNotify: '',
            msgSendBack: `Indicate option, _ob_ for order book building. Example: */disable ob*.`,
            notifyType: 'log'
		} 
	}
	if (type === "ob") {
		tradeParams.mm_isOrderBookActive = false;
		let msgNotify, msgSendBack;
		if (tradeParams.mm_isActive) {
			msgNotify = `${config.notifyName} disable order book building for ${config.pair} pair. Market making is still active.`;
			msgSendBack = `Order book building is disabled for ${config.pair}. Market making is still active. To stop market making, type */stop mm*. To close current ob-orders, type */clear ob*.`;
		} else {
			msgNotify = `${config.notifyName} disabled order book building for ${config.pair}.`;
			msgSendBack = `Order book building is disabled for ${config.pair}.`;
		}
		return {
			msgNotify,
			msgSendBack,
			notifyType: 'log'
		}
	}
}

function buypercent(param) {
	const val = +((param[0] || '').trim());
	if (!val || val === Infinity || val < 0 || val > 100) {
        return {
            msgNotify: '',
            msgSendBack: `Invalid percentage of buy orders. Example: */buyPercent 85*.`,
            notifyType: 'log'
		} 
	}

	tradeParams.mm_buyPercent = val / 100;
	return {
		msgNotify: `${config.notifyName} is set to make market with ${val}% of buy orders for ${config.pair} pair.`,
		msgSendBack: `Set to make market with ${val}% of buy orders for ${config.pair} pair.`,
		notifyType: 'log'
	}
}

function amount(param) {
	const val = (param[0] || '').trim();
	if (!val || !val.length || (val.indexOf('-') === -1)) {
        return {
            msgNotify: '',
            msgSendBack: `Invalid values for market making of ${config.pair}. Example: */amount 0.01-20*.`,
            notifyType: 'log'
		} 
	}
	const [minStr, maxStr] = val.split('-');
	const min = +minStr;
	const max = +maxStr;
	if (!min || min === Infinity || !max || max === Infinity){
        return {
            msgNotify: '',
            msgSendBack: `Invalid values for market making of ${config.pair}. Example: */amount 0.01-20*.`,
            notifyType: 'log'
		} 
	}
	tradeParams.mm_minAmount = min;
	tradeParams.mm_maxAmount = max;
	return {
		msgNotify: `${config.notifyName} is set to make market with amounts from ${min} to ${max} ${config.coin1} for ${config.pair} pair.`,
		msgSendBack: `Set to make market with amounts from ${min} to ${max} ${config.coin1} for ${config.pair} pair.`,
		notifyType: 'log'
	}
}

function interval(param) {
	const val = (param[0] || '').trim();
	if (!val || !val.length || (val.indexOf('-') === -1)) {
        return {
            msgNotify: '',
            msgSendBack: `Invalid intervals for market making of ${config.pair}. Example: */interval 1-5 min*.`,
            notifyType: 'log'
		} 
	}

	let time = (param[1] || '').trim();
	let multiplier;

	switch (time) {
		case 'sec':
			multiplier = 1000;
			break;
		case 'min':
			multiplier = 1000*60;
			break;
		case 'hour':
			multiplier = 1000*60*60;
			break;
		default:
			multiplier = 1000*60;
			time = 'min';
	}

	const [minStr, maxStr] = val.split('-');
	const min = +minStr;
	const max = +maxStr;
	if (!min || min === Infinity || !max || max === Infinity) {
        return {
            msgNotify: '',
            msgSendBack: `Invalid intervals for market making of ${config.pair}. Example: */interval 1-5 min*.`,
            notifyType: 'log'
		} 
	}
	tradeParams.mm_minInterval = min * multiplier;
	tradeParams.mm_maxInterval = max * multiplier;
	return {
		msgNotify: `${config.notifyName} is set to make market in intervals from ${min} to ${max} ${time} for ${config.pair} pair.`,
		msgSendBack: `Set to make market in intervals from ${min} to ${max} ${time} for ${config.pair} pair.`,
		notifyType: 'log'
	}
}

async function clear(params) {

	param = params[0];
	if (!param || param.indexOf('/') === -1) {
		param = config.pair;
	}
	let coin = (param || '').toUpperCase().trim();
	let output = '';
	let pair;
	if (coin.indexOf('/') > -1) {
		pair = coin;
		coin = coin.substr(0, coin.indexOf('/')); 
	}

	if (!pair || !pair.length) {
		output = 'Please specify market to clear orders in. F. e., */clear DOGE/BTC*.';
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}	
	}

	let purposes;
	let count = 0;
	let purposeString;
	params.forEach(param => {
		if (['all'].includes(param)) {
			purposes = ['mm', 'tb', 'ob'];
		}
		if (['tb'].includes(param)) {
			purposes = ['tb'];
			purposeString = `trade bot`;
		}
		if (['ob'].includes(param)) {
			purposes = ['ob'];
			purposeString = `order book`;
		}
	});
	if (!purposes) {
		purposes = ['mm'];
		purposeString = `market making`;
	}

	// console.log(purposes, count, output);
	count = await orderCollector(purposes, pair);
	if (purposeString) {
		if (count > 0) {
			output = `Clearing ${count} **${purposeString}** orders for ${pair} pair on ${config.exchangeName}..`;
		} else {
			output = `No open **${purposeString}** orders on ${config.exchangeName} for ${pair}.`;
		}	
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}	
	}
	
	if (pair) {
		const openOrders = await traderapi.getOpenOrders(pair);
		if (openOrders) {
			if ((count + openOrders.length) > 0) {
				output = `Clearing **all** ${count + openOrders.length} orders for ${pair} pair on ${config.exchangeName}..`;
				openOrders.forEach(order => {
					traderapi.cancelOrder(order.orderid, order.side, order.symbol);
				});
			} else {
				output = `No open orders on ${config.exchangeName} for ${pair}.`;
			}
		} else {
			output = `Unable to get ${config.exchangeName} orders for ${pair}.`;
		}
	}

	return {
		msgNotify: ``,
		msgSendBack: `${output}`,
		notifyType: 'log'
	}

}

// function $u.getPairObj(param, letCoin1only = false) {

// 	let pair = (param || '').toUpperCase().trim();
// 	let coin1Decimals = 8;
// 	let coin2Decimals = 8;
// 	let isPairFromParam = true;
// 	let coin1, coin2;

// 	if (!pair || pair.indexOf('/') === -1 || pair === config.pair) { // Set default pair
// 		if (pair != config.pair)
// 			isPairFromParam = false;
// 		if ((pair.indexOf('/') === -1) && letCoin1only) { // Not a pair, may be a coin only
// 			coin1 = pair;
// 			if (coin1 === config.coin1)
// 				coin1Decimals = config.coin1Decimals;		
// 			pair = null;
// 			coin2 = null;
// 		} else { // A pair
// 			pair = config.pair;
// 			coin1Decimals = config.coin1Decimals;
// 			coin2Decimals = config.coin2Decimals;
// 		}
// 	}

// 	if (pair) {
// 		coin1 = pair.substr(0, pair.indexOf('/')); 
// 		coin2 = pair.substr(pair.indexOf('/') + 1, pair.length);
// 	}

// 	return {
// 		pair,
// 		coin1,
// 		coin2,
// 		coin1Decimals,
// 		coin2Decimals,
// 		isPairFromParam
// 	}
// }

async function fill(params) {

	// default: low=bid, count=5, pair=ADM/BTC
	// fill ADM/BTC buy amount=0.00002000 low=0.00000102 high=0.00000132 count=7 

	// default: high=ask, count=5, ADM/BTC
	// fill ADM/BTC sell amount=300 low=0.00000224 high=0.00000380 count=7

	let count, amount, low, high;
	params.forEach(param => {
		try {
			if (param.startsWith('count')) {
				count = +param.split('=')[1].trim();
			}
			if (param.startsWith('amount')) {
				amount = +param.split('=')[1].trim();
			}
			if (param.startsWith('low')) {
				low = +param.split('=')[1].trim();
			}
			if (param.startsWith('high')) {
				high = +param.split('=')[1].trim();
			}
		} catch (e) {
			return {
				msgNotify: ``,
				msgSendBack: 'Wrong arguments. Command works like this: */fill ADM/BTC buy amount=0.00002000 low=0.00000100 high=0.00000132 count=7*.',
				notifyType: 'log'
			}	
		}
	});

	if (params.length < 3) {
		return {
			msgNotify: ``,
			msgSendBack: 'Wrong arguments. Command works like this: */fill ADM/BTC buy amount=0.00002000 low=0.00000100 high=0.00000132 count=7*.',
			notifyType: 'log'
		}
	}

	let output = '';
	let type;
	const pairObj = $u.getPairObj(params[0]);
	const pair = pairObj.pair;
	const coin1 = pairObj.coin1;
	const coin2 = pairObj.coin2;
	const coin1Decimals =  pairObj.coin1Decimals;
	const coin2Decimals =  pairObj.coin2Decimals;
	if (pairObj.isPairFromParam) {
		type = params[1].trim();
	} else {
		type = params[0].trim();
	}

	if (!pair || !pair.length) {
		output = 'Please specify market to fill orders in.';
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}	
	}

	if (!count || count === Infinity || count < 1)
		count = 5; // default

	if (!high || high === Infinity || !low || low === Infinity) {
		const exchangeRates = await traderapi.getRates(pair);
		if (exchangeRates) {
			if (!low || low === Infinity)
				low = exchangeRates.bid;
			if (!high || high === Infinity)
				high = exchangeRates.ask;
		} else {
			output = `Unable to get ${config.exchangeName} rates for ${pair} to fill orders.`;
			return {
				msgNotify: ``,
				msgSendBack: `${output}`,
				notifyType: 'log'
			}	
		}
	}

	// console.log(pair, type, count, amount, low, high);

	if (low > high) {
		output = `To fill orders _high_ should be greater than _low_.`;
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}
	}

	const balances = await traderapi.getBalances(false);
	let balance;
	let isBalanceEnough = true;
	if (balances) {
		try {
			if (type === 'buy') {
				balance = balances.filter(crypto => crypto.code === coin2)[0].free;
				output = `Not enough ${coin2} to fill orders. Check balances.`;
			} else {
				balance = balances.filter(crypto => crypto.code === coin1)[0].free; 
				output = `Not enough ${coin1} to fill orders. Check balances.`;
			}
			isBalanceEnough = balance >= amount;
		} catch (e) {
			output = `Unable to process balances. Check parameters.`;
			return {
				msgNotify: ``,
				msgSendBack: `${output}`,
				notifyType: 'log'
			}	
		}
	} else {
		output = `Unable to get ${config.exchangeName} balances. Try again.`;
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}
	}

	if (!isBalanceEnough) {
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}
	}

	// Make order list
	let orderList = [];
	const delta = high - low;
	const step = delta / count;
	const orderAmount = amount / count;
	const deviation = 0.9;

	let price = low;
	let total = 0, coin1Amount = 0, coin2Amount = 0;
	for (let i=0; i < count; i++) {
		price += $u.randomDeviation(step, deviation);
		coin1Amount = $u.randomDeviation(orderAmount, deviation);
		total += coin1Amount;

		// Checks if total or price exceeded
		if (total > amount) {
			if (count === 1)
				coin1Amount = amount
			else
				break;
		}
		if (price > high) {
			if (count === 1)
				price = high
			else
				break;
		}

		// Count base and quote currency amounts
		if (type === 'buy') {
			coin2Amount = coin1Amount;
			coin1Amount = coin1Amount / price;
		} else {
			coin1Amount = coin1Amount;
			coin2Amount = coin1Amount * price;
		}
		// console.log(price, coin1Amount, total);
		orderList.push({
			price: price,
			amount: coin1Amount,
			altAmount: coin2Amount
		});
	}

	// console.log(orderList, orderList.length);

	// Place orders
	let total1 = 0, total2 = 0;
	items = 0;
	let id;
	for (i=0; i < orderList.length; i++) {
		id = (await traderapi.placeOrder(type, pair, orderList[i].price, orderList[i].amount, 1, null, pairObj)).orderid;
		if (id) {
			items += 1;
			total1 += +orderList[i].amount;
			total2 += +orderList[i].altAmount;
		}
	}

	if (items > 0)
		output = `${items} orders to ${type} ${$u.thousandSeparator(+total1.toFixed(coin1Decimals), false)} ${coin1} for ${$u.thousandSeparator(+total2.toFixed(coin2Decimals), false)} ${coin2}.`;
	else
		output = `No orders were placed. Check log file for details.`;

	return {
		msgNotify: items > 0 ? `${config.notifyName} placed ${output}` : '',
		msgSendBack: items > 0 ? `Placed ${output}` : output,
		notifyType: 'log'
	}

}

async function buy(params) {

	let result = getBuySellParams(params, 'buy');
	return await buy_sell(result, 'buy');

}

async function sell(params) {

	let result = getBuySellParams(params, 'sell');
	return await buy_sell(result, 'sell');

}

function getBuySellParams(params, type) {

	// default: pair={config} BaseCurrency/QuoteCurrency, price=market
	// amount XOR quote
	// buy ADM/BTC amount=200 price=0.00000224 — buy 200 ADM at 0.00000224
	// sell ADM/BTC amount=200 price=0.00000224 — sell 200 ADM at 0.00000224
	// buy ADM/BTC quote=0.01 price=0.00000224 — buy ADM for 0.01 BTC at 0.00000224
	// sell ADM/BTC quote=0.01 price=0.00000224 — sell ADM to get 0.01 BTC at 0.00000224

	// when Market order, buy should follow quote, sell — amount
	// buy ADM/BTC quote=0.01 — buy ADM for 0.01 BTC at market price
	// buy ADM/BTC quote=0.01 price=market — the same
	// buy ADM/BTC quote=0.01 — buy ADM for 0.01 BTC at market price
	// sell ADM/BTC amount=8 — sell 8 ADM at market price

	let amount, quote, price = 'market';
	params.forEach(param => {
		try {
			if (param.startsWith('quote')) {
				quote = +param.split('=')[1].trim();
			}
			if (param.startsWith('amount')) {
				amount = +param.split('=')[1].trim();
			}
			if (param.startsWith('price')) {
				price = param.split('=')[1].trim();
				if (price.toLowerCase() === 'market')
					price = 'market'
				else
					price = +price;
			}
		} catch (e) {
			return {
				msgNotify: ``,
				msgSendBack: 'Wrong arguments. Command works like this: */sell ADM/BTC amount=200 price=market*.',
				notifyType: 'log'
			}	
		}
	});

	if (params.length < 1) {
		return {
			msgNotify: ``,
			msgSendBack: 'Wrong arguments. Command works like this: */sell ADM/BTC amount=200 price=market*.',
			notifyType: 'log'
		}
	}

	if ((quote && amount) || (!quote && !amount)) {
		return {
			msgNotify: ``,
			msgSendBack: 'You should specify amount _or_ quote, and not both of them.',
			notifyType: 'log'
		}
	}

	let amountOrQuote = quote || amount;

	let output = '';
	if (((!price || price === Infinity || price <= 0) && (price != 'market')) || (!amountOrQuote || amountOrQuote === Infinity || amountOrQuote <= 0)) {
		output = `Incorrect params: ${amountOrQuote}, ${price}. Command works like this: */sell ADM/BTC amount=200 price=market*.`;
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}	
	}

	// when Market order, buy should pass quote parameter, when sell — amount
	const allowBuyAmountExchanges = ['resfinex', 'atomars'];
	if (price === 'market' && !allowBuyAmountExchanges.includes(config.exchange)) {
		if ((type === 'buy' && !quote) || ((type === 'sell' && !amount))) {
			output = `When placing Market order, buy should follow with _quote_, sell with _amount_. Command works like this: */sell ADM/BTC amount=200 price=market*.`;
			return {
				msgNotify: ``,
				msgSendBack: `${output}`,
				notifyType: 'log'
			}	
		}
	}

	const amountNecessaryExchanges = ['resfinex', 'atomars'];
	if (price === 'market' && amountNecessaryExchanges.includes(config.exchange)) {
		if (!amount) {
			output = `When placing Market order on ${config.exchangeName}, _amount_ is necessary. Command works like this: */sell ADM/BTC amount=200 price=market*.`;
			return {
				msgNotify: ``,
				msgSendBack: `${output}`,
				notifyType: 'log'
			}	
		}
	}

	const pairObj = $u.getPairObj(params[0]);
	const pair = pairObj.pair;
	const coin1 = pairObj.coin1;
	const coin2 = pairObj.coin2;
	const coin1Decimals =  pairObj.coin1Decimals;
	const coin2Decimals =  pairObj.coin2Decimals;

	if (!pair || !pair.length) {
		output = 'Please specify market to make an order.';
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}	
	}

	return {
		amount,
		price, 
		quote,
		pair,
		coin1,
		coin2,
		coin1Decimals,
		coin2Decimals,
		pairObj
	}	

}

async function buy_sell(params, type) {

	if (params.msgSendBack)
		return params;

	if (!params.amount) {
		params.amount = params.quote / params.price;
	} else {
		params.quote = params.amount * params.price;
	}

	let result;
	if (params.price === 'market') {
		result = await traderapi.placeOrder(type, params.pair, null, params.amount, 0, params.quote, params.pairObj);
	} else {
		result = await traderapi.placeOrder(type, params.pair, params.price, params.amount, 1, params.quote, params.pairObj);
	}

	return {
		msgNotify: `${config.notifyName}: ${result.message}`,
		msgSendBack: result.message,
		notifyType: 'log'
	}

}

function params() {

	// console.log(tradeParams);
	let output = `I am set to work with ${config.pair} pair on ${config.exchangeName}. Current trading settings:`;
	output += "\n\n" + JSON.stringify(tradeParams, null, 3);;

return {
	msgNotify: ``,
	msgSendBack: `${output}`,
	notifyType: 'log'
}

}

function help() {

	let output = `I am **online** and ready to trade. I can do trading and market making, and also can give you market info.`;

	output += `

Commands:

**/rates**: Find out the market price of the coin and/or the ask and bid prices on the exchange for the trading pair. F. e., */rates ADM* or */rates ADM/BTC*.

**/stats**: Show information on the trading pair on the exchange. Prices, trading volumes and market making stats. Like */stats* or */stats ETH/BTC*.

**/orders**: Display the number of active orders for the trading pair. Example: */orders ADM/BTC*.

**/calc**: Calculate the price of one cryptocurrency in another at the market price and at the exchange prices. Works like this: */calc 2.05 BTC in USDT*.

**/balances**: Display your balances on the exchange

**/start**: Start trading (td) or market making (mm). F. e., /*start mm*.

**/stop**: Stop trading (td) or market making (mm). F. e., /*stop mm*.

**/amount**: Set the amount range for market making orders. Example: */amount 0.1-20*.

**/interval**: Set the frequency in [sec, *min*, hour] of transactions for market making. Example: */interval 1-5 min*.

**/buyPercent**: Set the percentage of buy orders for market making. Try */buyPercent 85*.

**/fill**: Fill sell or buy order book. Works like this: */fill ADM/BTC buy amount=0.00200000 low=0.00000050 high=0.00000182 count=7*.

**/buy** and **/sell**: Place a limit or market order. If _price_ is not specified, market order placed. Examples: */buy ADM/BTC amount=200 price=0.00000224* — buy 200 ADM at 0.00000224 BTC. */sell ADM/BTC quote=0.01 price=0.00000224* — sell ADM to get 0.01 BTC at 0.00000224 BTC. */sell ADM/BTC amount=200* — sell 200 ADM at market price.

**/clear**: Cancel [*mm*, td, all] active orders. F. e., */clear ETH/BTC all* or just */clear* for mm-orders of default pair.

**/params**: Show current trading settings

**/version**: Show bot’s software version

Happy trading!
`;

return {
	msgNotify: ``,
	msgSendBack: `${output}`,
	notifyType: 'log'
}

}

async function rates(params) {

	let output = '';

	const pairObj = $u.getPairObj(params[0], true);
	const pair = pairObj.pair;
	const coin1 = pairObj.coin1;
	const coin2 = pairObj.coin2;
	const coin1Decimals =  pairObj.coin1Decimals;
	const coin2Decimals =  pairObj.coin2Decimals;

	if (!coin1 || !coin1.length) {
		output = 'Please specify coin ticker or specific market you are interested in. F. e., */rates ADM* or */rates ETH/BTC*.';
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}	
	}
	const currencies = Store.currencies;
	const res = Object
		.keys(Store.currencies)
		.filter(t => t.startsWith(coin1 + '/'))
		.map(t => {
			let p = `${coin1}/**${t.replace(coin1 + '/', '')}**`;
			return `${p}: ${currencies[t]}`;
		})
		.join(', ');

	if (!res.length) {
		if (!pair) {
			output = `I can’t get rates for *${coin1}*. Made a typo? Try */rates ADM*.`;
			return {
				msgNotify: ``,
				msgSendBack: `${output}`,
				notifyType: 'log'
			}
		}
	} else {
		output = `Global market rates for ${coin1}:
${res}.`;
	}

	if (pair) {
		const exchangeRates = await traderapi.getRates(pair);
		if (output)
			output += "\n\n";
		if (exchangeRates) {
			output += `${config.exchangeName} rates for ${pair} pair:
Ask: ${exchangeRates.ask.toFixed(coin2Decimals)}, bid: ${exchangeRates.bid.toFixed(coin2Decimals)}.`;
		} else {
			output += `Unable to get ${config.exchangeName} rates for ${pair}.`;
		}
	}

	return {
		msgNotify: ``,
		msgSendBack: `${output}`,
		notifyType: 'log'
	}

}

async function stats(params) {

	let output = '';

	const pairObj = $u.getPairObj(params[0]);
	const pair = pairObj.pair;
	const coin1 = pairObj.coin1;
	const coin2 = pairObj.coin2;
	const coin1Decimals =  pairObj.coin1Decimals;
	const coin2Decimals =  pairObj.coin2Decimals;

	if (!pair || !pair.length) {
		output = 'Please specify market you are interested in. F. e., */stats ETH/BTC*.';
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}	
	}

	if (pair) {
		const exchangeRates = await traderapi.getRates(pair);
		if (exchangeRates) {
			let volume_Coin2 = '';
			if (exchangeRates.volume_Coin2) {
				volume_Coin2 = ` & ${$u.thousandSeparator(+exchangeRates.volume_Coin2.toFixed(coin2Decimals), true)} ${coin2}`;
			}
			output += `${config.exchangeName} 24h stats for ${pair} pair:
Vol: ${$u.thousandSeparator(+exchangeRates.volume.toFixed(coin1Decimals), true)} ${coin1}${volume_Coin2}. High: ${exchangeRates.high.toFixed(coin2Decimals)}, low: ${exchangeRates.low.toFixed(coin2Decimals)}, delta: _${(exchangeRates.high-exchangeRates.low).toFixed(coin2Decimals)}_ ${coin2}.
Ask: ${exchangeRates.ask.toFixed(coin2Decimals)}, bid: ${exchangeRates.bid.toFixed(coin2Decimals)}, spread: _${(exchangeRates.ask-exchangeRates.bid).toFixed(coin2Decimals)}_ ${coin2}.`;
		} else {
			output += `Unable to get ${config.exchangeName} stats for ${pair}.`;
		}
	}

	let orderStats = await getStats(true, true, false, "mm", pair);

	if (orderStats) {
		if (orderStats === 'Empty' || orderStats.coin1AmountTotalAllCount === 0) {
			output += "\n\n" + `There were no Market making orders for ${pair} all time.`
		} else {
			output += "\n\n" + `Market making stats for ${pair} pair:` + "\n";
			if (orderStats.coin1AmountTotalDayCount != 0) {
				output += `24h: ${orderStats.coin1AmountTotalDayCount} orders with ${$u.thousandSeparator(+orderStats.coin1AmountTotalDay.toFixed(coin1Decimals), true)} ${coin1} and ${$u.thousandSeparator(+orderStats.coin2AmountTotalDay.toFixed(coin2Decimals), true)} ${coin2}`
			} else {
				output += `24h: no orders`;
			}
			if (orderStats.coin1AmountTotalMonthCount > orderStats.coin1AmountTotalDayCount) {
				output += `, 30d: ${orderStats.coin1AmountTotalMonthCount} orders with ${$u.thousandSeparator(+orderStats.coin1AmountTotalMonth.toFixed(coin1Decimals), true)} ${coin1} and ${$u.thousandSeparator(+orderStats.coin2AmountTotalMonth.toFixed(coin2Decimals), true)} ${coin2}`
			} else if (orderStats.coin1AmountTotalMonthCount === 0) {
				output += `30d: no orders`;
			}
			if (orderStats.coin1AmountTotalAllCount > orderStats.coin1AmountTotalMonthCount) {
				output += `, all time: ${orderStats.coin1AmountTotalAllCount} orders with ${$u.thousandSeparator(+orderStats.coin1AmountTotalAll.toFixed(coin1Decimals), true)} ${coin1} and ${$u.thousandSeparator(+orderStats.coin2AmountTotalAll.toFixed(coin2Decimals), true)} ${coin2}`
			}
			output += '.';
		}
	} else {
		output += "\n\n" + `Unable to get Market making stats for ${pair}.`;
	}

	return {
		msgNotify: ``,
		msgSendBack: `${output}`,
		notifyType: 'log'
	}

}

async function orders(params) {

	let output = '';

	const pairObj = $u.getPairObj(params[0]);
	const pair = pairObj.pair;
	const coin1 = pairObj.coin1;
	const coin2 = pairObj.coin2;
	const coin1Decimals =  pairObj.coin1Decimals;
	const coin2Decimals =  pairObj.coin2Decimals;

	if (!pair || !pair.length) {
		output = 'Please specify market you are interested in. F. e., */orders ADM/BTC*.';
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}	
	}

	if (pair) {
		const openOrders = await traderapi.getOpenOrders(pair);
		// console.log(openOrders);
		if (openOrders) {
			if (openOrders.length > 0)
				output = `${config.exchangeName} open orders for ${pair} pair: ${openOrders.length}.`;
			else 
				output = `No open orders on ${config.exchangeName} for ${pair}.`;
		} else {
			output = `Unable to get ${config.exchangeName} orders for ${pair}.`;
		}
	}

	return {
		msgNotify: ``,
		msgSendBack: `${output}`,
		notifyType: 'log'
	}

}

async function calc(arr) {

	if (arr.length !== 4) {
		return {
			msgNotify: ``,
			msgSendBack: 'Wrong arguments. Command works like this: */calc 2.05 BTC in USDT*.',
			notifyType: 'log'
		}
	}

	let output = '';
	const amount = +arr[0];
	const inCurrency = arr[1].toUpperCase().trim();
	const outCurrency = arr[3].toUpperCase().trim();
	let pair = inCurrency + '/' + outCurrency;
	let pair2 = outCurrency + '/' + inCurrency;

	if (!amount || amount === Infinity) {
		output = `It seems amount "*${amount}*" for *${inCurrency}* is not a number. Command works like this: */calc 2.05 BTC in USDT*.`;
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}
	}
	if (!$u.isHasTicker(inCurrency)) {
		output = `I don’t have rates of crypto *${inCurrency}* from Infoservice. Made a typo? Try */calc 2.05 BTC in USDT*.`;
	}
	if (!$u.isHasTicker(outCurrency)) {
		output = `I don’t have rates of crypto *${outCurrency}* from Infoservice. Made a typo? Try */calc 2.05 BTC in USDT*.`;
	}

	let result;
	if (!output) {
		result = Store.mathEqual(inCurrency, outCurrency, amount, true).outAmount;
		if (amount <= 0 || result <= 0 || !result) {
			output = `I didn’t understand amount for *${inCurrency}*. Command works like this: */calc 2.05 BTC in USDT*.`;
			return {
				msgNotify: ``,
				msgSendBack: `${output}`,
				notifyType: 'log'
			}
		}
		if ($u.isFiat(outCurrency)) {
			result = +result.toFixed(2);
		}
		output = `Global market value of ${$u.thousandSeparator(amount)} ${inCurrency} equals **${$u.thousandSeparator(result)} ${outCurrency}**.`;
	} else {
		output = '';
	}

	if (output)
		output += "\n\n";
	let askValue, bidValue;

	let exchangeRates = await traderapi.getRates(pair);
	if (exchangeRates) {
		askValue = exchangeRates.ask * amount;
		bidValue = exchangeRates.bid * amount;
		output += `${config.exchangeName} value of ${$u.thousandSeparator(amount)} ${inCurrency}:
Ask: **${$u.thousandSeparator(askValue.toFixed(8))} ${outCurrency}**, bid: **${$u.thousandSeparator(bidValue.toFixed(8))} ${outCurrency}**.`;
	} else {
		exchangeRates = await traderapi.getRates(pair2);
		if (exchangeRates) {
			askValue = amount / exchangeRates.ask;
			bidValue = amount / exchangeRates.bid;
			output += `${config.exchangeName} value of ${$u.thousandSeparator(amount)} ${inCurrency}:
	Ask: **${$u.thousandSeparator(askValue.toFixed(8))} ${outCurrency}**, bid: **${$u.thousandSeparator(bidValue.toFixed(8))} ${outCurrency}**.`;
		} else {
			output += `Unable to get ${config.exchangeName} rates for ${pair}.`;
		}
	}

	return {
		msgNotify: ``,
		msgSendBack: `${output}`,
		notifyType: 'log'
	}

}

async function balances() {
	const balances = await traderapi.getBalances();
	let output = '';

	if (balances.length === 0) {
		output = `All empty.`;
	} else {
		balances.forEach(crypto => {
			output += `${$u.thousandSeparator(+crypto.free.toFixed(8), true)} _${crypto.code}_`;
			if (+crypto.freezed > 0) {
				output += ` & ${$u.thousandSeparator(+crypto.freezed.toFixed(8), true)} freezed`;
			}
			output += "\n";
		});
	}

	return {
		msgNotify: ``,
		msgSendBack: `${config.exchangeName} balances:
${output}`,
		notifyType: 'log'
	}

}

function version() {
	return {
		msgNotify: ``,
		msgSendBack: `I am running on _adamant-tradebot_ software version _${Store.version}_. Revise code on ADAMANT's GitHub.`,
		notifyType: 'log'
	}
}

function saveConfig() { 
    const str = "module.exports = " + JSON.stringify(tradeParams, null, 3);
	fs.writeFileSync('./trade/tradeParams_' + config.exchange + '.js', str)
}

const commands = {
	help,
	rates,
	stats,
	orders,
	calc,
	balances,
	version,
	start,
	stop,
	buypercent,
	amount,
	interval,
    clear,
	fill,
	params,
	buy,
	sell,
	enable,
	disable
}