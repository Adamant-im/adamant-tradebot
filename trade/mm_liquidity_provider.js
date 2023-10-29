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
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
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

const minMaxAmounts = {};

let isPreviousIterationFinished = true;

module.exports = {
  readableModuleName: 'Liquidity',

  run() {
    this.iteration();
  },

  async iteration() {
    const interval = setPause();
    if (interval && tradeParams.mm_isActive && tradeParams.mm_isLiquidityActive) {
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
   * Main part of Liquidity provider
   */
  async updateLiquidity() {
    try {
      const coin1Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;
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
        log.warn(`Liquidity: Order books are empty for ${config.pair}, or temporary API error. Unable to get spread while placing liq-orders.`);
        return;
      }

      if (!setMinMaxAmounts(orderBookInfo)) {
        log.warn('Liquidity: Unable to calculate min-max amounts while placing liq-orders.');
        return;
      }

      liquidityOrders = await orderUtils.updateOrders(liquidityOrders, config.pair, utils.getModuleName(module.id) + ':liq-'); // update orders which partially filled or not found
      liquidityOrders = await this.closeLiquidityOrders(liquidityOrders, orderBookInfo); // close orders which expired or out of spread

      let liqInfoString;

      // 2. Place regular (depth) liq-orders
      const liquidityDepthOrders = liquidityOrders.filter((order) => order.subPurpose !== 'ss');
      const liquidityDepthStats = utils.getOrdersStats(liquidityDepthOrders);
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

      liqInfoString = `Liquidity: Opened ${liquidityDepthStats.bidsCount} bids-buy depth orders for ${liquidityDepthStats.bidsTotalQuoteAmount.toFixed(coin2Decimals)} of ${tradeParams.mm_liquidityBuyQuoteAmount} ${config.coin2}`;
      liqInfoString += ` and ${liquidityDepthStats.asksCount} asks-sell depth orders with ${liquidityDepthStats.asksTotalAmount.toFixed(coin1Decimals)} of ${tradeParams.mm_liquiditySellAmount} ${config.coin1}.`;
      log.log(liqInfoString);
    } catch (e) {
      log.error(`Error in updateLiquidity() of ${utils.getModuleName(module.id)} module: ` + e);
    }
  },

  /**
   * Closes opened liq-orders:
   * - Expired by time
   * - Out of Spread
   * - Out of Pw's range
   * @param {Array of Object} liquidityOrders Orders of type liq, got from internal DB
   * @param {Object} orderBookInfo Object of utils.getOrderBookInfo() to check if order is out of spread
   * @return {Array of Object} Updated order list
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

            if (outOfSpreadInfo.isOrderOutOfMinMaxSpread) {
              reasonToClose = `It's price ${outOfSpreadInfo.orderPrice.toFixed(coin2Decimals)} ${pairObj.coin2} out of ±${outOfSpreadInfo.spreadPercent}% spread: [${outOfSpreadInfo.minPrice}, ${outOfSpreadInfo.maxPrice}].`;
            } else {
              reasonToClose = `It's price ${outOfSpreadInfo.orderPrice.toFixed(coin2Decimals)} ${pairObj.coin2} in the ±${outOfSpreadInfo.spreadPercentMin}% disallowed inner spread: [${outOfSpreadInfo.innerLowPrice}, ${outOfSpreadInfo.innerHighPrice}].`;
            }

            reasonObject.isOutOfSpread = true;
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
        log.error(`Error in closeLiquidityOrders() of ${utils.getModuleName(module.id)} module: ` + e);
      }
    }

    return updatedLiquidityOrders;
  },

  /**
   * Places a new Liquidity order (liq type)
   * Sets an order price. Spread support orders are closer to mid of spread.
   * Sets an order amount. Spread support orders are of small amounts.
   * Checks for balances. If not enough balances, notify/log, and return false
   * @param {Number} totalQtyPlaced Amount for buy-orders and Quote for sell-orders already placed for liq-orders in total
   * @param {Number} totalOrdersPlaced Liq-order number in total (one side)
   * @param {String} orderType Type of order, 'buy' or 'sell'
   * @param {Object} orderBookInfo Order book info to calculate order price
   * @param {String} subPurpose 'depth' for regular depth liq-orders, 'ss' for spread support liq-orders
   * @return {Object} Result and reason in case of fault
   */
  async placeLiquidityOrder(totalQtyPlaced, totalOrdersPlaced, orderType, orderBookInfo, subPurpose) {
    try {
      const type = orderType;
      const subPurposeString = subPurpose === 'ss' ? '(spread support)' : '(depth)';

      const priceReq = await setPrice(type, orderBookInfo, subPurpose);
      const price = priceReq.price;
      if (!price) { // Not expected
        if ((Date.now()-lastNotifyPriceTimestamp > constants.HOUR) && priceReq.message) {
          notify(priceReq.message, 'warn');
          lastNotifyPriceTimestamp = Date.now();
        }
        return;
      }

      const coin1Amount = setAmount(type, subPurpose);
      const coin2Amount = coin1Amount * price;
      const lifeTime = setLifeTime();

      let output = '';
      let orderParamsString = '';

      orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      if (!type || !price || !coin1Amount || !coin2Amount) {
        log.warn(`Liquidity: Unable to run liq-order ${subPurposeString} with params: ${orderParamsString}.`);
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
          if (coin1Amount + totalQtyPlaced > tradeParams.mm_liquiditySellAmount) {
            return false;
          }
        }
        if (type === 'buy') {
          if (coin2Amount + totalQtyPlaced > tradeParams.mm_liquidityBuyQuoteAmount) {
            return false;
          }
        }
      }

      // Check balances
      const balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount, type);
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

      const orderReq = await traderapi.placeOrder(type, config.pair, price, coin1Amount, 1, null);
      if (orderReq && orderReq.orderId) {
        const { ordersDb } = db;
        const order = new ordersDb({
          _id: orderReq.orderId,
          date: utils.unixTimeStampMs(),
          dateTill: utils.unixTimeStampMs() + lifeTime,
          purpose: 'liq', // liq: liquidity & spread
          subPurpose,
          type,
          // targetType: type,
          exchange: config.exchange,
          pair: config.pair,
          coin1: config.coin1,
          coin2: config.coin2,
          price,
          coin1Amount,
          coin2Amount,
          LimitOrMarket: 1, // 1 for limit price. 0 for Market price.
          isProcessed: false,
          isExecuted: false,
          isCancelled: false,
          isClosed: false,
        }, true);

        output = `${type} ${coin1Amount.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2} at ${price.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}`;
        log.info(`Liquidity: Successfully placed liq-order ${subPurposeString} to ${output}.`);
        if (type === 'sell') {
          return +coin1Amount;
        } else {
          return +coin2Amount;
        }
      } else {
        log.warn(`Liquidity: Unable to execute liq-order ${subPurposeString} with params: ${orderParamsString}. No order id returned.`);
        return false;
      }
    } catch (e) {
      log.error(`Error in placeLiquidityOrder() of ${utils.getModuleName(module.id)} module: ` + e);
    }
  },
};

