const $u = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./tradeParams_' + config.exchange);
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;
const hour = 1000 * 60 * 60;
const INTERVAL_MIN = 1000;
const INTERVAL_MAX = 3000;
const LIFETIME_MIN = 1000;
const LIFETIME_MAX = 20000;

module.exports = {
	run() {
        this.iteration();
    },
    iteration() {
        let interval = setPause();
        // console.log(interval);
        if (interval && tradeParams.mm_isActive && tradeParams.mm_isOrderBookActive) {
            this.buildOrderBook();
            setTimeout(() => {this.iteration()}, interval);
        } else {
            setTimeout(() => {this.iteration()}, 3000); // Check for config.mm_isActive every 3 seconds
        }
    },
	async buildOrderBook() {
        const {ordersDb} = db;
        const orderBookOrdersCount = (await ordersDb.find({
            isProcessed: false,
            purpose: 'ob', // ob: dynamic order book order
            pair: config.pair,
            exchange: config.exchange
        })).length;

//        console.log(orderBookOrdersCount);
        if (orderBookOrdersCount < tradeParams.mm_orderBookOrdersCount)
            this.placeOrderBookOrder(orderBookOrdersCount);
    
        this.closeOrderBookOrders(orderBookOrdersCount);
    },
	async closeOrderBookOrders(orderBookOrdersCount) {
        const {ordersDb} = db;
        const ordersToClose = await ordersDb.find({
            isProcessed: false,
            purpose: 'ob', // ob: dynamic order book order
            pair: config.pair,
            exchange: config.exchange,
            dateTill: {$lt: $u.unix()}
        });
        orderBookOrdersCount-= ordersToClose.length;
        ordersToClose.forEach(async order => {
            try {
                traderapi.cancelOrder(order._id, order.type, order.pair);
                order.update({
                    isProcessed: true,
                    isClosed: true
                });
                await order.save();
                log.info(`Closing ob-order with params: id=${order._id}, type=${order.targetType}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}. Open ob-orders: ~${orderBookOrdersCount}.`);
    
            } catch (e) {
                log.error('Error in removeOrderBookOrders(): ' + e);
            }
        });
    },
	async placeOrderBookOrder(orderBookOrdersCount) {
        const type = setType();
        const position = setPosition();
        const priceReq = await setPrice(type, config.pair, position);
        const price = priceReq.price;
        const coin1Amount = setAmount();
        const coin2Amount = coin1Amount * price;
        const lifeTime = setLifeTime(position);

        let orderId;
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
            notify(`${config.notifyName} unable to run ob-order with params: ${orderParamsString}.`, 'warn');
            return;
        }

        // console.log(type, price.toFixed(8), coin1Amount.toFixed(0), coin2Amount.toFixed(0), 'position:', position, 'lifeTime:', lifeTime);

        // Check balances
        const balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount, type);
        if (!balances.result) {
            if ((Date.now()-lastNotifyBalancesTimestamp > hour) && balances.message) {
                notify(balances.message, 'warn', config.silent_mode);
                lastNotifyBalancesTimestamp = Date.now();
            }
            return;
        }

        orderId = (await traderapi.placeOrder(type, config.pair, price, coin1Amount, 1, null, pairObj)).orderid;
        if (orderId) {
            const {ordersDb} = db;
            const order = new ordersDb({
                _id: orderId,
                date: $u.unix(),
                dateTill: $u.unix() + lifeTime,
                purpose: 'ob', // ob: dynamic order book order
                type: type,
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
                isCancelled: false,
                isClosed: false
            });
            await order.save();
            output = `${type} ${coin1Amount.toFixed(config.coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(config.coin2Decimals)} ${config.coin2}`;
            log.info(`Successfully placed ob-order to ${output}. Open ob-orders: ~${orderBookOrdersCount+1}.`);
        } else {
            console.warn(`${config.notifyName} unable to execute ob-order with params: ${orderParamsString}. No order id returned.`);
        }

	},
};

function setType() {
    if (!tradeParams || !tradeParams.mm_buyPercent) {
        log.warn(`Param mm_buyPercent is not set. Check ${config.exchangeName} config.`);
        return false;
    }
    let type = 'sell';
    if (Math.random() > tradeParams.mm_buyPercent) // 1 minus tradeParams.mm_buyPercent
        type = 'buy';
	return type;
}

async function isEnoughCoins(coin1, coin2, amount1, amount2, type) {
	const balances = await traderapi.getBalances(false);
    let balance1, balance2;
    let isBalanceEnough = true;
    let output = '';

    if (balances) {
		try {
            balance1 = balances.filter(crypto => crypto.code === coin1)[0].free;
            balance2 = balances.filter(crypto => crypto.code === coin2)[0].free;


            if ((!balance1 || balance1 < amount1) && type === 'sell') {
                output = `${config.notifyName}: Not enough ${coin1} for placing ${type} ob-order. Check balances.`;
                isBalanceEnough = false;
            }
            if ((!balance2 || balance2 < amount2) && type === 'buy') {
                output = `${config.notifyName}: Not enough ${coin2} for placing ${type} ob-order. Check balances.`;
                isBalanceEnough = false;
            }

            // console.log(balance1.toFixed(0), amount1.toFixed(0), balance2.toFixed(8), amount2.toFixed(8));
            return {
                result: isBalanceEnough,
                message: output
            }

		} catch (e) {
            log.warn(`Unable to process balances for placing ob-order.`);
            return {
                result: false
            }
        }
	} else {
        log.warn(`Unable to get balances for placing ob-order.`);
        return {
            result: false
        }
    }
}

async function setPrice(type, pair, position) {

    let output = '';

    let high, low;
    const orderBook = await traderapi.getOrderBook(pair);
    // const orderBook = await traderapi.getOrderBook(pair, tradeParams.mm_orderBookHeight + 1);

    if (!orderBook) {
        log.warn(`Unable to get order book for ${pair} to set a price while placing ob-order.`);
        return {
            price: false,
        }
    }
    
    const orderList = type === 'buy' ? orderBook.bids : orderBook.asks;
    // console.log();
    // console.log(type);
    // console.log(orderList);

    if (!orderList || !orderList[0] || !orderList[1]) {
        output = `${config.notifyName}: Orders count of type ${type} is less then 2. Unable to set a price for ${pair} while placing ob-order.`;
        return {
            price: false,
            message: output
        }
    } else {
        if (orderList.length < position)
            position = orderList.length;
        if (type === 'sell') {
            low = orderList[position-2].price;
            high = orderList[position-1].price;
        } else {
            high = orderList[position-2].price;
            low = orderList[position-1].price;
        }
    }

    return {
        price: Math.random() * (high - low) + low
    }

}

function setAmount() {
    if (!tradeParams || !tradeParams.mm_maxAmount || !tradeParams.mm_minAmount) {
        log.warn(`Params mm_maxAmount or mm_minAmount are not set. Check ${config.exchangeName} config.`);
        return false;
    }
    return Math.random() * (tradeParams.mm_maxAmount - tradeParams.mm_minAmount) + tradeParams.mm_minAmount;
}

function setPosition() {
    return Math.round(Math.random() * (tradeParams.mm_orderBookHeight - 2) + 2);
}

function setLifeTime(position) {
    return Math.round((Math.random() * (LIFETIME_MAX - LIFETIME_MIN) + LIFETIME_MIN) * Math.sqrt(position));
}

function setPause() {
    return Math.round(Math.random() * (INTERVAL_MAX - INTERVAL_MIN) + INTERVAL_MIN);
}
