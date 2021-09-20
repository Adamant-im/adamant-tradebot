const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./settings/tradeParams_' + config.exchange);
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');
const orderUtils = require('./orderUtils');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

const INTERVAL_MIN = 2000;
const INTERVAL_MAX = 3000;
const LIFETIME_MIN = 1000;
// const LIFETIME_MAX = 40000; — depends on mm_orderBookOrdersCount
const LIFETIME_KOEF = 1.5;

let isPreviousIterationFinished = true;

module.exports = {

  async test() {
    console.log('==========================');
    console.log('**************before');
    // const pw = require('./mm_price_watcher');
    // console.log(`isPriceActual: ${pw.getIsPriceActual()}`);
    // console.log(await traderapi.getBalances());
    // const markets = await traderapi.getMarkets();
    // console.log(traderapi.markets['KOM/USDT']);
    // const traderapi2 = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);

    // const traderapi2 = require('./trader_' + 'resfinex')(config.apikey, config.apisecret, config.apipassword, log);

    // console.log(await traderapi.getOpenOrders('KOM/USDT'));
    // console.log(await traderapi.getOrderBook('KOM/USDT'));

    // console.log((await traderapi.getMarkets())['ADM/USDT']);
    // console.log((await traderapi2.getMarkets())['ADM/USDT']);
    // console.log(traderapi2.markets['ADM/USDT']);

    // setTimeout(() => {
    //   console.log(1);
    //   const traderapi = require('./trader_' + 'resfinex')(config.apikey, config.apisecret, config.apipassword, log);
    //   console.log(require('./orderUtils').parseMarket('ADM/USDT', 'resfinex'));
    //   console.log(2);
    //   // console.log(traderapi2.markets['KOM/USDT']);
    // }, 3000);
    // setTimeout(() => {
    //   console.log(1);
    //   console.log(require('./orderUtils').parseMarket('ADM/USDT', 'resfinex'));
    //   console.log(require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log).marketInfo('KOM/USDT'));
    //   console.log(2);
    //   // console.log(traderapi2.markets['KOM/USDT']);
    // }, 6000);

    // let req = await traderapi.cancelOrder('53346669011', null, 'KOM/USDT');

    let req = await traderapi.cancelOrder('5d13f3e8-dcb3-4a6d-88c1-16cf6e8d8179');

    // let exchangeapi = require('./trader_' + 'atomars')(null, null, null, log, true);
    // let req = await exchangeapi.getOrderBook('ADM/USDT');
    // const pw2 = require('./mm_price_watcher');
    // console.log(`isPriceActual: ${pw2.getIsPriceActual()}`);

    console.log('**************after:');
    // console.log(req);
  },
  run() {
    this.iteration();
  },
  async iteration() {

    const interval = setPause();
    // console.log(interval);
    if (interval && tradeParams.mm_isActive && tradeParams.mm_isOrderBookActive) {
      if (isPreviousIterationFinished) {
        isPreviousIterationFinished = false;
        await this.buildOrderBook();
        isPreviousIterationFinished = true;
      } else {
        log.log(`Postponing iteration of the order book builder for ${interval} ms. Previous iteration is in progress yet.`);
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
  async buildOrderBook() {

    const { ordersDb } = db;
    const orderBookOrders = await ordersDb.find({
      isProcessed: false,
      purpose: 'ob', // ob: dynamic order book order
      pair: config.pair,
      exchange: config.exchange,
    });

    if (orderBookOrders.length < tradeParams.mm_orderBookOrdersCount) {
      await this.placeOrderBookOrder(orderBookOrders.length);
    }
    await this.closeOrderBookOrders(orderBookOrders);

  },
  async closeOrderBookOrders(orderBookOrders) {

    let orderBookOrdersCount = orderBookOrders.length;
    for (const order of orderBookOrders) {
      try {

        if (order.dateTill < utils.unix()) {

          orderBookOrdersCount -= 1;
          const cancelReq = await traderapi.cancelOrder(order._id, order.type, order.pair);
          if (cancelReq !== undefined) {
            log.log(`Closing ob-order with params: id=${order._id}, type=${order.type}, pair=${order.pair}, price=${order.price}, coin1Amount=${order.coin1Amount}, coin2Amount=${order.coin2Amount}. It is expired. Open ob-orders: ~${orderBookOrdersCount}.`);
            await order.update({
              isProcessed: true,
              isClosed: true,
              isExpired: true,
            }, true);
          } else {
            log.log(`Request to close ob-order with id=${order._id} failed. Will try next time, keeping this order in the DB for now.`);
          }

        }
      } catch (e) {
        log.error(`Error in closeOrderBookOrders() of ${utils.getModuleName(module.id)} module: ` + e);
      }
    };

  },
  async placeOrderBookOrder(orderBookOrdersCount) {

    try {

      const type = setType();

      const orderBook = await traderapi.getOrderBook(config.pair);
      if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
        log.warn(`${config.notifyName}: Order books are empty for ${config.pair}, or temporary API error. Unable to check if I need to place ob-order.`);
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
        log.warn(`${config.notifyName}: Filtered order count of type ${type} is less then 2 for ${config.pair}, or temporary API error. Unable to set a price while placing ob-order.`);
        return;
      }

      const position = setPosition(orderList.length);
      const priceReq = await setPrice(type, position, orderList);
      const price = priceReq.price;
      const coin1Amount = setAmount();
      const coin2Amount = coin1Amount * price;
      const lifeTime = setLifeTime(position);

      let output = '';
      let orderParamsString = '';

      if (!price) {
        if ((Date.now()-lastNotifyPriceTimestamp > constants.HOUR) && priceReq.message) {
          notify(priceReq.message, 'warn');
          lastNotifyPriceTimestamp = Date.now();
        }
        return;
      }

      orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      if (!type || !price || !coin1Amount || !coin2Amount) {
        log.warn(`${config.notifyName} unable to run ob-order with params: ${orderParamsString}.`);
        return;
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
          purpose: 'ob', // ob: dynamic order book order
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
        log.info(`Successfully placed ob-order to ${output}. Open ob-orders: ~${orderBookOrdersCount+1}.`);
      } else {
        log.warn(`${config.notifyName} unable to execute ob-order with params: ${orderParamsString}. No order id returned.`);
      }

    } catch (e) {
      log.error(`Error in placeOrderBookOrder() of ${utils.getModuleName(module.id)} module: ` + e);
    }

  },
};

function setType() {

  if (!tradeParams || !tradeParams.mm_buyPercent) {
    log.warn(`Param mm_buyPercent is not set. Check ${config.exchangeName} config.`);
    return false;
  }

  let type = 'sell';
  // 1 minus tradeParams.mm_buyPercent
  if (Math.random() > tradeParams.mm_buyPercent) {
    type = 'buy';
  }
  return type;

}

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
        output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1} ${type} ob-order. Free: ${balance1free.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}, frozen: ${balance1freezed.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}.`;
        isBalanceEnough = false;
      }
      if ((!balance2free || balance2free < amount2) && type === 'buy') {
        output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2} ${type} ob-order. Free: ${balance2free.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}, frozen: ${balance2freezed.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}.`;
        isBalanceEnough = false;
      }

      // console.log(balance1.toFixed(0), amount1.toFixed(0), balance2.toFixed(8), amount2.toFixed(8));
      return {
        result: isBalanceEnough,
        message: output,
      };

    } catch (e) {
      log.warn(`Unable to process balances for placing ob-order: ` + e);
      return {
        result: false,
      };
    }
  } else {
    log.warn(`Unable to get balances for placing ob-order.`);
    return {
      result: false,
    };
  }
}

