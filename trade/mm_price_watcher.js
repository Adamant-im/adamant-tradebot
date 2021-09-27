const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const exchangerUtils = require('../helpers/cryptos/exchanger');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./settings/tradeParams_' + config.exchange);
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');
const orderUtils = require('./orderUtils');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

const INTERVAL_MIN = 10000;
const INTERVAL_MAX = 30000;
const LIFETIME_MIN = constants.HOUR * 5;
const LIFETIME_MAX = constants.HOUR * 10;

const priceChangeWarningPercent = 20;
const priceChangeNotifyPercent = 1;

let isPreviousIterationFinished = true;

let lowPrice; let highPrice;
let isPriceActual = false;
let setPriceRangeCount = 0;
let pwExchange; let pwExchangeApi;

log.log(`Module ${utils.getModuleName(module.id)} is loaded.`);

module.exports = {
  getLowPrice() {
    return lowPrice;
  },
  getHighPrice() {
    return highPrice;
  },
  getIsPriceActual() {
    return isPriceActual;
  },
  setPwExchangeApi(exchange) {
    if (pwExchange !== exchange) {
      pwExchangeApi = require('./trader_' + exchange.toLowerCase())(null, null, null, log, true);
      pwExchange = exchange;
      log.log(`Price watcher switched to ${exchange} exchange API.`);
    }
  },
  getPwExchangeApi() {
    return pwExchangeApi;
  },
  run() {
    // isPriceActual = true;
    // console.log(`isPriceActual: ${this.getIsPriceActual()}`);
    this.iteration();
  },
  async iteration() {
    const interval = setPause();
    // console.log(interval);
    if (interval && tradeParams.mm_isActive && tradeParams.mm_isPriceWatcherActive) {
      if (isPreviousIterationFinished) {
        isPreviousIterationFinished = false;
        this.reviewPrices();
        isPreviousIterationFinished = true;
      } else {
        log.log(`Postponing iteration of the price watcher for ${interval} ms. Previous iteration is in progress yet.`);
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
  async reviewPrices() {

    try {

      const { ordersDb } = db;
      let pwOrders = await ordersDb.find({
        isProcessed: false,
        purpose: 'pw', // pw: price watcher order
        pair: config.pair,
        exchange: config.exchange,
      });

      // console.log('pwOrders-Untouched', pwOrders.length);
      // pwOrders = await this.updatePriceWatcherOrders(pwOrders); // update orders which partially filled or not found
      pwOrders = await orderUtils.updateOrders(pwOrders, config.pair); // update orders which partially filled or not found
      // console.log('pwOrders-AfterUpdate', pwOrders.length);
      pwOrders = await this.closePriceWatcherOrders(pwOrders); // close orders which expired
      // console.log('pwOrders-AfterClose', pwOrders.length);

      setPriceRange();

      if (isPriceActual) {

        const orderBook = await traderapi.getOrderBook(config.pair);
        if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
          log.warn(`${config.notifyName}: Order books are empty for ${config.pair}, or temporary API error. Unable to check if I need to place pw-order.`);
          return;
        }

        let targetPrice = 0;
        if (orderBook.asks[0].price < lowPrice) {
          targetPrice = lowPrice;
        } else if (orderBook.bids[0].price > highPrice) {
          targetPrice = highPrice;
        }

        // console.log('highestBid:', orderBook.bids[0].price, 'lowestAsk:', orderBook.asks[0].price);
        // console.log('targetPrice:', targetPrice, 'lowPrice:', lowPrice, 'highPrice:', highPrice);

        if (targetPrice) {

          const orderBookInfo = utils.getOrderBookInfo(orderBook, tradeParams.mm_liquiditySpreadPercent, targetPrice);
          const reliabilityKoef = utils.randomValue(1.05, 1.1);
          orderBookInfo.amountTargetPrice *= reliabilityKoef;
          orderBookInfo.amountTargetPriceQuote *= reliabilityKoef;

          // console.log(orderBookInfo);
          const priceString = `${config.pair} price of ${targetPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}`;
          const actionString = `${orderBookInfo.typeTargetPrice} ${orderBookInfo.amountTargetPrice.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${config.coin1} ${orderBookInfo.typeTargetPrice === 'buy' ? 'with' : 'for'} ${orderBookInfo.amountTargetPriceQuote.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}`;
          const logMessage = `To make ${priceString}, the bot is going to ${actionString}.`;
          log.info(logMessage);
          await this.placePriceWatcherOrder(targetPrice, orderBookInfo);

        }

      }

    } catch (e) {
      log.error(`Error in reviewPrices() of ${utils.getModuleName(module.id)} module: ` + e);
    }

  },
  async closePriceWatcherOrders(pwOrders) {

    const updatedPwOrders = [];
    for (const order of pwOrders) {
      try {
        if (order.dateTill < utils.unix()) {

          const cancelReq = await traderapi.cancelOrder(order._id, order.type, order.pair);
          if (cancelReq !== undefined) {
            log.log(`Closing pw-order with params: id=${order._id}, type=${order.type}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}. It is expired.`);
            await order.update({
              isProcessed: true,
              isClosed: true,
              isExpired: true,
            }, true);
          } else {
            log.log(`Request to close expired pw-order with id=${order._id} failed. Will try next time, keeping this order in the DB for now.`);
          }

        } else {
          updatedPwOrders.push(order);
        }
      } catch (e) {
        log.error(`Error in closePriceWatcherOrders() of ${utils.getModuleName(module.id)} module: ` + e);
      }
    }
    return updatedPwOrders;

  },
  async placePriceWatcherOrder(targetPrice, orderBookInfo) {

    try {

      const type = orderBookInfo.typeTargetPrice;
      const price = targetPrice;
      const coin1Amount = orderBookInfo.amountTargetPrice;
      const coin2Amount = orderBookInfo.amountTargetPriceQuote;
      const lifeTime = setLifeTime();

      let output = '';
      let orderParamsString = '';

      orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      if (!type || !price || !coin1Amount || !coin2Amount) {
        log.warn(`${config.notifyName} unable to run pw-order with params: ${orderParamsString}.`);
        return;
      }

      console.log(type, price.toFixed(8), coin1Amount.toFixed(2), coin2Amount.toFixed(2), 'lifeTime:', lifeTime);

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
          purpose: 'pw', // pw: price watcher order
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
        log.info(`Successfully placed pw-order to ${output}.`);

      } else {
        log.warn(`${config.notifyName} unable to execute pw-order with params: ${orderParamsString}. No order id returned.`);
        return false;
      }

    } catch (e) {
      log.error(`Error in placePriceWatcherOrder() of ${utils.getModuleName(module.id)} module: ` + e);
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
        output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1} ${type} pw-order. Free: ${balance1free.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}, frozen: ${balance1freezed.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}.`;
        isBalanceEnough = false;
      }
      if ((!balance2free || balance2free < amount2) && type === 'buy') {
        output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2} ${type} pw-order. Free: ${balance2free.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}, frozen: ${balance2freezed.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}.`;
        isBalanceEnough = false;
      }

      return {
        result: isBalanceEnough,
        message: output,
      };

    } catch (e) {
      log.warn(`Unable to process balances for placing pw-order: ` + e);
      return {
        result: false,
      };
    }
  } else {
    log.warn(`Unable to get balances for placing pw-order.`);
    return {
      result: false,
    };
  }
}