/**
 * Checks if it's enough balances to place an order
 * @param {String} coin1 If selling coin1
 * @param {String} coin2 If buying coin2
 * @param {Number} amount1 Coin1 amount for 'sell' orders
 * @param {Number} amount2 Coin2 amount for 'buy' orders
 * @param {String} type Type of order, 'buy' or 'sell'
 * @return {Object<result, message>} Message is an error message to notify
 */
async function isEnoughCoins(coin1, coin2, amount1, amount2, type) {
  const balances = await traderapi.getBalances(false);
  let balance1free; let balance2free;
  let balance1freezed; let balance2freezed;
  let isBalanceEnough = true;
  let output = '';

  if (balances) {
    try {
      balance1free = balances.filter((crypto) => crypto.code === coin1)[0]?.free || 0;
      balance2free = balances.filter((crypto) => crypto.code === coin2)[0]?.free || 0;
      balance1freezed = balances.filter((crypto) => crypto.code === coin1)[0]?.freezed || 0;
      balance2freezed = balances.filter((crypto) => crypto.code === coin2)[0]?.freezed || 0;

      if ((!balance1free || balance1free < amount1) && type === 'sell') {
        output = `Not enough balance to place ${amount1.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1} ${type} liq-order. Free: ${balance1free.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}, frozen: ${balance1freezed.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}.`;
        isBalanceEnough = false;
      }
      if ((!balance2free || balance2free < amount2) && type === 'buy') {
        output = `Not enough balance to place ${amount2.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2} ${type} liq-order. Free: ${balance2free.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}, frozen: ${balance2freezed.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}.`;
        isBalanceEnough = false;
      }

      return {
        result: isBalanceEnough,
        message: output,
      };
    } catch (e) {
      log.warn('Liquidity: Unable to process balances for placing liq-order: ' + e);
      return {
        result: false,
      };
    }
  } else {
    log.warn('Liquidity: Unable to get balances for placing liq-order.');
    return {
      result: false,
    };
  }
}

