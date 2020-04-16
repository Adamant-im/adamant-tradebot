const $u = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./tradeParams_' + config.exchange);
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');
const orderCollector = require('./orderCollector');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;
const hour = 1000 * 60 * 60;

module.exports = {
	run() {
        this.iteration();
    },
    iteration() {
        let interval = setPause();
        // console.log(interval);
        if (interval && tradeParams.mm_isActive) {
            this.executeMmOrder();
            setTimeout(() => {this.iteration()}, interval);
        } else {
            setTimeout(() => {this.iteration()}, 3000); // Check for config.mm_isActive every 3 seconds
        }
    },
	async executeMmOrder() {
        const type = setType();
        const priceReq = await setPrice(type, config.pair);
        const price = priceReq.price;
        const coin1Amount = setAmount();
        const coin2Amount = coin1Amount * price;
        let order1, order2;
        let output = '';
        let orderParamsString = '';
        const pairObj = $u.getPairObj(config.pair);

        if (!price) {
            if ((Date.now()-lastNotifyPriceTimestamp > hour) && priceReq.message) {
                notify(priceReq.message, 'warn');
                lastNotifyPriceTimestamp = Date.now();
            }
            return;
        }

        orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
        if (!type || !price || !coin1Amount || !coin2Amount) {
            notify(`${config.notifyName} unable to run mm-order with params: ${orderParamsString}.`, 'warn');
            return;
        }

        // console.log(type, price.toFixed(8), coin1Amount.toFixed(0), coin2Amount.toFixed(0));

        // Check balances
        const balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount);
        if (!balances.result) {
            if ((Date.now()-lastNotifyBalancesTimestamp > hour) && balances.message) {
                notify(balances.message, 'warn');
                lastNotifyBalancesTimestamp = Date.now();
            }
            return;
        }

        order1 = (await traderapi.placeOrder(crossType(type), config.pair, price, coin1Amount, 1, null, pairObj)).orderid;
        if (order1) {
            const {ordersDb} = db;
            const order = new ordersDb({
                _id: order1,
                crossOrderId: null,
                date: $u.unix(),
                purpose: 'mm', // Market making
                type: crossType(type),
                targetType: type,
                exchange: config.exchange,
                pair: config.pair,
                coin1: config.coin1,
                coin2: config.coin2,
                price: price,
                coin1Amount: coin1Amount,
                coin2Amount: coin2Amount,
                LimitOrMarket: 1,  // 1 for limit price. 0 for Market price.
                isProcessed: false,
                isExecuted: false,
                isCancelled: false
            });
            // await order.save();
            order2 = (await traderapi.placeOrder(type, config.pair, price, coin1Amount, 1, null, pairObj)).orderid;
            if (order2) {
                output = `${type} ${coin1Amount.toFixed(config.coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(config.coin2Decimals)} ${config.coin2}`;
                log.info(`Successfully executed mm-order to ${output}.`);
                order.update({
                    isProcessed: true,
                    isExecuted: true,
                    crossOrderId: order2
                });
                await order.save();
            } else {
                await order.save();
                notify(`${config.notifyName} unable to execute cross-order for mm-order with params: id=${order1}, ${orderParamsString}. Check balances. Running order collector now.`, 'warn');
                orderCollector(['mm'], config.pair);
            }         
        } else { // if order1
            console.warn(`${config.notifyName} unable to execute mm-order with params: ${orderParamsString}. No order id returned.`);
        }

	},
};

function setType() {
    if (!tradeParams || !tradeParams.mm_buyPercent) {
        log.warn(`Param mm_buyPercent is not set. Check ${config.exchangeName} config.`);
        return false;
    }
    let type = 'buy';
    if (Math.random() > tradeParams.mm_buyPercent)
        type = 'sell';
	return type;
}

async function isEnoughCoins(coin1, coin2, amount1, amount2) {
	const balances = await traderapi.getBalances(false);
    let balance1, balance2;
    let isBalanceEnough = true;
    let output = '';

    if (balances) {
		try {
            balance1 = balances.filter(crypto => crypto.code === coin1)[0].free;
            balance2 = balances.filter(crypto => crypto.code === coin2)[0].free;


            if (!balance1 || balance1 < amount1) {
                output = `${config.notifyName}: Not enough ${coin1} for placing market making order. Check balances.`;
                isBalanceEnough = false;
            }
            if (!balance2 || balance2 < amount2) {
                output = `${config.notifyName}: Not enough ${coin2} for placing market making order. Check balances.`;
                isBalanceEnough = false;
            }

            // console.log(balance1.toFixed(0), amount1.toFixed(0), balance2.toFixed(8), amount2.toFixed(8));
            return {
                result: isBalanceEnough,
                message: output
            }

		} catch (e) {
            log.warn(`Unable to process balances for placing market making order.`);
            return {
                result: false
            }
        }
	} else {
        log.warn(`Unable to get balances for placing market making order.`);
        return {
            result: false
        }
    }
}

