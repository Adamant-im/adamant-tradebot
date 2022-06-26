const db = require('../modules/DB');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const orderUtils = require('./orderUtils');
const utils = require('../helpers/utils');

module.exports = {
  orderPurposes: {
    'mm': 'Market making',
    'ob': 'Dynamic order book',
    'tb': 'Trade bot',
    'liq': 'Liquidity',
    'pw': 'Price watcher',
    'man': 'Manual', // manually placed order with /fill, /buy, /sell, /make price commands
    'all': 'All types',
    // unk: unknown order (not in the local bot's database)
  },

  /**
   * Cancels orders (from dbOrders only!) of specific purposes
   * @param {String[]} purposes Cancel orders of these purposes
   * @param {String} pair Exchange pair to cancel orders on it
   * @param {Boolean} doForce Make several iterations to cancel orders to bypass API limitations
   * @param {String} orderType Cancel only 'buy' or 'sell' orders
   * @param {Object} filter Filter orders by parameters. For in-code usage only.
   *   Example: const filter = {
   *     price: { $gt: 0.00000033, $lt: 0.00000046 },
   *   };
   * @param {String} callerName For logger
   * @param {String} ordersString For logger
   * @return {Object} totalOrders and more
   */
  async clearLocalOrders(purposes, pair, doForce = false, orderType, filter, callerName, ordersString = 'orders') {
    try {
      const callerString = callerName ? ` (run by ${callerName})` : '';
      ordersString = ordersString === 'orders' ? `${typeof purposes === 'object' ? purposes?.join(',') : purposes}-orders` : ordersString;
      let logMessage = `Order collector${callerString}: Clearing locally stored ${ordersString} on ${pair} pair.`;
      if (orderType || filter) {
        logMessage += ' Filter:';
        if (orderType) logMessage += ` type ${orderType}`;
        if (filter) logMessage += `, criterias ${JSON.stringify(filter)}`;
        logMessage += '.';
      }
      logMessage += ` doForce is ${doForce}.`;
      log.log(logMessage);

      const { ordersDb } = db;
      const orderFilter = {
        isProcessed: false,
        pair: pair || config.pair,
        exchange: config.exchange,
      };
      if (purposes !== 'all') {
        orderFilter.purpose = { $in: purposes };
      }
      if (orderType) {
        orderFilter.type = orderType;
      }
      Object.assign(orderFilter, filter);
      ordersToClear = await ordersDb.find(orderFilter);

      const clearedOrdersAll = [];
      const clearedOrdersSuccess = [];
      const clearedOrdersOnlyMarked = [];
      let totalBidsQuote = 0;
      let totalAsksAmount = 0;

      let notFinished = false;
      let tries = 0;
      const MAX_TRIES = 10;

      do {
        tries += 1;
        for (const order of ordersToClear) {
          if (!clearedOrdersAll.includes(order._id)) {
            const cancelReq = await traderapi.cancelOrder(order._id, order.type, order.pair);
            const orderInfoString = `${order.purpose}-order with id=${order._id}, type=${order.type}, targetType=${order.targetType}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}`;
            if (cancelReq !== undefined) {
              if (cancelReq) {
                order.update({
                  isProcessed: true,
                  isCancelled: true,
                  isClosed: true,
                });
                log.log(`Order collector: Successfully cancelled ${orderInfoString}.`);
                clearedOrdersSuccess.push(order._id);
                if (order.type === 'buy') {
                  totalBidsQuote += order.coin2Amount;
                } else {
                  totalAsksAmount += order.coin1Amount;
                }
              } else {
                order.update({
                  isProcessed: true,
                  isClosed: true,
                });
                log.log(`Order collector: Unable to cancel ${orderInfoString}. Probably it doesn't exist anymore. Making it as closed.`);
                clearedOrdersOnlyMarked.push(order._id);
              }
              await order.save();
              clearedOrdersAll.push(order._id);
            } else {
              log.log(`Order collector: Request to cancel ${orderInfoString} failed. Will try next time, keeping this order in the DB for now.`);
            }
          }
        };

        notFinished = doForce && ordersToClear.length > clearedOrdersAll.length && tries < MAX_TRIES;
      } while (notFinished);

      logMessage = '';
      if (ordersToClear.length) {
        const pairObj = orderUtils.parseMarket(pair);
        if (clearedOrdersSuccess.length) {
          logMessage += `Successfully cancelled ${clearedOrdersSuccess.length} of ${ordersToClear.length} ${ordersString}:`;
          logMessage += ` ${totalBidsQuote.toFixed(pairObj.coin2Decimals)} ${pairObj.coin2} bids and ${totalAsksAmount.toFixed(pairObj.coin1Decimals)} ${pairObj.coin1} asks.`;
        } else {
          logMessage += `No ${ordersString} of total ${ordersToClear.length} were cancelled.`;
        }
        if (clearedOrdersOnlyMarked.length) {
          logMessage += ` ${clearedOrdersOnlyMarked.length} orders don't exist, marked as closed.`;
        }
      } else {
        logMessage = ordersString === 'orders' ? 'No orders to cancel with these criteria.' : `No ${ordersString} to cancel.`;
      }
      log.log(`Order collector${callerString}: ${logMessage}`);

      return {
        totalOrders: ordersToClear.length,
        clearedOrdersCountAll: clearedOrdersAll.length,
        clearedOrdersCountSuccess: clearedOrdersSuccess.length,
        clearedOrdersCountOnlyMarked: clearedOrdersOnlyMarked.length,
        logMessage,
      };
    } catch (e) {
      log.error(`Error in clearLocalOrders() of ${utils.getModuleName(module.id)}: ${e}.`);
    }
  },

  /**
   * Cancels unknown orders (which are not in the bot's local dbOrders)
   * Helpful when exchange API fails to actually close order, but said it did
   * @param {String} pair Exchange pair to cancel orders on it
   * @param {Boolean} doForce Make several iterations to cancel orders to bypass API limitations
   * @param {String} orderType Cancel only 'buy' or 'sell' orders
   * @param {String} callerName For logger
   * @param {String} ordersString For logger
   * @return {Object}  totalOrders and more
   */
  async clearUnknownOrders(pair, doForce = false, orderType, callerName, ordersString = 'unknown orders') {
    try {
      const callerString = callerName ? ` (run by ${callerName})` : '';
      let logMessage = `Order collector${callerString}: Clearing ${ordersString} on ${pair} pair.`;
      if (orderType) {
        logMessage += ' Filter:';
        if (orderType) logMessage += ` type ${orderType}`;
        logMessage += '.';
      }
      logMessage += ` doForce is ${doForce}.`;
      log.log(logMessage);

      const { ordersDb } = db;
      let dbOrders;
      const orderFilter = {
        isProcessed: false,
        pair: pair || config.pair,
        exchange: config.exchange,
      };
      let orderTypeString = '';
      if (orderType) {
        orderFilter.type = orderType;
        orderTypeString = `${orderType}-`;
      }

      dbOrders = await ordersDb.find(orderFilter);
      const totalOrdersCountBeforeUpdate = dbOrders.length;
      dbOrders = await orderUtils.updateOrders(dbOrders, pair || config.pair, utils.getModuleName(module.id)); // update orders which partially filled or not found
      const totalOrdersCountAfterUpdate = dbOrders.length;

      const dbOrderIds = dbOrders.map((order) => {
        return order._id;
      });

      let clearedOrdersCountAll = 0;
      let clearedOrdersCountSuccess = 0;
      let totalOrdersToClearCount;

      let openOrders = await traderapi.getOpenOrders(pair || config.pair);
      if (orderType) openOrders = openOrders.filter((order) => order.side === orderType);

      if (openOrders) {
        // totalOrdersCount may be not actual or even negative because of several reasons
        totalOrdersToClearCount = openOrders.length - totalOrdersCountAfterUpdate;

        const clearedOrders = [];
        let notFinished = false;
        let tries = 0;
        const MAX_TRIES = 10;

        do {
          tries += 1;
          for (const order of openOrders) {
            if (!clearedOrders.includes(order.orderid) && !dbOrderIds.includes(order.orderid)) {
              const cancelReq = await traderapi.cancelOrder(order.orderid, order.side, order.symbol);
              const orderInfoString = `unknown order with id=${order.orderid}, side=${order.side}, pair=${order.symbol}, price=${order.price}, coin1Amount=${order.amount}, status=${order.status}`;
              if (cancelReq !== undefined) {
                if (cancelReq) {
                  log.log(`Order collector: Successfully cancelled ${orderInfoString}.`);
                  clearedOrdersCountSuccess += 1;
                } else {
                  log.log(`Order collector: Unable to cancel ${orderInfoString}. Probably it doesn't exist anymore. Making it as closed.`);
                }
                clearedOrders.push(order.orderid);
                clearedOrdersCountAll += 1;
                // As this order is not in dbOrders, we don't update isProcessed, etc.
              } else {
                log.log(`Order collector: Request to cancel ${orderInfoString}.${doForce ? ' doForce enabled, will try again.' : ' doForce disabled, ignoring.'}`);
              }
            }
          };

          notFinished = doForce && totalOrdersToClearCount > clearedOrders.length && tries < MAX_TRIES;
        } while (notFinished);

        logMessage = '';
        let addLogMessage = `Filtered ${totalOrdersCountBeforeUpdate} ${orderTypeString}orders in the local DB, ${totalOrdersCountAfterUpdate} left after update.`;
        addLogMessage += ` The exchange replied with ${openOrders.length} ${orderTypeString}orders, unknown orders to clear ${openOrders.length}–${totalOrdersCountAfterUpdate}= ${totalOrdersToClearCount}. `;
        if (totalOrdersToClearCount > 0) {
          if (clearedOrdersCountSuccess) {
            logMessage += `Successfully cancelled ${clearedOrdersCountSuccess} of ${totalOrdersToClearCount} ${ordersString}.`;
          } else {
            logMessage += ` No ${ordersString} of total ${totalOrdersToClearCount} were cancelled.`;
          }
        } else {
          logMessage = `No ${ordersString} found.`;
        }
        log.log(`Order collector${callerString}: ${addLogMessage}${logMessage}`);
      } else {
        logMessage = `Unable to get open orders from exchange to close Unknown orders. It seems API request failed. Try again later.`;
        log.warn(`Order collector: ${logMessage}`);
        return {
          logMessage,
        };
      }

      return {
        totalOrders: totalOrdersToClearCount,
        clearedOrdersCountAll,
        clearedOrdersCountSuccess,
        logMessage,
      };
    } catch (e) {
      log.error(`Error in clearUnknownOrders() of ${utils.getModuleName(module.id)}: ${e}.`);
    }
  },

  /**
   * Cancels all of open orders, including orders which are not in the bot's local dbOrders
   * It calls clearLocalOrders and clearUnknownOrders consequently
   * @param {String} pair Exchange pair to cancel all orders on it
   * @param {Boolean} doForce Make several iterations to cancel orders to bypass API limitations
   * @param {String} orderType Cancel only 'buy' or 'sell' orders
   * @param {String} callerName For logger
   * @param {String} ordersString For logger
   * @return {Object} totalOrders and more
   */
  async clearAllOrders(pair, doForce = false, orderType, callerName, ordersString = 'orders') {
    try {
      const callerString = callerName ? ` (run by ${callerName})` : '';
      let logMessage = `Order collector${callerString}: Clearing all ${ordersString} on ${pair} pair.`;
      if (orderType) {
        logMessage += ' Filter:';
        if (orderType) logMessage += ` type ${orderType}`;
        logMessage += '.';
      }
      logMessage += ` doForce is ${doForce}.`;
      log.log(logMessage);

      // First, close orders which are in bot's database, and mark them as closed
      // 'all' = all types of orders
      const clearedLocalInfo = await this.clearLocalOrders('all', pair, doForce, orderType, undefined, `Order collector–${callerName}`, ordersString === 'orders' ? undefined : ordersString);
      if (!clearedLocalInfo) {
        logMessage = `Failed to clear locally stored orders. Try again later.`;
        log.warn(`Order collector: ${logMessage}`);
        return {
          logMessage,
        };
      }
      // Next, close orders which are not closed yet (not in the local DB or not closed by other reason)
      const clearedUnknownInfo = await this.clearUnknownOrders(pair, doForce, orderType, `Order collector–${callerName}`, ordersString === 'orders' ? undefined : ordersString);
      if (!utils.isPositiveOrZeroNumber(clearedUnknownInfo?.totalOrders)) {
        logMessage = `Failed to clear orders received from exchange. Locally stored orders may be closed: ${clearedLocalInfo.logMessage} Error: ${clearedUnknownInfo?.logMessage}`;
        log.warn(`Order collector: ${logMessage}`);
        return {
          logMessage,
        };
      }

      const totalLocalOrders = clearedLocalInfo.totalOrders;
      const clearedLocalOrders = clearedLocalInfo.clearedOrdersCountAll;
      const totalUnknownOrders = clearedUnknownInfo.totalOrders;
      const clearedUnknownOrders = clearedUnknownInfo.clearedOrdersCountAll;
      const totalOrders = totalLocalOrders + totalUnknownOrders;
      const clearedOrders = clearedLocalOrders + clearedUnknownOrders;

      logMessage = '';
      if (totalOrders) {
        if (clearedOrders) {
          logMessage += `Successfully closed ${clearedOrders} of ${totalOrders} ${ordersString}:`;
          logMessage += ` ${clearedLocalOrders} of ${totalLocalOrders} locally stored, and ${clearedUnknownOrders} of ${totalUnknownOrders} received from exchange.`;
        } else {
          logMessage += `No ${ordersString} of total ${totalOrders} were cancelled.`;
        }
      } else {
        logMessage = `No ${ordersString} to cancel.`;
      }
      log.log(`Order collector${callerString}: ${logMessage}`);

      return {
        totalLocalOrders,
        clearedLocalOrders,
        totalUnknownOrders,
        clearedUnknownOrders,
        totalOrders,
        clearedOrders,
        logMessage,
      };
    } catch (e) {
      log.error(`Error in clearAllOrders() of ${utils.getModuleName(module.id)}: ${e}.`);
    }
  },
};

// If exchanges API is not stable, close mm & unk orders regularly
if (config.clearAllOrdersInterval) {
  // Clear Market-making orders every 120 sec — In case if API errors
  // This function is excessive as mm_trader trigger clearLocalOrders() manually if needed
  setInterval(() => {
    module.exports.clearLocalOrders(['mm'], config.pair, undefined, undefined, undefined, 'Regular cleaner');
  }, 120 * 1000);
  // Clear all unknown orders
  setInterval(() => {
    module.exports.clearUnknownOrders(config.pair, undefined, undefined, 'Regular cleaner');
  }, config.clearAllOrdersInterval * 60 * 1000);
}
