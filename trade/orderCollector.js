const db = require('../modules/DB');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);

/** 
 * Purposes:
 * mm: market making order
 * ob: dynamic order book order
 * tb: trade bot order
*/

module.exports = async (purposes, pair) => {

    // log.info(`Order collector..`);

    const {ordersDb} = db;
    let ordersToClear = await ordersDb.find({
        isProcessed: false,
        purpose: {$in: purposes},
        pair: pair || config.pair,
        exchange: config.exchange
    });

    ordersToClear.forEach(async order => {
        try {

            traderapi.cancelOrder(order._id, order.type, order.pair);
            order.update({
                isProcessed: true,
                isCancelled: true
            });
            await order.save();

            log.info(`Cancelling ${order.purpose}-order with params: id=${order._id}, type=${order.targetType}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}.`);

        } catch (e) {
            log.error('Error in orderCollector module: ' + e);
        }
    });
    
    return ordersToClear.length;

};

async function clearAllOrders() {
	// First, close orders which are in bot's database
	let count = await module.exports(['mm', 'tb', 'ob'], config.pair);
	// Next, if need to clear all orders, close orders which are not closed yet
    const openOrders = await traderapi.getOpenOrders(config.pair);
    log.info(`Clearing all opened orders every ${config.clearAllOrdersInterval} minutes.. Orders to close: ${count + openOrders.length}.`);
    if (openOrders) {
        openOrders.forEach(order => {
            traderapi.cancelOrder(order.orderid, order.side, order.symbol);
        });
    }
}

setInterval(() => {
	module.exports(['mm', 'tb'], config.pair);
}, 15 * 1000);

if (config.clearAllOrdersInterval) {
    setInterval(() => {
        clearAllOrders();
    }, config.clearAllOrdersInterval * 60 * 1000);
}
