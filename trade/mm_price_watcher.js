const $u = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./tradeParams_' + config.exchange);
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;
let lastNotifyOrderBooksTimestamp = 0;
const HOUR = 1000 * 60 * 60;
const INTERVAL_MIN = 10000;
const INTERVAL_MAX = 20000;
const LIFETIME_MIN = 1000 * 60 * 30; // 30 minutes
const LIFETIME_MAX = HOUR * 2; // 2 hours
const MAX_ORDERS = 6; // each side

module.exports = {
	run() {
        this.iteration();
    },
    iteration() {
        let interval = setPause();
        // console.log(interval);
        if (interval && tradeParams.mm_isActive && tradeParams.mm_isPriceWatcherActive) {
            this.reviewPrices();
            setTimeout(() => {this.iteration()}, interval);
        } else {
            setTimeout(() => {this.iteration()}, 3000); // Check for config.mm_isActive every 3 seconds
        }
    },
	async reviewPrices() {

        try {

            const {ordersDb} = db;
            let pwOrders = await ordersDb.find({
                isProcessed: false,
                purpose: 'pw', // pw: price watcher order
                pair: config.pair,
                exchange: config.exchange
            });

            let orderBookInfo = $u.getOrderBookInfo(await traderapi.getOrderBook(config.pair), tradeParams.mm_liquiditySpreadPercent);
            if (!orderBookInfo) {
                if (Date.now()-lastNotifyOrderBooksTimestamp > HOUR) {
                    notify(`${config.notifyName}: Order books are empty for ${config.pair}, or temporary API error. Unable to get spread for ${pair} while placing pw-order.`, 'warn');
                    lastNotifyOrderBooksTimestamp = Date.now();
                }
                return;
            }
            // console.log(orderBookInfo);

            console.log('pwOrders-Untouched', pwOrders.length);
            pwOrders = await this.updatePriceWatcherOrders(pwOrders); // update orders which partially filled or not found
            console.log('pwOrders-AfterUpdate', pwOrders.length);
            pwOrders = await this.closePriceWatcherOrders(pwOrders, orderBookInfo); // close orders which expired or out of spread
            console.log('pwOrders-AfterClose', pwOrders.length);

            let liquidityStats = $u.getOrdersStats(pwOrders);
            // console.log(liquidityStats);

            let amountPlaced;
            do {
                amountPlaced = await this.placePriceWatcherOrder(liquidityStats.bidsTotalQuoteAmount, 'buy', orderBookInfo);            
                if (amountPlaced) {
                    liquidityStats.bidsTotalQuoteAmount += amountPlaced;
                    liquidityStats.bidsCount += 1;
                    // console.log(`New buy liq-order placed: ${amountPlaced}. Total sell liq-orders: ${liquidityStats.bidsTotalQuoteAmount}.`)
                }
            } while (amountPlaced);
            do {
                amountPlaced = await this.placePriceWatcherOrder(liquidityStats.asksTotalAmount, 'sell', orderBookInfo);
                if (amountPlaced) {
                    liquidityStats.asksTotalAmount += amountPlaced;
                    liquidityStats.asksCount += 1;
                }
                // console.log(`New sell liq-order placed: ${amountPlaced}. Total sell liq-orders: ${liquidityStats.asksTotalAmount}.`)
            } while (amountPlaced);
    
            log.info(`Liquidity stats: opened ${liquidityStats.bidsCount} bids-buy orders for ${liquidityStats.bidsTotalQuoteAmount.toFixed(config.coin2Decimals)} of ${tradeParams.mm_liquidityBuyAmount} ${config.coin2} and ${liquidityStats.asksCount} asks-sell orders with ${liquidityStats.asksTotalAmount.toFixed(config.coin1Decimals)} of ${tradeParams.mm_liquiditySellAmount} ${config.coin1}.`);

        } catch (e) {
            log.error(`Error in reviewPrices() of ${$u.getModuleName(module.id)} module: ` + e);
        }
    },
	async closePriceWatcherOrders(pwOrders, orderBookInfo) {

        let updatedPwOrders = [];
        for (const order of pwOrders) {
            try {
                if (order.dateTill < $u.unix()) {
                    await traderapi.cancelOrder(order._id, order.type, order.pair);
                    await order.update({
                        isProcessed: true,
                        isClosed: true,
                        isExpired: true
                    }, true);
                    log.info(`Closing pw-order with params: id=${order._id}, type=${order.targetType}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}. It is expired.`);
//////////////////////
                } else if ($u.isOrderOutOfSpread(order, orderBookInfo)) {
                    await traderapi.cancelOrder(order._id, order.type, order.pair);
                    await order.update({
                        isProcessed: true,
                        isClosed: true,
                        isOutOfSpread: true
                    }, true);
                    log.info(`Closing pw-order with params: id=${order._id}, type=${order.targetType}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}. It is out of spread.`);
                } else {
                    updatedPwOrders.push(order);
                }
            } catch (e) {
                log.error(`Error in closePriceWatcherOrders() of ${$u.getModuleName(module.id)} module: ` + e);
            }
        }
        return updatedPwOrders;

    },
    async updatePriceWatcherOrders(pwOrders) {

        let updatedPwOrders = [];
        try {

            const exchangeOrders = await traderapi.getOpenOrders(config.pair);
            if (exchangeOrders) {
                // console.log('exchangeOrders:', exchangeOrders.length);
                for (const dbOrder of pwOrders) {

                    let isLifeOrder = false;
                    let isOrderFound = false;
                    for (const exchangeOrder of exchangeOrders) {
                        // console.log(dbOrder._id, exchangeOrder.orderid, exchangeOrder.status);
                        if (dbOrder._id === exchangeOrder.orderid) {
                            // console.log('========');
                            // console.log('match:', dbOrder._id, exchangeOrder.orderid, exchangeOrder.status);
                            // console.log(exchangeOrder);
                            // console.log('========');
                            isOrderFound = true;
                            switch (exchangeOrder.status) {
                                case "new":
                                    isLifeOrder = true;
                                    break;
                                case "closed":
                                    await dbOrder.update({
                                        isProcessed: true,
                                        isClosed: true
                                    }, true);
                                    isLifeOrder = false;
                                    log.info(`Updating (closing) pw-order with params: id=${dbOrder._id}, type=${dbOrder.targetType}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount}, coin2Amount=${dbOrder.coin2Amount}: order is closed.`);
                                    break;
                                case "filled":
                                    await dbOrder.update({
                                        isProcessed: true,
                                        isFilled: true
                                    }, true);
                                    isLifeOrder = false;
                                    log.info(`Updating (closing) pw-order with params: id=${dbOrder._id}, type=${dbOrder.targetType}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount}, coin2Amount=${dbOrder.coin2Amount}: order is filled.`);
                                    break;
                                case "part_filled":
                                    isLifeOrder = true;
                                    if (dbOrder.coin1Amount > exchangeOrder.amountLeft) {
                                        let prev_amount = dbOrder.coin1Amount;
                                        await dbOrder.update({
                                            isFilled: true,
                                            coin1Amount: exchangeOrder.amountLeft
                                        }, true);
                                        log.info(`Updating pw-order with params: id=${dbOrder._id}, type=${dbOrder.targetType}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${prev_amount}, coin2Amount=${dbOrder.coin2Amount}: order is partly filled. Amount left: ${dbOrder.coin1Amount}.`);
                                    }
                                    break;										
                                default:
                                    isLifeOrder = true;
                                    break;
                            } // switch

                        } // if match orderId
                        
                    } // for (const exchangeOrder of exchangeOrders)

                    if (isOrderFound) {
                        if (isLifeOrder)
                        updatedPwOrders.push(dbOrder);
                    } else {
                        await traderapi.cancelOrder(dbOrder._id, dbOrder.type, dbOrder.pair);
                        await dbOrder.update({
                            isProcessed: true,
                            isClosed: true,
                            isNotFound: true
                        }, true);
                        log.info(`Updating (closing) pw-order with params: id=${dbOrder._id}, type=${dbOrder.targetType}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount}, coin2Amount=${dbOrder.coin2Amount}: unable to find it in the exchangeOrders.`);
                    }

                } // for (const dbOrder of liquidityOrders)

            } else { // if exchangeOrders

                log.warn(`Unable to get exchangeOrders in updatePriceWatcherOrders(), leaving dbOrders as is.`);
                updatedPwOrders = pwOrders;
            }

        } catch (e) {
            log.error(`Error in updatePriceWatcherOrders() of ${$u.getModuleName(module.id)} module: ` + e);
        }
        
        return updatedPwOrders;

    },
	async placePriceWatcherOrder(amountPlaced, orderType, orderBookInfo) {

        try {

            const type = orderType;

            const priceReq = await setPrice(type, orderBookInfo);
            const price = priceReq.price;
            if (!price) {
                if ((Date.now()-lastNotifyPriceTimestamp > HOUR) && priceReq.message) {
                    notify(priceReq.message, 'warn');
                    lastNotifyPriceTimestamp = Date.now();
                }
                return;
            }

            const coin1Amount = setAmount(type, price);
            const coin2Amount = coin1Amount * price;
            const lifeTime = setLifeTime();

            let orderId;
            let output = '';
            let orderParamsString = '';
            const pairObj = $u.getPairObj(config.pair);

            orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
            if (!type || !price || !coin1Amount || !coin2Amount) {
                notify(`${config.notifyName} unable to run pw-order with params: ${orderParamsString}.`, 'warn');
                return;
            }

            // console.log(type, price.toFixed(8), coin1Amount.toFixed(2), coin2Amount.toFixed(2), 'lifeTime:', lifeTime);
            // console.log('amountPlaced:', amountPlaced);

            if (type === 'sell') {
                if (coin1Amount > (tradeParams.mm_liquiditySellAmount - amountPlaced)) {
                    // console.log(`Exceeded liquidity amounts to ${type}. Pending: ${coin1Amount.toFixed(config.coin1Decimals)}, placed: ${amountPlaced.toFixed(config.coin1Decimals)}, limit: ${tradeParams.mm_liquiditySellAmount} ${config.coin1}.`);
                    return false;    
                } 
            }

            if (type === 'buy') {
                if (coin2Amount > (tradeParams.mm_liquidityBuyAmount - amountPlaced)) {
                    // console.log(`Exceeded liquidity amounts to ${type}. Pending: ${coin2Amount.toFixed(config.coin2Decimals)}, placed: ${amountPlaced.toFixed(config.coin2Decimals)}, limit: ${tradeParams.mm_liquidityBuyAmount} ${config.coin2}.`);
                    return false;    
                } 
            }

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
                    purpose: 'pw', // pw: price watcher order
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
                }, true);
                
                output = `${type} ${coin1Amount.toFixed(config.coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(config.coin2Decimals)} ${config.coin2}`;
                log.info(`Successfully placed pw-order to ${output}.`);
                if (type === 'sell')
                    return +coin1Amount
                else
                    return +coin2Amount;

            } else {
                console.warn(`${config.notifyName} unable to execute pw-order with params: ${orderParamsString}. No order id returned.`);
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
                output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(config.coin1Decimals)} ${coin1} ${type} pw-order. Free: ${balance1free.toFixed(config.coin1Decimals)} ${coin1}, freezed: ${balance1freezed.toFixed(config.coin1Decimals)} ${coin1}.`;
                isBalanceEnough = false;
            }
            if ((!balance2free || balance2free < amount2) && type === 'buy') {
                output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(config.coin2Decimals)} ${coin2} ${type} pw-order. Free: ${balance2free.toFixed(config.coin2Decimals)} ${coin2}, freezed: ${balance2freezed.toFixed(config.coin2Decimals)} ${coin2}.`;
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

