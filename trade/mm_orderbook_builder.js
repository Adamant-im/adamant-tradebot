const $u = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./tradeParams_' + config.exchange);
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;
const HOUR = 1000 * 60 * 60;
const INTERVAL_MIN = 2000;
const INTERVAL_MAX = 4000;
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
        const orderBookOrders = await ordersDb.find({
            isProcessed: false,
            purpose: 'ob', // ob: dynamic order book order
            pair: config.pair,
            exchange: config.exchange
        });

        if (orderBookOrders.length < tradeParams.mm_orderBookOrdersCount)
            this.placeOrderBookOrder(orderBookOrders.length);
    
        this.closeOrderBookOrders(orderBookOrders);
    },
	async closeOrderBookOrders(orderBookOrders) {
        let orderBookOrdersCount = orderBookOrders.length;
        orderBookOrders.forEach(async order => {
            try {
                if (order.dateTill < $u.unix()) {
                    orderBookOrdersCount -= 1;
                    traderapi.cancelOrder(order._id, order.type, order.pair);
                    order.update({
                        isProcessed: true,
                        isClosed: true,
                        isExpired: true
                    }, true);
                    log.info(`Closing ob-order with params: id=${order._id}, type=${order.targetType}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}. It is expired. Open ob-orders: ~${orderBookOrdersCount}.`);
                }
            } catch (e) {
                log.error(`Error in closeOrderBookOrders() of ${$u.getModuleName(module.id)} module: ` + e);
            }
        });
    },
	async placeOrderBookOrder(orderBookOrdersCount) {

        try {

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
                if ((Date.now()-lastNotifyPriceTimestamp > HOUR) && priceReq.message) {
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
                if ((Date.now()-lastNotifyBalancesTimestamp > HOUR) && balances.message) {
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
                    // targetType: type,
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
                }, true);
                output = `${type} ${coin1Amount.toFixed(config.coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(config.coin2Decimals)} ${config.coin2}`;
                log.info(`Successfully placed ob-order to ${output}. Open ob-orders: ~${orderBookOrdersCount+1}.`);
            } else {
                console.warn(`${config.notifyName} unable to execute ob-order with params: ${orderParamsString}. No order id returned.`);
            }

        } catch (e) {
            log.error(`Error in placeOrderBookOrder() of ${$u.getModuleName(module.id)} module: ` + e);
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
    let balance1free, balance2free;
    let balance1freezed, balance2freezed;
    let isBalanceEnough = true;
    let output = '';

    if (balances) {
		try {
            balance1free = balances.filter(crypto => crypto.code === coin1)[0].free;
            balance2free = balances.filter(crypto => crypto.code === coin2)[0].free;
            balance1freezed = balances.filter(crypto => crypto.code === coin1)[0].freezed;
            balance2freezed = balances.filter(crypto => crypto.code === coin2)[0].freezed;

            if ((!balance1free || balance1free < amount1) && type === 'sell') {
                output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(config.coin1Decimals)} ${coin1} ${type} ob-order. Free: ${balance1free.toFixed(config.coin1Decimals)} ${coin1}, freezed: ${balance1freezed.toFixed(config.coin1Decimals)} ${coin1}.`;
                isBalanceEnough = false;
            }
            if ((!balance2free || balance2free < amount2) && type === 'buy') {
                output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(config.coin2Decimals)} ${coin2} ${type} ob-order. Free: ${balance2free.toFixed(config.coin2Decimals)} ${coin2}, freezed: ${balance2freezed.toFixed(config.coin2Decimals)} ${coin2}.`;
                isBalanceEnough = false;
            }

            // console.log(balance1.toFixed(0), amount1.toFixed(0), balance2.toFixed(8), amount2.toFixed(8));
            return {
                result: isBalanceEnough,
                message: output
            }

		} catch (e) {
            log.warn(`Unable to process balances for placing ob-order: ` + e);
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

    try {

        let output = '';
        let high, low;
        // not all exchanges have limit/size parameter for orderBook/depth
        // const orderBook = await traderapi.getOrderBook(pair, tradeParams.mm_orderBookHeight + 1);
        const orderBook = await traderapi.getOrderBook(pair);
        if (!orderBook) {
            log.warn(`Unable to get order book for ${pair} to set a price while placing ob-order.`);
            return {
                price: false,
            }
        }
        
        let orderList = type === 'buy' ? orderBook.bids : orderBook.asks;
        // Remove duplicates by 'price' field
        orderList = orderList.filter((order, index, self) =>
            index === self.findIndex((o) => (
                o.price === order.price
            ))
        )

        if (!orderList || !orderList[0] || !orderList[1]) {
            output = `${config.notifyName}: Orders count of type ${type} is less then 2, or temporary API error. Unable to set a price for ${pair} while placing ob-order.`;
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

    } catch (e) {
        log.error(`Error in setPrice() of ${$u.getModuleName(module.id)} module: ` + e);
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
