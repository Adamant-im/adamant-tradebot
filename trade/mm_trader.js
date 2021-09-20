const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./settings/tradeParams_' + config.exchange);
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');
const orderCollector = require('./orderCollector');
const orderUtils = require('./orderUtils');

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

let isPreviousIterationFinished = true;

module.exports = {
  run() {
    this.iteration();
  },
  async iteration() {
    const interval = setPause();
    // console.log(interval);
    if (interval && tradeParams.mm_isActive) {
      if (isPreviousIterationFinished) {
        isPreviousIterationFinished = false;
        await this.executeMmOrder();
        isPreviousIterationFinished = true;
      } else {
        log.log(`Postponing iteration of the market-maker for ${interval} ms. Previous iteration is in progress yet.`);
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
  async executeMmOrder() {

    try {

      const type = setType();
      let coin1Amount = setAmount();
      const priceReq = await setPrice(type, config.pair, coin1Amount);
      const price = priceReq.price;
      if (priceReq.coin1Amount) coin1Amount = priceReq.coin1Amount; // it may be changed
      const coin2Amount = coin1Amount * price;

      let output = '';
      let orderParamsString = '';

      if (!price) {
        if ((Date.now()-lastNotifyPriceTimestamp > constants.HOUR) && priceReq.message) {
          notify(priceReq.message, 'warn');
          lastNotifyPriceTimestamp = Date.now();
        }
        return;
      }

      orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, mmCurrentAction=${priceReq.mmCurrentAction}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      if (!type || !price || !coin1Amount || !coin2Amount) {
        log.warn(`${config.notifyName} unable to run mm-order with params: ${orderParamsString}.`);
        return;
      }

      // console.log(orderParamsString);
      // console.log(type, price.toFixed(8), coin1Amount.toFixed(0), coin2Amount.toFixed(0));

      // Check balances
      const balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount, type, priceReq.mmCurrentAction);
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

      let order1; let order2;

      if (priceReq.mmCurrentAction === 'executeInSpread') {

        order1 = await traderapi.placeOrder(crossType(type), config.pair, price, coin1Amount, 1, null);
        if (order1 && order1.orderid) {
          const { ordersDb } = db;
          const order = new ordersDb({
            _id: order1.orderid,
            crossOrderId: null,
            date: utils.unix(),
            purpose: 'mm', // Market making
            mmOrderAction: priceReq.mmCurrentAction,
            type: crossType(type),
            targetType: type,
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
          });

          order2 = await traderapi.placeOrder(type, config.pair, price, coin1Amount, 1, null);
          if (order2 && order2.orderid) {
            output = `${type} ${coin1Amount.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}`;
            log.info(`Successfully executed mm-order to ${output}. Action: executeInSpread.`);
            order.update({
              isProcessed: true,
              isExecuted: true,
              crossOrderId: order2.orderid,
            });
            await order.save();

          } else {

            await order.save();
            log.warn(`${config.notifyName} unable to execute cross-order for mm-order with params: id=${order1.orderid}, ${orderParamsString}. Action: executeInSpread. Check balances. Running order collector now.`);
            orderCollector.clearOrders(['mm'], config.pair);
          }
        } else { // if order1
          log.warn(`${config.notifyName} unable to execute mm-order with params: ${orderParamsString}. Action: executeInSpread. No order id returned.`);
        }

      } else if (priceReq.mmCurrentAction === 'executeInOrderBook') {

        order1 = await traderapi.placeOrder(type, config.pair, price, coin1Amount, 1, null);
        if (order1 && order1.orderid) {
          const { ordersDb } = db;
          const order = new ordersDb({
            _id: order1.orderid,
            crossOrderId: null,
            date: utils.unix(),
            purpose: 'mm', // Market making
            mmOrderAction: priceReq.mmCurrentAction,
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
            isProcessed: true,
            isExecuted: true,
            isCancelled: false,
          });
          await order.save();

          output = `${type} ${coin1Amount.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}`;
          log.info(`Successfully executed mm-order to ${output}. Action: executeInOrderBook.`);

        } else { // if order1
          log.warn(`${config.notifyName} unable to execute mm-order with params: ${orderParamsString}. Action: executeInOrderBook. No order id returned.`);
        }
      }

    } catch (e) {
      log.error(`Error in executeMmOrder() of ${utils.getModuleName(module.id)} module: ` + e);
    }

  },
};

function setType() {

  if (!tradeParams || !tradeParams.mm_buyPercent) {
    log.warn(`Param mm_buyPercent is not set. Check ${config.exchangeName} config.`);
    return false;
  }
  let type = 'buy';
  if (Math.random() > tradeParams.mm_buyPercent) {
    type = 'sell';
  }
  return type;

}

async function isEnoughCoins(coin1, coin2, amount1, amount2, type, mmCurrentAction) {

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

      if (!balance1free || balance1free < amount1) {

        if (mmCurrentAction === 'executeInSpread') {
          if (type === 'sell') {
            output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1} ${type} direct mm-order (in spread). Free: ${balance1free.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}, frozen: ${balance1freezed.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}.`;
          } else {
            output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1} ${type} cross-type mm-order (in spread). Free: ${balance1free.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}, frozen: ${balance1freezed.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}.`;
          }
          isBalanceEnough = false;
        }

        if (mmCurrentAction === 'executeInOrderBook') {
          if (type === 'sell') {
            output = `${config.notifyName}: Not enough balance to place ${amount1.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1} ${type} mm-order (in order book). Free: ${balance1free.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}, frozen: ${balance1freezed.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}.`;
            isBalanceEnough = false;
          }
        }

      }

      if (!balance2free || balance2free < amount2) {

        if (mmCurrentAction === 'executeInSpread') {
          if (type === 'buy') {
            output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2} ${type} direct mm-order (in spread). Free: ${balance2free.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}, freezed: ${balance2freezed.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}.`;
          } else {
            output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2} ${type} cross-type mm-order (in spread). Free: ${balance2free.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}, freezed: ${balance2freezed.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}.`;
          }
          isBalanceEnough = false;
        }

        if (mmCurrentAction === 'executeInOrderBook') {
          if (type === 'buy') {
            output = `${config.notifyName}: Not enough balance to place ${amount2.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2} ${type} mm-order (in order book). Free: ${balance2free.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}, freezed: ${balance2freezed.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}.`;
            isBalanceEnough = false;
          }
        }


      }

      // console.log(balance1.toFixed(0), amount1.toFixed(0), balance2.toFixed(8), amount2.toFixed(8));
      return {
        result: isBalanceEnough,
        message: output,
      };

    } catch (e) {
      log.warn(`Unable to process balances for placing mm-order: ` + e);
      return {
        result: false,
      };
    }
  } else {
    log.warn(`Unable to get balances for placing mm-order.`);
    return {
      result: false,
    };
  }
}

