/**
 * The module places and removes orders in the order book to keep it dynamic.
 * Each iteration places up to MAX_ORDERS_PER_ITERATION orders.
 * The maximum number of ob-orders is defined by `tradeParams.mm_orderBookOrdersCount`.
 * Supports both spot and perpetual contract trading.
 * For spot trading, always uses the first trading account, even when two-account trading is enabled.
 */

/**
 * @module trade/mm_orderbook_builder
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/ordersDb.d.js').BotOrderDbRecord} BotOrderDbRecord
 * @typedef {import('types/depth.d').DepthItem} DepthItem
 */

const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');

const tradeParams = require('./settings/tradeParams_' + config.exchange);

const TraderApi = require('./trader_' + config.exchange);
const isPerpetual = Boolean(config.perpetual);

const perpetualApiFactory = isPerpetual ? utils.softRequire('../modules/perpetualApi', __filename) : undefined;

if (isPerpetual && !perpetualApiFactory) {
  throw new Error('mm_orderbook_builder: config.perpetual is set but modules/perpetualApi.js is missing from this build.');
}

const traderapi = isPerpetual ?
    perpetualApiFactory() :
    TraderApi(
        config.apikey,
        config.apisecret,
        config.apipassword,
        log,
        undefined,
        undefined,
        config.exchange_socket,
        config.exchange_socket_pull,
    );

const db = require('../modules/DB');
const orderUtils = require('./orderUtils');
const orderCollector = require('./orderCollector');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

const INTERVAL_MIN = 2000;
const INTERVAL_MAX = 6000;

const LIFETIME_MIN = 2000;
const LIFETIME_MAX_KOEF = 0.5; // LIFETIME_MAX ~ 30 sec; Calculated as `mm_orderBookOrdersCount * LIFETIME_KOEF * 1000`

const MAX_ORDERS_PER_ITERATION = 5; // Place up to 5 orders every iteration

let isPreviousIterationFinished = true;

const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(config.defaultPair));
const { pair, coin1, coin2, coin1Decimals, coin2Decimals } = formattedPair;
const exchange = config.exchange;

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

log.log(`Module ${moduleName} is loaded.`);