/**
 * Calculates order price for specific order type and subPurpose
 * The price is relative to mid of spread, which depends on mm_liquidityTrend
 * Price watcher may correct a price
 * @param {String} type Type of order, 'buy' or 'sell'
 * @param {Object} orderBookInfo Includes average prices for different mm_liquidityTrend
 * @param {String} subPurpose 'depth' for regular depth liq-orders, 'ss' for spread support liq-orders
 * @return {Object<price, message>} Message is an error message to notify
 */
async function setPrice(type, orderBookInfo, subPurpose) {
  try {
    let output = '';
    let high; let low;
    let targetPrice;

    /**
     * trendAveragePrice is a price between highestBid and lowestAsk (in spread)
     * middleAveragePrice is randomly ±15% closer to middle of spread
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

    let price; let pwLowPrice; let pwHighPrice;

    const pw = require('./mm_price_watcher');
    if (pw.getIsPriceActualAndEnabled()) {
      pwLowPrice = pw.getLowPrice();
      pwHighPrice = pw.getHighPrice();
    }

    let priceBeforePwCorrection;
    let liqKoefMin; let liqKoefMax;
    if (subPurpose === 'ss') {
      liqKoefMin = 0;
      liqKoefMax = constants.LIQUIDITY_SS_MAX_SPREAD_PERCENT/100;
    } else {
      liqKoefMin = tradeParams.mm_liquiditySpreadPercentMin/100 || 0;
      liqKoefMax = tradeParams.mm_liquiditySpreadPercent/100;
    }

    // Keep spread enough for in-spread trading
    const delta = ['spread', 'optimal'].includes(tradeParams.mm_Policy) ? precision * 3 : precision;

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
        price = pwHighPrice;
        price = utils.randomValue(pwHighPrice * (1 - liqKoefMax), pwHighPrice);
      }
      if (price + delta > orderBookInfo.lowestAsk) {
        price = orderBookInfo.lowestAsk - delta;
      }
    }

    if (priceBeforePwCorrection) {
      output = `Liquidity: Price watcher corrected price from ${priceBeforePwCorrection.toFixed(coin2Decimals)} ${config.coin2} to ${price.toFixed(coin2Decimals)} ${config.coin2} while placing ${type} liq-order. ${pw.getPwRangeString()}`;
      log.log(output);
    }

    return {
      price,
    };
  } catch (e) {
    log.error(`Error in setPrice() of ${utils.getModuleName(module.id)} module: ` + e);
  }
}

/**
 * Returns random amount to place a liq-order for specific order type and subPurpose
 * Min-max intervals are stored in global minMaxAmounts
 * @param {String} type Type of order, 'buy' or 'sell'
 * @param {String} subPurpose 'depth' for regular depth liq-orders, 'ss' for spread support liq-orders
 * @return {Number} Amount to place an order
 */
function setAmount(type, subPurpose) {
  try {
    return utils.randomValue(minMaxAmounts[subPurpose][type].min, minMaxAmounts[subPurpose][type].max);
  } catch (e) {
    log.error(`Error in setAmount() of ${utils.getModuleName(module.id)} module: ` + e);
  }
}

/**
 * Calculates min-max amounts for different order types and subPurposes
 * And stores in global minMaxAmounts
 * @param {Object} orderBookInfo Includes a price to convert from coin2 to coin1
 * @return {Boolean} True if successfully stored
 */
function setMinMaxAmounts(orderBookInfo) {
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
    minMaxAmounts.depth.sell.max = tradeParams.mm_liquiditySellAmount / minMaxAmounts.depth.sell.orders;
    minMaxAmounts.depth.sell.min = minMaxAmounts.depth.sell.max / 2;
    minMaxAmounts.depth.buy.orders = getMaxOrderNumberOneSide('buy', 'depth');
    minMaxAmounts.depth.buy.max = tradeParams.mm_liquidityBuyQuoteAmount /
        orderBookInfo.highestBid / minMaxAmounts.depth.buy.orders;
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
    log.error(`Error in setMinMaxAmounts() of ${utils.getModuleName(module.id)} module: ` + e);
  }
}

/**
 * Calculate maximum liq-order number for specific order type and subPurpose
 * Depth orders number depends on total liquidity value,
 * Additionally, spread support order number limited by constants
 * @param {String} type Type of order, 'buy' or 'sell'
 * @param {String} subPurpose 'depth' for regular depth liq-orders, 'ss' for spread support liq-orders
 * @return {Number} Order number
 */
function getMaxOrderNumberOneSide(type, subPurpose) {
  try {
    let valueInUSD;
    if (type === 'sell') {
      valueInUSD = exchangerUtils.convertCryptos(config.coin1, 'USD', tradeParams.mm_liquiditySellAmount).outAmount;
    } else {
      valueInUSD = exchangerUtils.convertCryptos(config.coin2, 'USD', tradeParams.mm_liquidityBuyQuoteAmount).outAmount;
    }

    let n;
    if (valueInUSD <= 1) {
      n = 1;
    } else if (valueInUSD <= 10) {
      n = 2;
    } else if (valueInUSD <= 50) {
      n = 4;
    } else if (valueInUSD <= 100) {
      n = 6;
    } else if (valueInUSD <= 500) {
      n = 8;
    } else if (valueInUSD <= 1000) {
      n = 9;
    } else {
      n = Math.ceil(Math.sqrt(Math.sqrt(valueInUSD))) || DEFAULT_MAX_ORDERS_ONE_SIDE;
    }

    const apiOrderNumberLimit = traderapi.features(config.pair).orderNumberLimit;
    if (apiOrderNumberLimit <= 200) {
      n = Math.ceil(n / 1.4);
    } else if (apiOrderNumberLimit <= 100) {
      n = Math.ceil(n / 1.8);
    }

    return n;
  } catch (e) {
    log.error(`Error in getMaxOrderNumber() of ${utils.getModuleName(module.id)} module: ` + e);
    return DEFAULT_MAX_ORDERS_ONE_SIDE;
  }
}

/**
 * Set a random liq-order lifetime
 * @return {Number} Pause in ms
 */
function setLifeTime() {
  return utils.randomValue(LIFETIME_MIN, LIFETIME_MAX, true);
}

/**
 * Set a random pause in ms for next Liquidity iteration
 * @return {Number} Pause in ms
 */
function setPause() {
  return utils.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}