async function setPrice(type, pair) {

    const precision = Math.pow(10, -config.coin2Decimals).toFixed(config.coin2Decimals); // decimals
    const smallSpread = precision * 15; // if spread is small and should do market making less careful
    // console.log(precision, smallSpread);

    let output = '';
    let isCareful = true;
    if (tradeParams && (tradeParams.mm_isCareful != undefined)) {
        isCareful = tradeParams.mm_isCareful;
    }
    let allowNoSpread = false;
    if (tradeParams && (tradeParams.mm_allowNoSpread != undefined)) {
        allowNoSpread = tradeParams.mm_allowNoSpread;
    }

    let ask_high, bid_low;
    const exchangeRates = await traderapi.getRates(pair);
    if (exchangeRates) {
        bid_low = +exchangeRates.bid;
        ask_high = +exchangeRates.ask;
    } else {
        log.warn(`Unable to get current rates for ${pair} to set a price.`);
        return {
            price: false,
        }

    }

    const spread = ask_high - bid_low;
    if (spread <= precision * 2) {
        if (allowNoSpread) {
            return type === 'buy'? bid_low : ask_high;
        } else {
            output = `${config.notifyName}: No spread currently, and mm_allowNoSpread is disabled. Unable to set a price for ${pair}.`;
            return {
                price: false,
                message: output
            }
        }
    }
    
    let deltaPercent;
    const interval = ask_high - bid_low;
    // console.log(interval, smallSpread);
    if (isCareful) {
        if (interval > smallSpread) {
            // 1-25% of spread
            deltaPercent = Math.random() * (0.25 - 0.01) + 0.01;
        } else {
            // 5-35% of spread
            deltaPercent = Math.random() * (0.35 - 0.05) + 0.05;
        }
    } else {
        // 1-45% of spread
        deltaPercent = Math.random() * (0.45 - 0.01) + 0.01;
    }

    // console.log('2:', bid_low.toFixed(8), ask_high.toFixed(8), interval.toFixed(8), deltaPercent.toFixed(2));
    let price, from, to;
    if (type === 'buy') {
        // from = +bid_low;
        // to = bid_low + interval*deltaPercent;
        // price = Math.random() * (to - from) + +from;
        price = bid_low + interval*deltaPercent;
    } else {
        // from = ask_high - interval*deltaPercent;
        // to = +ask_high;
        // price = Math.random() * (to - from) + +from;
        price = ask_high - interval*deltaPercent;
    }

    const minPrice = +bid_low + +precision;
    const maxPrice = ask_high - precision;
    // price = 0.009618977658650832;
    // console.log('low, high', bid_low, ask_high);
    // console.log('min, max', minPrice, maxPrice);
    // console.log('price1', price);
    if (price >= maxPrice)
        price = ask_high - precision;
    if (price <= minPrice)
        price = +bid_low + +precision;
    // console.log('price2', price);

    return {
        price: price
    }

}

function setAmount() {
    if (!tradeParams || !tradeParams.mm_maxAmount || !tradeParams.mm_minAmount) {
        log.warn(`Params mm_maxAmount or mm_minAmount are not set. Check ${config.exchangeName} config.`);
        return false;
    }
    return Math.random() * (tradeParams.mm_maxAmount - tradeParams.mm_minAmount) + tradeParams.mm_minAmount;
}

function setPause() {
    if (!tradeParams || !tradeParams.mm_maxInterval || !tradeParams.mm_minInterval) {
        log.warn(`Params mm_maxInterval or mm_minInterval are not set. Check ${config.exchangeName} config.`);
        return false;
    }
    return Math.round(Math.random() * (tradeParams.mm_maxInterval - tradeParams.mm_minInterval)) + tradeParams.mm_minInterval;
}

function crossType(type) {
    if (type === 'buy')
        return 'sell'
    else
        return 'buy';
}
