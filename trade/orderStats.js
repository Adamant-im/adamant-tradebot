const db = require('../modules/DB');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const orderUtils = require('./orderUtils');
const log = require('../helpers/log');

module.exports = {

  async aggregate(isExecuted, isProcessed, isCancelled, purpose, pair) {

    const { ordersDb } = db;

    const day = utils.unix() - 24 * 3600 * 1000;
    const month = utils.unix() - 30 * 24 * 3600 * 1000;

    stats = (await ordersDb.aggregate([
      { $group: {
        _id: null,
        coin1AmountTotalAll: { $sum: {
          $cond: [
            // Condition to test
            { $and: [{ $eq: ['$isExecuted', isExecuted] }, { $eq: ['$isProcessed', isProcessed] }, { $eq: ['$isCancelled', isCancelled] }, { $eq: ['$purpose', purpose] }, { $eq: ['$pair', pair] }, { $eq: ['$exchange', config.exchange] }] },
            // True
            '$coin1Amount',
            // False
            0,
          ],
        } },
        coin1AmountTotalDay: { $sum: {
          $cond: [
            // Condition to test
            { $and: [{ $gt: ['$date', day] }, { $eq: ['$isExecuted', isExecuted] }, { $eq: ['$isProcessed', isProcessed] }, { $eq: ['$isCancelled', isCancelled] }, { $eq: ['$purpose', purpose] }, { $eq: ['$pair', pair] }, { $eq: ['$exchange', config.exchange] }] },
            // True
            '$coin1Amount',
            // False
            0,
          ],
        } },
        coin1AmountTotalMonth: { $sum: {
          $cond: [
            // Condition to test
            { $and: [{ $gt: ['$date', month] }, { $eq: ['$isExecuted', isExecuted] }, { $eq: ['$isProcessed', isProcessed] }, { $eq: ['$isCancelled', isCancelled] }, { $eq: ['$purpose', purpose] }, { $eq: ['$pair', pair] }, { $eq: ['$exchange', config.exchange] }] },
            // True
            '$coin1Amount',
            // False
            0,
          ],
        } },
        coin2AmountTotalAll: { $sum: {
          $cond: [
            // Condition to test
            { $and: [{ $eq: ['$isExecuted', isExecuted] }, { $eq: ['$isProcessed', isProcessed] }, { $eq: ['$isCancelled', isCancelled] }, { $eq: ['$purpose', purpose] }, { $eq: ['$pair', pair] }, { $eq: ['$exchange', config.exchange] }] },
            // True
            '$coin2Amount',
            // False
            0,
          ],
        } },
        coin2AmountTotalDay: { $sum: {
          $cond: [
            // Condition to test
            { $and: [{ $gt: ['$date', day] }, { $eq: ['$isExecuted', isExecuted] }, { $eq: ['$isProcessed', isProcessed] }, { $eq: ['$isCancelled', isCancelled] }, { $eq: ['$purpose', purpose] }, { $eq: ['$pair', pair] }, { $eq: ['$exchange', config.exchange] }] },
            // True
            '$coin2Amount',
            // False
            0,
          ],
        } },
        coin2AmountTotalMonth: { $sum: {
          $cond: [
            // Condition to test
            { $and: [{ $gt: ['$date', month] }, { $eq: ['$isExecuted', isExecuted] }, { $eq: ['$isProcessed', isProcessed] }, { $eq: ['$isCancelled', isCancelled] }, { $eq: ['$purpose', purpose] }, { $eq: ['$pair', pair] }, { $eq: ['$exchange', config.exchange] }] },
            // True
            '$coin2Amount',
            // False
            0,
          ],
        } },
        coin1AmountTotalAllCount: { $sum: {
          $cond: [
            // Condition to test
            { $and: [{ $eq: ['$isExecuted', isExecuted] }, { $eq: ['$isProcessed', isProcessed] }, { $eq: ['$isCancelled', isCancelled] }, { $eq: ['$purpose', purpose] }, { $eq: ['$pair', pair] }, { $eq: ['$exchange', config.exchange] }] },
            // True
            1,
            // False
            0,
          ],
        } },
        coin1AmountTotalDayCount: { $sum: {
          $cond: [
            // Condition to test
            { $and: [{ $gt: ['$date', day] }, { $eq: ['$isExecuted', isExecuted] }, { $eq: ['$isProcessed', isProcessed] }, { $eq: ['$isCancelled', isCancelled] }, { $eq: ['$purpose', purpose] }, { $eq: ['$pair', pair] }, { $eq: ['$exchange', config.exchange] }] },
            // True
            1,
            // False
            0,
          ],
        } },
        coin1AmountTotalMonthCount: { $sum: {
          $cond: [
            // Condition to test
            { $and: [{ $gt: ['$date', month] }, { $eq: ['$isExecuted', isExecuted] }, { $eq: ['$isProcessed', isProcessed] }, { $eq: ['$isCancelled', isCancelled] }, { $eq: ['$purpose', purpose] }, { $eq: ['$pair', pair] }, { $eq: ['$exchange', config.exchange] }] },
            // True
            1,
            // False
            0,
          ],
        } },

      } },
    ]));

    if (!stats[0]) {
      stats[0] = 'Empty';
    }

    return stats[0];

  },
  async ordersByType(pair) {

    const ordersByType = {};
    ordersByType.all = [];

    try {

      const { ordersDb } = db;
      let dbOrders = await ordersDb.find({
        isProcessed: false,
        pair: pair || config.pair,
        exchange: config.exchange,
      });

      dbOrders = await orderUtils.updateOrders(dbOrders, pair);

      if (dbOrders && dbOrders[0]) {

        ordersByType.all = dbOrders;
        ordersByType.mm = dbOrders.filter((order) => order.purpose === 'mm');
        ordersByType.ob = dbOrders.filter((order) => order.purpose === 'ob');
        ordersByType.tb = dbOrders.filter((order) => order.purpose === 'tb');
        ordersByType.liq = dbOrders.filter((order) => order.purpose === 'liq');
        ordersByType.pw = dbOrders.filter((order) => order.purpose === 'pw');
        ordersByType.man = dbOrders.filter((order) => order.purpose === 'man');

      }

    } catch (e) {
      log.error(`Error in ordersByType(${pair}) of ${utils.getModuleName(module.id)}: ${e}.`);
    }

    return ordersByType;

  },

};

