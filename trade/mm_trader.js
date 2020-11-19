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
let lastNotifyOrderBooksTimestamp = 0;

const HOUR = 1000 * 60 * 60;

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

        try {

            const type = setType();
            let coin1Amount = setAmount();
            const priceReq = await setPrice(type, config.pair, coin1Amount);
            const price = priceReq.price;
            if (priceReq.coin1Amount) coin1Amount = priceReq.coin1Amount; // it may be changed
            const coin2Amount = coin1Amount * price;

            let order1, order2;
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

            orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, mmCurrentAction=${priceReq.mmCurrentAction}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
            if (!type || !price || !coin1Amount || !coin2Amount) {
                notify(`${config.notifyName} unable to run mm-order with params: ${orderParamsString}.`, 'warn');
                return;
            }

            // console.log(orderParamsString);
            // console.log(type, price.toFixed(8), coin1Amount.toFixed(0), coin2Amount.toFixed(0));

            // Check balances
            const balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount, type, priceReq.mmCurrentAction);
            if (!balances.result) {
                if (balances.message) {
                    if (Date.now()-lastNotifyBalancesTimestamp > HOUR) {
                        notify(balances.message, 'warn', config.silent_mode);
                        lastNotifyBalancesTimestamp = Date.now();
                    } else {
                        log.log(message);
                    }
                }
                return;
            }

            if (priceReq.mmCurrentAction === 'executeInSpread') {

                order1 = (await traderapi.placeOrder(crossType(type), config.pair, price, coin1Amount, 1, null, pairObj)).orderid;
                if (order1) {
                    const {ordersDb} = db;
                    const order = new ordersDb({
                        _id: order1,
                        crossOrderId: null,
                        date: $u.unix(),
                        purpose: 'mm', // Market making
                        mmOrderAction: priceReq.mmCurrentAction,
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
                        log.info(`Successfully executed mm-order to ${output}. Action: executeInSpread.`);
                        order.update({
                            isProcessed: true,
                            isExecuted: true,
                            crossOrderId: order2
                        });
                        await order.save();
                    } else {
                        await order.save();
                        notify(`${config.notifyName} unable to execute cross-order for mm-order with params: id=${order1}, ${orderParamsString}. Action: executeInSpread. Check balances. Running order collector now.`, 'warn', config.silent_mode);
                        orderCollector(['mm'], config.pair);
                    }         
                } else { // if order1
                    console.warn(`${config.notifyName} unable to execute mm-order with params: ${orderParamsString}. Action: executeInSpread. No order id returned.`);
                }
            } else if (priceReq.mmCurrentAction === 'executeInOrderBook') {

                order1 = (await traderapi.placeOrder(type, config.pair, price, coin1Amount, 1, null, pairObj)).orderid;
                if (order1) {
                    const {ordersDb} = db;
                    const order = new ordersDb({
                        _id: order1,
                        crossOrderId: null,
                        date: $u.unix(),
                        purpose: 'mm', // Market making
                        mmOrderAction: priceReq.mmCurrentAction,
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
                        isProcessed: true,
                        isExecuted: true,
                        isCancelled: false
                    });
                    await order.save();

                    output = `${type} ${coin1Amount.toFixed(config.coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(config.coin2Decimals)} ${config.coin2}`;
                    log.info(`Successfully executed mm-order to ${output}. Action: executeInOrderBook.`);
                        
                } else { // if order1
                    console.warn(`${config.notifyName} unable to execute mm-order with params: ${orderParamsString}. Action: executeInOrderBook. No order id returned.`);
                }
            }

        } catch (e) {
            log.error(`Error in executeMmOrder() of ${$u.getModuleName(module.id)} module: ` + e);
        }
    },
};

function setType() {
    // return 'buy';

    if (!tradeParams || !tradeParams.mm_buyPercent) {
        log.warn(`Param mm_buyPercent is not set. Check ${config.exchangeName} config.`);
        return false;
    }
    let type = 'buy';
    if (Math.random() > tradeParams.mm_buyPercent)
        type = 'sell';
    return type;
    
}

