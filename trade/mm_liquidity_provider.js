/**
 * Places orders in ±mm_liquiditySpreadPercent with mm_liquiditySellAmount and mm_liquidityBuyQuoteAmount
 * So it also maintains mm_liquiditySpreadPercent spread
 * mm_liquidityTrend determines how to fill the gap: middle, downtrend, or uptrend
 */

const utils = require('../helpers/utils');
const constants = require('../helpers/const');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./settings/tradeParams_' + config.exchange);
const Store = require('../modules/Store');

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

const db = require('../modules/DB');
const orderUtils = require('./orderUtils');
const exchangerUtils = require('../helpers/cryptos/exchanger');
const orderCollector = require('./orderCollector');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

const INTERVAL_MIN = 10 * 1000;
const INTERVAL_MAX = 20 * 1000;
const LIFETIME_MIN = 1000 * 60 * 7; // 7 minutes
const LIFETIME_MAX = constants.HOUR * 7; // 7 hours
const DEFAULT_MAX_ORDERS_ONE_SIDE = 9;

const minMaxAmounts = {}; // Stores min-max amounts for different order types (buy, sell) and subPurposes (depth, ss)

// For safe liquidity, we calculate actual limits from mm_liquidityBuyQuoteAmount and mm_liquiditySellAmount
// These limits consider balance between how much actually bought and sold
let liqLimits = {};

let isPreviousIterationFinished = true;