async function setPrice(type, position, orderList) {

  try {

    let output = '';
    let high; let low;

    if (orderList.length < position) {
      position = orderList.length;
    }

    if (type === 'sell') {
      low = orderList[position-2].price;
      high = orderList[position-1].price;
    } else {
      high = orderList[position-2].price;
      low = orderList[position-1].price;
    }

    // Put orders between current orders, but not with the same price
    const precision = utils.getPrecision(orderUtils.parseMarket(config.pair).coin2Decimals);
    // console.log(`ob precision: ${precision}, before: low ${low}, high ${high}`);
    if (low + precision < high) {
      low += precision;
    }
    if (high - precision > low) {
      high -= precision;
    }
    // console.log(`ob precision: ${precision}, after: low ${low}, high ${high}`);

    let price = utils.randomValue(low, high);

    const pw = require('./mm_price_watcher');
    if (tradeParams.mm_isPriceWatcherActive && pw.getIsPriceActual()) {

      const lowPrice = pw.getLowPrice();
      const highPrice = pw.getHighPrice();
      // console.log('lowPrice:', +lowPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals), 'highPrice:', +highPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals));

      if (type === 'sell') {
        if (price < lowPrice) {
          price = lowPrice * utils.randomValue(1, 1.21);
          output = `${config.notifyName}: Price watcher corrected price to sell not lower than ${lowPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} while placing ob-order. Low: ${low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}.`;
          log.log(output);
        }
      } else {
        if (price > highPrice) {
          price = highPrice * utils.randomValue(0.79, 1);
          output = `${config.notifyName}: Price watcher corrected price to buy not higher than ${highPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} while placing ob-order. Low: ${low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}.`;
          log.log(output);
        }
      }
    }

    return {
      price,
    };

  } catch (e) {
    log.error(`Error in setPrice() of ${utils.getModuleName(module.id)} module: ` + e);
  }


}

function setAmount() {

  if (!tradeParams || !tradeParams.mm_maxAmount || !tradeParams.mm_minAmount) {
    log.warn(`Params mm_maxAmount or mm_minAmount are not set. Check ${config.exchangeName} config.`);
    return false;
  }
  return utils.randomValue(tradeParams.mm_minAmount, tradeParams.mm_maxAmount);

}

function setPosition(orderCount) {
  const maxPosition = Math.min(orderCount, tradeParams.mm_orderBookHeight);
  return utils.randomValue(2, maxPosition, true);
}

function setLifeTime(position) {

  const positionKoef = Math.sqrt(position/1.5);
  const lifetimeMax = tradeParams.mm_orderBookOrdersCount * LIFETIME_KOEF * 1000;
  const orderLifeTime = Math.round(utils.randomValue(LIFETIME_MIN, lifetimeMax, false) * positionKoef);
  // console.log(orderLifeTime);
  return orderLifeTime;
}

function setPause() {
  return utils.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}