async function setPrice(type, pair, coin1Amount) {

  try {

    const precision = utils.getPrecision(orderUtils.parseMarket(config.pair).coin2Decimals);
    const smallSpread = precision * 15; // if spread is small and should do market making less careful
    let output = '';

    let ask_high; let bid_low; let price;
    const orderBook = await traderapi.getOrderBook(config.pair);
    const orderBookInfo = utils.getOrderBookInfo(orderBook, tradeParams.mm_liquiditySpreadPercent);
    if (!orderBookInfo) {
      log.warn(`${config.notifyName}: Order books are empty for ${config.pair}, or temporary API error. Unable to set a price while placing mm-order.`);
      return {
        price: false,
      };
    }
    bid_low = orderBookInfo.highestBid;
    ask_high = orderBookInfo.lowestAsk;
    // console.log('bid_low:', bid_low, 'ask_high:', ask_high);

    let mmPolicy = tradeParams.mm_Policy; // optimal, spread, orderbook
    let mmCurrentAction; // doNotExecute, executeInSpread, executeInOrderBook

    let isSpreadCorrectedByPriceWatcher = false;
    let skipNotify = false;

    const pw = require('./mm_price_watcher');
    if (tradeParams.mm_isPriceWatcherActive && pw.getIsPriceActual()) {

      const lowPrice = pw.getLowPrice();
      const highPrice = pw.getHighPrice();

      if (type === 'buy') {

        if (bid_low > highPrice) {

          output = `${config.notifyName}: Refusing to buy higher than ${highPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}. Mm-order cancelled. Low: ${bid_low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${ask_high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}. Check current order books and the price watcher parameters.`;
          skipNotify = true;
          mmCurrentAction = 'doNotExecute';

        } else if (ask_high > highPrice) {

          output = `${config.notifyName}: Price watcher corrected spread to buy not higher than ${highPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} while placing mm-order.`;
          if (mmPolicy === 'orderbook') {
            mmCurrentAction = 'doNotExecute';
            output += ` Market making settings deny trading in spread. Unable to set a price for ${pair}. Mm-order cancelled. Low: ${bid_low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${ask_high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}. Check current order books and the price watcher parameters.`;
            skipNotify = true;
          } else {
            mmPolicy = 'spread';
            output += ` Will trade in spread. Low: ${bid_low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${ask_high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}. Check current order books and the price watcher parameters.`;
            log.log(output);
            output = '';
            isSpreadCorrectedByPriceWatcher = true;
          }
          ask_high = highPrice;

        }

      } else if (type === 'sell') {

        if (ask_high < lowPrice) {

          output = `${config.notifyName}: Refusing to sell lower than ${lowPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}. Mm-order cancelled. Low: ${bid_low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${ask_high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}. Check current order books and the price watcher parameters.`;
          skipNotify = true;
          mmCurrentAction = 'doNotExecute';

        } else if (bid_low < lowPrice) {

          output = `${config.notifyName}: Price watcher corrected spread to sell not lower than ${lowPrice.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} while placing mm-order.`;
          if (mmPolicy === 'orderbook') {
            mmCurrentAction = 'doNotExecute';
            output += ` Market making settings deny trading in spread. Unable to set a price for ${pair}. Mm-order cancelled. Low: ${bid_low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${ask_high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}. Check current order books and the price watcher parameters.`;
            skipNotify = true;
          } else {
            mmPolicy = 'spread';
            output += ` Will trade in spread. Low: ${bid_low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${ask_high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}. Check current order books and the price watcher parameters.`;
            log.log(output);
            output = '';
            isSpreadCorrectedByPriceWatcher = true;
          }
          bid_low = lowPrice;

        }

      }

    }

    // console.log('mmPolicy', mmPolicy);

    if (mmCurrentAction !== 'doNotExecute') {

      const spread = ask_high - bid_low;
      const noSpread = spread < precision * 2;

      if (noSpread) {

        if (mmPolicy === 'orderbook' || (mmPolicy === 'optimal' && tradeParams.mm_isLiquidityActive)) {
          mmCurrentAction = 'executeInOrderBook';
        } else {
          mmCurrentAction = 'doNotExecute';
        }

      } else { // there is a spread

        if (mmPolicy === 'spread') {
          mmCurrentAction = 'executeInSpread';
        } else if (mmPolicy === 'optimal') {
          if (tradeParams.mm_isLiquidityActive) {
            // 80% in order book and 20% in spread
            mmCurrentAction = Math.random() > 0.8 ? 'executeInSpread' : 'executeInOrderBook';
          } else {
            const obSpread = orderBookInfo.spreadPercent;
            if (obSpread < 2) { // small spread
              // 90% in spread and 10% in order book
              mmCurrentAction = Math.random() > 0.1 ? 'executeInSpread' : 'executeInOrderBook';
            } else if (obSpread < 5) {
              mmCurrentAction = Math.random() > 0.05 ? 'executeInSpread' : 'executeInOrderBook';
            } else if (obSpread < 10) {
              mmCurrentAction = Math.random() > 0.01 ? 'executeInSpread' : 'executeInOrderBook';
            } else {
              mmCurrentAction = Math.random() > 0.001 ? 'executeInSpread' : 'executeInOrderBook';
            }
          }
        } else {
          mmCurrentAction = 'executeInOrderBook';
        }

      }

    }

    // console.log('mmCurrentAction', mmCurrentAction);

    if (mmCurrentAction === 'doNotExecute') {

      if (!output) {
        if (isSpreadCorrectedByPriceWatcher) {
          output = `${config.notifyName}: Refusing to place mm-order because of price watcher. Corrected spread is too small. Low: ${bid_low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${ask_high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}. Check current order books and the price watcher parameters.`;
          skipNotify = true;
        } else {
          output = `${config.notifyName}: No spread currently, and market making settings deny trading in the order book. Low: ${bid_low.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)}, high: ${ask_high.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${config.coin2}. Unable to set a price for ${pair}. Update settings or create spread manually.`;
        }
      }
      if (skipNotify) {
        log.log(output);
        output = '';
      }
      return {
        price: false,
        message: output,
      };

    }

    if (mmCurrentAction === 'executeInOrderBook') {

      let amountInSpread; let amountInConfig; let amountMaxAllowed; let firstOrderAmount;
      // fill not more, than liquidity amount * allowedAmountKoef
      const allowedAmountKoef = tradeParams.mm_isLiquidityActive ? utils.randomValue(0.5, 0.8) : utils.randomValue(0.2, 0.5);

      if (type === 'sell') {

        amountInSpread = orderBookInfo.liquidity.percentCustom.amountBids;
        amountInConfig = tradeParams.mm_liquidityBuyQuoteAmount / bid_low;
        amountMaxAllowed = amountInSpread > amountInConfig ? amountInConfig : amountInSpread;
        amountMaxAllowed *= allowedAmountKoef;
        console.log(`Selling; coin1Amount: ${coin1Amount}, amountInSpread: ${amountInSpread}, amountInConfig: ${amountInConfig}, amountMaxAllowed: ${amountMaxAllowed}.`);

        if (amountMaxAllowed && tradeParams.mm_isLiquidityActive) {

          price = orderBookInfo.liquidity.percentCustom.lowPrice;
          if (coin1Amount > amountMaxAllowed) {
            coin1Amount = amountMaxAllowed;
          } else {
            coin1Amount = coin1Amount;
          }

        } else {

          firstOrderAmount = orderBook.bids[0].amount * allowedAmountKoef;
          price = bid_low;
          if (coin1Amount > firstOrderAmount) {
            coin1Amount = firstOrderAmount;
          } else {
            coin1Amount = coin1Amount;
          }

        }

      }

      if (type === 'buy') {

        amountInSpread = orderBookInfo.liquidity.percentCustom.amountAsks;
        amountInConfig = tradeParams.mm_liquiditySellAmount;
        amountMaxAllowed = amountInSpread > amountInConfig ? amountInConfig : amountInSpread;
        amountMaxAllowed *= allowedAmountKoef;
        console.log(`Buying; coin1Amount: ${coin1Amount}, amountInSpread: ${amountInSpread}, amountInConfig: ${amountInConfig}, amountMaxAllowed: ${amountMaxAllowed}.`);

        if (amountMaxAllowed && tradeParams.mm_isLiquidityActive) {

          price = orderBookInfo.liquidity.percentCustom.highPrice;
          if (coin1Amount > amountMaxAllowed) {
            coin1Amount = amountMaxAllowed;
          } else {
            coin1Amount = coin1Amount;
          }

        } else {

          firstOrderAmount = orderBook.asks[0].amount * allowedAmountKoef;
          price = ask_high;
          if (coin1Amount > firstOrderAmount) {
            coin1Amount = firstOrderAmount;
          } else {
            coin1Amount = coin1Amount;
          }

        }

      }

      // console.log(`Price: ${price}, coin1Amount: ${coin1Amount}.`)

      return {
        price,
        coin1Amount,
        mmCurrentAction,
      };

    }

    if (mmCurrentAction === 'executeInSpread') {

      let isCareful = true; // set price closer to bids & asks
      if (tradeParams && (tradeParams.mm_isCareful !== undefined)) {
        isCareful = tradeParams.mm_isCareful;
      }

      let deltaPercent;
      const interval = ask_high - bid_low;
      // console.log(interval, smallSpread);
      if (isCareful) {
        if (interval > smallSpread) {
          // 1-25% of spread
          deltaPercent = utils.randomValue(0.01, 0.25);
        } else {
          // 5-35% of spread
          deltaPercent = utils.randomValue(0.05, 0.35);
        }
      } else {
        // 1-45% of spread
        deltaPercent = utils.randomValue(0.01, 0.45);
      }

      if (type === 'buy') {
        price = bid_low + interval*deltaPercent;
      } else {
        price = ask_high - interval*deltaPercent;
      }

      const minPrice = +bid_low + +precision;
      const maxPrice = ask_high - precision;

      if (price >= maxPrice) {
        price = ask_high - precision;
      }
      if (price <= minPrice) {
        price = +bid_low + +precision;
      }

      return {
        price,
        mmCurrentAction,
      };

    } // if (mmCurrentAction === 'executeInSpread')

  } catch (e) {
    log.error(`Error in setPrice() of ${utils.getModuleName(module.id)} module: ` + e);
  }

}

function setAmount() {
  if (!tradeParams || !tradeParams.mm_maxAmount || !tradeParams.mm_minAmount) {
    log.warn(`Params mm_maxAmount or mm_minAmount are not set. Check ${config.exchangeName} config.`);
    return false;
  }
  return Math.random() * (tradeParams.mm_maxAmount - tradeParams.mm_minAmount) + tradeParams.mm_minAmount;
}

function setPause() {
  if (!tradeParams || !tradeParams.mm_maxInterval || !tradeParams.mm_minInterval) {
    log.warn(`Params mm_maxInterval or mm_minInterval are not set. Check ${config.exchangeName} config.`);
    return false;
  }
  return Math.round(Math.random() * (tradeParams.mm_maxInterval - tradeParams.mm_minInterval)) + tradeParams.mm_minInterval;
}

function crossType(type) {
  if (type === 'buy') {
    return 'sell';
  } else {
    return 'buy';
  }
}
