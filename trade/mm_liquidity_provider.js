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
const orderCollector = require('./orderCollector');
const orderUtils = require('./orderUtils');
const exchangerUtils = require('../helpers/cryptos/exchanger');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

const INTERVAL_MIN = 10 * 1000;
const INTERVAL_MAX = 20 * 1000;
const LIFETIME_MIN = 1000 * 60 * 7; // 7 minutes
const LIFETIME_MAX = constants.HOUR * 7; // 7 hours
const DEFAULT_MAX_ORDERS = 9; // each side

let isPreviousIterationFinished = true;

module.exports = {
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

  async updateLiquidity(noCache = false) {
    try {
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
        log.warn(`Liquidity: Order books are empty for ${config.pair}, or temporary API error. Unable to get spread while placing liq-order.`);
        return;
      }

      liquidityOrders = await orderUtils.updateOrders(liquidityOrders, config.pair, utils.getModuleName(module.id), noCache); // update orders which partially filled or not found
      liquidityOrders = await this.closeLiquidityOrders(liquidityOrders, orderBookInfo); // close orders which expired or out of spread

      const liquidityStats = utils.getOrdersStats(liquidityOrders);

      let amountPlaced;
      do {
        amountPlaced = await this.placeLiquidityOrder(liquidityStats.bidsTotalQuoteAmount, 'buy', orderBookInfo);
        if (amountPlaced) {
          liquidityStats.bidsTotalQuoteAmount += amountPlaced;
          liquidityStats.bidsCount += 1;
        }
      } while (amountPlaced);
      do {
        amountPlaced = await this.placeLiquidityOrder(liquidityStats.asksTotalAmount, 'sell', orderBookInfo);
        if (amountPlaced) {
          liquidityStats.asksTotalAmount += amountPlaced;
          liquidityStats.asksCount += 1;
        }
      } while (amountPlaced);

      log.log(`Liquidity: Opened ${liquidityStats.bidsCount} bids-buy orders for ${liquidityStats.bidsTotalQuoteAmount.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} of ${tradeParams.mm_liquidityBuyQuoteAmount} ${config.coin2} and ${liquidityStats.asksCount} asks-sell orders with ${liquidityStats.asksTotalAmount.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} of ${tradeParams.mm_liquiditySellAmount} ${config.coin1}.`);
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
          reasonToClose = `It's expired.`;
          reasonObject.isExpired = true;
        } else if (utils.isOrderOutOfPriceWatcherRange(order)) {
          const pw = require('./mm_price_watcher');
          reasonToClose = `It's out of ${pw.getPwRangeString()}`;
          reasonObject.isOutOfPwRange = true;
        } else if (utils.isOrderOutOfSpread(order, orderBookInfo)) {
          reasonToClose = `It's out of ±% spread.}`;
          reasonObject.isOutOfSpread = true;
        }

        if (reasonToClose) {
          const cancelReq = await traderapi.cancelOrder(order._id, order.type, order.pair);
          const orderInfoString = `liq-order with id=${order._id}, type=${order.type}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}`;

          if (cancelReq !== undefined) {
            order.update({
              ...reasonObject,
              isProcessed: true,
              isClosed: true,
            });

            if (cancelReq) {
              order.update({ isCancelled: true });
              log.log(`Liquidity: Successfully cancelled ${orderInfoString}. ${reasonToClose}`);
            } else {
              log.log(`Liquidity: Unable to cancel ${orderInfoString}. ${reasonToClose} Probably it doesn't exist anymore. Marking it as closed.`);
            }

            await order.save();
          } else {
            log.log(`Liquidity: Request to close ${orderInfoString} failed. ${reasonToClose} Will try next time, keeping this order in the DB for now.`);
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

  async placeLiquidityOrder(amountPlaced, orderType, orderBookInfo) {
    try {
      const type = orderType;

      const priceReq = await setPrice(type, orderBookInfo);
      const price = priceReq.price;
      if (!price) {
        if ((Date.now()-lastNotifyPriceTimestamp > constants.HOUR) && priceReq.message) {
          notify(priceReq.message, 'warn');
          lastNotifyPriceTimestamp = Date.now();
        }
        return;
      }

      const coin1Amount = setAmount(type, price);
      const coin2Amount = coin1Amount * price;
      const lifeTime = setLifeTime();

      let output = '';
      let orderParamsString = '';

      orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      if (!type || !price || !coin1Amount || !coin2Amount) {
        log.warn(`Liquidity: Unable to run liq-order with params: ${orderParamsString}.`);
        return;
      }

      if (type === 'sell') {
        if (coin1Amount > (tradeParams.mm_liquiditySellAmount - amountPlaced)) {
          return false;
        }
      }

      if (type === 'buy') {
        if (coin2Amount > (tradeParams.mm_liquidityBuyQuoteAmount - amountPlaced)) {
          return false;
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
      if (orderReq && orderReq.orderid) {
        const { ordersDb } = db;
        const order = new ordersDb({
          _id: orderReq.orderid,
          date: utils.unixTimeStampMs(),
          dateTill: utils.unixTimeStampMs() + lifeTime,
          purpose: 'liq', // liq: liquidity & spread
          type: type,
          // targetType: type,
          exchange: config.exchange,
          pair: config.pair,
          coin1: config.coin1,
          coin2: config.coin2,
          price: price,
          coin1Amount: coin1Amount,
          coin2Amount: coin2Amount,
          LimitOrMarket: 1, // 1 for limit price. 0 for Market price.
          isProcessed: false,
          isExecuted: false,
          isCancelled: false,
          isClosed: false,
        }, true);

        output = `${type} ${coin1Amount.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2} at ${price.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}`;
        log.info(`Liquidity: Successfully placed liq-order to ${output}.`);
        if (type === 'sell') {
          return +coin1Amount;
        } else {
          return +coin2Amount;
        }

      } else {
        log.warn(`Liquidity: Unable to execute liq-order with params: ${orderParamsString}. No order id returned.`);
        return false;
      }

    } catch (e) {
      log.error(`Error in placeLiquidityOrder() of ${utils.getModuleName(module.id)} module: ` + e);
    }
  },
};

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
      log.warn(`Liquidity: Unable to process balances for placing liq-order: ` + e);
      return {
        result: false,
      };
    }
  } else {
    log.warn(`Liquidity: Unable to get balances for placing liq-order.`);
    return {
      result: false,
    };
  }
}

async function setPrice(type, orderBookInfo) {
  try {
    let output = '';
    let high; let low;

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

    let price; let lowPrice; let highPrice;

    const pw = require('./mm_price_watcher');
    if (pw.getIsPriceActualAndEnabled()) {
      lowPrice = pw.getLowPrice();
      highPrice = pw.getHighPrice();
    }

    let priceBeforePwCorrection;
    const liqKoef = tradeParams.mm_liquiditySpreadPercent/100 / 2;

    if (type === 'sell') {
      low = targetPrice;
      high = targetPrice * (1 + liqKoef);
      price = utils.randomValue(low, high);
      if (lowPrice && price < lowPrice) {
        priceBeforePwCorrection = price;
        price = utils.randomValue(lowPrice, lowPrice * (1 + liqKoef));
      }
      if (price - precision < orderBookInfo.highestBid) {
        price = orderBookInfo.highestBid + precision;
      }
    } else {
      high = targetPrice;
      low = targetPrice * (1 - liqKoef);
      price = utils.randomValue(low, high);
      if (highPrice && price > highPrice) {
        priceBeforePwCorrection = price;
        price = highPrice;
        price = utils.randomValue(highPrice * (1 - liqKoef), highPrice);
      }
      if (price + precision > orderBookInfo.lowestAsk) {
        price = orderBookInfo.lowestAsk - precision;
      }
    }

    if (priceBeforePwCorrection) {
      output = `Liquidity: Price watcher corrected price from ${priceBeforePwCorrection.toFixed(coin2Decimals)} ${config.coin2} to ${price.toFixed(coin2Decimals)} ${config.coin2} while placing ${type} liq-order. ${pw.getPwRangeString()}`;
      log.log(output);
    }

    return {
      price: price,
    };
  } catch (e) {
    log.error(`Error in setPrice() of ${utils.getModuleName(module.id)} module: ` + e);
  }
}

function setAmount(type, price) {
  try {
    if (!tradeParams || !tradeParams.mm_liquiditySellAmount || !tradeParams.mm_liquidityBuyQuoteAmount) {
      log.warn(`Liquidity: Params mm_liquiditySellAmount or mm_liquidityBuyQuoteAmount are not set. Check ${config.exchangeName} config.`);
      return false;
    }

    const maxOrderNumber = getMaxOrderNumber(type);
    let min;
    if (type === 'sell') {
      min = tradeParams.mm_liquiditySellAmount / maxOrderNumber;
    } else {
      min = tradeParams.mm_liquidityBuyQuoteAmount / price / maxOrderNumber;
    }
    const max = min * 2;

    const pairObj = orderUtils.parseMarket(config.pair);
    log.log(`Liquidity: Setting maximum number of ${type}-orders to ${maxOrderNumber}. Order amount is from ${min.toFixed(pairObj.coin1Decimals)} ${pairObj.coin1} to ${max.toFixed(pairObj.coin1Decimals)} ${pairObj.coin1}.`);

    return utils.randomValue(min, max);
  } catch (e) {
    log.error(`Error in setAmount() of ${utils.getModuleName(module.id)} module: ` + e);
  }
}

function getMaxOrderNumber(type) {
  try {
    let valueInUSD;
    if (type === 'sell') {
      valueInUSD = exchangerUtils.convertCryptos(config.coin1, 'USD', tradeParams.mm_liquiditySellAmount).outAmount;
    } else {
      valueInUSD = exchangerUtils.convertCryptos(config.coin2, 'USD', tradeParams.mm_liquidityBuyQuoteAmount).outAmount;
    }
    if (valueInUSD <= 1) {
      return 1;
    } else if (valueInUSD <= 10) {
      return 2;
    } else if (valueInUSD <= 50) {
      return 3;
    } else if (valueInUSD <= 100) {
      return 4;
    } else if (valueInUSD <= 500) {
      return 8;
    } else if (valueInUSD <= 1000) {
      return 9;
    } else {
      return Math.ceil(Math.sqrt(Math.sqrt(valueInUSD))) || DEFAULT_MAX_ORDERS;
    }
  } catch (e) {
    log.error(`Error in getMaxOrderNumber() of ${utils.getModuleName(module.id)} module: ` + e);
    return DEFAULT_MAX_ORDERS;
  }
}

function setLifeTime() {
  return utils.randomValue(LIFETIME_MIN, LIFETIME_MAX, true);
}

function setPause() {
  return utils.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}
