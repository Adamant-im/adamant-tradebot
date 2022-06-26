/**
 * Make trades for market-making
 * It places two orders on case of 'executeInSpread' or one order if 'executeInOrderBook'
 * Policies (mm_Policy):
 * - spread: Trade in spread only. If there is no spread, the bot will not trade.
 * - orderbook: Trade in orderbook only. Looks amazing when spread/liquidity is supported as well.
 * - optimal: Combines spread and orderbook. If chooses one or another depending on several parameters.
 */

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
    if (
      interval &&
      tradeParams.mm_isActive
    ) {
      if (isPreviousIterationFinished) {
        isPreviousIterationFinished = false;
        await this.executeMmOrder();
        isPreviousIterationFinished = true;
      } else {
        log.warn(`Market-making: Postponing iteration of the market-maker for ${interval} ms. Previous iteration is in progress yet.`);
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
  * Main part of Trader
  */
  async executeMmOrder() {
    try {
      coin1Decimals = orderUtils.parseMarket(config.pair).coin1Decimals;
      coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

      const type = setType();
      let coin1Amount = setAmount();

      const priceReq = await setPrice(type, coin1Amount); // it may update coin1Amount
      const price = priceReq.price;
      if (priceReq.coin1Amount) coin1Amount = priceReq.coin1Amount;
      const coin2Amount = coin1Amount * price;

      let output = '';
      let orderParamsString = '';

      if (!price) {
        if ((Date.now()-lastNotifyPriceTimestamp > constants.HOUR) && priceReq.message) {
          notify(`${config.notifyName}: ${priceReq.message}`, 'warn');
          lastNotifyPriceTimestamp = Date.now();
        }
        return;
      }

      orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, mmCurrentAction=${priceReq.mmCurrentAction}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      if (!type || !price || !coin1Amount || !coin2Amount) {
        log.warn(`Market-making: Unable to run mm-order with params: ${orderParamsString}.`);
        return;
      }

      log.log(`Market-making: Placing order with params ${orderParamsString}.`);

      // Check balances
      const balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount, type, priceReq.mmCurrentAction);
      if (!balances.result) {
        if (balances.message) {
          if (Date.now()-lastNotifyBalancesTimestamp > constants.HOUR) {
            notify(`${config.notifyName}: ${balances.message}`, 'warn', config.silent_mode);
            lastNotifyBalancesTimestamp = Date.now();
          } else {
            log.log(`Market-making: ${balances.message}`);
          }
        }
        return;
      }

      let order1; let order2;
      const takerApi = traderapi;

      if (priceReq.mmCurrentAction === 'executeInSpread') {

        // First, (maker) we place crossType-order using first account
        order1 = await traderapi.placeOrder(crossType(type), config.pair, price, coin1Amount, 1, null);
        if (order1 && order1.orderid) {
          const { ordersDb } = db;
          const order = new ordersDb({
            _id: order1.orderid,
            crossOrderId: null,
            date: utils.unixTimeStampMs(),
            purpose: 'mm', // Market making
            mmOrderAction: priceReq.mmCurrentAction, // executeInSpread or executeInOrderBook
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
            orderMakerAccount: '',
            orderTakerAccount: '',
            isSecondAccountOrder: false,
          });

          // Last, (taker) we place type-order using second account (in case of 2-keys trading)
          order2 = await takerApi.placeOrder(type, config.pair, price, coin1Amount, 1, null);
          if (order2 && order2.orderid) {
            output = `${type} ${coin1Amount.toFixed(coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(coin2Decimals)} ${config.coin2} at ${price.toFixed(coin2Decimals)} ${config.coin2}`;
            log.info(`Market-making: Successfully executed mm-order to ${output}. Action: executeInSpread.`);
            order.update({
              isProcessed: true,
              isExecuted: true,
              crossOrderId: order2.orderid,
            });
            await order.save();

          } else {
            await order.save();
            log.warn(`Market-making: Unable to execute taker cross-order for mm-order with params: id=${order1.orderid}, ${orderParamsString}. Action: executeInSpread. Check balances. Running order collector now.`);
            await orderCollector.clearLocalOrders(['mm'], config.pair, undefined, undefined, undefined, 'Market-making');
          }
        } else { // if order1
          log.warn(`Market-making: Unable to execute maker mm-order with params: ${orderParamsString}. Action: executeInSpread. No order id returned.`);
        }

      } else if (priceReq.mmCurrentAction === 'executeInOrderBook') {

        // First and last, (taker) we place type-order using second account (in case of 2-keys trading)
        order1 = await takerApi.placeOrder(type, config.pair, price, coin1Amount, 1, null);
        if (order1 && order1.orderid) {
          const { ordersDb } = db;
          const order = new ordersDb({
            _id: order1.orderid,
            crossOrderId: null,
            date: utils.unixTimeStampMs(),
            purpose: 'mm', // Market making
            mmOrderAction: priceReq.mmCurrentAction, // executeInSpread or executeInOrderBook
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
            isSecondAccountOrder: false,
          });
          await order.save();

          output = `${type} ${coin1Amount.toFixed(coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(coin2Decimals)} ${config.coin2} at ${price.toFixed(coin2Decimals)} ${config.coin2}`;
          log.info(`Market-making: Successfully executed mm-order to ${output}. Action: executeInOrderBook.`);

        } else { // if order1
          log.warn(`Market-making: Unable to execute mm-order with params: ${orderParamsString}. Action: executeInOrderBook. No order id returned.`);
        }
      }

    } catch (e) {
      log.error(`Error in executeMmOrder() of ${utils.getModuleName(module.id)} module: ` + e);
    }

  },
};

