const $u = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./tradeParams_' + config.exchange);
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');
const orderUtils = require('./orderUtils');
const Store = require('../modules/Store');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

const HOUR = 1000 * 60 * 60;
const INTERVAL_MIN = 10000;
const INTERVAL_MAX = 30000;
const LIFETIME_MIN = 1000 * 60 * 30; // 30 minutes
const LIFETIME_MAX = HOUR * 2; // 2 hours

let isPreviousIterationFinished = true;

let lowPrice, highPrice;
let isPriceActual = false;
let setPriceRangeCount = 0;
let pwExchange, pwExchangeApi;

console.log(`Module ${$u.getModuleName(module.id)} is loaded.`);

module.exports = {
    getLowPrice() {
        return lowPrice;
    },
    getHighPrice() {
        return highPrice;
    },
    getIsPriceActual() {
        return isPriceActual;
    },
    setPwExchangeApi(exchange) {
        if (pwExchange !== exchange) {
            pwExchangeApi = require('./trader_' + exchange.toLowerCase())(null, null, null, log, true);
            pwExchange = exchange;
            log.log(`Price watcher switched to ${exchange} exchange API.`)
        }
    },
    getPwExchangeApi() {
        return pwExchangeApi;
    },
	run() {
        // isPriceActual = true;
        // console.log(`isPriceActual: ${this.getIsPriceActual()}`);
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

            setPriceRange();

            if (isPriceActual) {

                let orderBook = await traderapi.getOrderBook(config.pair);
                if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
                    log.warn(`${config.notifyName}: Order books are empty for ${config.pair}, or temporary API error. Unable to check if I need to place pw-order.`);
                    return;
                }

                let targetPrice = 0;
                if (orderBook.asks[0].price < lowPrice) {
                    targetPrice = lowPrice;
                } else if (orderBook.bids[0].price > highPrice) {
                    targetPrice = highPrice;
                }

                // console.log('highestBid:', orderBook.bids[0].price, 'lowestAsk:', orderBook.asks[0].price);
                // console.log('targetPrice:', targetPrice, 'lowPrice:', lowPrice, 'highPrice:', highPrice);

                if (targetPrice) {

                    let orderBookInfo = $u.getOrderBookInfo(orderBook, tradeParams.mm_liquiditySpreadPercent, targetPrice);
                    const reliabilityKoef = $u.randomValue(1.05, 1.1);
                    orderBookInfo.amountTargetPrice *= reliabilityKoef;
                    orderBookInfo.amountTargetPriceQuote *= reliabilityKoef;

                    // console.log(orderBookInfo);
                    let priceString = `${config.pair} price of ${targetPrice.toFixed(config.coin2Decimals)} ${config.coin2}`;
                    let actionString = `${orderBookInfo.typeTargetPrice} ${orderBookInfo.amountTargetPrice.toFixed(config.coin1Decimals)} ${config.coin1} ${orderBookInfo.typeTargetPrice === 'buy' ? 'with' : 'for'} ${orderBookInfo.amountTargetPriceQuote.toFixed(config.coin2Decimals)} ${config.coin2}`;
                    let logMessage = `To make ${priceString}, the bot is going to ${actionString}.`;
                    log.info(logMessage);
                    await this.placePriceWatcherOrder(targetPrice, orderBookInfo);    

                }

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
            const pairObj = $u.getPairObject(config.pair);

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

async function setPriceRange() {

    try {

        let previousLowPrice = lowPrice;
        let previousHighPrice = highPrice;

        setPriceRangeCount += 1;
        let l, h;

        if (tradeParams.mm_priceWatcherSource.indexOf('@') > -1) {

            let exchange, pair;
            [pair, exchange] = tradeParams.mm_priceWatcherSource.split('@');
            let pairObj = $u.getPairObject(pair, false);

            // let exchangeapi = require('./trader_' + exchange.toLowerCase())(null, null, null, log, true);
            module.exports.setPwExchangeApi(exchange);
            let orderBook = await pwExchangeApi.getOrderBook(pair);
            if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
                errorSettingPriceRange(`Unable to get the order book for ${pair} at ${exchange} exchange. It may be a temporary API error.`);
                return false;
            }

            if (tradeParams.mm_priceWatcherSourcePolicy === 'strict') {

                l = Store.mathEqual(pairObj.coin2, config.coin2, orderBook.bids[0].price, true).outAmount;
                h = Store.mathEqual(pairObj.coin2, config.coin2, orderBook.asks[0].price, true).outAmount;
    
                if (!l || l <= 0 || !h || h <= 0) {
                    errorSettingPriceRange(`Wrong results of Store.mathEqual function: l=${l}, h=${h}.`);
                    return false;
                }

                log.log(`Got a reference price range for ${pair} at ${exchange} exchange (strict): from ${l} to ${h}.`);

            } else {

                let orderBookInfo = $u.getOrderBookInfo(orderBook, 0, false);
                // console.log(orderBookInfo);
                if (!orderBookInfo || !orderBookInfo.smartAsk || !orderBookInfo.smartBid) {
                    errorSettingPriceRange(`Unable to calculate the orderBookInfo for ${pair} at ${exchange} exchange.`);
                    return false;
                }

                l = Store.mathEqual(pairObj.coin2, config.coin2, orderBookInfo.smartBid, true).outAmount;
                h = Store.mathEqual(pairObj.coin2, config.coin2, orderBookInfo.smartAsk, true).outAmount;
    
                if (!l || l <= 0 || !h || h <= 0) {
                    errorSettingPriceRange(`Wrong results of Store.mathEqual function: l=${l}, h=${h}.`);
                    return false;
                }

                let l_strict = Store.mathEqual(pairObj.coin2, config.coin2, orderBook.bids[0].price, true).outAmount;
                let h_strict = Store.mathEqual(pairObj.coin2, config.coin2, orderBook.asks[0].price, true).outAmount;

                log.log(`Got a reference price range for ${pair} at ${exchange} exchange: smart from ${l} to ${h}, strict from ${l_strict} to ${h_strict}.`);

            }

            lowPrice = l * $u.randomValue(1 - tradeParams.mm_priceWatcherDeviationPercent/100, 1) * $u.randomValue(0.99, 1.005);
            highPrice = h * $u.randomValue(1, 1 + tradeParams.mm_priceWatcherDeviationPercent/100) * $u.randomValue(0.995, 1.01);    
            // log.log(`Modified price range for ${pair} at ${exchange} exchange: from ${lowPrice.toFixed(config.coin2Decimals)} to ${highPrice.toFixed(config.coin2Decimals)}.`);
            if (lowPrice >= highPrice) {
                lowPrice = l;
                highPrice = h;
            }
            isPriceActual = true;
            setPriceRangeCount = 0;

        } else {

            // Price range is set in some coin

            l = Store.mathEqual(tradeParams.mm_priceWatcherSource, config.coin2, tradeParams.mm_priceWatcherLowPriceInSourceCoin, true).outAmount;
            h = Store.mathEqual(tradeParams.mm_priceWatcherSource, config.coin2, tradeParams.mm_priceWatcherHighPriceInSourceCoin, true).outAmount;
            
            if (!l || l <= 0 || !h || h <= 0) {

                errorSettingPriceRange(`Wrong results of Store.mathEqual function: l=${l}, h=${h}.`);
                return false;

            } else {

                lowPrice = l * $u.randomValue(0.98, 1.01);
                highPrice = h * $u.randomValue(0.99, 1.02);    
                if (lowPrice >= highPrice) {
                    lowPrice = l;
                    highPrice = h;
                }
                isPriceActual = true;
                setPriceRangeCount = 0;

            }
    
        }

        if (previousLowPrice && previousHighPrice) {

            const warningPercent = 20;

            let deltaLow = Math.abs(lowPrice - previousLowPrice);
            let deltaLowPercent = deltaLow / ( (lowPrice + previousLowPrice) / 2 ) * 100;
            let deltaHigh = Math.abs(highPrice - previousHighPrice);
            let deltaHighPercent = deltaHigh / ( (highPrice + previousHighPrice) / 2 ) * 100;
            
            let changedByStringLow, changedByStringHigh;
            if (deltaLowPercent < 0.01) {
                changedByStringLow = `(no changes)`;
            } else {
                changedByStringLow = `(changed by ${deltaLowPercent.toFixed(2)}%)`;
            }
            if (deltaHighPercent < 0.01) {
                changedByStringHigh = `(no changes)`;
            } else {
                changedByStringHigh = `(changed by ${deltaHighPercent.toFixed(2)}%)`;
            }

            if (deltaLowPercent > warningPercent || deltaHighPercent > warningPercent) {
                notify(`Price watcher's new price range changed much—new values are from ${lowPrice.toFixed(config.coin2Decimals)} ${changedByStringLow} to ${highPrice.toFixed(config.coin2Decimals)} ${changedByStringHigh} ${config.coin2}.`, 'warn');
            } else {
                log.log(`Price watcher set a new price range from ${lowPrice.toFixed(config.coin2Decimals)} ${changedByStringLow} to ${highPrice.toFixed(config.coin2Decimals)} ${changedByStringHigh} ${config.coin2}.`);
            }

        } else {
            log.log(`Price watcher set a price range from ${lowPrice.toFixed(config.coin2Decimals)} to ${highPrice.toFixed(config.coin2Decimals)} ${config.coin2}.`);

        }

    } catch (e) {

        errorSettingPriceRange(`Error in setPriceRange() of ${$u.getModuleName(module.id)} module: ${e}.`);
        return false;

    }

}

function errorSettingPriceRange(errorMessage) {

    try {

        let baseNotifyMessage = `Unable to set the Price Watcher's price range ${setPriceRangeCount} times in series. I've temporary turned off watching the ${config.coin1} price.`;
        let baseMessage = `Unable to set the Price Watcher's price range ${setPriceRangeCount} times.`;

        if (setPriceRangeCount > 10) {

            isPriceActual = false;
            if (Date.now()-lastNotifyPriceTimestamp > HOUR) {
                notify(`${baseNotifyMessage} ${errorMessage}`, 'warn');
                lastNotifyPriceTimestamp = Date.now();
            } else {
                log.log(`${baseNotifyMessage} ${errorMessage}`);
            }

        } else {
            if (isPriceActual) {
                log.log(`${baseMessage} ${errorMessage} I will continue watching ${config.coin1} price according to previous values.`);
            } else {
                log.log(`${baseMessage} ${errorMessage} No data to watch ${config.coin1} price. Price watching is disabled.`);
            }
        }

    } catch (e) {
        log.error(`Error in errorSettingPriceRange() of ${$u.getModuleName(module.id)} module: ` + e);
    }

}