module.exports = {
  readableModuleName: 'Order book builder',

  run() {
    this.iteration();
  },

  /**
   * Executes the order book builder instance loop at a time interval,
   * as long as it is enabled.
   */
  async iteration() {
    const interval = setPause();
    if (
      interval &&
      tradeParams.mm_isActive &&
      tradeParams.mm_isOrderBookActive &&
      (
        !tradeParams.mm_isTraderActive ||
        constants.MM_POLICIES_REGULAR.includes(tradeParams.mm_Policy)
      )
    ) {
      if (isPreviousIterationFinished) {
        isPreviousIterationFinished = false;
        await this.buildOrderBook();
        isPreviousIterationFinished = true;
      } else {
        log.log(`Orderbook builder: Postponing iteration of the order book builder for ${interval} ms. Previous iteration is in progress yet.`);
      }
      setTimeout(() => {
        this.iteration();
      }, interval);
    } else {
      setTimeout(() => {
        this.iteration();
      }, 3000); // Check for config.mm_isActive every 3 seconds
    }
  },

  /**
   * The main order book builder function.
   * Removes outdated ob-orders and places new ones.
   * Called regularly on each `iteration()`.
   */
  async buildOrderBook() {
    try {
      const { ordersDb } = db;
      /** @type {BotOrderDbRecord[]} */
      let obOrders = await ordersDb.find({
        isProcessed: false,
        purpose: 'ob', // ob: dynamic order book order
        pair,
        exchange,
      });

      obOrders = await orderUtils.updateOrders(obOrders, pair, moduleName + ':ob-', undefined, traderapi); // Update orders which partially filled or not found
      obOrders = await this.closeObOrders(obOrders);

      let ordersToPlace = utils.randomValue(1, MAX_ORDERS_PER_ITERATION, true);
      let obOrderCount = obOrders.length;

      while (ordersToPlace > 0 && obOrderCount < tradeParams.mm_orderBookOrdersCount) {
        ordersToPlace--;

        if (await this.placeObOrder(obOrderCount)) {
          obOrderCount++;
        }
      }

      log.log(`Orderbook builder: ${obOrderCount} ob-orders opened.`);
    } catch (e) {
      log.error(`Error in buildOrderBook() of ${moduleName} module: ${e}`);
    }
  },

  /**
   * Closes opened ob-orders:
   * - Expired by time
   * - Out of Pw's range
   * @param {BotOrderDbRecord[]} obOrders Orders of purpose 'ob', received from the internal DB
   * @return {Promise<BotOrderDbRecord[]>} Updated order list
   */
  async closeObOrders(obOrders) {
    const updatedObOrders = [];

    for (const order of obOrders) {
      try {
        let reasonToClose = '';
        const reasonObject = {};

        if (order.dateTill < utils.unixTimeStampMs()) {
          reasonToClose = 'It\'s expired.';
          reasonObject.isExpired = true;
        } else if (utils.isOrderOutOfPriceWatcherRange(order)) {
          const pw = require('./mm_price_watcher');
          reasonToClose = `It's out of ${pw.getPwRangeString()}`;
          reasonObject.isOutOfPwRange = true;
        }

        if (reasonToClose) {
          const cancellation = await orderCollector.clearOrderById(
              order, order.pair, order.side, this.readableModuleName, reasonToClose, reasonObject, traderapi);

          if (!cancellation.isCancelRequestProcessed) {
            updatedObOrders.push(order);
          }
        } else {
          updatedObOrders.push(order);
        }
      } catch (e) {
        log.error(`Error in closeObOrders() of ${moduleName} module: ${e}`);
      }
    }

    return updatedObOrders;
  },

  /**
   * Places new ob-order
   * @param {number} obOrderCount Number of opened ob-orders, for logging
   * @return {Promise<boolean | undefined>} Order placed or not
   */
  async placeObOrder(obOrderCount) {
    try {
      const side = setSide();

      const orderBook = await orderUtils.getOrderBookCached(pair, moduleName, true);

      if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
        log.warn(`Orderbook builder: Order books are empty for ${pair}, or a temporary API error occurred. Unable to determine whether an ob-order should be placed.`);
        return;
      }

      let orderList = side === 'buy' ? orderBook.bids : orderBook.asks;
      // Remove duplicates by 'price' field
      orderList = orderList.filter((order, index, self) =>
        index === self.findIndex((o) => (
          o.price === order.price
        )),
      );

      if (!orderList || !orderList[0] || !orderList[1]) {
        log.warn(`Orderbook builder: Filtered ${side}-order count is less than 2 for ${pair}, or a temporary API error occurred. Unable to determine a price for placing an ob-order.`);
        return;
      }

      const position = setPosition(orderList.length);
      const priceReq = await setPrice(side, position, orderList);
      const priceError = priceReq.message;
      const price = priceReq.price;
      const coin1Amount = setAmount();
      const coin2Amount = coin1Amount * price;
      const lifeTime = setLifeTime(position);

      let output = '';
      let orderParamsString = '';

      // Verify ob-order price

      if (!price) {
        if (priceError && (Date.now()-lastNotifyPriceTimestamp > constants.HOUR)) {
          notify(`${config.notifyName}: ${priceReq.message}`, 'warn'); // Currently, there is no priceReq.message
          lastNotifyPriceTimestamp = Date.now();
        }

        return;
      }

      orderParamsString = `side=${side}, pair=${pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      if (!side || !price || !coin1Amount || !coin2Amount) {
        log.warn(`Orderbook builder: Unable to run ob-order of ${orderParamsString}.`);
        return;
      }

      // Check balances

      const balances = await orderUtils.isEnoughCoins(side, pair, coin1Amount, coin2Amount, 'ob', '', moduleName, traderapi);

      if (!balances.result) {
        if (balances.message) {
          if (Date.now()-lastNotifyBalancesTimestamp > constants.HOUR) {
            notify(`${config.notifyName}: ${balances.message}`, 'warn', config.silent_mode);
            lastNotifyBalancesTimestamp = Date.now();
          } else {
            log.log(`Orderbook builder: ${balances.message}`);
          }
        }

        return;
      }

      const orderReq = isPerpetual ?
          await traderapi.placeOrder(side, pair, price, coin1Amount, 'limit') :
          await traderapi.placeOrder(side, pair, price, coin1Amount, 1, null);

      if (orderReq?.orderId) {
        const { ordersDb } = db;

        /** @type {BotOrderDbRecord} */
        const order = new ordersDb({
          _id: orderReq.orderId,
          date: utils.unixTimeStampMs(),
          dateTill: utils.unixTimeStampMs() + lifeTime,
          purpose: 'ob', // ob: dynamic order book order
          side,
          // targetSide: side,
          exchange,
          pair,
          coin1,
          coin2,
          price,
          coin1Amount,
          coin2Amount,
          coin1AmountFilled: undefined,
          coin2AmountFilled: undefined,
          coin1AmountLeft: coin1Amount,
          coin2AmountLeft: coin2Amount,
          LimitOrMarket: 1, // 1 for limit price. 0 for Market price.
          isProcessed: false,
          isExecuted: false,
          isCancelled: false,
          isClosed: false,
        });

        await order.save();

        output = `${side} ${coin1Amount.toFixed(coin1Decimals)} ${coin1} for ${coin2Amount.toFixed(coin2Decimals)} ${coin2} at ${price.toFixed(coin2Decimals)} ${coin2}`;
        output += ` with ${Math.round(lifeTime/1000)} sec life time`;
        log.info(`Orderbook builder: Successfully placed ob-order to ${output}. Opened ob-orders: ~${obOrderCount+1}.`);

        return true;
      } else {
        log.warn(`Orderbook builder: Unable to execute ob-order of ${orderParamsString}. No order id returned.`);
      }
    } catch (e) {
      log.error(`Error in placeObOrder() of ${moduleName} module: ${e}`);
    }
  },
};

/**
 * Determines if to 'buy' or 'sell' for ob-order
 * @returns {'buy' | 'sell'}
*/
function setSide() {
  // 1 minus tradeParams.mm_buyPercent
  const side = Math.random() > tradeParams.mm_buyPercent ? 'buy' : 'sell';

  return side;
}

/**
 * Calculates ob-order price
 * The function corrects a price to fit the Pw's range
 * @param {'buy' | 'sell'} side Order side
 * @param {number} position Position in the order book to place ob-order
 * @param {DepthItem[]} orderList Current order book side items
 * @returns {Promise<{ price?: number, message?: string } | undefined >}
*/
async function setPrice(side, position, orderList) {
  try {
    let output = '';

    let low; let high;

    if (orderList.length < position) {
      position = orderList.length;
    }

    if (side === 'sell') {
      low = orderList[position-2].price;
      high = orderList[position-1].price;
    } else {
      low = orderList[position-1].price;
      high = orderList[position-2].price;
    }

    const precision = utils.getPrecision(coin2Decimals);

    // Put orders between current orders, but not with the same price
    if (low + precision < high) {
      low += precision;
    }
    if (high - precision > low) {
      high -= precision;
    }

    let price = utils.randomValue(low, high);
    let pwLowPrice; let pwHighPrice; let priceBeforePwCorrection;

    const pw = require('./mm_price_watcher');

    if (pw.getIsPriceWatcherEnabled()) {
      const orderInfo = `${side} ob-order at ${price.toFixed(coin2Decimals)} ${coin2}`;

      if (pw.getIsPriceAnomaly()) {
        log.log(`Orderbook builder: Skipped placing ${orderInfo}. Price watcher reported a price anomaly.`);

        return {
          price: undefined,
        };
      } else if (pw.getIsPriceActual()) {
        pwLowPrice = pw.getLowPrice();
        pwHighPrice = pw.getHighPrice();
      } else {
        if (pw.getIgnorePriceNotActual()) {
          log.log(`Orderbook builder: While placing ${orderInfo}, the Price Watcher reported that the price range is not actual. According to settings, ignore this and treat it as if Pw is disabled.`);
        } else {
          log.log(`Orderbook builder: Skipped placing ${orderInfo}. Price Watcher reported that the price range is not actual.`);

          return {
            price: undefined,
          };
        }
      }
    }

    if (side === 'sell') {
      if (pwLowPrice && price < pwLowPrice) {
        priceBeforePwCorrection = price;
        const maxVisiblePrice = orderList[tradeParams.mm_orderBookHeight]?.price;

        if (pwLowPrice < maxVisiblePrice) {
          price = utils.randomValue(pwLowPrice, maxVisiblePrice);
        } else {
          price = utils.randomValue(pwLowPrice, maxVisiblePrice * 1.05);
        }
      }
    } else {
      if (pwHighPrice && price > pwHighPrice) {
        priceBeforePwCorrection = price;
        const minVisiblePrice = orderList[tradeParams.mm_orderBookHeight]?.price;

        if (minVisiblePrice < pwHighPrice) {
          price = utils.randomValue(minVisiblePrice, pwHighPrice);
        } else {
          price = utils.randomValue(pwHighPrice * 0.95, pwHighPrice);
        }
      }
    }

    if (priceBeforePwCorrection) {
      output = `Orderbook builder: Price watcher corrected price from ${priceBeforePwCorrection.toFixed(coin2Decimals)} ${coin2} to ${price.toFixed(coin2Decimals)} ${coin2} while placing ${side} ob-order. ${pw.getPwRangeString()}`;
      log.log(output);
    }

    return {
      price,
    };
  } catch (e) {
    log.error(`Error in setPrice() of ${moduleName} module: ${e}`);
  }
}

/**
 * Sets randomized order amount
 * @returns {number} Amount to place order in order book
*/
function setAmount() {
  const min = tradeParams.mm_minAmount;
  let max = tradeParams.mm_maxAmount;

  if (tradeParams.mm_orderBookMaxOrderPercent) {
    max = max * tradeParams.mm_orderBookMaxOrderPercent / 100;

    if (max <= min) {
      max = min * 1.1;
    }
  }

  return utils.randomValue(min, max);
}

/**
 * Sets random ob-order position in the order book
 * @param {number} orderCount Count of orders in the order book (buy or sell side)
 * @returns {number}
*/
function setPosition(orderCount) {
  const maxPosition = Math.min(orderCount, tradeParams.mm_orderBookHeight);

  return utils.randomValue(2, maxPosition, true);
}

/**
 * Calculates a random lifetime for an order-book (ob) order, in milliseconds.
 * The closer the order is to the spread, the shorter its lifetime becomes.
 * @param {number} position Position of the order in the order book
 * @returns {number} Order lifetime in milliseconds
 */
function setLifeTime(position) {
  const lifetimeMax = tradeParams.mm_orderBookOrdersCount * LIFETIME_MAX_KOEF * 1000;
  const orderLifeTime = Math.round(utils.randomValue(LIFETIME_MIN, lifetimeMax, false) * Math.cbrt(position));

  return orderLifeTime;
}

/**
 * Sets interval to review order book in ms
 * @returns {number}
*/
function setPause() {
  return utils.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}