/**
 * Determines if to 'buy' or 'sell'
 * @returns {String}
*/
function setType() {
  if (!tradeParams || !tradeParams.mm_buyPercent) {
    log.warn(`Market-making: Param mm_buyPercent is not set. Check ${config.exchangeName} config.`);
    return false;
  }

  let type = 'buy';
  if (Math.random() > tradeParams.mm_buyPercent) {
    type = 'sell';
  }

  return type;
}

/**
 * Comprehensive function to check if enough funds to trade
 * @param {String} coin1 = config.coin1 (base)
 * @param {String} coin2 = config.coin2 (quote)
 * @param {Number} amount1 Amount in coin1 (base) to trade
 * @param {Number} amount2 Amount in coin2 (quote) to trade
 * @param {String} type 'buy' or 'sell'
 * @param {String} mmCurrentAction 'executeInSpread' or 'executeInOrderBook'
 * @returns {Object<Boolean, String>}
 *  result: if enough funds to trade
 *  message: error message
 */
async function isEnoughCoins(coin1, coin2, amount1, amount2, type, mmCurrentAction) {
  const traderapi2 = false;
  const balances = await traderapi.getBalances(false);
  if (!balances) {
    log.warn(`Market-making: Unable to get balances${traderapi2 ? ' on first account' : ''} for placing mm-order.`);
    return {
      result: false,
    };
  }
  const balances2 = undefined;
  if (!balances2 && traderapi2) {
    log.warn(`Market-making: Unable to get balances${traderapi2 ? ' on second account' : ''} for placing mm-order.`);
    return {
      result: false,
    };
  }

  let isBalanceEnough = true;
  let output = ''; let onWhichAccount; let orderType;
  let coin1Balance; let coin2Balance;

  try {
    const coin1Decimals = orderUtils.parseMarket(config.pair).coin1Decimals;
    const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

    const makerBalances = balances;
    const takerBalances = traderapi2 ? balances2 : balances;

    const makerCoin1Balance = makerBalances.filter((crypto) => crypto.code === coin1)[0] || { free: 0, freezed: 0 };
    const makerCoin2Balance = makerBalances.filter((crypto) => crypto.code === coin2)[0] || { free: 0, freezed: 0 };
    const takerCoin1Balance = takerBalances.filter((crypto) => crypto.code === coin1)[0] || { free: 0, freezed: 0 };
    const takerCoin2Balance = takerBalances.filter((crypto) => crypto.code === coin2)[0] || { free: 0, freezed: 0 };

    if (mmCurrentAction === 'executeInSpread') {
      if (type === 'buy') {
        // First, (maker) we place crossType-order (sell) using first account
        // Last, (taker) we place type-order (buy) using second account
        coin1Balance = makerCoin1Balance;
        coin2Balance = takerCoin2Balance;
        if (!coin1Balance.free || coin1Balance.free < amount1) {
          isBalanceEnough = false;
          onWhichAccount = traderapi2 ? ' on first account' : '';
          orderType = 'direct maker (selling)';
          output = `Not enough balance${onWhichAccount} to place ${amount1.toFixed(coin1Decimals)} ${coin1} ${orderType} mm-order (in spread). Free: ${coin1Balance.free.toFixed(coin1Decimals)} ${coin1}, frozen: ${coin1Balance.freezed.toFixed(coin1Decimals)} ${coin1}.`;
        } else if (!coin2Balance.free || coin2Balance.free < amount2) {
          isBalanceEnough = false;
          onWhichAccount = traderapi2 ? ' on second account' : '';
          orderType = 'cross-type taker (buying)';
          output = `Not enough balance${onWhichAccount} to place ${amount2.toFixed(coin2Decimals)} ${coin2} ${orderType} mm-order (in spread). Free: ${coin2Balance.free.toFixed(coin2Decimals)} ${coin2}, frozen: ${coin2Balance.freezed.toFixed(coin2Decimals)} ${coin2}.`;
        }
      } else { // type === 'sell'
        // First, (maker) we place crossType-order (buy) using first account
        // Last, (taker) we place type-order (sell) using second account
        coin1Balance = takerCoin1Balance;
        coin2Balance = makerCoin2Balance;
        if (!coin2Balance.free || coin2Balance.free < amount2) {
          isBalanceEnough = false;
          onWhichAccount = traderapi2 ? ' on first account' : '';
          orderType = 'direct maker (buying)';
          output = `Not enough balance${onWhichAccount} to place ${amount2.toFixed(coin2Decimals)} ${coin2} ${orderType} mm-order (in spread). Free: ${coin2Balance.free.toFixed(coin2Decimals)} ${coin2}, frozen: ${coin2Balance.freezed.toFixed(coin2Decimals)} ${coin2}.`;
        } else if (!coin1Balance.free || coin1Balance.free < amount1) {
          isBalanceEnough = false;
          onWhichAccount = traderapi2 ? ' on second account' : '';
          orderType = 'cross-type taker (selling)';
          output = `Not enough balance${onWhichAccount} to place ${amount1.toFixed(coin1Decimals)} ${coin1} ${orderType} mm-order (in spread). Free: ${coin1Balance.free.toFixed(coin1Decimals)} ${coin1}, frozen: ${coin1Balance.freezed.toFixed(coin1Decimals)} ${coin1}.`;
        }
      }
    }

    if (mmCurrentAction === 'executeInOrderBook') {
      if (type === 'sell') {
        coin1Balance = takerCoin1Balance;
        if (!coin1Balance.free || coin1Balance.free < amount1) {
          isBalanceEnough = false;
          onWhichAccount = traderapi2 ? ' on second account' : '';
          output = `Not enough balance${onWhichAccount} to place ${amount1.toFixed(coin1Decimals)} ${coin1} ${type} mm-order (in order book). Free: ${coin1Balance.free.toFixed(coin1Decimals)} ${coin1}, frozen: ${coin1Balance.freezed.toFixed(coin1Decimals)} ${coin1}.`;
        }
      } else { // type === 'buy'
        coin2Balance = takerCoin1Balance;
        if (!coin2Balance.free || coin2Balance.free < amount2) {
          isBalanceEnough = false;
          onWhichAccount = traderapi2 ? ' on second account' : '';
          output = `Not enough balance${onWhichAccount} to place ${amount2.toFixed(coin2Decimals)} ${coin2} ${type} mm-order (in order book). Free: ${coin2Balance.free.toFixed(coin2Decimals)} ${coin2}, frozen: ${coin2Balance.freezed.toFixed(coin2Decimals)} ${coin2}.`;
        }
      }
    }

    return {
      result: isBalanceEnough,
      message: output,
    };
  } catch (e) {
    log.warn(`Market-making: Unable to process balances for placing mm-order: ` + e);
    return {
      result: false,
    };
  }
}

