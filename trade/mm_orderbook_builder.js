/**
 * Places to and removes orders from order book in order to make it dynamic
 * Each iteration places up to MAX_ORDERS_PER_ITERATION orders
 * Maximum ob-order number is tradeParams.mm_orderBookOrdersCount
 */

/**
 * @module trade/mm_orderbook_builder
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 */

const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');

const tradeParams = require('./settings/tradeParams_' + config.exchange);

const TraderApi = require('./trader_' + config.exchange);
const isPerpetual = Boolean(config.perpetual);

const traderapi = isPerpetual ?
    require('../modules/perpetualApi')() :
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

const INTERVAL_MIN = 1500;
const INTERVAL_MAX = 3000;


// LIFETIME_MAX ~ 30 sec; — depends on mm_orderBookOrdersCount * LIFETIME_KOEF * 1000 * Math.cbrt(position))
// Also depends on traderapi.features().orderNumberLimit
const LIFETIME_MIN = 1500;
const LIFETIME_KOEF = 0.5;

const MAX_ORDERS_PER_ITERATION = 5; // Place up to 5 orders every iteration

let isPreviousIterationFinished = true;

const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(config.defaultPair));
const coin1 = formattedPair.coin1;
const coin2 = formattedPair.coin2;
const coin1Decimals = formattedPair.coin1Decimals;
const coin2Decimals = formattedPair.coin2Decimals;
const pair = formattedPair.pair;
const exchange = config.exchange;

