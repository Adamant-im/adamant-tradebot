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
const INTERVAL_MAX = 3000;
const LIFETIME_MIN = 1000;
// const LIFETIME_MAX = 40000; — depends on mm_orderBookOrdersCount
const LIFETIME_KOEF = 1.5;

let isPreviousIterationFinished = true;

module.exports = {

    async test() {
        console.log('==========================');
        console.log('**************before');
        let pw = require('./mm_price_watcher');
        console.log(`isPriceActual: ${pw.getIsPriceActual()}`);
        // let req = await traderapi.cancelOrder('ADM_USDT');
        // let exchangeapi = require('./trader_' + 'atomars')(null, null, null, log, true);
        // let req = await exchangeapi.getOrderBook('ADM/USDT');
        let pw2 = require('./mm_price_watcher');
        console.log(`isPriceActual: ${pw2.getIsPriceActual()}`);

        console.log('**************after:');
        // console.log(req);
    },
	run() {
        this.iteration();
    },
    async iteration() {

        let interval = setPause();
        // console.log(interval);
        if (interval && tradeParams.mm_isActive && tradeParams.mm_isOrderBookActive) {
            if (isPreviousIterationFinished) {
                isPreviousIterationFinished = false;
                await this.buildOrderBook();
                isPreviousIterationFinished = true;
            } else {
                log.log(`Postponing iteration of the order book builder for ${interval} ms. Previous iteration is in progress yet.`);
            }
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

        if (orderBookOrders.length < tradeParams.mm_orderBookOrdersCount) {
            await this.placeOrderBookOrder(orderBookOrders.length);
        }
        await this.closeOrderBookOrders(orderBookOrders);
        
    },
	async closeOrderBookOrders(orderBookOrders) {

        let orderBookOrdersCount = orderBookOrders.length;
        for (const order of orderBookOrders) {
            try {

                if (order.dateTill < $u.unix()) {

                    orderBookOrdersCount -= 1;
                    let cancelReq = await traderapi.cancelOrder(order._id, order.type, order.pair);
                    if (cancelReq !== undefined) {
                        log.info(`Closing ob-order with params: id=${order._id}, type=${order.type}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}. It is expired. Open ob-orders: ~${orderBookOrdersCount}.`);
                        await order.update({
                            isProcessed: true,
                            isClosed: true,
                            isExpired: true
                        }, true);
                    } else {
                        log.log(`Request to close ob-order with id=${order._id} failed. Will try next time, keeping this order in the DB for now.`);
                    }
        
                }
            } catch (e) {
                log.error(`Error in closeOrderBookOrders() of ${$u.getModuleName(module.id)} module: ` + e);
            }
        };

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

            let output = '';
            let orderParamsString = '';
            const pairObj = $u.getPairObject(config.pair);

            if (!price) {
                if ((Date.now()-lastNotifyPriceTimestamp > HOUR) && priceReq.message) {
                    notify(priceReq.message, 'warn');
                    lastNotifyPriceTimestamp = Date.now();
                }
                return;
            }

            orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
            if (!type || !price || !coin1Amount || !coin2Amount) {
                log.warn(`${config.notifyName} unable to run ob-order with params: ${orderParamsString}.`);
                return;
            }

            // console.log(type, price.toFixed(8), coin1Amount.toFixed(0), coin2Amount.toFixed(0), 'position:', position, 'lifeTime:', lifeTime);

            // Check balances
            const balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount, type);
            if (!balances.result) {
                if (balances.message) {
                    if (Date.now()-lastNotifyBalancesTimestamp > HOUR) {
                        notify(balances.message, 'warn', config.silent_mode);
                        lastNotifyBalancesTimestamp = Date.now();
                    } else {
                        log.log(balances.message);
                    }
                }
                return;
            }

            let orderReq;
            orderReq = await traderapi.placeOrder(type, config.pair, price, coin1Amount, 1, null, pairObj);
            if (orderReq && orderReq.orderid) {
                const {ordersDb} = db;
                const order = new ordersDb({
                    _id: orderReq.orderid,
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
                log.warn(`${config.notifyName} unable to execute ob-order with params: ${orderParamsString}. No order id returned.`);
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
                output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(config.coin1Decimals)} ${coin1} ${type} ob-order. Free: ${balance1free.toFixed(config.coin1Decimals)} ${coin1}, frozen: ${balance1freezed.toFixed(config.coin1Decimals)} ${coin1}.`;
                isBalanceEnough = false;
            }
            if ((!balance2free || balance2free < amount2) && type === 'buy') {
                output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(config.coin2Decimals)} ${coin2} ${type} ob-order. Free: ${balance2free.toFixed(config.coin2Decimals)} ${coin2}, frozen: ${balance2freezed.toFixed(config.coin2Decimals)} ${coin2}.`;
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
            const precision = $u.getPrecision(config.coin2Decimals);
            console.log(`ob precision: ${precision}, before: low ${low}, high ${high}`);
            if (low + precision < high) {
                low += precision;
            }
            if (high - precision > low) {
                high -= precision;
            }
            console.log(`ob precision: ${precision}, after: low ${low}, high ${high}`);

        }

        let price = $u.randomValue(low, high);
        
        let pw = require('./mm_price_watcher');
        if (tradeParams.mm_isPriceWatcherActive && pw.getIsPriceActual()) {
        
            let lowPrice = pw.getLowPrice();
            let highPrice = pw.getHighPrice();
            // console.log('lowPrice:', +lowPrice.toFixed(config.coin2Decimals), 'highPrice:', +highPrice.toFixed(config.coin2Decimals));

            if (type === 'sell') {
                if (price < lowPrice) {
                    price = lowPrice * $u.randomValue(1, 1.21);
                    output = `${config.notifyName}: Price watcher corrected price to sell not lower than ${lowPrice.toFixed(config.coin2Decimals)} while placing ob-order. Low: ${low.toFixed(config.coin2Decimals)}, high: ${high.toFixed(config.coin2Decimals)} ${config.coin2}.`;
                    log.log(output);
                }
            } else {
                if (price > highPrice) {
                    price = highPrice * $u.randomValue(0.79, 1);
                    output = `${config.notifyName}: Price watcher corrected price to buy not higher than ${highPrice.toFixed(config.coin2Decimals)} while placing ob-order. Low: ${low.toFixed(config.coin2Decimals)}, high: ${high.toFixed(config.coin2Decimals)} ${config.coin2}.`;
                    log.log(output);
                }
            }        
        }

        return {
            price
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

    let positionKoef = Math.sqrt(position/1.5);
    let lifetimeMax = tradeParams.mm_orderBookOrdersCount * LIFETIME_KOEF * 1000;
    let orderLifeTime = Math.round($u.randomValue(LIFETIME_MIN, lifetimeMax, false) * positionKoef);
    // console.log(orderLifeTime);
    return orderLifeTime;
}

function setPause() {
    return $u.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}
