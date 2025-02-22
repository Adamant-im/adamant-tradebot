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

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

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
      let sampleStructure = {};
      for (const purpose of purposes) {
        const stats = await this.getOrderStats(true, true, false, purpose, pair);
        statList.push({
          purpose,
          purposeName: orderPurposes[purpose],
          ...stats,
        });
        if (stats.db) {
          sampleStructure = stats;
        }
      }

      statTotal.purpose = 'total';
      statTotal.purposeName = 'Total orders';
      Object.keys(sampleStructure).forEach((key) => {
        if (key.startsWith('coin')) {
          statTotal[key] = statList.reduce((total, stats) => total + (stats[key] || 0), 0);
        }
      });
    } catch (e) {
      log.error(`Error in getAllOrderStats(purposes: ${purposes?.join(', ')}, pair: ${pair}) of ${moduleName}: ${e}.`);
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
      log.error(`Error in getOrderStats(isExecuted: ${isExecuted}, isProcessed: ${isProcessed}, isCancelled: ${isCancelled}, purpose: ${purpose}, pair: ${pair}) of ${moduleName}: ${e}.`);
    }

    if (!stats[0]) {
      stats[0] = 'Empty';
    }

    return stats[0];
  },

  /**
   * Returns info about locally stored open orders grouped by purpose (type)
   * Used for /orders command
   * @param {string} pair BTC/USDT for spot or BTCUSDT for perpetual
   * @param {Object} api If we should calculate for the second account in case of 2-keys trading
   * @param {boolean} [hideNotOpened=true] Hide ld-orders in [Not opened, Filled, Cancelled] states
   * @param {boolean} [splitByModuleIndex=true] Splits indexed purposes like 'ld', 'ld2' according to moduleIndex
   * @return {Promise<Object>} Aggregated by purpose order info
   */
  async ordersByType(pair, api, hideNotOpened = true, splitByModuleIndex = true) {
    const ordersByType = {};

    try {
      const { ordersDb } = db;
      let dbOrders = await ordersDb.find({
        isProcessed: false,
        pair,
        exchange: config.exchange,
        isSecondAccountOrder: api?.isSecondAccount ? true : { $ne: true },
      });

      dbOrders = await orderUtils.updateOrders(dbOrders, pair, `${moduleName}-ordersByType`, false, api, hideNotOpened);

      // Handle specific purposes

      Object.keys(orderPurposes).forEach((purpose) => {
        if (purpose === 'all') return; // Skip 'all', handled later

        if (!splitByModuleIndex) {
          // Default behavior without splitting by moduleIndex

          const allOrders = dbOrders.filter((order) => order.purpose === purpose);
          const buyOrders = [];
          const sellOrders = [];
          let buyOrdersQuote = 0;
          let sellOrdersAmount = 0;

          allOrders.forEach((order) => {
            if (order.type === 'buy') {
              buyOrders.push(order);
              buyOrdersQuote += order.coin2Amount;
            } else if (order.type === 'sell') {
              sellOrders.push(order);
              sellOrdersAmount += order.coin1Amount;
            }
          });

          ordersByType[purpose] = {
            purposeName: orderPurposes[purpose],
            allOrders,
            buyOrders,
            sellOrders,
            buyOrdersQuote,
            sellOrdersAmount,
          };
        } else {
          // Split by moduleIndex

          const groupedOrders = {};

          dbOrders
              .filter((order) => order.purpose === purpose)
              .forEach((order) => {
                const moduleIndex = order.moduleIndex || 1; // Default to 1 if moduleIndex not present
                const key = moduleIndex > 1 ? `${purpose}${moduleIndex}` : purpose;

                if (!groupedOrders[key]) {
                  groupedOrders[key] = [];
                }

                groupedOrders[key].push(order);
              });

          Object.entries(groupedOrders).forEach(([key, orders]) => {
            const buyOrders = [];
            const sellOrders = [];
            let buyOrdersQuote = 0;
            let sellOrdersAmount = 0;

            orders.forEach((order) => {
              if (order.type === 'buy') {
                buyOrders.push(order);
                buyOrdersQuote += order.coin2Amount;
              } else if (order.type === 'sell') {
                sellOrders.push(order);
                sellOrdersAmount += order.coin1Amount;
              }
            });

            ordersByType[key] = {
              purposeName: orderPurposes[purpose],
              allOrders: orders,
              buyOrders,
              sellOrders,
              buyOrdersQuote,
              sellOrdersAmount,
            };
          });

          // Add an empty entry for purposes with no orders

          if (!Object.keys(groupedOrders).length) {
            ordersByType[purpose] = {
              purposeName: orderPurposes[purpose],
              allOrders: [],
              buyOrders: [],
              sellOrders: [],
              buyOrdersQuote: 0,
              sellOrdersAmount: 0,
            };
          }
        }
      });

      // Ensure 'all' purpose is handled separately

      ordersByType['all'] = {
        purposeName: 'All Orders',
        allOrders: dbOrders || [],
        buyOrders: [],
        sellOrders: [],
        buyOrdersQuote: 0,
        sellOrdersAmount: 0,
      };

      dbOrders.forEach((order) => {
        if (order.type === 'buy') {
          ordersByType['all'].buyOrders.push(order);
          ordersByType['all'].buyOrdersQuote += order.coin2Amount;
        } else if (order.type === 'sell') {
          ordersByType['all'].sellOrders.push(order);
          ordersByType['all'].sellOrdersAmount += order.coin1Amount;
        }
      });
    } catch (e) {
      log.error(`Error in ordersByType(${pair}) of ${moduleName}: ${e}.`);
    }

    return ordersByType;
  },

  /**
   * Filters order list by moduleIndex
   * Supports backward compatibility, when orders don't include moduleIndex
   * @param {Array<Object>} orders List of orders
   * @param {number} moduleIndex When working with several module instances, e.g., ladder1 and ladder2. Indexing starts with 1.
   * @return {Array<Object>} Filtered list of orders
   */
  ordersByModuleIndex(orders, moduleIndex) {
    return orders.filter((order) => {
      if (moduleIndex === 1) {
        // Include orders where moduleIndex === 1 or moduleIndex does not exist (backward compatibility)
        return order.moduleIndex === 1 || !order.moduleIndex;
      } else {
        return order.moduleIndex === moduleIndex;
      }
    });
  },
};