module.exports = {
  readableModuleName: 'Order book builder',

  run() {
    this.iteration();
  },

  async iteration() {
    const interval = setPause();
    if (
      interval &&
      tradeParams.mm_isActive &&
      tradeParams.mm_isOrderBookActive &&
      constants.MM_POLICIES_REGULAR.includes(tradeParams.mm_Policy)
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
   * The main order book builder function
   * It's called regularly in each iteration()
   */
  async buildOrderBook() {
    try {
      const { ordersDb } = db;
      let obOrders = await ordersDb.find({
        isProcessed: false,
        purpose: 'ob', // ob: dynamic order book order
        pair,
        exchange,
      });

      obOrders = await orderUtils.updateOrders(obOrders, pair, utils.getModuleName(module.id) + ':ob-'); // Update orders which partially filled or not found
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
      log.error(`Error in buildOrderBook() of ${utils.getModuleName(module.id)} module: ${e}`);
    }
  },

  /**
   * Closes opened ob-orders:
   * - Expired by time
   * - Out of Pw's range
   * @param {Object[]} obOrders Orders of type ob, received from the internal DB
   * @return {Promise<Object[]>} Updated order list
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
              order, order.pair, order.type, this.readableModuleName, reasonToClose, reasonObject, traderapi);

          if (!cancellation.isCancelRequestProcessed) {
            updatedObOrders.push(order);
          }
        } else {
          updatedObOrders.push(order);
        }
      } catch (e) {
        log.error(`Error in closeObOrders() of ${utils.getModuleName(module.id)} module: ${e}`);
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
      const type = setType();

      const orderBook = await orderUtils.getOrderBookCached(pair, utils.getModuleName(module.id), true);

      if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
        log.warn(`Orderbook builder: Order books are empty for ${pair}, or temporary API error. Unable to check if I need to place ob-order.`);
        return;
      }

      let orderList = type === 'buy' ? orderBook.bids : orderBook.asks;
      // Remove duplicates by 'price' field
      orderList = orderList.filter((order, index, self) =>
        index === self.findIndex((o) => (
          o.price === order.price
        )),
      );

      if (!orderList || !orderList[0] || !orderList[1]) {
        log.warn(`Orderbook builder: Filtered ${type}-order count is less than 2 for ${pair}, or temporary API error. Unable to set a price while placing ob-order.`);
        return;
      }

      const position = setPosition(orderList.length);
      const priceReq = await setPrice(type, position, orderList);
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

      orderParamsString = `type=${type}, pair=${pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      if (!type || !price || !coin1Amount || !coin2Amount) {
        log.warn(`Orderbook builder: Unable to run ob-order of ${orderParamsString}.`);
        return;
      }

      // Check balances

      const balances = await orderUtils.isEnoughCoins(type, pair, coin1Amount, coin2Amount, 'ob', '', utils.getModuleName(module.id), traderapi);

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
          await traderapi.placeOrder(type, pair, price, coin1Amount, 'limit', null) :
          await traderapi.placeOrder(type, pair, price, coin1Amount, 1, null);

      if (orderReq?.orderId) {
        const { ordersDb } = db;

        const order = new ordersDb({
          _id: orderReq.orderId,
          date: utils.unixTimeStampMs(),
          dateTill: utils.unixTimeStampMs() + lifeTime,
          purpose: 'ob', // ob: dynamic order book order
          type,
          // targetType: type,
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

        output = `${type} ${coin1Amount.toFixed(coin1Decimals)} ${coin1} for ${coin2Amount.toFixed(coin2Decimals)} ${coin2} at ${price.toFixed(coin2Decimals)} ${coin2}`;
        output += ` with ${Math.round(lifeTime/1000)} sec life time`;
        log.info(`Orderbook builder: Successfully placed ob-order to ${output}. Opened ob-orders: ~${obOrderCount+1}.`);

        return true;
      } else {
        log.warn(`Orderbook builder: Unable to execute ob-order of ${orderParamsString}. No order id returned.`);
      }
    } catch (e) {
      log.error(`Error in placeObOrder() of ${utils.getModuleName(module.id)} module: ${e}`);
    }
  },
};

/**
 * Determines if to 'buy' or 'sell' for ob-order
 * @returns {'buy' | 'sell'}
*/
function setType() {
  // 1 minus tradeParams.mm_buyPercent
  const type = Math.random() > tradeParams.mm_buyPercent ? 'buy' : 'sell';

  return type;
}

/**
 * Calculates ob-order price
 * The function corrects a price to fit the Pw's range
 * @param {'buy' | 'sell'} type Order type
 * @param {number} position Position in the order book to place ob-order
 * @param {Object} orderList Current ob-orders
 * @returns {Promise<{ price: number | undefined, message: string | undefined }>}
*/
async function setPrice(type, position, orderList) {
  try {
    let output = '';

    let low; let high;

    if (orderList.length < position) {
      position = orderList.length;
    }

    if (type === 'sell') {
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
      const orderInfo = `${type} ob-order at ${price.toFixed(coin2Decimals)} ${coin2}`;

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
          log.log(`Orderbook builder: While placing ${orderInfo}, the Price watcher reported the price range is not actual. According to settings, ignore and treat this like the Pw is disabled.`);
        } else {
          log.log(`Orderbook builder: Skipped placing ${orderInfo}. Price watcher reported the price range is not actual.`);

          return {
            price: undefined,
          };
        }
      }
    }

    if (type === 'sell') {
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
      output = `Orderbook builder: Price watcher corrected price from ${priceBeforePwCorrection.toFixed(coin2Decimals)} ${coin2} to ${price.toFixed(coin2Decimals)} ${coin2} while placing ${type} ob-order. ${pw.getPwRangeString()}`;
      log.log(output);
    }

    return {
      price,
    };
  } catch (e) {
    log.error(`Error in setPrice() of ${utils.getModuleName(module.id)} module: ${e}`);
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
 * Sets random ob-order lifetime
 * The closer to the spread, the lesser life time
 * @param {number} position Position in the order book
 * @returns {number}
*/
function setLifeTime(position) {
  const lifetimeMax = tradeParams.mm_orderBookOrdersCount * LIFETIME_KOEF * 1000;
  let orderLifeTime = Math.round(utils.randomValue(LIFETIME_MIN, lifetimeMax, false) * Math.cbrt(position));

  if (utils.isPositiveInteger(traderapi.features().orderNumberLimit)) {
    orderLifeTime *= traderapi.features().orderNumberLimit;
  }

  return orderLifeTime;
}

/**
 * Sets interval to review order book in ms
 * @returns {number}
*/
function setPause() {
  return utils.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}
