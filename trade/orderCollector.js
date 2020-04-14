const db = require('../modules/DB');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);

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

            log.info(`Cancelling mm-order with params: id=${order._id}, type=${order.targetType}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}.`);

		} catch (e) {
			log.error('Error in orderCollector module: ' + e);
		}
    });
    
    return ordersToClear.length;

};

setInterval(() => {
	module.exports(['mm', 'tb'], config.pair);
}, 15 * 1000);