/**
 * Calculates mm-order price
 * @param {String} type 'buy' or 'sell'
 * @param {Number} coin1Amount Amount to trade. This function can update it.
 * @returns {Object<Number, Number, String>}
 *  price: price to trade
 *  coin1Amount: updated amount to trade
 *  mmCurrentAction: 'executeInSpread', 'executeInOrderBook' or 'doNotExecute'
*/
async function setPrice(type, coin1Amount) {
  try {
    const coin1Decimals = orderUtils.parseMarket(config.pair).coin1Decimals;
    const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;
    const precision = utils.getPrecision(coin2Decimals); // precision for 3 decimals = 0.001
    let output = '';

    let ask_high; let bid_low; let price;
    const orderBook = await traderapi.getOrderBook(config.pair);
    let orderBookInfo = utils.getOrderBookInfo(orderBook, tradeParams.mm_liquiditySpreadPercent);
    if (!orderBookInfo) {
      log.warn(`Market-making: Order books are empty for ${config.pair}, or temporary API error. Unable to set a price while placing mm-order.`);
      return {
        price: false,
      };
    }
    bid_low = orderBookInfo.highestBid;
    ask_high = orderBookInfo.lowestAsk;

    let mmPolicy = tradeParams.mm_Policy; // optimal, spread, orderbook
    let mmCurrentAction; // doNotExecute, executeInSpread, executeInOrderBook

    let isSpreadCorrectedByPriceWatcher = false;
    let skipNotify = false;

    /**
     * Check if Price Watcher allows to trade, and set bid_low–ask_high
     */
    const pw = require('./mm_price_watcher');
    if (pw.getIsPriceActualAndEnabled()) {
      const lowPrice = pw.getLowPrice();
      const highPrice = pw.getHighPrice();

      if (type === 'buy') {
        if (bid_low > highPrice) {

          output = `Refusing to buy higher than ${highPrice.toFixed(coin2Decimals)}. Mm-order cancelled. Low: ${bid_low.toFixed(coin2Decimals)}, high: ${ask_high.toFixed(coin2Decimals)} ${config.coin2}. ${pw.getPwRangeString()} Check current order books and the price watcher parameters.`;
          skipNotify = true;
          mmCurrentAction = 'doNotExecute';

        } else if (ask_high > highPrice) {

          output = `Price watcher corrected spread to buy not higher than ${highPrice.toFixed(coin2Decimals)} while placing mm-order.`;
          if (mmPolicy === 'orderbook') {
            mmCurrentAction = 'doNotExecute';
            output += ` Market making settings deny trading in spread. Unable to set a price for ${config.pair}. Mm-order cancelled. Low: ${bid_low.toFixed(coin2Decimals)}, high: ${ask_high.toFixed(coin2Decimals)} ${config.coin2}. ${pw.getPwRangeString()} Check current order books and the price watcher parameters.`;
            skipNotify = true;
          } else {
            mmPolicy = 'spread';
            output += ` Will trade in spread. Low: ${bid_low.toFixed(coin2Decimals)}, high: ${ask_high.toFixed(coin2Decimals)} ${config.coin2}. ${pw.getPwRangeString()} Check current order books and the price watcher parameters.`;
            log.log(`Market-making: ${output}`);
            output = '';
            isSpreadCorrectedByPriceWatcher = true;
          }
          ask_high = highPrice;

        }
      } else if (type === 'sell') {
        if (ask_high < lowPrice) {

          output = `Refusing to sell lower than ${lowPrice.toFixed(coin2Decimals)}. Mm-order cancelled. Low: ${bid_low.toFixed(coin2Decimals)}, high: ${ask_high.toFixed(coin2Decimals)} ${config.coin2}. ${pw.getPwRangeString()} Check current order books and the price watcher parameters.`;
          skipNotify = true;
          mmCurrentAction = 'doNotExecute';

        } else if (bid_low < lowPrice) {

          output = `Price watcher corrected spread to sell not lower than ${lowPrice.toFixed(coin2Decimals)} while placing mm-order.`;
          if (mmPolicy === 'orderbook') {
            mmCurrentAction = 'doNotExecute';
            output += ` Market making settings deny trading in spread. Unable to set a price for ${config.pair}. Mm-order cancelled. Low: ${bid_low.toFixed(coin2Decimals)}, high: ${ask_high.toFixed(coin2Decimals)} ${config.coin2}. ${pw.getPwRangeString()} Check current order books and the price watcher parameters.`;
            skipNotify = true;
          } else {
            mmPolicy = 'spread';
            output += ` Will trade in spread. Low: ${bid_low.toFixed(coin2Decimals)}, high: ${ask_high.toFixed(coin2Decimals)} ${config.coin2}. ${pw.getPwRangeString()} Check current order books and the price watcher parameters.`;
            log.log(`Market-making: ${output}`);
            output = '';
            isSpreadCorrectedByPriceWatcher = true;
          }
          bid_low = lowPrice;

        }
      }
    } // Price Watcher checks

    const spread = ask_high - bid_low;
    const priceAvg = (ask_high + bid_low) / 2;
    const spreadPercent = spread / priceAvg * 100;
    const spreadNumber = Math.round(spread / precision);
    const noSpread = spreadNumber < 2;

    /**
     * If Price Watcher allows to trade, go ahead and set a price and amount
     */
    if (mmCurrentAction !== 'doNotExecute') {
      if (noSpread) {
        // No spread: Trade in orderbook, or cancel
        if (mmPolicy === 'orderbook' || (mmPolicy === 'optimal' && tradeParams.mm_isLiquidityActive)) {
          mmCurrentAction = 'executeInOrderBook';
        } else {
          mmCurrentAction = 'doNotExecute';
        }
      } else {
        // There is a spread, set:
        // mmCurrentAction: 'executeInSpread' or 'executeInOrderBook'
        // bid_low–ask_high interval to set a price

        if (mmPolicy === 'spread') {
          mmCurrentAction = 'executeInSpread';
        } else if (mmPolicy === 'optimal') {
          if (tradeParams.mm_isLiquidityActive) {
            // If Liquidity is enabled with Optimal mm-policy, do 80% in order book and 20% in spread
            mmCurrentAction = Math.random() > 0.8 ? 'executeInSpread' : 'executeInOrderBook';
          } else {
            // If Liquidity is disabled with Optimal mm-policy, do most orders in spread, but few in order book yet
            const obSpread = orderBookInfo.spreadPercent;
            if (obSpread < 2) { // small spread
              // If ob-spread is less than 2%, do 90% orders in spread and 10% in order book
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

    } // if (mmCurrentAction !== 'doNotExecute')

    /**
     * Set a price and trade amount according to mmCurrentAction
     * Or cancel a trade, if 'doNotExecute'
     */
    if (mmCurrentAction === 'doNotExecute') {
      if (!output) {
        if (isSpreadCorrectedByPriceWatcher) {
          output = `Refusing to place mm-order because of price watcher. Corrected spread is too small. Low: ${bid_low.toFixed(coin2Decimals)}, high: ${ask_high.toFixed(coin2Decimals)} ${config.coin2}. ${pw.getPwRangeString()} Check current order books and the price watcher parameters.`;
          skipNotify = true;
        } else {
          output = `No spread currently, and market making settings deny trading in the order book. Low: ${bid_low.toFixed(coin2Decimals)}, high: ${ask_high.toFixed(coin2Decimals)} ${config.coin2}. Unable to set a price for ${config.pair}. Update settings or create spread manually.`;
        }
      }
      if (skipNotify) {
        log.log(`Market-making: ${output}`);
        output = '';
      }
      return {
        price: false,
        message: output,
      };
    } // if (mmCurrentAction === 'doNotExecute')

    if (mmCurrentAction === 'executeInOrderBook') {

      let amountInSpread; let amountInConfig; let amountMaxAllowed; let firstOrderAmount;
      // fill not more, than liquidity amount * allowedAmountKoef
      const allowedAmountKoef = tradeParams.mm_isLiquidityActive ? utils.randomValue(0.5, 0.8) : utils.randomValue(0.2, 0.5);
      if (type === 'sell') {
        amountInSpread = orderBookInfo.liquidity.percentCustom.amountBids;
        amountInConfig = tradeParams.mm_liquidityBuyQuoteAmount / bid_low;
        amountMaxAllowed = amountInSpread > amountInConfig ? amountInConfig : amountInSpread;
        amountMaxAllowed *= allowedAmountKoef;

        if (amountMaxAllowed && tradeParams.mm_isLiquidityActive) {
          price = orderBookInfo.liquidity.percentCustom.lowPrice;
          if (coin1Amount > amountMaxAllowed) {
            isLimited = true;
            coin1Amount = amountMaxAllowed;
          } else {
            coin1Amount = coin1Amount;
          }
        } else {
          firstOrderAmount = orderBook.bids[0].amount * allowedAmountKoef;
          price = bid_low;
          if (coin1Amount > firstOrderAmount) {
            isLimited = true;
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

        if (amountMaxAllowed && tradeParams.mm_isLiquidityActive) {
          price = orderBookInfo.liquidity.percentCustom.highPrice;
          if (coin1Amount > amountMaxAllowed) {
            isLimited = true;
            coin1Amount = amountMaxAllowed;
          } else {
            coin1Amount = coin1Amount;
          }
        } else {
          firstOrderAmount = orderBook.asks[0].amount * allowedAmountKoef;
          price = ask_high;
          if (coin1Amount > firstOrderAmount) {
            isLimited = true;
            coin1Amount = firstOrderAmount;
          } else {
            coin1Amount = coin1Amount;
          }
        }
      } // if (type === 'buy')

      return {
        price,
        coin1Amount,
        mmCurrentAction,
      };
    } // if (mmCurrentAction === 'executeInOrderBook')

    if (mmCurrentAction === 'executeInSpread') {
      price = utils.randomValue(bid_low, ask_high);

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

/**
 * Sets ~randomized trading amount from mm_minAmount to mm_maxAmount multiplied by volatilityKoef
 * It considers volatilityKoef (0.25–4) from mm_volume_volatility module
 * @returns {Number} Amount to trade in base coin
*/
function setAmount() {
  if (!tradeParams || !tradeParams.mm_maxAmount || !tradeParams.mm_minAmount) {
    log.warn(`Market-making: Params mm_maxAmount or mm_minAmount are not set. Check ${config.exchangeName} config.`);
    return false;
  }
  return Math.random() * (tradeParams.mm_maxAmount - tradeParams.mm_minAmount) + tradeParams.mm_minAmount;
}

/**
 * Sets trading interval in ms
 * @returns {Number}
*/
function setPause() {
  if (!tradeParams || !tradeParams.mm_maxInterval || !tradeParams.mm_minInterval) {
    log.warn(`Market-making: Params mm_maxInterval or mm_minInterval are not set. Check ${config.exchangeName} config.`);
    return false;
  }
  return utils.randomValue(tradeParams.mm_minInterval, tradeParams.mm_maxInterval, true);
}

function crossType(type) {
  return type === 'buy' ? 'sell' : 'buy';
}
