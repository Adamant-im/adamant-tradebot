const db = require('../modules/DB');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);

/** 
 * Purposes:
 * all — (String) all type of orders
 * mm: market making order
 * ob: dynamic order book order
 * tb: trade bot order
 * liq: liquidity order
 * pw: price watcher order
*/

module.exports = async (purposes, pair) => {

    // log.info(`Order collector..`);

    const {ordersDb} = db;
    let ordersToClear;

    if (purposes === 'all') {
        ordersToClear = await ordersDb.find({
            isProcessed: false,
            pair: pair || config.pair,
            exchange: config.exchange
        });
    } else {
        ordersToClear = await ordersDb.find({
            isProcessed: false,
            purpose: {$in: purposes},
            pair: pair || config.pair,
            exchange: config.exchange
        });    
    }

    for (const order of ordersToClear) {

        try {

            let cancelReq = await traderapi.cancelOrder(order._id, order.type, order.pair);
            if (cancelReq !== undefined) {
                log.info(`Order collector: Cancelling ${order.purpose}-order with params: id=${order._id}, type=${order.type}, targetType=${order.targetType}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}.`);
                await order.update({
                    isProcessed: true,
                    isCancelled: true
                }, true);
            } else {
                log.log(`Order collector: Request to cancel ${order.purpose}-order with id=${order._id} failed. Will try next time, keeping this order in the DB for now.`);
            }

        } catch (e) {
            log.error(`Error in for (const order: ${order._id} of ordersToClear) of ${$u.getModuleName(module.id)}: ${err}.`);
        }

    };
    
    return ordersToClear.length;

};

async function clearAllOrders() {

    // First, close orders which are in bot's database
    // 'all' = ['mm', 'tb', 'ob', 'liq', 'pw']
    let count = await module.exports('all', config.pair);
    
	// Next, if need to clear all orders, close orders which are not closed yet
    const openOrders = await traderapi.getOpenOrders(config.pair);
    log.info(`Clearing all opened orders every ${config.clearAllOrdersInterval} minutes.. Orders to close: ${count + openOrders.length}.`);
    if (openOrders) {
        openOrders.forEach(order => {
            traderapi.cancelOrder(order.orderid, order.side, order.symbol);
        });
    }

}

// Clear Market-making orders every 20 sec — In case if API errors
setInterval(() => {
	module.exports(['mm'], config.pair);
}, 20 * 1000);

// Clear all orders, if clearAllOrdersInterval set in config
if (config.clearAllOrdersInterval) {
    setInterval(() => {
        clearAllOrders();
    }, config.clearAllOrdersInterval * 60 * 1000);
}