function setLifeTime() {
  return utils.randomValue(LIFETIME_MIN, LIFETIME_MAX, true);
}

function setPause() {
  return utils.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}

async function setPriceRange() {

  try {

    const previousLowPrice = lowPrice;
    const previousHighPrice = highPrice;

    setPriceRangeCount += 1;
    let l; let h;

    if (tradeParams.mm_priceWatcherSource.indexOf('@') > -1) {

      const pair = tradeParams.mm_priceWatcherSource.split('@')[0];
      const exchange = tradeParams.mm_priceWatcherSource.split('@')[1];
      const pairObj = orderUtils.parseMarket(pair, exchange);

      module.exports.setPwExchangeApi(exchange);
      const orderBook = await pwExchangeApi.getOrderBook(pair);
      if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
        errorSettingPriceRange(`Unable to get the order book for ${pair} at ${exchange} exchange. It may be a temporary API error.`);
        return false;
      }

      if (tradeParams.mm_priceWatcherSourcePolicy === 'strict') {

        l = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, orderBook.bids[0].price).outAmount;
        h = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, orderBook.asks[0].price).outAmount;

        if (!l || l <= 0 || !h || h <= 0) {
          errorSettingPriceRange(`Wrong results of exchangerUtils.convertCryptos function: l=${l}, h=${h}.`);
          return false;
        }

        log.log(`Got a reference price range for ${pair} at ${exchange} exchange (strict): from ${l} to ${h}.`);

      } else {

        const orderBookInfo = utils.getOrderBookInfo(orderBook, 0, false);
        // console.log(orderBookInfo);
        if (!orderBookInfo || !orderBookInfo.smartAsk || !orderBookInfo.smartBid) {
          errorSettingPriceRange(`Unable to calculate the orderBookInfo for ${pair} at ${exchange} exchange.`);
          return false;
        }

        l = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, orderBookInfo.smartBid).outAmount;
        h = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, orderBookInfo.smartAsk).outAmount;

        if (!l || l <= 0 || !h || h <= 0) {
          errorSettingPriceRange(`Wrong results of exchangerUtils.convertCryptos function: l=${l}, h=${h}.`);
          return false;
        }

        const l_strict = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, orderBook.bids[0].price).outAmount;
        const h_strict = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, orderBook.asks[0].price).outAmount;

        log.log(`Got a reference price range for ${pair} at ${exchange} exchange: smart from ${l} to ${h}, strict from ${l_strict} to ${h_strict}.`);

      }

      lowPrice = l * utils.randomValue(1 - tradeParams.mm_priceWatcherDeviationPercent/100, 1) * utils.randomValue(0.99, 1.005);
      highPrice = h * utils.randomValue(1, 1 + tradeParams.mm_priceWatcherDeviationPercent/100) * utils.randomValue(0.995, 1.01);
      if (lowPrice >= highPrice) {
        lowPrice = l;
        highPrice = h;
      }
      isPriceActual = true;
      setPriceRangeCount = 0;

    } else {

      // Price range is set in some coin

      l = exchangerUtils.convertCryptos(tradeParams.mm_priceWatcherSource, config.coin2,
          tradeParams.mm_priceWatcherLowPriceInSourceCoin).outAmount;
      h = exchangerUtils.convertCryptos(tradeParams.mm_priceWatcherSource, config.coin2,
          tradeParams.mm_priceWatcherHighPriceInSourceCoin).outAmount;

      if (!l || l <= 0 || !h || h <= 0) {

        errorSettingPriceRange(`Wrong results of exchangerUtils.convertCryptos function: l=${l}, h=${h}.`);
        return false;

      } else {

        lowPrice = l * utils.randomValue(0.98, 1.01);
        highPrice = h * utils.randomValue(0.99, 1.02);
        if (lowPrice >= highPrice) {
          lowPrice = l;
          highPrice = h;
        }
        isPriceActual = true;
        setPriceRangeCount = 0;

      }

    }

    if (previousLowPrice && previousHighPrice) {

      const deltaLow = Math.abs(lowPrice - previousLowPrice);
      const deltaLowPercent = deltaLow / ( (lowPrice + previousLowPrice) / 2 ) * 100;
      const directionLow = lowPrice > previousLowPrice ? 'increased' : 'decreased';
      const deltaHigh = Math.abs(highPrice - previousHighPrice);
      const deltaHighPercent = deltaHigh / ( (highPrice + previousHighPrice) / 2 ) * 100;
      const directionHigh = highPrice > previousHighPrice ? 'increased' : 'decreased';

      let changedByStringLow; let changedByStringHigh;
      if (deltaLowPercent < priceChangeNotifyPercent) {
        changedByStringLow = `(no changes)`;
      } else {
        changedByStringLow = `(${directionLow} by ${deltaLowPercent.toFixed(0)}%)`;
      }
      if (deltaHighPercent < priceChangeNotifyPercent) {
        changedByStringHigh = `(no changes)`;
      } else {
        changedByStringHigh = `(${directionHigh} by ${deltaHighPercent.toFixed(0)}%)`;
      }

      if (deltaLowPercent > priceChangeWarningPercent || deltaHighPercent > priceChangeWarningPercent) {
        notify(`${config.notifyName}: Price watcher's new price range changed much—new values are from ${lowPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${changedByStringLow} to ${highPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${changedByStringHigh} ${config.coin2}.`, 'warn');
      } else {
        log.log(`Price watcher set a new price range from ${lowPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${changedByStringLow} to ${highPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${changedByStringHigh} ${config.coin2}.`);
      }

    } else {
      log.log(`Price watcher set a price range from ${lowPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} to ${highPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}.`);

    }

  } catch (e) {

    errorSettingPriceRange(`Error in setPriceRange() of ${utils.getModuleName(module.id)} module: ${e}.`);
    return false;

  }

}

function errorSettingPriceRange(errorMessage) {

  try {

    const baseNotifyMessage = `Unable to set the Price Watcher's price range ${setPriceRangeCount} times in series. I've temporary turned off watching the ${config.coin1} price.`;
    const baseMessage = `Unable to set the Price Watcher's price range ${setPriceRangeCount} times.`;

    if (setPriceRangeCount > 10) {

      isPriceActual = false;
      if (Date.now()-lastNotifyPriceTimestamp > constants.HOUR) {
        notify(`${baseNotifyMessage} ${errorMessage}`, 'warn');
        lastNotifyPriceTimestamp = Date.now();
      } else {
        log.log(`${baseNotifyMessage} ${errorMessage}`);
      }

    } else {
      if (isPriceActual) {
        log.log(`${baseMessage} ${errorMessage} I will continue watching ${config.coin1} price according to previous values.`);
      } else {
        log.log(`${baseMessage} ${errorMessage} No data to watch ${config.coin1} price. Price watching is disabled.`);
      }
    }

  } catch (e) {
    log.error(`Error in errorSettingPriceRange() of ${utils.getModuleName(module.id)} module: ` + e);
  }

}
