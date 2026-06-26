const constants = require('../helpers/const');
const db = require('../modules/DB');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const orderUtils = require('./orderUtils');
const log = require('../helpers/log');
const orderPurposes = require('./orderCollector').orderPurposes;

/**
 * Order statuses:
 *
 * - isProcessed
 *   Initialized as `false`. Becomes `true` once the order is *fully* filled, cancelled, disappears, or marked to be closed.
 *
 * - isExecuted
 *   Initialized as `false`. Set to `true` when the order is considered filled or part_filled.
 *
 * - isClosed
 *   Initialized as `false`. Becomes `true` once the order is fully filled, cancelled, or disappears.
 *
 * - isCancelled
 *   Initialized as `false`. Becomes `true` after the bot cancels it (via `orderCollector`).
 *   Every Cancelled order is also Closed and Processed.
 *
 * - isExpired
 *   Initialized as `undefined`. Becomes `true` when the order's lifetime ends.
 *   Every Expired* order is also Closed and Processed.
 *
 * - isCountExceeded
 *   Initialized as `undefined`. Special status when the max count of this order purpose is exceeded.
 *   Every CountExceeded order is also Closed and Processed.
 *
 * - isOutOfPwRange
 *   Initialized as `undefined`. Special status when the order is no longer in the Price Watcher range.
 *   Every OutOfPwRange order is also Closed and Processed.
 *
 * - isOutOfSpread
 *   Applies to liq-orders only. Initialized as `undefined`. Special status when the order is no longer within the ±% spread.
 *   Every OutOfSpread order is also Closed and Processed.
 *
 * - isNotFound
 *   Initialized as `undefined`. Special status when the order is missing in exchange's `traderapi.getOpenOrders`.
 *   NotFound order may be considered later as Executed, Cancelled, Closed, Processed.
 */

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

module.exports = {
  /**
   * Get stats on all orders by purposes list
   * Used for statistics (the /stats command)
   * @param {string[]} purposes List of purposes
   * @param {string} pair Filter order trade pair
   * @return {Promise<Object>} Aggregated info
   */
  async getAllOrderStats(purposes, pair) {
    const statList = [];
    const statTotal = {};

    try {
      let sampleStructure = {};
      for (const purpose of purposes) {
        // Include executed and processed orders; exclude cancelled orders
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
   * @param {boolean} isExecuted Filter executed orders or not
   * @param {boolean} isProcessed Filter processed orders or not
   * @param {boolean} isCancelled Filter processed orders or not
   * @param {string} purpose Filter order purpose
   * @param {string} pair Filter order trade pair
   * @return {Promise<Object>} Aggregated info
   */
  async getOrderStats(isExecuted, isProcessed, isCancelled, purpose, pair) {
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
            exchange: config.exchange, // Only include orders from the current exchange
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
   * Returns information about locally stored open orders grouped by purpose.
   *
   * Note: It returns empty objects only for non–module-indexed purposes.
   *   For example, if there are no `ld` and `ld2` orders, the result will not include
   *   `ordersByPurpose['ld2']`, but will still include `ordersByPurpose['ld']`.
   *
   * Note: The function updates the locally stored orders using exchange data by calling `orderUtils.updateOrders()`.
   *   If the getOpenOrders() request fails, the function
   *   ignores the failure and returns the orders without that update.
   *
   * Used for the `/orders` command.
   *
   * @param {string} pair Trading pair: `BTC/USDT` for spot or `BTCUSDT` for perpetual
   * @param {Object} api API instance to use: spot (first or second account) or perpetual
   * @param {boolean} [hideNotOpened=true] Hides ld-orders in [Not opened, Filled, Cancelled, Missed, To be removed, Removed] states
   * @param {boolean} [splitByModuleIndex=true] Splits module-indexed purposes (e.g., `ld`, `ld2`) according to their `moduleIndex`
   *
   * @return {Promise<Object>} Aggregated order information grouped by purpose
   */
  async ordersByPurpose(pair, api, hideNotOpened = true, splitByModuleIndex = true) {
    const ordersByPurpose = {};

    try {
      const { ordersDb } = db;
      let dbOrders = await ordersDb.find({
        isProcessed: false,
        pair,
        exchange: config.exchange,
        isSecondAccountOrder: api?.isSecondAccount ? true : { $ne: true },
      });

      dbOrders = await orderUtils.updateOrders(dbOrders, pair, `${moduleName}-ordersByPurpose`, false, api, hideNotOpened);

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
            if (order.side === 'buy') {
              buyOrders.push(order);
              buyOrdersQuote += order.coin2Amount;
            } else if (order.side === 'sell') {
              sellOrders.push(order);
              sellOrdersAmount += order.coin1Amount;
            }
          });

          ordersByPurpose[purpose] = {
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
              if (order.side === 'buy') {
                buyOrders.push(order);
                buyOrdersQuote += order.coin2Amount;
              } else if (order.side === 'sell') {
                sellOrders.push(order);
                sellOrdersAmount += order.coin1Amount;
              }
            });

            ordersByPurpose[key] = {
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
            ordersByPurpose[purpose] = {
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

      ordersByPurpose['all'] = {
        purposeName: 'All Orders',
        allOrders: dbOrders || [],
        buyOrders: [],
        sellOrders: [],
        buyOrdersQuote: 0,
        sellOrdersAmount: 0,
      };

      dbOrders.forEach((order) => {
        if (order.side === 'buy') {
          ordersByPurpose['all'].buyOrders.push(order);
          ordersByPurpose['all'].buyOrdersQuote += order.coin2Amount;
        } else if (order.side === 'sell') {
          ordersByPurpose['all'].sellOrders.push(order);
          ordersByPurpose['all'].sellOrdersAmount += order.coin1Amount;
        }
      });
    } catch (e) {
      log.error(`Error in ordersByPurpose(${pair}) of ${moduleName}: ${e}.`);
    }

    return ordersByPurpose;
  },

  /**
   * Filters order list by moduleIndex
   * Supports backward compatibility, when orders don't include moduleIndex
   * @param {Object[]} orders List of orders
   * @param {number} moduleIndex When working with several module instances, e.g., ladder1 and ladder2. Indexing starts with 1.
   * @return {Object[]} Filtered list of orders
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

