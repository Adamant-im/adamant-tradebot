const db = require('../modules/DB');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const orderUtils = require('./orderUtils');
const log = require('../helpers/log');
const orderPurposes = require('./orderCollector').orderPurposes;

/**
 * Order statuses:
 * isProcessed: order created with false, and after it's filled, cancelled, or disappeared, becomes true
 * isExecuted: order created with false, and (mostly taker-orders only: mm, cl, pm, pw) if we consider it's filled, set to true
 * isClosed: order created with false, and after it's filled, cancelled, or disappeared, becomes true
 * isCancelled: order created with false, and after the bot cancels it (orderCollector), becomes true
 *   Every Cancelled order is Closed and Processed as well
 * isExpired: order created with undefined, and has a special status of isExpired if it's life time ends
 *   Every Expired order is Closed and Processed as well
 * isCountExceeded: order created with undefined, and has a special status of isCountExceeded if order count of this type exceeds
 *   Every CountExceeded order is Closed and Processed as well
 * isOutOfPwRange: order created with undefined, and has a special status of isOutOfPwRange if it's already not in Pw price range
 *   Every OutOfPwRange order is Closed and Processed as well
 * isOutOfSpread: liq-order created with undefined, and has a special status of isOutOfSpread if it's already not in ±% of spread
 *   Every OutOfSpread order is Closed and Processed as well
 * isNotFound: order created with undefined, and has a special status of isNotFound if it's not found with traderapi.getOpenOrders
 *   Every NotFound order is Closed and Processed as well
 */

module.exports = {
  /**
   * Returns info about locally stored orders by purpose (type)
   * Used for /orders command
   * @param {String} pair Filter order trade pair
   * @param {Object} api If we should use second account in case of 2-keys trading
   * @return {Object} Aggregated info
   */
  async ordersByType(pair, api) {
    const ordersByType = { };

    try {
      const { ordersDb } = db;
      let dbOrders = await ordersDb.find({
        isProcessed: false,
        pair: pair || config.pair,
        exchange: config.exchange,
        isSecondAccountOrder: api ? true : { $ne: true },
      });

      dbOrders = await orderUtils.updateOrders(dbOrders, pair, utils.getModuleName(module.id), false, api);
      if (dbOrders && dbOrders[0]) {
        Object.keys(orderPurposes).forEach((purpose) => {
          ordersByType[purpose] = { };
          ordersByType[purpose].purposeName = orderPurposes[purpose];
          ordersByType[purpose].allOrders = purpose === 'all' ? dbOrders : dbOrders.filter((order) => order.purpose === purpose);
          ordersByType[purpose].buyOrders = ordersByType[purpose].allOrders.filter((order) => order.type === 'buy');
          ordersByType[purpose].sellOrders = ordersByType[purpose].allOrders.filter((order) => order.type === 'sell');
          ordersByType[purpose].buyOrdersQuote =
            ordersByType[purpose].buyOrders.reduce((total, order) => total + order.coin2Amount, 0);
          ordersByType[purpose].sellOrdersAmount =
            ordersByType[purpose].sellOrders.reduce((total, order) => total + order.coin1Amount, 0);
        });
      } else {
        ordersByType['all'] = { };
        ordersByType['all'].allOrders = [];
      }

    } catch (e) {
      log.error(`Error in ordersByType(${pair}) of ${utils.getModuleName(module.id)}: ${e}.`);
    }

    return ordersByType;
  },
};

