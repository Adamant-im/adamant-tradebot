/**
 * Helpers for canceling orders
 */

/**
 * @module trade/orderUtils
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 */

const constants = require('../helpers/const');
const db = require('../modules/DB');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const traderapi = require('./trader_' + config.exchange)(
    config.apikey,
    config.apisecret,
    config.apipassword,
    log,
    undefined,
    undefined,
    config.exchange_socket,
    config.exchange_socket_pull,
);

const orderUtils = require('./orderUtils');
const utils = require('../helpers/utils');

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

module.exports = {
  orderPurposes: {
    ld: 'Ladder',
    t: 'Trader',
    ob: 'Dynamic order book',
    obs: 'Order book in spread',
    tb: 'Trade bot', // Reserved, never used
    liq: 'Liquidity',
    sm: 'Spread maintainer',
    fs: 'Fund supplier',
    pw: 'Price watcher',
    cl: 'Cleaner',
    pm: 'Price maker',
    ag: 'Antigap',
    qh: 'Quote hunter',
    tw: 'TWAP',
    be: 'Balance equalizer',
    man: 'Manual', // manually placed order with /fill, /buy, /sell, /make price commands
    all: 'All types',
    // unk: unknown order (not in the local bot's database)
  },

  /**
   * Parses order purpose from string
   * Note: Only ld(1) and ld2 allowed as module-indexed purpose. E.g., for 'man2' or 'ld3', the function returns 'parsed: false'.
   * @param {string} testPurpose E.g., 'man' or 'ld2'
   * @param {boolean} [addUnk=true] If to add { unk: Unknown order }
   * @return {{ parsed: boolean, moduleIndex?: number, moduleIndexString?: ''|string, purpose?: string, purposeString?: string }} parsed info
   */
  parsePurpose(testPurpose, addUnk = true) {
    const result = {
      parsed: false, // True if order purpose is found and correct
      moduleIndex: 1, // By default, it's the first and only module. Indexing starts with 1.
      moduleIndexString: '', // Equals to '' when the `testPurpose` index is omitted (e.g., 'ld') or explicitly set to 'ld1'. Equals to '2' or higher for indexed purposes such as 'ld2', 'ld3', etc.
      moduleIndexStringFull: '1', // Equals to '' when the `testPurpose` index is omitted (e.g., 'ld'). Equals to '1' when explicitly set to 'ld1'. Equals to '2' or higher for indexed purposes such as 'ld2', 'ld3', etc.
    };

    if (testPurpose.startsWith('ld')) {
      result.moduleIndexStringFull = testPurpose.slice(2);
      testPurpose = 'ld';

      if (!['', '2'].includes(result.moduleIndexStringFull)) { // Allowed ld1 and ld2
        return {
          parsed: false,
        };
      }

      result.moduleIndex = +result.moduleIndexStringFull || 1; // +'' is 0 -> 1
      result.moduleIndexString = result.moduleIndexStringFull === '1' ? '' : result.moduleIndexStringFull; // '1' -> ''
    }

    const orderPurposes = this.getPurposeList(addUnk);

    orderPurposes.purposes.forEach((purpose) => {
      const [[key, value]] = Object.entries(purpose);

      if (testPurpose === key) {
        result.parsed = true;
        result.purpose = key;
        result.purposeString = value;
      }
    });

    return result;
  },

  /**
   * Get orderPurposes as an object and as a message
   * @param {boolean} [addUnk=true] If to add { unk: Unknown order }
   * @param {string[]} [excludeList=[]] Purpose keys to exclude, e.g., ['t', 'man']
   * @return {{ purposes: Object[], message: string }} Order purpose
   */
  getPurposeList(addUnk = true, excludeList = []) {
    const result = {
      purposes: [],
      message: '',
    };

    Object.entries(this.orderPurposes).forEach((purpose) => {
      const key = purpose[0];
      const value = purpose[1];

      if (!excludeList.includes(key)) {
        result.purposes.push({
          [key]: value,
        });

        result.message += `${key}: ${value},\n`;
      }
    });

    if (addUnk) {
      result.purposes.push({
        unk: 'Unknown order',
      });

      result.message += `unk: Unknown order`;
    }

    result.message = utils.trimAny(result.message, ', \n');

    return result;
  },

  /**
   * Get order key by purpose, case insensitive comparison
   * @param {string} orderPurpose Order purpose, e.g., 'Trader'
   * @return {string} Order key, e.g., 't'
   */
  getOrderKeyByPurpose(orderPurpose) {
    let orderKey;

    orderPurpose = orderPurpose.replace(' Manual', '');

    Object.keys(this.orderPurposes).forEach((key) => {
      if (utils.isStringEqualCI(this.orderPurposes[key], orderPurpose)) {
        orderKey = key;
      }
    });

    return orderKey;
  },

  /**
   * Cancels buy-orders to free up quote-coins
   * Works for both Spot and Contracts
   * For the first trading account only
   * Used when:
   * - Achieving support price by any means
   * @param {boolean} cancelAll If to cancel all of orders
   * @param {boolean} cancelUnk If to cancel unk-orders along with all other types except 'man'
   * @param {string} callerName For logger
   * @param {string} reason For logger
   * @param {Object} [api=traderapi] Exchange API to use, can be the second trading account or perpetual API. If not set, the first account will be used.
   * @return {Promise<void>} Nothing to return
   */
  async clearBuyOrdersToFreeQuoteCoin(cancelAll, cancelUnk, callerName, reason, api = traderapi) {
    try {
      const onWhichAccount = api.isSecondAccount ? ' on second account' : '';

      const orderSideToClear = 'buy';

      const logString = `Order collector (run by ${callerName}): Cancelling %1${onWhichAccount} to free up ${config.coin2}. Reason: ${reason}.`;

      if (cancelAll) {
        log.log(logString.replace('%1', 'all-orders'));

        await this.clearAllOrders(config.pair, false, orderSideToClear, `Order collector–${callerName}`, undefined, api);
      } else {
        log.log(logString.replace('%1', cancelUnk ? 'all except man-orders' : 'all except man- and unk- orders'));

        const orderPurposesToClear = utils.cloneObject(this.orderPurposes);
        delete orderPurposesToClear['man'];
        delete orderPurposesToClear['all'];
        const orderPurposesToClearArray = Object.keys(orderPurposesToClear);

        await this.clearLocalOrders(orderPurposesToClearArray, config.pair, false, orderSideToClear, undefined, `Order collector–${callerName}`, undefined, api);

        if (cancelUnk) {
          await this.clearUnknownOrders(config.pair, false, orderSideToClear, `Order collector–${callerName}`, undefined, api, false);
        }
      }
    } catch (e) {
      log.error(`Error in clearBuyOrdersToFreeQuoteCoin() of ${moduleName}: ${e}.`);
    }
  },

  /**
   * Cancels (locally stored) orders conditionally when moving a token price
   * For the first trading account and SPOT only
   * Used when:
   * - Do not to create additional volume by Price watcher and Price maker. 90%+ of volume is created by pw and pm.
   * - Not enough balance to buy/sell self-trade orders
   * @param {string} orderSide If the bot 'buy' or 'sell'. When buying, the function cancels sell-orders, and vice versa.
   * @param {number} thisStepPrice At what price the bot buys or sells
   * @param {string} callerName For logger
   * @param {string} reason For logger
   * @param {Object} [api=traderapi] Exchange API to use, can be the second trading account or perpetual API. If not set, the first account will be used.
   * @return {Promise<void>} Nothing to return
   */
  async clearPriceStepOrders(orderSide, thisStepPrice, callerName, reason, api = traderapi) {
    try {
      const onWhichAccount = api.isSecondAccount ? ' on second account' : '';

      const filter = { };
      let orderSideToClear;

      if (orderSide === 'buy') {
        orderSideToClear = 'sell';
        filter.price = { $lte: thisStepPrice };
      } else {
        orderSideToClear = 'buy';
        filter.price = { $gte: thisStepPrice };
      }

      const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(config.pair));

      log.log(`Order collector (run by ${callerName}): Cancelling ${orderSideToClear}-orders${onWhichAccount} up to ${thisStepPrice.toFixed(formattedPair.coin2Decimals)} ${formattedPair.coin2} price. Reason: ${reason}.`);

      await this.clearLocalOrders('all', config.pair, false, orderSideToClear, filter, `Order collector–${callerName}`, undefined, api);
    } catch (e) {
      log.error(`Error in clearPriceStepOrders() of ${moduleName}: ${e}.`);
    }
  },

  /**
   * Cancels a specific order. If the order is present in dbOrders, also updates its isClosed status.
   * Works for both Spot and Contracts.
   * @param {string | Object} orderId OrderId or ordersDb object
   * @param {string} pair=config.defaultPair BTC/USDT for spot or BTCUSDT for perpetual
   * @param {string} orderSide Side, 'buy' or 'sell'. For logger.
   * @param {string} callerName For logger
   * @param {string} reasonToClose For logger
   * @param {Object} reasonObject Additional parameters to save in a closed DB order
   * @param {Object} [api=traderapi] Exchange API to use, can be the second trading account or perpetual API. If not set, the first account will be used.
   * @return {Promise<Object>} ordersDb object and cancellation statuses
   */
  async clearOrderById(orderId, pair = config.defaultPair, orderSide, callerName, reasonToClose, reasonObject, api = traderapi) {
    try {
      const onWhichAccount = api.isSecondAccount ? ' on second account' : '';
      const callerString = callerName ? ` (run by ${callerName})` : '';

      const { ordersDb } = db;

      let order;
      let isOrderFoundById;

      if (typeof orderId === 'object') {
        order = orderId;
        orderId = order._id;
      } else {
        order = await ordersDb.findOne({
          _id: orderId,
          exchange: config.exchange,
          pair,
          isSecondAccountOrder: api.isSecondAccount ? true : { $ne: true },
        });

        if (order) {
          isOrderFoundById = true;
        }
      }

      let note = '';
      let orderInfoString;

      // Prepare a note if the order is present in ordersDb and isProcessed

      if (order) {
        orderSide = order.side;

        const purposeIndexed = `${order.purpose}${order.moduleIndex > 1 ? order.moduleIndex : ''}`; // E.g., 'ld2' or 'man'
        orderInfoString = `${purposeIndexed}-order${order.subTypeString || order.subPurposeString || ''}${onWhichAccount} with id=${orderId}, side=${orderSide}, targetSide=${order.targetSide}, ladderIndex=${order.ladderIndex}, ladderState=${order.ladderState}, ladderBeforeFilledState=${order.ladderBeforeFilledState}, pair=${pair}, price=${order.price}, coin1Amount=${order.coin1Amount} (${order.coin1AmountLeft} left), coin2Amount=${order.coin2Amount}`;

        if (isOrderFoundById) {
          if (order.isProcessed) {
            note = ' Note: this order is found in ordersDb by ID and already marked as processed.';
          } else {
            note = ' Note: this order is found in ordersDb by ID but not processed yet.';
          }
        } else {
          if (order.isProcessed) {
            note = ' Note: this order is already marked as processed in ordersDb.';
          }
        }
      } else {
        orderInfoString = `order${onWhichAccount} with id=${orderId}, side=${orderSide}, pair=${pair}`;

        note = ' Note: this order was not found in ordersDb.';
      }

      let reasonToCloseString = '';
      if (reasonToClose) {
        reasonToCloseString =`, ${utils.trimAny(reasonToClose, ' .')}`;
      }

      log.log(`Order collector${callerString}: Clearing ${orderInfoString}${reasonToCloseString}.${note}`);

      let ordersDbString = note;

      // Cancel the orders

      const cancelReq = await api.cancelOrder(orderId, orderSide, pair);

      if (cancelReq !== undefined) {
        // Request finished in a valid way

        const isProcessedEarlier = order?.isProcessed;

        order?.update({
          isProcessed: true,
          isClosed: true,
        });

        if (reasonObject) {
          order?.update({
            ...reasonObject,
          });
        }

        if (cancelReq) {
          // Order cancelled

          if (order) {
            ordersDbString = ' Also marked it as cancelled in ordersDb.';

            order?.update({
              isCancelled: true,
            });
          }

          log.log(`Order collector: Successfully cancelled ${orderInfoString}${reasonToCloseString}.${ordersDbString}`);
        } else {
          // Exchange refused to cancel the order, it may be already cancelled earlier

          if (order) {
            if (isProcessedEarlier) {
              ordersDbString = ' It was already marked as processed in ordersDb.';
            } else {
              ordersDbString = ' Marking it as processed and closed in ordersDb.';
            }
          }

          log.log(`Order collector: Unable to cancel ${orderInfoString}. Probably it doesn't exist anymore.${ordersDbString}`);
        }
      } else {
        // Request to cancel an order failed

        if (order) {
          ordersDbString = ' Keeping this order in ordersDb.';
        }

        log.warn(`Order collector: Request to cancel ${orderInfoString} failed.${ordersDbString}`);
      }

      await order?.save();

      return {
        order,
        isOrderFoundInTheOrdersDb: !!order,
        isCancelRequestProcessed: cancelReq !== undefined,
        isOrderCancelled: cancelReq,
      };
    } catch (e) {
      log.error(`Error in clearOrderById() of ${moduleName}: ${e}.`);
    }
  },

  /**
   * Cancels locally known orders (from dbOrders only!) of specific purposes
   * Works for both Spot and Contracts.
   * @param {string[] | 'all'} purposes Cancel orders of these purposes
   * @param {string} pair BTC/USDT for spot or BTCUSDT for perpetual
   * @param {boolean} doForce=false Make several iterations to cancel orders to bypass API limitations
   * @param {string} orderSide If to cancel only 'buy' or 'sell' orders
   * @param {Object} filter Optional filter orders by parameters. For in-code usage only.
   *   Example: const filter = {
   *     price: { $gt: 0.00000033, $lt: 0.00000046 },
   *   };
   * @param {string} callerName For logger
   * @param {string} ordersString For logger
   * @param {Object} [api=traderapi] Exchange API to use, can be the second trading account or perpetual API. If not set, the first account will be used.
   * @param {''|string} [moduleIndexString=undefined] Set when closing only orders of specific module instance.
   *   Set '' for the first instance or '2'+ for others. '1' is not expected.
   *   E.g., '/clear ld2' closes only ld2-orders. Applies to all of [purposes].
   *   If moduleIndexString is undefined, closes orders of all module instances.
   * @return {Promise<Object>} totalOrders and more
   */
  async clearLocalOrders(purposes, pair, doForce = false, orderSide, filter, callerName, ordersString = 'orders', api = traderapi, moduleIndexString = undefined) {
    try {
      // Log clearLocalOrders request details

      const onWhichAccount = api.isSecondAccount ? ' on second account' : '';
      const callerString = callerName ? ` (run by ${callerName})` : '';

      ordersString = ordersString === 'orders' ?
          `${typeof purposes === 'object' ?
              purposes?.join(`${moduleIndexString},`) :
              purposes}-orders` :
          ordersString;
      const ordersStringForLog = ordersString + onWhichAccount;

      let logMessage = `Order collector${callerString}: Clearing locally stored ${ordersStringForLog} on ${pair} pair.`;

      if (orderSide || filter) {
        logMessage += ' Filter:';
        if (orderSide) logMessage += ` side ${orderSide}`;
        if (filter) logMessage += `, criteria ${JSON.stringify(filter)}`;
        logMessage += '.';
      }
      logMessage += ` doForce is ${doForce}.`;
      log.log(logMessage);

      // Retrieve orders from the database using criteria

      const { ordersDb } = db;

      const orderFilter = {
        isProcessed: false,
        pair,
        exchange: config.exchange,
        isSecondAccountOrder: api.isSecondAccount ? true : { $ne: true },
      };

      if (purposes !== 'all') {
        orderFilter.purpose = { $in: purposes };
      }

      if (orderSide) {
        orderFilter.side = orderSide;
      }

      if (moduleIndexString !== undefined) {
        if (moduleIndexString) { // '2'+
          orderFilter.moduleIndex = +moduleIndexString; // '2' -> 2 (number)
        } else { // ''
          orderFilter.$or = [
            { moduleIndex: 1 }, // moduleIndex is 1
            { moduleIndex: { $exists: false } }, // moduleIndex is not set
          ];
        }
      }

      Object.assign(orderFilter, filter);

      let ordersToClear = await ordersDb.find(orderFilter);

      const orderCountAll = ordersToClear.length;

      // Filter out not opened ld-orders, don't close them

      ordersToClear = ordersToClear.filter((order) => order.purpose !== 'ld' || constants.LADDER_OPENED_STATES.includes(order.ladderState));
      const orderCountOpened = ordersToClear.length;
      const orderCountHidden = orderCountAll - orderCountOpened;
      if (orderCountHidden > 0) {
        log.log(`Order collector: Ignoring ${orderCountHidden} not opened ld${moduleIndexString}-orders in states like Not opened, Filled.`);
      }

      // Create vars to store stats

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
            const moduleIndexStringOrder = order.moduleIndex > 1 ? order.moduleIndex : '';
            const purposeIndexed = `${order.purpose}${moduleIndexStringOrder}`; // E.g., 'ld2' or 'man'
            const orderInfoString = `${purposeIndexed}-order${order.subTypeString || order.subPurposeString || ''} with id=${order._id}, side=${order.side}, targetSide=${order.targetSide}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount} (${order.coin1AmountLeft} left), coin2Amount=${order.coin2Amount}`;

            const cancelReq = await api.cancelOrder(order._id, order.side, order.pair);

            if (cancelReq !== undefined) {
              if (cancelReq) {
                if (order.purpose === 'ld') {
                  // For ld-orders, additionally set ladderState to 'Cancelled'

                  const previousState = order.ladderState;

                  order.update({
                    ladderState: 'Cancelled',
                  });

                  log.log(`Order collector: Changing state of ${orderInfoString} from ${previousState} to ${order.ladderState}. If Ladder${moduleIndexStringOrder} module is enabled, it will be re-opened.`);
                }

                order.update({
                  isProcessed: true,
                  isCancelled: true,
                  isClosed: true,
                });

                log.log(`Order collector: Successfully cancelled ${orderInfoString}.`);

                clearedOrdersSuccess.push(order._id);

                if (order.side === 'buy') {
                  totalBidsQuote += order.coin2Amount;
                } else {
                  totalAsksAmount += order.coin1Amount;
                }
              } else {
                // Cancellation request succeeded, but the order was not actually cancelled — it likely no longer exists

                order.update({
                  isProcessed: true,
                  isClosed: true,
                });

                log.log(`Order collector: Unable to cancel ${orderInfoString}. It probably no longer exists. Marking as closed.`);

                clearedOrdersOnlyMarked.push(order._id);
              }

              await order.save();

              clearedOrdersAll.push(order._id);
            } else {
              log.log(`Order collector: Request to cancel ${orderInfoString} failed. Will try again next time, keeping this order in ordersDb for now.`);
            }
          }
        }

        notFinished = doForce && ordersToClear.length > clearedOrdersAll.length && tries < MAX_TRIES;
      } while (notFinished);

      logMessage = '';

      if (ordersToClear.length) {
        const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));

        if (clearedOrdersSuccess.length) {
          logMessage += `Successfully cancelled ${clearedOrdersSuccess.length} of ${ordersToClear.length} ${ordersStringForLog}:`;
          logMessage += ` ${totalBidsQuote.toFixed(formattedPair.coin2Decimals)} ${formattedPair.coin2} bids and ${totalAsksAmount.toFixed(formattedPair.coin1Decimals)} ${formattedPair.coin1} asks.`;
        } else {
          logMessage += `No ${ordersStringForLog} of total ${ordersToClear.length} were cancelled.`;
        }

        if (clearedOrdersOnlyMarked.length) {
          logMessage += ` ${clearedOrdersOnlyMarked.length} orders don't exist, marked them as closed.`;
        }
      } else {
        logMessage = ordersString === 'orders' ? `No orders${onWhichAccount} to cancel with these criteria.` : `No ${ordersStringForLog} to cancel.`;
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
      log.error(`Error in clearLocalOrders() of ${moduleName}: ${e}.`);
    }
  },

  /**
   * Cancels unknown orders (those not found in the bot's local dbOrders)
   * Works both with Spot and Contracts
   * Useful for cleanup when the exchange API reports an order as closed, but the order still remains active on the exchange
   * @param {string} pair BTC/USDT for spot or BTCUSDT for perpetual
   * @param {boolean} doForce=false Make several iterations to cancel orders to bypass API limitations
   * @param {string} orderSide If to cancel only 'buy' or 'sell' orders
   * @param {string} callerName For logger
   * @param {string} ordersString For logger
   * @param {Object} [api=traderapi] API instance to use: spot (first or second account) or perpetual. Defaults to the first spot API.
   * @param {boolean} [closeNotOpenedLd=true] Force to close ld-orders in [Not opened, Filled, Cancelled, Missed, To be removed, Removed] states. Regularly, it's up to the Ladder module to manage them.
   * @return {Promise<Object>} totalOrders and more
   */
  async clearUnknownOrders(pair, doForce = false, orderSide, callerName, ordersString = 'unknown orders', api = traderapi, closeNotOpenedLd = true) {
    try {
      const onWhichAccount = api.isSecondAccount ? ' on second account' : '';
      const ordersStringForLog = `${ordersString}${onWhichAccount}`;
      const callerString = callerName ? ` (run by ${callerName})` : '';

      const moduleNameFull = `${moduleName}-clearUnknownOrders`;

      let logMessage = `Order collector${callerString}: Clearing ${ordersStringForLog} on ${pair} pair, closeNotOpenedLd: ${closeNotOpenedLd}.`;
      if (orderSide) {
        logMessage += ` Filter: side ${orderSide}.`;
      }
      logMessage += ` doForce is ${doForce}.`;
      log.log(logMessage);

      const { ordersDb } = db;
      let dbOrders;

      const orderFilter = {
        isProcessed: false,
        pair, // BTC/USDT for spot or BTCUSDT for perpetual
        exchange: config.exchange,
        isSecondAccountOrder: api.isSecondAccount ? true : { $ne: true },
      };

      let orderSideString = '';
      if (orderSide) {
        orderFilter.side = orderSide;
        orderSideString = `${orderSide}-`;
      }

      dbOrders = await ordersDb.find(orderFilter);
      const totalOrdersCountBeforeUpdate = dbOrders.length;

      // Update orders that are partially filled or not found
      // For ld-orders, pay attention to the closeNotOpenedLd → hideNotOpened parameter
      dbOrders = await orderUtils.updateOrders(dbOrders, pair, moduleNameFull, undefined, api, closeNotOpenedLd);
      const totalOrdersCountAfterUpdate = dbOrders.length;

      const dbOrderIds = dbOrders.map((order) => {
        // While dbOrders stores ids in native format (can be number), getOpenOrders always returns ids as strings
        // Cast dbOrders ids to string for further comparison
        return order._id.toString();
      });

      let clearedOrdersCountAll = 0;
      let clearedOrdersCountSuccess = 0;
      let totalOrdersToClearCount;

      let openOrders = await orderUtils.getOpenOrdersCached(pair, moduleNameFull, undefined, api);

      if (orderSide) {
        openOrders = openOrders.filter((order) => order.side === orderSide);
      }

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
            if (!clearedOrders.includes(order.orderId) && !dbOrderIds.includes(order.orderId)) {
              const cancellation = await this.clearOrderById(
                  order.orderId, pair, orderSide, 'clearUnknownOrders()', `Batch cancellation for exchange ${pair} orders`, undefined, api);

              if (cancellation.isCancelRequestProcessed) {
                clearedOrders.push(order.orderId);
                clearedOrdersCountAll += 1;

                if (cancellation.isOrderCancelled) {
                  clearedOrdersCountSuccess += 1;

                // This order is likely not present in dbOrders, so isProcessed and similar flags are not updated
                // However, clearOrderById() may still perform these updates
                }
              }
            }
          }

          notFinished = doForce && totalOrdersToClearCount > clearedOrders.length && tries < MAX_TRIES;
        } while (notFinished);

        // Log results

        logMessage = '';
        let addLogMessage = `Filtered ${totalOrdersCountBeforeUpdate} ${orderSideString}orders in the local DB, ${totalOrdersCountAfterUpdate} left after update.`;
        addLogMessage += ` The exchange replied with ${openOrders.length} ${orderSideString}orders, unknown orders to clear ${openOrders.length}–${totalOrdersCountAfterUpdate}= ${totalOrdersToClearCount}. `;
        if (totalOrdersToClearCount > 0) {
          if (clearedOrdersCountSuccess) {
            logMessage += `Successfully cancelled ${clearedOrdersCountSuccess} of ${totalOrdersToClearCount} ${ordersString}.`;
          } else {
            logMessage += ` No ${ordersStringForLog} of total ${totalOrdersToClearCount} were cancelled.`;
          }
        } else {
          logMessage = `No ${ordersStringForLog} found.`;
        }

        log.log(`Order collector${callerString}: ${addLogMessage}${logMessage}`);
      } else {
        logMessage = `Unable to receive ${pair} open orders${onWhichAccount} from exchange to close Unknown orders. It seems API request failed. Try again later.`;
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
      log.error(`Error in clearUnknownOrders() of ${moduleName}: ${e}.`);
    }
  },

  /**
   * Cancels all open orders, including orders which are not in the bot's local dbOrders
   * It calls clearLocalOrders and clearUnknownOrders consequently
   * Works both with Spot and Contracts
   * @param {string} pair BTC/USDT for spot or BTCUSDT for perpetual
   * @param {boolean} doForce=false Make several iterations to cancel orders to bypass API limitations
   * @param {string} orderSide If to cancel only 'buy' or 'sell' orders
   * @param {string} callerName For logger
   * @param {string} ordersString For logger
   * @param {Object} [api=traderapi] Exchange API to use, can be the second trading account or perpetual API. If not set, the first account will be used.
   * @return {Promise<Object>} totalOrders and more
   */
  async clearAllOrders(pair, doForce = false, orderSide, callerName, ordersString = 'orders', api = traderapi) {
    try {
      const onWhichAccount = api.isSecondAccount ? ' on second account' : '';
      const ordersStringForLog = ordersString + onWhichAccount;

      const callerString = callerName ? ` (run by ${callerName})` : '';

      let logMessage = `Order collector${callerString}: Clearing all ${ordersStringForLog} on ${pair} pair.`;
      if (orderSide) {
        logMessage += ` Filter: side ${orderSide}.`;
      }
      logMessage += ` doForce is ${doForce}.`;
      log.log(logMessage);

      // First, close orders which are in bot's database, and mark them as closed
      // 'all' = all types of orders
      const clearedLocalInfo = await this.clearLocalOrders('all', pair, doForce, orderSide, undefined, `Order collector–${callerName}`, ordersString === 'orders' ? undefined : ordersString, api);

      if (!clearedLocalInfo) {
        logMessage = `Failed to clear locally stored orders${onWhichAccount}. Try again later.`;
        log.warn(`Order collector: ${logMessage}`);

        return {
          logMessage,
        };
      }

      // Next, close orders which are not closed yet (not in the local DB or not closed by other reason)
      const clearedUnknownInfo = await this.clearUnknownOrders(pair, doForce, orderSide, `Order collector–${callerName}`, ordersString === 'orders' ? undefined : ordersString, api, true);

      if (!utils.isPositiveOrZeroNumber(clearedUnknownInfo?.totalOrders)) {
        logMessage = `Failed to clear orders${onWhichAccount} received from exchange. Locally stored orders may be closed: ${clearedLocalInfo.logMessage} Error: ${clearedUnknownInfo?.logMessage}`;
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
          logMessage += `Successfully closed ${clearedOrders} of ${totalOrders} ${ordersStringForLog}:`;
          logMessage += ` ${clearedLocalOrders} of ${totalLocalOrders} locally stored, and ${clearedUnknownOrders} of ${totalUnknownOrders} received from exchange.`;
        } else {
          logMessage += `No ${ordersStringForLog} of total ${totalOrders} were cancelled.`;
        }
      } else {
        logMessage = `No ${ordersStringForLog} to cancel.`;
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
      log.error(`Error in clearAllOrders() of ${moduleName}: ${e}.`);
    }
  },
};

// If exchanges API is not stable, close t & unk orders regularly
if (config.clearAllOrdersInterval) {
  // Clear Trader orders every 120 sec — In case if API errors
  // This function is excessive as mm_trader triggers clearLocalOrders() manually if needed
  setInterval(() => {
    module.exports.clearLocalOrders(['t'], config.pair, undefined, undefined, undefined, 'Regular cleaner');
  }, 120 * 1000);

  // Clear unknown orders except not opened ld-orders (these are managed by the Ladder module)
  setInterval(() => {
    module.exports.clearUnknownOrders(config.pair, undefined, undefined, 'Regular cleaner', undefined, undefined, false);
  }, config.clearAllOrdersInterval * 60 * 1000);
}
