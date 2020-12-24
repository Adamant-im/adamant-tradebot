const $u = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./tradeParams_' + config.exchange);
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');
const orderUtils = require('./orderUtils');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

const HOUR = 1000 * 60 * 60;
const INTERVAL_MIN = 10000;
const INTERVAL_MAX = 20000;
const LIFETIME_MIN = 1000 * 60 * 30; // 30 minutes
const LIFETIME_MAX = HOUR * 2; // 2 hours

let isPreviousIterationFinished = true;

module.exports = {
	run() {
        this.iteration();
    },
    iteration() {
        let interval = setPause();
        // console.log(interval);
        if (interval && tradeParams.mm_isActive && tradeParams.mm_isPriceWatcherActive) {
            if (isPreviousIterationFinished) {
                this.reviewPrices();
            } else {
                log.log(`Postponing iteration of the price watcher for ${interval} ms. Previous iteration is in progress yet.`);
            }
            setTimeout(() => {this.iteration()}, interval);
        } else {
            setTimeout(() => {this.iteration()}, 3000); // Check for config.mm_isActive every 3 seconds
        }
    },
	async reviewPrices() {

        try {

            isPreviousIterationFinished = false;

            const {ordersDb} = db;
            let pwOrders = await ordersDb.find({
                isProcessed: false,
                purpose: 'pw', // pw: price watcher order
                pair: config.pair,
                exchange: config.exchange
            });

            console.log('pwOrders-Untouched', pwOrders.length);
            // pwOrders = await this.updatePriceWatcherOrders(pwOrders); // update orders which partially filled or not found
            pwOrders = await orderUtils.updateOrders(pwOrders, config.pair); // update orders which partially filled or not found
            console.log('pwOrders-AfterUpdate', pwOrders.length);
            pwOrders = await this.closePriceWatcherOrders(pwOrders); // close orders which expired
            console.log('pwOrders-AfterClose', pwOrders.length);

            let lowPrice = tradeParams.mm_priceWatcherLowPrice * $u.randomValue(0.98, 1.01);
            let highPrice = tradeParams.mm_priceWatcherHighPrice * $u.randomValue(0.99, 1.02);
            if (lowPrice >= highPrice) {
                lowPrice = tradeParams.mm_priceWatcherLowPrice;
                highPrice = tradeParams.mm_priceWatcherHighPrice;
            }

            let orderBook = await traderapi.getOrderBook(config.pair);
            if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
                log.warn(`${config.notifyName}: Order books are empty for ${config.pair}, or temporary API error. Unable to check if I need to place pw-order.`);
                return;
            }

            let orderBookInfo;
            const reliabilityKoef = $u.randomValue(1.05, 1.1);
            let targetPrice = 0;

            if (orderBook.asks[0].price < lowPrice) {
                targetPrice = lowPrice;
            } else if (orderBook.bids[0].price > highPrice) {
                targetPrice = highPrice;
            }

            // console.log('highestBid:', orderBook.bids[0].price, 'lowestAsk:', orderBook.asks[0].price);
            // console.log('targetPrice:', targetPrice, 'lowPrice:', lowPrice, 'highPrice:', highPrice);

            if (targetPrice) {
                orderBookInfo = $u.getOrderBookInfo(orderBook, tradeParams.mm_liquiditySpreadPercent, targetPrice);
                orderBookInfo.amountTargetPrice *= reliabilityKoef;
                orderBookInfo.amountTargetPriceQuote *= reliabilityKoef;

                // console.log(orderBookInfo);
                let priceString = `${config.pair} price of ${targetPrice.toFixed(config.coin2Decimals)} ${config.coin2}`;
                let actionString = `${orderBookInfo.typeTargetPrice} ${orderBookInfo.amountTargetPrice.toFixed(config.coin1Decimals)} ${config.coin1} ${orderBookInfo.typeTargetPrice === 'buy' ? 'with' : 'for'} ${orderBookInfo.amountTargetPriceQuote.toFixed(config.coin2Decimals)} ${config.coin2}`;
                let logMessage = `To make ${priceString}, the bot is going to ${actionString}.`;
                log.info(logMessage);
                await this.placePriceWatcherOrder(targetPrice, orderBookInfo);    
            }

            isPreviousIterationFinished = true;

        } catch (e) {
            log.error(`Error in reviewPrices() of ${$u.getModuleName(module.id)} module: ` + e);
        }

    },
	async closePriceWatcherOrders(pwOrders) {

        let updatedPwOrders = [];
        for (const order of pwOrders) {
            try {
                if (order.dateTill < $u.unix()) {

                    let cancelReq = await traderapi.cancelOrder(order._id, order.type, order.pair);
                    if (cancelReq !== undefined) {
                        log.info(`Closing pw-order with params: id=${order._id}, type=${order.type}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}. It is expired.`);
                        await order.update({
                            isProcessed: true,
                            isClosed: true,
                            isExpired: true
                        }, true);
                    } else {
                        log.log(`Request to close expired pw-order with id=${order._id} failed. Will try next time, keeping this order in the DB for now.`);
                    }
        
                } else {
                    updatedPwOrders.push(order);
                }
            } catch (e) {
                log.error(`Error in closePriceWatcherOrders() of ${$u.getModuleName(module.id)} module: ` + e);
            }
        }
        return updatedPwOrders;

    },
	async placePriceWatcherOrder(targetPrice, orderBookInfo) {

        try {

            const type = orderBookInfo.typeTargetPrice;
            const price = targetPrice;
            const coin1Amount = orderBookInfo.amountTargetPrice;
            const coin2Amount = orderBookInfo.amountTargetPriceQuote;
            const lifeTime = setLifeTime();

            let output = '';
            let orderParamsString = '';
            const pairObj = $u.getPairObj(config.pair);

            orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
            if (!type || !price || !coin1Amount || !coin2Amount) {
                log.warn(`${config.notifyName} unable to run pw-order with params: ${orderParamsString}.`);
                return;
            }

            console.log(type, price.toFixed(8), coin1Amount.toFixed(2), coin2Amount.toFixed(2), 'lifeTime:', lifeTime);

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
                    purpose: 'pw', // pw: price watcher order
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
                log.info(`Successfully placed pw-order to ${output}.`);

            } else {
                log.warn(`${config.notifyName} unable to execute pw-order with params: ${orderParamsString}. No order id returned.`);
                return false;
            }

        } catch (e) {
            log.error(`Error in placePriceWatcherOrder() of ${$u.getModuleName(module.id)} module: ` + e);
        }

    },
    
};

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
                output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(config.coin1Decimals)} ${coin1} ${type} pw-order. Free: ${balance1free.toFixed(config.coin1Decimals)} ${coin1}, frozen: ${balance1freezed.toFixed(config.coin1Decimals)} ${coin1}.`;
                isBalanceEnough = false;
            }
            if ((!balance2free || balance2free < amount2) && type === 'buy') {
                output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(config.coin2Decimals)} ${coin2} ${type} pw-order. Free: ${balance2free.toFixed(config.coin2Decimals)} ${coin2}, frozen: ${balance2freezed.toFixed(config.coin2Decimals)} ${coin2}.`;
                isBalanceEnough = false;
            }

            return {
                result: isBalanceEnough,
                message: output
            }

		} catch (e) {
            log.warn(`Unable to process balances for placing pw-order: ` + e);
            return {
                result: false
            }
        }
	} else {
        log.warn(`Unable to get balances for placing pw-order.`);
        return {
            result: false
        }
    }
}

function setLifeTime() {
    return $u.randomValue(LIFETIME_MIN, LIFETIME_MAX, true);
}

function setPause() {
    return $u.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}
