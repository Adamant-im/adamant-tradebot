const db = require('../modules/DB');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const orderUtils = require('./orderUtils');

/**
 * Purposes:
 * all — (String) all type of orders
 * mm: market making order
 * ob: dynamic order book order
 * tb: trade bot order
 * liq: liquidity order
 * pw: price watcher order
 * man: manually placed order with /fill, /buy, /sell, /make price commands
 * unk: unknown order (not in the local bot's database)
*/

module.exports = {

  /**
     * Cancels orders of specific purposes
     * @param {Array} purposes Cancel orders of these purposes
     * @param {String} pair Exchange pair to cancel orders on it
     * @param {Boolean} doForce Make several iterations to cancel orders to bypass API limitations
     */
  async clearOrders(purposes, pair, doForce = false) {

    // console.log(`clearOrders(${purposes}, ${pair}, ${doForce})…`);

    const { ordersDb } = db;
    let ordersToClear;

    if (purposes === 'all') {
      ordersToClear = await ordersDb.find({
        isProcessed: false,
        pair: pair || config.pair,
        exchange: config.exchange,
      });
    } else {
      ordersToClear = await ordersDb.find({
        isProcessed: false,
        purpose: { $in: purposes },
        pair: pair || config.pair,
        exchange: config.exchange,
      });
    }

    const clearedOrders = [];
    let notFinished = false;
    let tries = 0;
    const MAX_TRIES = 10;

    do {

      tries += 1;
      for (const order of ordersToClear) {

        try {

          if (!clearedOrders.includes(order._id)) {
            const cancelReq = await traderapi.cancelOrder(order._id, order.type, order.pair);
            if (cancelReq !== undefined) {
              log.log(`Order collector: Cancelled ${order.purpose}-order with params: id=${order._id}, type=${order.type}, targetType=${order.targetType}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}.`);
              await order.update({
                isProcessed: true,
                isCancelled: true,
              }, true);
              clearedOrders.push(order._id);
            } else {
              log.log(`Order collector: Request to cancel ${order.purpose}-order with id=${order._id} failed. Will try next time, keeping this order in the DB for now.`);
            }
          }

        } catch (e) {
          log.error(`Error in for (const order: ${order._id} of ordersToClear) of ${utils.getModuleName(module.id)}: ${e}.`);
        }

      };

      notFinished = doForce && ordersToClear.length > clearedOrders.length && tries < MAX_TRIES;

    } while (notFinished);


    return {
      totalOrders: ordersToClear.length,
      clearedOrders: clearedOrders.length,
    };

  },

  /**
     * Cancels unknown orders (which are not in the bot's local db)
     * Helpful when exchange API fails to actually close order, but said it did
     * @param {String} pair Exchange pair to cancel orders on it
     * @param {Boolean} doForce Make several iterations to cancel orders to bypass API limitations
     */
  async clearUnknownOrders(pair, doForce = false) {

    // console.log(`clearOrders(${purposes}, ${pair}, ${doForce})…`);

    const { ordersDb } = db;
    let dbOrders;

    dbOrders = await ordersDb.find({
      isProcessed: false,
      pair: pair || config.pair,
      exchange: config.exchange,
    });
    dbOrders = await orderUtils.updateOrders(dbOrders, pair || config.pair); // update orders which partially filled or not found

    const dbOrderIds = dbOrders.map((order) => {
      return order._id;
    });

    let clearedOrdersCount = 0; let totalOrdersCount;

    const openOrders = await traderapi.getOpenOrders(pair || config.pair);
    if (openOrders) {

      // totalOrdersCount may be not actual or even negative because of several reasons
      totalOrdersCount = openOrders.length - dbOrderIds.length;

      const clearedOrders = [];
      let notFinished = false;
      let tries = 0;
      const MAX_TRIES = 10;

      do {

        tries += 1;
        for (const order of openOrders) {

          try {

            if (!clearedOrders.includes(order.orderid) && !dbOrderIds.includes(order.orderid)) {
              const cancelReq = await traderapi.cancelOrder(order.orderid, order.side, order.symbol);
              if (cancelReq !== undefined) {
                log.log(`Order collector: Cancelled unknown order with params: id=${order.orderid}, side=${order.side}, pair=${order.symbol}, price=${order.price}, coin1Amount=${order.amount}, status=${order.status}.`);
                clearedOrders.push(order.orderid);
                clearedOrdersCount += 1;
              } else {
                log.log(`Order collector: Request to cancel unknown order with id=${order.orderid} failed.${doForce ? ' doForce enabled, will try again.' : ' doForce disabled, ignoring.'}`);
              }
            }

          } catch (e) {
            log.error(`Error in for (const order: ${order.orderid} of openOrders) of ${utils.getModuleName(module.id)}: ${e}.`);
          }

        };

        // console.log(`Clearing general orders. Try number: ${tries},
        //  cleared: ${clearedOrders.length}, total: ${openOrders.length}.`)
        notFinished = doForce && totalOrdersCount > clearedOrders.length && tries < MAX_TRIES;

      } while (notFinished);

    } else {

      log.log(`Unable to get open orders to close Unknown orders. It seems API request failed.`);
      return false;
    }

    return {
      totalOrders: totalOrdersCount,
      clearedOrders: clearedOrdersCount,
    };

  },

  /**
     * Cancels all of open orders, including orders which are not in the bot's local db
     * @param {String} pair Exchange pair to cancel all orders on it
     * @param {Boolean} doForce Make several iterations to cancel orders to bypass API limitations
     */
  async clearAllOrders(pair, doForce = false) {

    // console.log(`clearAllOrders(${pair}, ${doForce})…`);
    // First, close orders which are in bot's database
    // 'all' = ['mm', 'tb', 'ob', 'liq', 'pw', 'man']
    const clearedInfo = await this.clearOrders('all', pair, doForce);
    let totalOrdersCount = clearedInfo.totalOrders;
    let clearedOrdersCount = clearedInfo.clearedOrders;
    let includesUnknownOrders = false;

    // Next, if need to clear all orders, close orders which are not closed yet
    const openOrders = await traderapi.getOpenOrders(pair);
    if (openOrders) {

      totalOrdersCount += openOrders.length;
      const clearedOrders = [];
      let notFinished = false;
      let tries = 0;
      const MAX_TRIES = 10;

      do {

        tries += 1;
        for (const order of openOrders) {

          try {

            if (!clearedOrders.includes(order.orderid)) {
              const cancelReq = await traderapi.cancelOrder(order.orderid, order.side, order.symbol);
              if (cancelReq !== undefined) {
                log.log(`Order collector: Cancelled general order with params: id=${order.orderid}, side=${order.side}, pair=${order.symbol}, price=${order.price}, coin1Amount=${order.amount}, status=${order.status}.`);
                clearedOrders.push(order.orderid);
                clearedOrdersCount += 1;
              } else {
                log.log(`Order collector: Request to cancel general order with id=${order.orderid} failed.${doForce ? ' doForce enabled, will try again.' : ' doForce disabled, ignoring.'}`);
              }
            }

          } catch (e) {
            log.error(`Error in for (const order: ${order.orderid} of openOrders) of ${utils.getModuleName(module.id)}: ${e}.`);
          }

        };

        notFinished = doForce && openOrders.length > clearedOrders.length && tries < MAX_TRIES;

      } while (notFinished);

      includesUnknownOrders = true;

    } else {

      log.log(`Unable to get open orders to close them. It seems API request failed.`);
      return false;
    }

    return {
      totalOrders: totalOrdersCount,
      clearedOrders: clearedOrdersCount,
      includesUnknownOrders,
    };


  },
};

// Clear Market-making orders every 120 sec — In case if API errors
// This function is excessive as mm_trader trigger clearOrders() manually if needed
setInterval(() => {
  module.exports.clearOrders(['mm'], config.pair);
}, 120 * 1000);

// Clear all orders, if clearAllOrdersInterval set in config
if (config.clearAllOrdersInterval) {
  setInterval(() => {

    log.info(`Clearing all Unknown opened orders every ${config.clearAllOrdersInterval} minutes as set in config…`);
    module.exports.clearUnknownOrders(config.pair);

  }, config.clearAllOrdersInterval * 60 * 1000);
}
