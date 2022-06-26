const constants = require('../helpers/const');
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
   * Get stats on all orders by purposes list
   * Used for statistics
   * @param {Array<String>} purposes List of purposes
   * @param {String} pair Filter order trade pair
   * @return {Object} Aggregated info
   */
  async getAllOrderStats(purposes, pair) {
    const statList = [];
    const statTotal = {};

    try {
      for (const purpose of purposes) {
        statList.push({
          purpose,
          purposeName: orderPurposes[purpose],
          ...(await this.getOrderStats(true, true, false, purpose, pair)),
        });
      }

      statTotal.purpose = 'total';
      statTotal.purposeName = 'Total orders';
      Object.keys(statList[0]).forEach((key) => {
        if (key.startsWith('coin')) {
          statTotal[key] = statList.reduce((total, stats) => total + (stats[key] || 0), 0);
        }
      });
    } catch (e) {
      log.error(`Error in getAllOrderStats(purposes: ${purposes?.join(', ')}, pair: ${pair}) of ${utils.getModuleName(module.id)}: ${e}.`);
    }

    return { statList, statTotal };
  },

  /**
   * Aggregates info about locally stored orders
   * Used for statistics
   * @param {Boolean} isExecuted Filter executed orders or not
   * @param {Boolean} isProcessed Filter processed orders or not
   * @param {Boolean} isCancelled Filter processed orders or not
   * @param {String} purpose Filter order type (purpose)
   * @param {String} pair Filter order trade pair
   * @return {Object} Aggregated info
   */
  async getOrderStats(isExecuted, isProcessed, isCancelled, purpose, pair) {
    if (purpose === 'man') isExecuted = false; // 'man' orders are not marked as executed

    const { ordersDb } = db;
    let stats = [];

    const hour = utils.unixTimeStampMs() - constants.HOUR;
    const day = utils.unixTimeStampMs() - constants.DAY;
    const month = utils.unixTimeStampMs() - 30 * constants.DAY;

    try {
      stats = (await ordersDb.aggregate([
        {
          $match: {
            pair,
            purpose,
            isProcessed,
            exchange: config.exchange,
          },
        },
        {
          $match: {
            isExecuted,
            isCancelled,
          },
        },
        {
          $group: {
            _id: null,
            coin1AmountTotalAll: { $sum: '$coin1Amount' },
            coin1AmountTotalHour: { $sum: {
              $cond: [
                // Condition to test
                { $gt: ['$date', hour] },
                // True
                '$coin1Amount',
                // False
                0,
              ],
            } },
            coin1AmountTotalDay: { $sum: {
              $cond: [
                // Condition to test
                { $gt: ['$date', day] },
                // True
                '$coin1Amount',
                // False
                0,
              ],
            } },
            coin1AmountTotalMonth: { $sum: {
              $cond: [
                // Condition to test
                { $gt: ['$date', month] },
                // True
                '$coin1Amount',
                // False
                0,
              ],
            } },
            coin2AmountTotalAll: { $sum: '$coin2Amount' },
            coin2AmountTotalHour: { $sum: {
              $cond: [
                // Condition to test
                { $gt: ['$date', hour] },
                // True
                '$coin2Amount',
                // False
                0,
              ],
            } },
            coin2AmountTotalDay: { $sum: {
              $cond: [
                // Condition to test
                { $gt: ['$date', day] },
                // True
                '$coin2Amount',
                // False
                0,
              ],
            } },
            coin2AmountTotalMonth: { $sum: {
              $cond: [
                // Condition to test
                { $gt: ['$date', month] },
                // True
                '$coin2Amount',
                // False
                0,
              ],
            } },
            coin1AmountTotalAllCount: { $sum: 1 },
            coin1AmountTotalHourCount: { $sum: {
              $cond: [
                // Condition to test
                { $gt: ['$date', hour] },
                // True
                1,
                // False
                0,
              ],
            } },
            coin1AmountTotalDayCount: { $sum: {
              $cond: [
                // Condition to test
                { $gt: ['$date', day] },
                // True
                1,
                // False
                0,
              ],
            } },
            coin1AmountTotalMonthCount: { $sum: {
              $cond: [
                // Condition to test
                { $gt: ['$date', month] },
                // True
                1,
                // False
                0,
              ],
            } },
          },
        },
      ]));
    } catch (e) {
      log.error(`Error in getOrderStats(isExecuted: ${isExecuted}, isProcessed: ${isProcessed}, isCancelled: ${isCancelled}, purpose: ${purpose}, pair: ${pair}) of ${utils.getModuleName(module.id)}: ${e}.`);
    }

    if (!stats[0]) {
      stats[0] = 'Empty';
    }

    return stats[0];
  },

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