async function isEnoughCoins(coin1, coin2, amount1, amount2, type, mmCurrentAction) {

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

            if (!balance1free || balance1free < amount1) {

                if (mmCurrentAction === 'executeInSpread') {
                    if (type === 'sell') {
                        output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(config.coin1Decimals)} ${coin1} ${type} direct mm-order (in spread). Free: ${balance1.toFixed(config.coin1Decimals)} ${coin1}, freezed: ${balance1freezed.toFixed(config.coin1Decimals)} ${coin1}.`;
                    } else {
                        output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(config.coin1Decimals)} ${coin1} ${type} cross-type mm-order (in spread). Free: ${balance1.toFixed(config.coin1Decimals)} ${coin1}, freezed: ${balance1freezed.toFixed(config.coin1Decimals)} ${coin1}.`;
                    }
                    isBalanceEnough = false;
                }

                if (mmCurrentAction === 'executeInOrderBook') {
                    if (type === 'sell') {
                        output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(config.coin1Decimals)} ${coin1} ${type} mm-order (in order book). Free: ${balance1.toFixed(config.coin1Decimals)} ${coin1}, freezed: ${balance1freezed.toFixed(config.coin1Decimals)} ${coin1}.`;
                        isBalanceEnough = false;
                    }                    
                }

            }

            if (!balance2free || balance2free < amount2) {

                if (mmCurrentAction === 'executeInSpread') {
                    if (type === 'buy') {
                        output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(config.coin2Decimals)} ${coin2} ${type} direct mm-order (in spread). Free: ${balance2free.toFixed(config.coin2Decimals)} ${coin2}, freezed: ${balance2freezed.toFixed(config.coin2Decimals)} ${coin2}.`;
                    } else {
                        output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(config.coin2Decimals)} ${coin2} ${type} cross-type mm-order (in spread). Free: ${balance2free.toFixed(config.coin2Decimals)} ${coin2}, freezed: ${balance2freezed.toFixed(config.coin2Decimals)} ${coin2}.`;
                    }
                    isBalanceEnough = false;
                }

                if (mmCurrentAction === 'executeInOrderBook') {
                    if (type === 'buy') {
                        output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(config.coin2Decimals)} ${coin2} ${type} mm-order (in order book). Free: ${balance2free.toFixed(config.coin2Decimals)} ${coin2}, freezed: ${balance2freezed.toFixed(config.coin2Decimals)} ${coin2}.`;
                        isBalanceEnough = false;
                    }                    
                }


            }

            // console.log(balance1.toFixed(0), amount1.toFixed(0), balance2.toFixed(8), amount2.toFixed(8));
            return {
                result: isBalanceEnough,
                message: output
            }

		} catch (e) {
            log.warn(`Unable to process balances for placing mm-order: ` + e);
            return {
                result: false
            }
        }
	} else {
        log.warn(`Unable to get balances for placing mm-order.`);
        return {
            result: false
        }
    }
}