module.exports = {
  readableModuleName: 'Liquidity',

  run() {
    this.iteration();
  },

  async iteration() {
    const interval = setPause();
    if (
      interval &&
      tradeParams.mm_isActive &&
      tradeParams.mm_isLiquidityActive &&
      constants.MM_POLICIES_REGULAR.includes(tradeParams.mm_Policy)
    ) {
      if (isPreviousIterationFinished) {
        isPreviousIterationFinished = false;
        await this.updateLiquidity();
        isPreviousIterationFinished = true;
      } else {
        log.log(`Liquidity: Postponing iteration of the liquidity provider for ${interval} ms. Previous iteration is in progress yet.`);
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
   * The main part of Liquidity provider
   * Updates (closes) current liq-orders, places spread support liq-orders, and then depth (regular) liq-orders, logs stats
   */
  async updateLiquidity() {
    try {
      const coin1Decimals = orderUtils.parseMarket(config.pair).coin1Decimals;
      const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

      const { ordersDb } = db;
      let liquidityOrders = await ordersDb.find({
        isProcessed: false,
        purpose: 'liq', // liq: liquidity order
        pair: config.pair,
        exchange: config.exchange,
      });

      const orderBook = await traderapi.getOrderBook(config.pair);
      const orderBookInfo = utils.getOrderBookInfo(orderBook, tradeParams.mm_liquiditySpreadPercent);

      if (!orderBookInfo) {
        log.warn(`Liquidity: Order books are empty for ${config.pair}, or temporary API error. Unable to get spread info while placing liq-orders.`);
        return;
      }

      if (!setMinMaxAmounts(orderBookInfo.highestBid)) {
        log.warn('Liquidity: Unable to calculate min-max amounts while placing liq-orders.');
        return;
      }

      liquidityOrders = await orderUtils.updateOrders(liquidityOrders, config.pair, utils.getModuleName(module.id) + ':liq-'); // update orders which partially filled or not found
      liquidityOrders = await this.closeLiquidityOrders(liquidityOrders, orderBookInfo); // close orders which expired or out of spread or out pf Pw's range

      let liqInfoString; let liqSsInfoString;

      // 2. Place regular (depth) liq-orders

      const liquidityDepthOrders = liquidityOrders.filter((order) => order.subPurpose !== 'ss');
      const liquidityDepthStats = utils.calculateOrderStats(liquidityDepthOrders);

      let amountPlaced;

      do {
        amountPlaced = await this.placeLiquidityOrder(liquidityDepthStats.bidsTotalQuoteAmount, liquidityDepthStats.bidsCount, 'buy', orderBookInfo, 'depth');
        if (amountPlaced) {
          liquidityDepthStats.bidsTotalQuoteAmount += amountPlaced;
          liquidityDepthStats.bidsCount += 1;
        }
      } while (amountPlaced);

      do {
        amountPlaced = await this.placeLiquidityOrder(liquidityDepthStats.asksTotalAmount, liquidityDepthStats.asksCount, 'sell', orderBookInfo, 'depth');
        if (amountPlaced) {
          liquidityDepthStats.asksTotalAmount += amountPlaced;
          liquidityDepthStats.asksCount += 1;
        }
      } while (amountPlaced);

      liqInfoString = `Liquidity: Opened ${liquidityDepthStats.bidsCount} bids-buy depth orders for ${liquidityDepthStats.bidsTotalQuoteAmount.toFixed(coin2Decimals)} ${config.coin2} out of ${tradeParams.mm_liquidityBuyQuoteAmount} (safe: ${liqLimits.bidLimit.toFixed(coin2Decimals)} ${config.coin2}, ${liqLimits.bidLimitPercent.toFixed(2)}%)`;
      liqInfoString += ` and ${liquidityDepthStats.asksCount} asks-sell depth orders with ${liquidityDepthStats.asksTotalAmount.toFixed(coin1Decimals)} ${config.coin1} out of ${tradeParams.mm_liquiditySellAmount} (safe: ${liqLimits.askLimit.toFixed(coin1Decimals)} ${config.coin1}, ${liqLimits.askLimitPercent.toFixed(2)}%) ${config.coin1}.`;
      liqInfoString += liqSsInfoString;

      log.log(liqInfoString);
    } catch (e) {
      log.error(`Error in updateLiquidity() of ${utils.getModuleName(module.id)} module: ${e}`);
    }
  },

  /**
   * Sets liquidity trend to fill a gap in the order book after a price change
   * Runs extraordinary iteration of updateLiquidity(), which will close out-of-spread and out-of-pw orders
   * Other modules as Spread maintainer call this function
   * @param {string} orderType Placed order type, 'buy' or 'sell'
   * @param {string} callerName Module name for logging
   */
  async updateLiquidityAfterPriceChange(orderType, callerName) {
    log.log(`${callerName}: Updating ${orderType} liq-orders after a price change.`);

    if (isPreviousIterationFinished) {
      const previousLiquidityTrend = tradeParams.mm_liquidityTrend;
      tradeParams.mm_liquidityTrend = orderType === 'buy' ? 'uptrend' : 'downtrend';

      // utils.saveConfig(false, 'Liquidity-UpdateTrend'); // Don't save, it's a one-time operation
      log.log(`${callerName}: After a price change with a ${orderType}-order, one-time liquidity trend set to '${tradeParams.mm_liquidityTrend}' from '${previousLiquidityTrend}'.`);

      isPreviousIterationFinished = false;
      await this.updateLiquidity();
      isPreviousIterationFinished = true;

      tradeParams.mm_liquidityTrend = previousLiquidityTrend;
    } else {
      log.log(`${callerName}: Skipping liq-orders update as previous iteration is in progress.`);
    }
  },

  /**
   * Closes opened liq-orders:
   * - Expired by time
   * - Out of Spread
   * - Out of Pw's range
   * @param {Array<Object>} liquidityOrders Orders of type liq, received from internal DB
   * @param {Object} orderBookInfo Object of utils.getOrderBookInfo() to check if an order is out of spread
   * @returns {Array<Object>} Updated order list
   */
  async closeLiquidityOrders(liquidityOrders, orderBookInfo) {
    const updatedLiquidityOrders = [];

    for (const order of liquidityOrders) {
      try {
        let reasonToClose = ''; const reasonObject = {};

        if (order.dateTill < utils.unixTimeStampMs()) {
          reasonToClose = 'It\'s expired.';
          reasonObject.isExpired = true;
        } else if (utils.isOrderOutOfPriceWatcherRange(order)) {
          const pw = require('./mm_price_watcher');
          reasonToClose = `It's out of ${pw.getPwRangeString()}`;
          reasonObject.isOutOfPwRange = true;
        } else {
          const outOfSpreadInfo = utils.isOrderOutOfSpread(order, orderBookInfo);

          if (outOfSpreadInfo?.isOrderOutOfSpread) {
            const pairObj = orderUtils.parseMarket(order.pair);
            const coin2Decimals = pairObj.coin2Decimals;

            let outOfSpreadString;

            if (outOfSpreadInfo.isOrderOutOfMinMaxSpread) {
              outOfSpreadString = `Its price ${outOfSpreadInfo.orderPrice.toFixed(coin2Decimals)} ${pairObj.coin2} out of ±${outOfSpreadInfo.spreadPercent}% spread: [${outOfSpreadInfo.minPrice.toFixed(coin2Decimals)}, ${outOfSpreadInfo.maxPrice.toFixed(coin2Decimals)}].`;
            } else {
              outOfSpreadString = `Its price ${outOfSpreadInfo.orderPrice.toFixed(coin2Decimals)} ${pairObj.coin2} in the ±${outOfSpreadInfo.spreadPercentMin}% disallowed inner spread: [${outOfSpreadInfo.innerLowPrice.toFixed(coin2Decimals)}, ${outOfSpreadInfo.innerHighPrice.toFixed(coin2Decimals)}].`;
            }

            reasonObject.isOutOfSpread = true;

            if (order.priceCorrected) {
              log.log(`Liquidity: While the ${order.type} liq-order${order.subPurposeString} with id=${order._id} is placed out of spread, we did it intentionally because of Pw or TWAP correction. Details: ${outOfSpreadString}`);
            } else {
              reasonToClose = outOfSpreadString;
            }
          }
        }

        if (reasonToClose) {
          const cancellation = await orderCollector.clearOrderById(
              order, order.pair, order.type, this.readableModuleName, reasonToClose, reasonObject, traderapi);

          if (!cancellation.isCancelRequestProcessed) {
            updatedLiquidityOrders.push(order);
          }
        } else {
          updatedLiquidityOrders.push(order);
        }
      } catch (e) {
        log.error(`Error in closeLiquidityOrders() of ${utils.getModuleName(module.id)} module: ${e}`);
      }
    }

    return updatedLiquidityOrders;
  },

  /**
   * Places a new Liquidity order (liq type)
   * Sets an order price. Spread support orders are closer to the middle of the spread.
   * Sets an order amount. Spread support orders are of small amounts.
   * Checks for balances. If not enough balances, notify/log, and return false.
   * Don't exceed liquidity amount/quote for depth liq-orders, and order number for spread support liq-orders
   * @param {number} totalQtyPlaced Amount for buy-orders and Quote for sell-orders already placed for liq-orders in total
   * @param {number} totalOrdersPlaced Liq-order number in total (one side)
   * @param {string} orderType Type of an order, 'buy' or 'sell'
   * @param {Object} orderBookInfo Order book info to calculate an order price
   * @param {string} subPurpose 'depth' for regular depth liq-orders, 'ss' for spread support liq-orders
   * @return {Object} Result and reason in case of fault
   */
  async placeLiquidityOrder(totalQtyPlaced, totalOrdersPlaced, orderType, orderBookInfo, subPurpose) {
    try {
      const liqPair = orderUtils.parseMarket(config.pair);

      const type = orderType;
      const subPurposeString = subPurpose === 'ss' ? ' (spread support)' : ' (depth)';

      const isOverLiquidityOrder = type === 'sell' ? // Because of the safe liquidity feature, the bot can move liquidity between asks and bids; Actual liquidity can be larger than initial.
          totalQtyPlaced > tradeParams.mm_liquiditySellAmount :
          totalQtyPlaced > tradeParams.mm_liquidityBuyQuoteAmount;

      const priceReq = await setPrice(type, orderBookInfo, subPurpose, subPurposeString, isOverLiquidityOrder);
      const price = priceReq.price;
      if (!price) {
        if (priceReq.message) {
          if (Date.now()-lastNotifyPriceTimestamp > constants.HOUR) {
            notify(priceReq.message, 'warn');
            lastNotifyPriceTimestamp = Date.now();
          } else {
            log.log(`Liquidity: ${priceReq.message}`);
          }
        }
        return;
      }

      const coin1Amount = setAmount(type, subPurpose);
      const coin2Amount = coin1Amount * price;
      const lifeTime = setLifeTime();

      let output = '';
      let orderParamsString = '';

      orderParamsString = `type=${type}, pair=${liqPair.pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      if (!type || !price || !coin1Amount || !coin2Amount) {
        log.warn(`Liquidity: Unable to run liq-order${subPurposeString} with params: ${orderParamsString}.`);
        return;
      }

      if (subPurpose === 'ss') {
        // Don't exceed order number for spread support liq-orders
        if (totalOrdersPlaced >= minMaxAmounts.ss[type].orders) {
          return false;
        }
      } else {
        // Don't exceed liquidity amount/quote for depth liq-orders
        if (type === 'sell') {
          if (coin1Amount + totalQtyPlaced > liqLimits.askLimit) {
            return false;
          }
        } else {
          if (coin2Amount + totalQtyPlaced > liqLimits.bidLimit) {
            return false;
          }
        }
      }

      if (priceReq.message) {
        log.log(`Liquidity: ${priceReq.message}`);
      }

      // Check balances
      const balances = await orderUtils.isEnoughCoins(type, liqPair, coin1Amount, coin2Amount, 'liq', '', this.readableModuleName);

      if (!balances.result) {
        if (balances.message) {
          if (Date.now()-lastNotifyBalancesTimestamp > constants.HOUR) {
            notify(`${config.notifyName}: ${balances.message}`, 'warn', config.silent_mode);
            lastNotifyBalancesTimestamp = Date.now();
          } else {
            log.log(`Liquidity: ${balances.message}`);
          }
        }
        return;
      }

      const orderReq = await traderapi.placeOrder(type, liqPair.pair, price, coin1Amount, 1, null);

      if (orderReq?.orderId) {
        const { ordersDb } = db;

        const order = new ordersDb({
          _id: orderReq.orderId,
          date: utils.unixTimeStampMs(),
          dateTill: utils.unixTimeStampMs() + lifeTime,
          purpose: 'liq', // liq: liquidity & spread
          subPurpose,
          subPurposeString,
          type,
          // targetType: type,
          exchange: config.exchange,
          pair: liqPair.pair,
          coin1: liqPair.coin1,
          coin2: liqPair.coin2,
          price,
          priceCorrected: priceReq.isCorrected, // If the price is corrected by Pw or TWAP range intentionally, closeLiquidityOrders() will not close the order in case of out of ±% spread
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

        output = `${type} ${coin1Amount.toFixed(liqPair.coin1Decimals)} ${liqPair.coin1} for ${coin2Amount.toFixed(liqPair.coin2Decimals)} ${liqPair.coin2} at ${price.toFixed(liqPair.coin2Decimals)} ${liqPair.coin2}`;
        log.info(`Liquidity: Successfully placed liq-order${subPurposeString} to ${output}.`);

        return type === 'sell' ? coin1Amount : coin2Amount;
      } else {
        log.warn(`Liquidity: Unable to execute liq-order${subPurposeString} with params: ${orderParamsString}. No order id returned.`);
        return false;
      }
    } catch (e) {
      log.error(`Error in placeLiquidityOrder() of ${utils.getModuleName(module.id)} module: ${e}`);
    }
  },

  /**
   * Loads ask and bid liq-order limits from systemsDb
   * If it's not stored yet, use the initial values
   */
  async loadLiqLimits() {
    liqLimits = await Store.getSystemDbField('liqLimits');

    if (utils.isObjectNotEmpty(liqLimits)) {
      log.log(`Liquidity: Limits for liq-orders are loaded for the database: ${JSON.stringify(liqLimits)}.`);
    } else {
      log.log('Liquidity: Limits for liq-orders are not stored in the database yet. Applying initial limits.');
      await this.resetLiqLimits('all', `${this.readableModuleName}/InitLimits`);
    }
  },

  /**
   * Loads ask and bid liq-order limits from systemsDb
   * If it's not stored yet, use the initial values
   * @param {string} callerName Who did store, for logging
   */
  async storeLiqLimits(callerName) {
    if (utils.isObjectNotEmpty(liqLimits)) {
      await Store.updateSystemDbField('liqLimits', liqLimits);
      log.log(`Liquidity: Limits for liq-orders are stored by ${callerName} in the database: ${JSON.stringify(liqLimits)}.`);
    } else {
      log.log(`Liquidity: Limits are empty: ${JSON.stringify(liqLimits)}. Skipping storing in the database.`);
    }
  },

  /**
   * Restores ask and bid liq-order limits in full to mm_liquidityBuyQuoteAmount and mm_liquiditySellAmount
   * @param {string} type Type of an order, 'buy' or 'sell'
   * @param {string} callerName Who did reset, for logging
   */
  async resetLiqLimits(type, callerName) {
    liqLimits = {
      bidLimit: tradeParams.mm_liquidityBuyQuoteAmount,
      askLimit: tradeParams.mm_liquiditySellAmount,
      bidLimitPercent: 100,
      askLimitPercent: 100,
      totalBidFilledAmount: 0,
      totalAskFilledAmount: 0,
      totalBidFilledQuote: 0,
      totalAskFilledQuote: 0,
      soldTwap: 0,
      boughtTwap: 0,
    };

    await this.storeLiqLimits(`${this.readableModuleName}/ResetLiqLimits`);

    log.log(`Liquidity: Limits for ${type} liq-orders are reset by ${callerName} to initial values: ${JSON.stringify(liqLimits)}.`);
  },

  /**
   * Returns actual liq-order limits
   * Used in other modules instead of mm_liquidityBuyQuoteAmount and mm_liquiditySellAmount
   */
  getLiqLimits() {
    return liqLimits;
  },

  /**
   * Creates a log string with TWAP range
   * @returns {string} Log string
   */
  getTwapRangeString() {
    const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

    const lowerBound = liqLimits?.boughtTwap?.toFixed(coin2Decimals) || 'NaN';
    const upperBound = liqLimits?.soldTwap?.toFixed(coin2Decimals) || 'NaN';

    return `TWAP range – buying below ${upperBound} ${config.coin2} and selling above ${lowerBound} ${config.coin2}.`;
  },
};

/**
 * Calculates an order price for a specific order type and subPurpose
 * The price is relative to the middle of the spread, which depends on mm_liquidityTrend
 * Spread support liq-orders are closer to the middle of the spread
 * Price watcher and current TWAP range may correct a price
 * @param {string} type Type of an order, 'buy' or 'sell'
 * @param {Object} orderBookInfo Includes average prices for different mm_liquidityTrend
 * @param {string} subPurpose 'depth' for regular depth liq-orders, 'ss' for spread support liq-orders
 * @param {string} subPurposeString For informative logging
 * @param {boolean} isOverLiquidityOrder If an order is over the initial liquidity, the bot places it closer to the spread independent from mm_liquiditySpreadPercentMin
 * @return {Object<price, message>} Message is an error message to notify
 */
async function setPrice(type, orderBookInfo, subPurpose, subPurposeString, isOverLiquidityOrder) {
  try {
    let high; let low;
    let targetPrice;
    let message = '';

    /**
     * trendAveragePrice is a price between highestBid and lowestAsk (in spread)
     * middleAveragePrice is randomly ±15% closer to the middle of spread
     * uptrendAveragePrice is randomly <15% closer to lowestAsk
     * downtrendAveragePrice is randomly <15% closer to highestBid
     */

    switch (tradeParams.mm_liquidityTrend) {
      case 'downtrend':
        targetPrice = orderBookInfo.downtrendAveragePrice;
        break;
      case 'uptrend':
        targetPrice = orderBookInfo.uptrendAveragePrice;
        break;
      case 'middle':
        targetPrice = orderBookInfo.middleAveragePrice;
        break;
      default:
        break;
    }

    const pairObj = orderUtils.parseMarket(config.pair);
    const coin2Decimals = pairObj.coin2Decimals;
    const precision = utils.getPrecision(coin2Decimals);

    // Set coefficients to calculate price bounds

    let liqKoefMin; let liqKoefMax;
    if (subPurpose === 'ss') {
      liqKoefMin = 0;
      liqKoefMax = constants.LIQUIDITY_SS_MAX_SPREAD_PERCENT/100;
    } else { // 'depth' liq-order
      if (isOverLiquidityOrder) {
        // Place orders over the initial liquidity closer to the spread
        message = `As this ${type} liq-order${subPurposeString} is over the initial liquidity, placing this order closer to the spread:`;
        message += ` the price range changed from ${tradeParams.mm_liquiditySpreadPercentMin || 0}–${tradeParams.mm_liquiditySpreadPercent}% to 0–${constants.OVER_LIQUIDITY_SPREAD_PERCENT}%.`;
        liqKoefMin = 0;
        liqKoefMax = constants.OVER_LIQUIDITY_SPREAD_PERCENT/100;
      } else {
        liqKoefMin = tradeParams.mm_liquiditySpreadPercentMin/100 || 0;
        liqKoefMax = tradeParams.mm_liquiditySpreadPercent/100;
      }
    }

    // Set Pw's and TWAP's ranges

    let price; let pwLowPrice; let pwHighPrice;
    let priceBeforePwCorrection; let priceBeforeTwapCorrection;

    const pw = require('./mm_price_watcher');
    if (pw.getIsPriceActualAndEnabled()) {
      pwLowPrice = pw.getLowPrice();
      pwHighPrice = pw.getHighPrice();
    }


    // Keep spread enough for in-spread trading
    const delta = constants.MM_POLICIES_IN_SPREAD_TRADING.includes(tradeParams.mm_Policy) ? precision * 3 : precision;

    // Calculate a liq-order price and adjust it according to Pw's range

    if (type === 'sell') {
      low = targetPrice * (1 + liqKoefMin);
      high = targetPrice * (1 + liqKoefMax);
      price = utils.randomValue(low, high);

      if (pwLowPrice && price < pwLowPrice) {
        priceBeforePwCorrection = price;
        price = utils.randomValue(pwLowPrice, pwLowPrice * (1 + liqKoefMax));
      }
      if (price - delta < orderBookInfo.highestBid) {
        price = orderBookInfo.highestBid + delta;
      }
    } else {
      high = targetPrice * (1 - liqKoefMin);
      low = targetPrice * (1 - liqKoefMax);
      price = utils.randomValue(low, high);

      if (pwHighPrice && price > pwHighPrice) {
        priceBeforePwCorrection = price;
        price = utils.randomValue(pwHighPrice * (1 - liqKoefMax), pwHighPrice);
      }

      if (price + delta > orderBookInfo.lowestAsk) {
        price = orderBookInfo.lowestAsk - delta;
      }
    }

    if (priceBeforePwCorrection) {
      message += ` Price watcher corrected the price from ${priceBeforePwCorrection.toFixed(coin2Decimals)} ${config.coin2} to ${price.toFixed(coin2Decimals)} ${config.coin2} while placing ${type} liq-order${subPurposeString}. ${pw.getPwRangeString()}`;
    }

    if (priceBeforeTwapCorrection) {
      const twapMessage = ` TWAP corrected the price from ${priceBeforeTwapCorrection.toFixed(coin2Decimals)} ${config.coin2} to ${price.toFixed(coin2Decimals)} ${config.coin2} while placing ${type} liq-order${subPurposeString}. ${module.exports.getTwapRangeString()}`;

      message += message ? ` Additionally,${twapMessage}` : twapMessage;
    }

    return {
      price,
      message: message.trim(),
      isCorrected: !!message,
    };
  } catch (e) {
    log.error(`Error in setPrice() of ${utils.getModuleName(module.id)} module: ${e}`);
    return {
      price: undefined,
    };
  }
}

/**
 * Returns random amount to place a liq-order for a specific order type and subPurpose
 * Min-max intervals are stored in global minMaxAmounts
 * @param {string} type Type of an order, 'buy' or 'sell'
 * @param {string} subPurpose 'depth' for regular depth liq-orders, 'ss' for spread support liq-orders
 * @return {number|undefined} Amount to place an order with
 */
function setAmount(type, subPurpose) {
  try {
    return utils.randomValue(minMaxAmounts[subPurpose][type].min, minMaxAmounts[subPurpose][type].max);
  } catch (e) {
    log.error(`Error in setAmount() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Calculates min-max amounts for different order types (buy, sell) and subPurposes (depth, ss)
 * And stores them in the global minMaxAmounts object
 * @param {Object} price For conversion from quote to amount
 * @return {boolean} True if successfully calculated and saved
 */
function setMinMaxAmounts(price) {
  try {
    const pairObj = orderUtils.parseMarket(config.pair);
    const coin1Decimals = pairObj.coin1Decimals;

    if (!tradeParams || !tradeParams.mm_liquiditySellAmount || !tradeParams.mm_liquidityBuyQuoteAmount) {
      log.warn(`Liquidity: Params mm_liquiditySellAmount or mm_liquidityBuyQuoteAmount are not set. Check ${config.exchangeName} config.`);
      return false;
    }

    let minMaxAmountsString;

    minMaxAmounts.depth = {
      buy: {},
      sell: {},
    };

    minMaxAmounts.depth.sell.orders = getMaxOrderNumberOneSide('sell', 'depth');
    minMaxAmounts.depth.sell.max = liqLimits.askLimit / minMaxAmounts.depth.sell.orders;
    minMaxAmounts.depth.sell.min = minMaxAmounts.depth.sell.max / 2;

    minMaxAmounts.depth.buy.orders = getMaxOrderNumberOneSide('buy', 'depth');
    minMaxAmounts.depth.buy.max = liqLimits.bidLimit / price / minMaxAmounts.depth.buy.orders;
    minMaxAmounts.depth.buy.min = minMaxAmounts.depth.buy.max / 2;

    minMaxAmountsString = `Liquidity: Setting maximum number of depth liq-orders to ${minMaxAmounts.depth.buy.orders} buys and ${minMaxAmounts.depth.sell.orders} sells.`;
    minMaxAmountsString += ` Order amounts are ${minMaxAmounts.depth.buy.min.toFixed(coin1Decimals)}–${minMaxAmounts.depth.buy.max.toFixed(coin1Decimals)} ${pairObj.coin1} buys`;
    minMaxAmountsString += ` and ${minMaxAmounts.depth.sell.min.toFixed(coin1Decimals)}–${minMaxAmounts.depth.sell.max.toFixed(coin1Decimals)} ${pairObj.coin1} sells.`;
    log.log(minMaxAmountsString);

    if (tradeParams.mm_liquiditySpreadSupport) {
      minMaxAmounts.ss = {
        buy: {},
        sell: {},
      };

      const minOrderAmount = orderUtils.getMinOrderAmount();

      minMaxAmounts.ss.sell.orders = getMaxOrderNumberOneSide('sell', 'ss');
      minMaxAmounts.ss.sell.min = minOrderAmount.min;
      minMaxAmounts.ss.sell.max = minOrderAmount.upperBound;

      minMaxAmounts.ss.buy.orders = getMaxOrderNumberOneSide('buy', 'ss');
      minMaxAmounts.ss.buy.min = minOrderAmount.min;
      minMaxAmounts.ss.buy.max = minOrderAmount.upperBound;

      minMaxAmountsString = `Liquidity: Setting maximum number of spread support liq-orders to ${minMaxAmounts.ss.buy.orders} buys and ${minMaxAmounts.ss.sell.orders} sells.`;
      minMaxAmountsString += ` Order amounts are ${minMaxAmounts.ss.buy.min.toFixed(coin1Decimals)}–${minMaxAmounts.ss.buy.max.toFixed(coin1Decimals)} ${pairObj.coin1} for both buys and sells.`;
      log.log(minMaxAmountsString);
    }

    return true;
  } catch (e) {
    log.error(`Error in setMinMaxAmounts() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * Calculates maximum liq-order number for a specific order type and subPurpose
 * Depth order number depends on total liquidity value,
 * Additionally, spread support order number is limited by constants
 * @param {string} type Type of the order, 'buy' or 'sell'
 * @param {string} subPurpose 'depth' for regular depth liq-orders, 'ss' for spread support liq-orders
 * @return {number} Order number
 */
function getMaxOrderNumberOneSide(type, subPurpose) {
  try {
    let liqCoin; let liqValue;

    if (type === 'sell') {
      liqCoin = config.coin1;
      liqValue = liqLimits.askLimit;
    } else {
      liqCoin = config.coin2;
      liqValue = liqLimits.bidLimit;
    }

    const valueInUSD = exchangerUtils.convertCryptos(liqCoin, 'USD', liqValue).outAmount;

    const usdThresholds = [
      { limit: 1, value: 1 },
      { limit: 10, value: 2 },
      { limit: 50, value: 4 },
      { limit: 100, value: 6 },
      { limit: 500, value: 8 },
      { limit: 1000, value: 9 },
    ];

    let n = usdThresholds.find((threshold) => valueInUSD <= threshold.limit)?.value ||
        Math.ceil(Math.sqrt(Math.sqrt(valueInUSD))) ||
        DEFAULT_MAX_ORDERS_ONE_SIDE;

    // Additionally, reduce the number of orders if an exchange's API applies limits
    const apiOrderNumberLimit = traderapi.features(config.pair).orderNumberLimit;
    if (apiOrderNumberLimit <= 200) {
      n = Math.ceil(n / 1.4);
    } else if (apiOrderNumberLimit <= 100) {
      n = Math.ceil(n / 1.8);
    }

    return n;
  } catch (e) {
    log.error(`Error in getMaxOrderNumber() of ${utils.getModuleName(module.id)} module: ${e}`);
    return DEFAULT_MAX_ORDERS_ONE_SIDE;
  }
}

/**
 * Set a random liq-order lifetime
 * @return {number} Pause in ms
 */
function setLifeTime() {
  return utils.randomValue(LIFETIME_MIN, LIFETIME_MAX, true);
}

/**
 * Set a random pause in ms for the next Liquidity iteration
 * @return {number} Pause in ms
 */
function setPause() {
  return utils.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}

module.exports.loadLiqLimits();
