const utils = require('../helpers/utils');
const constants = require('../helpers/const');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./settings/tradeParams_' + config.exchange);
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');
const orderUtils = require('./orderUtils');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

const INTERVAL_MIN = 30000;
const INTERVAL_MAX = 90000;
const LIFETIME_MIN = 1000 * 60 * 7; // 7 minutes
const LIFETIME_MAX = constants.HOUR * 7; // 7 hours
const MAX_ORDERS = 7; // each side

let isPreviousIterationFinished = true;

module.exports = {
  run() {
    this.iteration();
  },
  async iteration() {

    const interval = setPause();
    // console.log(interval);
    if (interval && tradeParams.mm_isActive && tradeParams.mm_isLiquidityActive) {
      if (isPreviousIterationFinished) {
        isPreviousIterationFinished = false;
        await this.updateLiquidity();
        isPreviousIterationFinished = true;
      } else {
        log.log(`Postponing iteration of the liquidity provider for ${interval} ms. Previous iteration is in progress yet.`);
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
  async updateLiquidity() {

    try {

      const { ordersDb } = db;
      let liquidityOrders = await ordersDb.find({
        isProcessed: false,
        purpose: 'liq', // liq: liquidity order
        pair: config.pair,
        exchange: config.exchange,
      });

      const orderBookInfo = utils.getOrderBookInfo(await traderapi.getOrderBook(config.pair),
          tradeParams.mm_liquiditySpreadPercent);

      if (!orderBookInfo) {
        log.warn(`${config.notifyName}: Order books are empty for ${config.pair}, or temporary API error. Unable to get spread while placing liq-order.`);
        return;
      }

      liquidityOrders = await orderUtils.updateOrders(liquidityOrders, config.pair); // update orders which partially filled or not found
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

      log.info(`Liquidity stats: opened ${liquidityStats.bidsCount} bids-buy orders for ${liquidityStats.bidsTotalQuoteAmount.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} of ${tradeParams.mm_liquidityBuyQuoteAmount} ${config.coin2} and ${liquidityStats.asksCount} asks-sell orders with ${liquidityStats.asksTotalAmount.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} of ${tradeParams.mm_liquiditySellAmount} ${config.coin1}.`);

    } catch (e) {
      log.error(`Error in updateLiquidity() of ${utils.getModuleName(module.id)} module: ` + e);
    }

  },
  async closeLiquidityOrders(liquidityOrders, orderBookInfo) {

    const updatedLiquidityOrders = [];
    for (const order of liquidityOrders) {
      try {
        if (order.dateTill < utils.unix()) {

          const cancelReq = await traderapi.cancelOrder(order._id, order.type, order.pair);
          if (cancelReq !== undefined) {
            log.log(`Closing liq-order with params: id=${order._id}, type=${order.type}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}. It is expired.`);
            await order.update({
              isProcessed: true,
              isClosed: true,
              isExpired: true,
            }, true);
          } else {
            log.log(`Request to close expired liq-order with id=${order._id} failed. Will try next time, keeping this order in the DB for now.`);
          }

        } else if (utils.isOrderOutOfSpread(order, orderBookInfo)) {

          const cancelReq = await traderapi.cancelOrder(order._id, order.type, order.pair);
          if (cancelReq !== undefined) {
            log.log(`Closing liq-order with params: id=${order._id}, type=${order.type}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}. It is out of spread.`);
            await order.update({
              isProcessed: true,
              isClosed: true,
              isOutOfSpread: true,
            }, true);
          } else {
            log.log(`Request to close out of spread liq-order with id=${order._id} failed. Will try next time, keeping this order in the DB for now.`);
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
        log.warn(`${config.notifyName} unable to run liq-order with params: ${orderParamsString}.`);
        return;
      }

      // console.log(type, price.toFixed(8), coin1Amount.toFixed(2), coin2Amount.toFixed(2), 'lifeTime:', lifeTime);
      // console.log('amountPlaced:', amountPlaced);

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
            notify(balances.message, 'warn', config.silent_mode);
            lastNotifyBalancesTimestamp = Date.now();
          } else {
            log.log(balances.message);
          }
        }
        return;
      }

      const orderReq = await traderapi.placeOrder(type, config.pair, price, coin1Amount, 1, null);
      if (orderReq && orderReq.orderid) {
        const { ordersDb } = db;
        const order = new ordersDb({
          _id: orderReq.orderid,
          date: utils.unix(),
          dateTill: utils.unix() + lifeTime,
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

        output = `${type} ${coin1Amount.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}`;
        log.info(`Successfully placed liq-order to ${output}.`);
        if (type === 'sell') {
          return +coin1Amount;
        } else {
          return +coin2Amount;
        }

      } else {
        log.warn(`${config.notifyName} unable to execute liq-order with params: ${orderParamsString}. No order id returned.`);
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
      balance1free = balances.filter((crypto) => crypto.code === coin1)[0].free;
      balance2free = balances.filter((crypto) => crypto.code === coin2)[0].free;
      balance1freezed = balances.filter((crypto) => crypto.code === coin1)[0].freezed;
      balance2freezed = balances.filter((crypto) => crypto.code === coin2)[0].freezed;

      if ((!balance1free || balance1free < amount1) && type === 'sell') {
        output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1} ${type} liq-order. Free: ${balance1free.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}, frozen: ${balance1freezed.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}.`;
        isBalanceEnough = false;
      }
      if ((!balance2free || balance2free < amount2) && type === 'buy') {
        output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2} ${type} liq-order. Free: ${balance2free.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}, frozen: ${balance2freezed.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}.`;
        isBalanceEnough = false;
      }

      return {
        result: isBalanceEnough,
        message: output,
      };

    } catch (e) {
      log.warn(`Unable to process balances for placing liq-order: ` + e);
      return {
        result: false,
      };
    }
  } else {
    log.warn(`Unable to get balances for placing liq-order.`);
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

    const precision = utils.getPrecision(orderUtils.parseMarket(config.pair).coin2Decimals);
    let price; let lowPrice = 0; let highPrice = 0;

    const pw = require('./mm_price_watcher');
    if (tradeParams.mm_isPriceWatcherActive && pw.getIsPriceActual()) {
      lowPrice = pw.getLowPrice();
      highPrice = pw.getHighPrice();
    }

    if (type === 'sell') {
      low = targetPrice;
      high = targetPrice * (1 + tradeParams.mm_liquiditySpreadPercent/100 / 2);
      price = utils.randomValue(low, high);
      if (lowPrice && price < lowPrice) {
        price = lowPrice;
        output = `${config.notifyName}: Price watcher corrected price to sell not lower than ${lowPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} while placing liq-order. Low: ${low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}.`;
        log.log(output);
      }
      if (price - precision < orderBookInfo.highestBid) {
        price = orderBookInfo.highestBid + precision;
      }
    } else {
      high = targetPrice;
      low = targetPrice * (1 - tradeParams.mm_liquiditySpreadPercent/100 / 2);
      price = utils.randomValue(low, high);
      if (highPrice && price > highPrice) {
        price = highPrice;
        output = `${config.notifyName}: Price watcher corrected price to buy not higher than ${highPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} while placing liq-order. Low: ${low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}.`;
        log.log(output);
      }
      if (price + precision > orderBookInfo.lowestAsk) {
        price = orderBookInfo.lowestAsk - precision;
      }
    }

    return {
      price: price,
    };

  } catch (e) {
    log.error(`Error in setPrice() of ${utils.getModuleName(module.id)} module: ` + e);
  }

}

function setAmount(type, price) {

  if (!tradeParams || !tradeParams.mm_liquiditySellAmount || !tradeParams.mm_liquidityBuyQuoteAmount) {
    log.warn(`Params mm_liquiditySellAmount or mm_liquidityBuyQuoteAmount are not set. Check ${config.exchangeName} config.`);
    return false;
  }

  let min; let max;

  if (type === 'sell') {
    min = tradeParams.mm_liquiditySellAmount / MAX_ORDERS;
    max = tradeParams.mm_liquiditySellAmount / 2;
  } else {
    min = tradeParams.mm_liquidityBuyQuoteAmount / price / MAX_ORDERS;
    max = tradeParams.mm_liquidityBuyQuoteAmount / price / 2;
  }

  return utils.randomValue(min, max);
}

function setLifeTime() {
  return utils.randomValue(LIFETIME_MIN, LIFETIME_MAX, true);
}

function setPause() {
  return utils.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}