async function setPrice(type, pair, coin1Amount) {

    try {

        const precision = $u.getPrecision(config.coin2Decimals);
        const smallSpread = precision * 15; // if spread is small and should do market making less careful
        let output = '';

        let ask_high, bid_low, price;
        const orderBook = await traderapi.getOrderBook(config.pair);
        let orderBookInfo = $u.getOrderBookInfo(orderBook, tradeParams.mm_liquiditySpreadPercent);
        if (!orderBookInfo) {
            if (Date.now()-lastNotifyOrderBooksTimestamp > HOUR) {
                notify(`${config.notifyName}: Order books are empty for ${config.pair}, or temporary API error. Unable to set a price for ${pair} while placing mm-order.`, 'warn');
                lastNotifyOrderBooksTimestamp = Date.now();
            }
            return {
                price: false
            }
        }
        bid_low = orderBookInfo.highestBid;
        ask_high = orderBookInfo.lowestAsk;
        // console.log('bid_low:', bid_low, 'ask_high:', ask_high);

        let mmPolicy = tradeParams.mm_Policy; // optimal, spread, orderbook
        let mmCurrentAction; // doNotExecute, executeInSpread, executeInOrderBook

        if (tradeParams.mm_isPriceWatcherActive) {
        // if (true) {

            let lowPrice = tradeParams.mm_priceWatcherLowPrice * $u.randomValue(0.98, 1.01);
            let highPrice = tradeParams.mm_priceWatcherHighPrice * $u.randomValue(0.99, 1.02);
            if (lowPrice >= highPrice) {
                lowPrice = tradeParams.mm_priceWatcherLowPrice;
                highPrice = tradeParams.mm_priceWatcherHighPrice;
            }
            // console.log('lowPrice:', +lowPrice.toFixed(config.coin2Decimals), 'highPrice:', +highPrice.toFixed(config.coin2Decimals));

            if (type === 'buy') {

                if (bid_low > highPrice) {

                    output = `${config.notifyName}: Refusing to buy higher than ${highPrice.toFixed(config.coin2Decimals)}. Mm-order cancelled. Low: ${bid_low.toFixed(config.coin2Decimals)}, high: ${ask_high.toFixed(config.coin2Decimals)} ${config.coin2}.`;
                    mmCurrentAction = 'doNotExecute'

                } else if (ask_high > highPrice) {
                    
                    output = `${config.notifyName}: Corrected spread to buy not higher than ${highPrice.toFixed(config.coin2Decimals)} while placing mm-order.`;
                    if (mmPolicy === 'orderbook') {
                        mmCurrentAction = 'doNotExecute';
                        output += ` Market making settings deny trading in spread. Unable to set a price for ${pair}. Mm-order cancelled. Low: ${bid_low.toFixed(config.coin2Decimals)}, high: ${ask_high.toFixed(config.coin2Decimals)} ${config.coin2}.`;
                    }
                    else {
                        mmPolicy = 'spread';
                        output += ` Will trade in spread. Low: ${bid_low.toFixed(config.coin2Decimals)}, high: ${ask_high.toFixed(config.coin2Decimals)} ${config.coin2}.`;
                        log.log(output);
                        output = '';
                    }
                    ask_high = highPrice;

                }

            } else if (type === 'sell') {

                if (ask_high < lowPrice) {

                    output = `${config.notifyName}: Refusing to sell lower than ${lowPrice.toFixed(config.coin2Decimals)}. Mm-order cancelled. Low: ${bid_low.toFixed(config.coin2Decimals)}, high: ${ask_high.toFixed(config.coin2Decimals)} ${config.coin2}.`;
                    mmCurrentAction = 'doNotExecute'

                } else if (bid_low < lowPrice) {

                    output = `${config.notifyName}: Corrected spread to sell not lower than ${lowPrice.toFixed(config.coin2Decimals)} while placing mm-order.`;
                    if (mmPolicy === 'orderbook') {
                        mmCurrentAction = 'doNotExecute'
                        output += ` Market making settings deny trading in spread. Unable to set a price for ${pair}. Mm-order cancelled. Low: ${bid_low.toFixed(config.coin2Decimals)}, high: ${ask_high.toFixed(config.coin2Decimals)} ${config.coin2}.`;
                    }
                    else {
                        mmPolicy = 'spread';
                        output += ` Will trade in spread. Low: ${bid_low.toFixed(config.coin2Decimals)}, high: ${ask_high.toFixed(config.coin2Decimals)} ${config.coin2}.`;
                        log.log(output);
                        output = '';
                    }
                    bid_low = lowPrice;

                }

            }

        }

        // console.log('mmPolicy', mmPolicy);

        if (mmCurrentAction !== 'doNotExecute') {

            const spread = ask_high - bid_low;
            const noSpread = spread < precision * 2;

            if (noSpread) {

                if (mmPolicy === 'orderbook' || (mmPolicy === 'optimal' && tradeParams.mm_isLiquidityActive)) {
                    mmCurrentAction = 'executeInOrderBook';            
                } else {
                    mmCurrentAction = 'doNotExecute';
                }
            } else {

                if (mmPolicy === 'spread') {
                    mmCurrentAction = 'executeInSpread';            
                } else if (mmPolicy === 'optimal') {
                    // 80% in order book and 20% in spread
                    mmCurrentAction = Math.random > 0.8 ? 'executeInSpread' : 'executeInOrderBook';
                } else {
                    mmCurrentAction = 'executeInOrderBook';
                }

            }

        }

        // console.log('mmCurrentAction', mmCurrentAction);

        if (mmCurrentAction === 'doNotExecute') {

            if (!output) output = `${config.notifyName}: No spread currently, and market making settings deny trading in the order book. Low: ${bid_low.toFixed(config.coin2Decimals)}, high: ${ask_high.toFixed(config.coin2Decimals)} ${config.coin2}. Unable to set a price for ${pair}. Update settings or create spread manually.`;
            return {
                price: false,
                message: output
            }

        }

        if (mmCurrentAction === 'executeInOrderBook') {

            let amountInSpread, amountInConfig, amountMaxAllowed, firstOrderAmount;
            // fill not more, than liquidity amount * allowedAmountKoef
            let allowedAmountKoef = tradeParams.mm_isLiquidityActive ? 0.9 : 0.5;

            if (type === 'sell') {

                amountInSpread = orderBookInfo.liquidity.percentCustom.amountBids;
                amountInConfig = tradeParams.mm_liquidityBuyQuoteAmount / bid_low;
                amountMaxAllowed = amountInSpread > amountInConfig ? amountInConfig : amountInSpread;
                amountMaxAllowed *= allowedAmountKoef;

                // console.log(`Selling; coin1Amount: ${coin1Amount}, amountInSpread: ${amountInSpread}, amountInConfig: ${amountInConfig}, amountMaxAllowed: ${amountMaxAllowed}.`)
                if (amountMaxAllowed) {
                    price = orderBookInfo.liquidity.percentCustom.lowPrice;
                    if (coin1Amount > amountMaxAllowed) {
                        coin1Amount = amountMaxAllowed;
                    } else {
                        coin1Amount = coin1Amount;
                    }
                } else {
                    firstOrderAmount = orderBook.bids[0].amount * allowedAmountKoef;
                    price = bid_low;
                    if (coin1Amount > firstOrderAmount) {
                        coin1Amount = firstOrderAmount;
                    } else {
                        coin1Amount = coin1Amount;
                    }
                }

            }

            if (type === 'buy') {

                amountInSpread = orderBookInfo.liquidity.percentCustom.amountAsks;
                amountInConfig = tradeParams.mm_liquiditySellAmount;
                amountMaxAllowed = amountInSpread > amountInConfig ? amountInConfig : amountInSpread;
                amountMaxAllowed *= allowedAmountKoef;

                // console.log(`Buying; coin1Amount: ${coin1Amount}, amountInSpread: ${amountInSpread}, amountInConfig: ${amountInConfig}, amountMaxAllowed: ${amountMaxAllowed}.`)
                if (amountMaxAllowed) {
                    price = orderBookInfo.liquidity.percentCustom.highPrice;
                    if (coin1Amount > amountMaxAllowed) {
                        coin1Amount = amountMaxAllowed;
                    } else {
                        coin1Amount = coin1Amount;
                    }
                } else {
                    firstOrderAmount = orderBook.asks[0].amount * allowedAmountKoef;
                    price = ask_high;
                    if (coin1Amount > firstOrderAmount) {
                        coin1Amount = firstOrderAmount;
                    } else {
                        coin1Amount = coin1Amount;
                    }
                }

            }

            // console.log(`Price: ${price}, coin1Amount: ${coin1Amount}.`)
            
            return {
                price,
                coin1Amount,
                mmCurrentAction
            }

        }

        if (mmCurrentAction === 'executeInSpread') {

            let isCareful = true; // set price closer to bids & asks
            if (tradeParams && (tradeParams.mm_isCareful != undefined)) {
                isCareful = tradeParams.mm_isCareful;
            }
        
            let deltaPercent;
            const interval = ask_high - bid_low;
            // console.log(interval, smallSpread);
            if (isCareful) {
                if (interval > smallSpread) {
                    // 1-25% of spread
                    deltaPercent = $u.randomValue(0.01, 0.25);
                } else {
                    // 5-35% of spread
                    deltaPercent = $u.randomValue(0.05, 0.35);
                }
            } else {
                // 1-45% of spread
                deltaPercent = $u.randomValue(0.01, 0.45);
            }

            // console.log('2:', bid_low.toFixed(8), ask_high.toFixed(8), interval.toFixed(8), deltaPercent.toFixed(2));
            let from, to;
            if (type === 'buy') {
                price = bid_low + interval*deltaPercent;
            } else {
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

            return {
                price,
                mmCurrentAction
            }

        } // if (mmCurrentAction === 'executeInSpread')

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