async function setPrice(type, orderBookInfo) {

    try {

        let output = '';
        let high, low;

        switch (tradeParams.mm_liquidityTrend) {
            case "downtrend":
                targetPrice = orderBookInfo.downtrendAveragePrice;
                break;
            case "uptrend":
                targetPrice = orderBookInfo.uptrendAveragePrice;
                break;
            case "middle":
                targetPrice = orderBookInfo.middleAveragePrice;
                break;
            default:
                break;
        }

        const precision = $u.getPrecision(config.coin2Decimals);
        let price;
        // console.log('=====', price, precision);

        if (type === 'sell') {
            low = targetPrice;
            high = targetPrice * (1 + tradeParams.mm_liquiditySpreadPercent/100 / 2);
            price = $u.randomValue(low, high);
            // console.log('****', price, low, high);
            if (price - precision < orderBookInfo.highestBid)
                price = orderBookInfo.highestBid + precision;
            // console.log(`Sell price: ${price.toFixed(config.coin2Decimals)} must be MORE than highest bid: ${orderBookInfo.highestBid}. Low: ${low}, high: ${high}.`)
        } else {
            high = targetPrice;
            low = targetPrice * (1 - tradeParams.mm_liquiditySpreadPercent/100 / 2);
            price = $u.randomValue(low, high);
            // console.log('****', price, low, high);
            if (price + precision > orderBookInfo.lowestAsk)
                price = orderBookInfo.lowestAsk - precision;
            // console.log(`Buy price: ${price.toFixed(config.coin2Decimals)} must be SMALLER than lowest ask: ${orderBookInfo.lowestAsk}. Low: ${low}, high: ${high}.`)
        }

        return {
            price: price
        }
    
    } catch (e) {
        log.error(`Error in setPrice() of ${$u.getModuleName(module.id)} module: ` + e);
    }

}

function setAmount(type, price) {

    if (!tradeParams || !tradeParams.mm_liquiditySellAmount || !tradeParams.mm_liquidityBuyAmount) {
        log.warn(`Params mm_liquiditySellAmount or mm_liquidityBuyAmount are not set. Check ${config.exchangeName} config.`);
        return false;
    }

    let min, max;

    if (type === 'sell') {
        min = tradeParams.mm_liquiditySellAmount / MAX_ORDERS;
        max = tradeParams.mm_liquiditySellAmount / 3 * 2;
    } else {
        min = tradeParams.mm_liquidityBuyAmount / price / MAX_ORDERS;
        max = tradeParams.mm_liquidityBuyAmount / price / 3 * 2;
    }

    return $u.randomValue(min, max);
}

function setLifeTime() {
    return $u.randomValue(LIFETIME_MIN, LIFETIME_MAX, true);
}

function setPause() {
    return $u.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}
