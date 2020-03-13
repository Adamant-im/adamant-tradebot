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
			return {
				msgNotify: `${config.notifyName} set to start market making for ${config.pair}.`,
				msgSendBack: `Starting market making for ${config.pair} pair..`,
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
				msgNotify: `${config.notifyName} stopped market making for ${config.pair} pair.`,
				msgSendBack: `Market making for ${config.pair} pair is disabled now.`,
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
			purposes = ['mm', 'tb'];
		}
		if (['tb'].includes(param)) {
			purposes = ['tb'];
			purposeString = `trade bot`;
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

	let firstParam = 'pair';
	param = params[0];
	if (!param || param.indexOf('/') === -1) {
		firstParam = 'type';
		param = config.pair;
	}
	let coin = (param || '').toUpperCase().trim();
	let coin2 = '';
	let output = '';
	let pair;
	if (coin.indexOf('/') > -1) {
		pair = coin;
		coin = coin.substr(0, coin.indexOf('/')); 
		coin2 = pair.substr(pair.indexOf('/') + 1, coin.length);
	}

	if (!pair || !pair.length) {
		output = 'Please specify market to fill orders in.';
		return {
			msgNotify: ``,
			msgSendBack: `${output}`,
			notifyType: 'log'
		}	
	}

	let type;
	if (firstParam === 'type') {
		type = params[0];
	} else {
		type = params[1];
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

	const balances = await traderapi.getBalances();
	let balance;
	let isBalanceEnough = true;
	if (balances) {
		try {
			if (type === 'buy') {
				balance = balances.filter(crypto => crypto.code === coin2)[0].free;
				output = `Not enough ${coin2} to fill orders. Check balances.`;
			} else {
				balance = balances.filter(crypto => crypto.code === coin)[0].free; 
				output = `Not enough ${coin} to fill orders. Check balances.`;
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
		if (type === 'buy') {
			// console.log(price, coin1Amount, total);
			coin2Amount = coin1Amount;
			coin1Amount = coin1Amount / price;
		} else {
			coin1Amount = coin1Amount;
			coin2Amount = coin1Amount * price;
		}
		if (price > high || total > amount)
			break;
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
		id = await traderapi.placeOrder(type, pair, orderList[i].price, orderList[i].amount, 1);
		if (id) {
			items += 1;
			total1 += +orderList[i].amount;
			total2 += +orderList[i].altAmount;
		}
	}

	output = `${items} orders to ${type} ${$u.thousandSeparator(+total1.toFixed(8), false)} ${coin} for ${$u.thousandSeparator(+total2.toFixed(8), false)} ${coin2}.`;

	return {
		msgNotify: `${config.notifyName} placed ${output}`,
		msgSendBack: `Placed ${output}`,
		notifyType: 'log'
	}

}

/*
function buy_sell(params) {

	/buy 10 ADM at 0.00000123 on ADM/BTC
	/buy 10 ADM on ADM/BTC
	/buy ADM for 0.1 BTC on ADM/BTC

	/sell 10 ADM at 0.00000123 on ADM/BTC
	/sell 10 ADM on ADM/BTC
	/sell ADM for 0.1 BTC on ADM/BTC

}
*/

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

**/clear**: Cancel [*mm*, td, all] active orders. F. e., */clear ETH/BTC all* or just */clear* for mm-orders of default pair.

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

	param = params[0];
	if (!param) {
		param = config.pair;
	}
	let coin = (param || '').toUpperCase().trim();
	let output = '';
	let pair;
	if (coin.indexOf('/') > -1) {
		pair = coin;
		coin = coin.substr(0, coin.indexOf('/')); 
	}

	if (!coin || !coin.length) {
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
		.filter(t => t.startsWith(coin + '/'))
		.map(t => {
			let p = `${coin}/**${t.replace(coin + '/', '')}**`;
			return `${p}: ${currencies[t]}`;
		})
		.join(', ');

	if (!res.length) {
		if (!pair) {
			output = `I can’t get rates for *${coin}*. Made a typo? Try */rates ADM*.`;
			return {
				msgNotify: ``,
				msgSendBack: `${output}`,
				notifyType: 'log'
			}
		}
	} else {
		output = `Global market rates for ${coin}:
${res}.`;
	}

	if (pair) {
		const exchangeRates = await traderapi.getRates(pair);
		if (output)
			output += "\n\n";
		if (exchangeRates) {
			output += `${config.exchangeName} rates for ${pair} pair:
Ask: ${exchangeRates.ask.toFixed(8)}, bid: ${exchangeRates.bid.toFixed(8)}`;
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

	param = params[0];
	if (!param || param.indexOf('/') === -1) {
		param = config.pair;
	}
	let coin = (param || '').toUpperCase().trim();
	let coin2 = '';
	let output = '';
	let pair;
	if (coin.indexOf('/') > -1) {
		pair = coin;
		coin = pair.substr(0, pair.indexOf('/'));
		coin2 = pair.substr(pair.indexOf('/') + 1, coin.length);
	}

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
			output += `${config.exchangeName} 24h stats for ${pair} pair:
Vol: ${$u.thousandSeparator(+exchangeRates.volume, true)} ${coin}. High: ${exchangeRates.high.toFixed(8)}, low: ${exchangeRates.low.toFixed(8)}, delta: _${(exchangeRates.high-exchangeRates.low).toFixed(8)}_ ${coin2}.
Ask: ${exchangeRates.ask.toFixed(8)}, bid: ${exchangeRates.bid.toFixed(8)}, spread: _${(exchangeRates.ask-exchangeRates.bid).toFixed(8)}_ ${coin2}.`;
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
				output += `24h: ${orderStats.coin1AmountTotalDayCount} orders with ${$u.thousandSeparator(+orderStats.coin1AmountTotalDay.toFixed(0), true)} ${coin} and ${$u.thousandSeparator(+orderStats.coin2AmountTotalDay.toFixed(8), true)} ${coin2}`
			}
			if (orderStats.coin1AmountTotalMonthCount > orderStats.coin1AmountTotalDayCount) {
				output += `, 30d: ${orderStats.coin1AmountTotalMonthCount} orders with ${$u.thousandSeparator(+orderStats.coin1AmountTotalMonth.toFixed(0), true)} ${coin} and ${$u.thousandSeparator(+orderStats.coin2AmountTotalMonth.toFixed(8), true)} ${coin2}`
			}
			if (orderStats.coin1AmountTotalAllCount > orderStats.coin1AmountTotalMonthCount) {
				output += `, all time: ${orderStats.coin1AmountTotalAllCount} orders with ${$u.thousandSeparator(+orderStats.coin1AmountTotalAll.toFixed(0), true)} ${coin} and ${$u.thousandSeparator(+orderStats.coin2AmountTotalAll.toFixed(8), true)} ${coin2}`
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
    fill
}