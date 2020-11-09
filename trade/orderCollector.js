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
    // 'all' = ['mm', 'tb', 'ob', 'liq']
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
