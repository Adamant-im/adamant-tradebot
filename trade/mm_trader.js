/**
 * Make trades for market-making
 * It places two orders on case of 'executeInSpread' or one order if 'executeInOrderBook'
 * Policies (mm_Policy):
 * - spread: Trade in spread only. If there is no spread, the bot will not trade.
 * - orderbook: Trade in orderbook only. Looks amazing when spread/liquidity is supported as well.
 * - optimal: Combines spread and orderbook. If chooses one or another depending on several parameters.
 * - others: Don't do Market-taking.
 *   Also: don't restore Pw's range; don't place cl-orders; don't run fund balancer; don't calculate volume volatility koef.
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

// Trading in order book
let lastOrderType = 'buy';
const EXECUTE_IN_ORDER_BOOK_PERCENT_WITH_LIQ_ENABLED_MIN = 0.6;
const EXECUTE_IN_ORDER_BOOK_PERCENT_WITH_LIQ_ENABLED_MAX = 0.8;
const EXECUTE_IN_ORDER_BOOK_PERCENT_WO_LIQ_ENABLED_MIN = 0.2;
const EXECUTE_IN_ORDER_BOOK_PERCENT_WO_LIQ_ENABLED_MAX = 0.5;
const EXECUTE_IN_ORDER_BOOK_ORDER_TYPE_REPEAT_PERCENT = 80; // repeat same order type ('buy' or 'sell') with 80% chance

module.exports = {
  readableModuleName: 'Market-making',

  run() {
    this.iteration();
  },

  async iteration() {
    const interval = setPause();
    if (
      interval &&
      tradeParams.mm_isActive &&
      constants.MM_POLICIES_VOLUME.includes(tradeParams.mm_Policy)
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
  * 1. Set an order type, buy or sell. Not a random function.
  * 2. Set amount to trade from mm_minAmount to mm_maxAmount multiplied by volatilityKoef
  * 3. Set trade price. Returns price, coin1Amount (corrected),
  *    mmCurrentAction: 'executeInSpread', 'executeInOrderBook' or 'doNotExecute'
  * 4. Check for balances
  * 5. Place two orders to match itself in case of executeInSpread.
  * 6. Place one order in case of executeInOrderBook
  *    Maintain spread tiny in case of 'orderbook' mm_Policy: Place Spread maintainer order
  *    Remove gaps in order book (extraordinary iteration with no cache)
  *    Clears second account order, if any left
  */
  async executeMmOrder() {
    try {
      const coin1Decimals = orderUtils.parseMarket(config.pair).coin1Decimals;
      const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

      const type = setType();
      let coin1Amount = setAmount();

      const priceReq = await setPrice(type, coin1Amount); // it may update coin1Amount
      const price = priceReq.price;
      if (priceReq.coin1Amount) coin1Amount = priceReq.coin1Amount;
      const coin2Amount = coin1Amount * price;

      let output = '';
      let orderParamsString = '';

      if (!price) {
        if (priceReq.message) {
          if ((Date.now()-lastNotifyPriceTimestamp > constants.HOUR)) {
            notify(`${config.notifyName}: ${priceReq.message}`, 'warn');
            lastNotifyPriceTimestamp = Date.now();
          } else {
            log.log(`Market-making: ${priceReq.message}`);
          }
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
      let order1Details; let order2Details;

      const takerApi = traderapi;
      const makerOrderType = orderUtils.crossType(type);

      if (priceReq.mmCurrentAction === 'executeInSpread') {

        // First, (maker) we place crossType-order using first account

        order1 = await traderapi.placeOrder(makerOrderType, config.pair, price, coin1Amount, 1, null);

        if (order1?.orderId) {
          const { ordersDb } = db;

          const order = new ordersDb({
            _id: order1.orderId,
            crossOrderId: null,
            date: utils.unixTimeStampMs(),
            purpose: 'mm', // Market making
            mmOrderAction: priceReq.mmCurrentAction, // executeInSpread or executeInOrderBook
            type: makerOrderType,
            targetType: type,
            exchange: config.exchange,
            pair: config.pair,
            coin1: config.coin1,
            coin2: config.coin2,
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
            orderMakerAccount: '',
            orderTakerAccount: '',
            isSecondAccountOrder: false,
          });

          // Last, (taker) we place type-order using second account (in case of 2-keys trading)

          order2 = await takerApi.placeOrder(type, config.pair, price, coin1Amount, 1, null);

          if (order2?.orderId) {
            output = `${type} ${coin1Amount.toFixed(coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(coin2Decimals)} ${config.coin2} at ${price.toFixed(coin2Decimals)} ${config.coin2}`;
            log.info(`Market-making: Successfully executed mm-order to ${output}. Action: executeInSpread.`);

            lastOrderType = type;

            order.update({
              isProcessed: true,
              crossOrderId: order2.orderId,
            });

            // Make a pause to ensure the exchange's matching engine processed the orders
            // Note: If orders were not filled, they stay opened during this pause (before they cancelled below)
            // It theoretically allows third-party bots matching them

            const pauseMs = traderapi.features().apiProcessingDelayMs ?? constants.DEFAULT_API_PROCESSING_DELAY_MS;
            await utils.pauseAsync(pauseMs, `Market-making: ${pauseMs} msec pause to ensure the ${config.exchangeName}'s matching engine processed the orders…`);

            // Check mm-orders status to understand if they're filled or not

            order1Details = await traderapi.getOrderDetails?.call(this, order1.orderId, order.pair);
            order2Details = await takerApi.getOrderDetails?.call(this, order2.orderId, order.pair);

            if (!order1Details?.status || !order2Details?.status) {
              if (!traderapi.getOrderDetails) {
                log.log(`Market-making: Getting order details are not implemented for ${config.exchangeName} exchange. Assuming both maker and taker executeInSpread mm-orders are filled.`);
              } else {
                log.log('Market-making: Unable to get maker and taker order details. Assuming both executeInSpread mm-orders are filled.');
              }

              order.update({
                coin1AmountFilled: undefined,
                coin2AmountFilled: undefined,
                isExecuted: true, // We _assume_ the order if fully filled
              });
            } else if (order1Details?.status === 'filled' && order2Details?.status === 'filled') {
              log.info('Market-making: Both maker and taker executeInSpread mm-orders are filled.');

              order.update({
                coin1AmountFilled: coin1Amount,
                coin2AmountFilled: coin2Amount,
                isExecuted: true,
              });
            } else if (order1Details?.status === 'filled' && ['new', 'part_filled'].includes(order2Details?.status)) {
              const fillPercent = order2Details.amountExecuted / coin1Amount;
              log.warn(`Market-making: While the maker order is filled, the taker is ${order2Details?.status} (${fillPercent}% filled). It may be the Scenario1 of third-party bot intervention.`);

              order.update({
                coin1AmountFilled: order2Details.amountExecuted,
                coin2AmountFilled: order2Details.volumeExecuted,
                isExecuted: false, // Not fully executed
              });
            } else if (order2Details?.status === 'filled' && ['new', 'part_filled'].includes(order1Details?.status)) {
              const fillPercent = order1Details.amountExecuted / coin1Amount;
              log.warn(`Market-making: The maker order is ${order1Details?.status} (${fillPercent}% filled), while the taker order is filled. It may be the Scenario2 of third-party bot intervention.`);

              order.update({
                coin1AmountFilled: order1Details.amountExecuted,
                coin2AmountFilled: order1Details.volumeExecuted,
                isExecuted: false, // Not fully executed
              });
            } else {
              log.warn(`Market-making: Unexpected scenario while placing executeInSpread mm-order. The maker order is ${order1Details?.status}, and the taker order is ${order2Details?.status}.`);

              order.update({
                coin1AmountFilled: undefined,
                coin2AmountFilled: undefined,
                isExecuted: false, // Not fully executed
              });
            }

            await order.save();

            // Cancelling maker and taker orders, if they are not filled

            if ([undefined, 'unknown', 'new', 'part_filled'].includes(order1Details?.status)) {
              const reasonToClose = `Cancelling order1 (maker) order with status '${order1Details?.status}' while doing executeInSpread mm-trade`;
              await orderCollector.clearOrderById(
                  order, order.pair, makerOrderType, this.readableModuleName, reasonToClose, undefined, traderapi);
            }

            if ([undefined, 'unknown', 'new', 'part_filled'].includes(order2Details?.status)) {
              const reasonToClose = `Cancelling order2 (taker) order with status '${order2Details?.status}' while doing executeInSpread mm-trade`;
              await orderCollector.clearOrderById(
                  order2.orderId, order.pair, type, this.readableModuleName, reasonToClose, undefined, takerApi);
            }
          } else {
            log.warn(`Market-making: Unable to execute taker cross-order for mm-order with params: id=${order1.orderId}, ${orderParamsString}. Action: executeInSpread.`);

            await order.save();

            const reasonToClose = 'Cancelling order1 (maker) because order2 (maker) was not placed while doing executeInSpread mm-trade';
            await orderCollector.clearOrderById(
                order, order.pair, makerOrderType, this.readableModuleName, reasonToClose, undefined, traderapi);
          }
        } else { // if order1
          log.warn(`Market-making: Unable to execute maker mm-order with params: ${orderParamsString}. Action: executeInSpread. No order id returned.`);
        }

      } else if (priceReq.mmCurrentAction === 'executeInOrderBook') {

        // First and last, (taker) we place type-order using second account (in case of 2-keys trading)

        order1 = await takerApi.placeOrder(type, config.pair, price, coin1Amount, 1, null);

        if (order1?.orderId) {
          const { ordersDb } = db;

          const order = new ordersDb({
            _id: order1.orderId,
            crossOrderId: null,
            date: utils.unixTimeStampMs(),
            purpose: 'mm', // Market making
            mmOrderAction: priceReq.mmCurrentAction, // executeInSpread or executeInOrderBook
            type,
            // targetType: type,
            exchange: config.exchange,
            pair: config.pair,
            coin1: config.coin1,
            coin2: config.coin2,
            price,
            coin1Amount,
            coin2Amount,
            coin1AmountFilled: undefined,
            coin2AmountFilled: undefined,
            coin1AmountLeft: coin1Amount,
            coin2AmountLeft: coin2Amount,
            LimitOrMarket: 1, // 1 for limit price. 0 for Market price.
            isProcessed: true,
            isExecuted: undefined,
            isCancelled: false,
            isSecondAccountOrder: false,
          });

          output = `${type} ${coin1Amount.toFixed(coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(coin2Decimals)} ${config.coin2} at ${price.toFixed(coin2Decimals)} ${config.coin2}`;
          log.info(`Market-making: Successfully executed mm-order to ${output}. Action: executeInOrderBook.`);

          lastOrderType = type;

          // Make a pause to ensure the exchange's matching engine processed the order
          // Note: If order is not filled, is stays opened during this pause (before it cancelled below)
          // Theoretically it allows third-party bots matching the order

          const pauseMs = traderapi.features().apiProcessingDelayMs ?? constants.DEFAULT_API_PROCESSING_DELAY_MS;
          await utils.pauseAsync(pauseMs, `Market-making: ${pauseMs} msec pause to ensure the ${config.exchangeName}'s matching engine processed the order…`);

          // Check the mm-order status to understand if it's filled or not

          order1Details = await traderapi.getOrderDetails?.call(this, order1.orderId, order.pair);

          if (!order1Details?.status) {
            if (!traderapi.getOrderDetails) {
              log.log(`Market-making: Getting order details are not implemented for ${config.exchangeName} exchange. Assuming the taker executeInOrderBook mm-order is filled.`);
            } else {
              log.log('Market-making: Unable to get the executeInOrderBook taker mm-order details. Assuming it is filled.');
            }

            order.update({
              coin1AmountFilled: undefined,
              coin2AmountFilled: undefined,
              isExecuted: true, // We _assume_ the order if fully filled
            });
          } else if (order1Details?.status === 'filled') {
            log.info('Market-making: The taker executeInOrderBook mm-order is filled.');

            order.update({
              coin1AmountFilled: coin1Amount,
              coin2AmountFilled: coin2Amount,
              isExecuted: true,
            });
          } else if (['new', 'part_filled'].includes(order1Details?.status)) {
            const fillPercent = order1Details.amountExecuted / coin1Amount;
            log.warn(`Market-making: The taker executeInOrderBook mm-order status is ${order2Details?.status} (${fillPercent}% filled). It may be the third-party bot intervention.`);

            order.update({
              coin1AmountFilled: order1Details.amountExecuted,
              coin2AmountFilled: order1Details.volumeExecuted,
              isExecuted: false, // Not fully executed
            });
          } else {
            log.warn(`Market-making: Unexpected scenario while placing the taker executeInOrderBook mm-order. Its status is ${order1Details?.status}.`);

            order.update({
              coin1AmountFilled: undefined,
              coin2AmountFilled: undefined,
              isExecuted: false, // Not fully executed
            });
          }

          await order.save();

          // Cancelling mm-order, if it's not filled

          if ([undefined, 'unknown', 'new', 'part_filled'].includes(order1Details?.status)) {
            const reasonToClose = `Cancelling order1 (taker) order with status '${order1Details?.status}' while doing executeInOrderBook mm-trade`;
            await orderCollector.clearOrderById(
                order, order.pair, order.type, this.readableModuleName, reasonToClose, undefined, takerApi);
          }
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
 * Order type depends on:
 * - If mm_isFundBalancerActive in case of two-keys trading. It helps to maintain both accounts with quote-coin.
 * - If mm_Policy is orderbook. Run buy- or sell- orders in series.
 * - Consider mm_buyPercent
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
        coin2Balance = takerCoin2Balance;
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
    log.warn('Market-making: Unable to process balances for placing mm-order: ' + e);
    return {
      result: false,
    };
  }
}

/**
 * Calculates mm-order price
 * It considers:
 * - mm_Policy (optimal, spread | wash, orderbook)
 * - Price watcher range, and prohibits to trade if out of range
 * - Calculates bid_low and ask_high and spread
 * - Choose mmCurrentAction: 'executeInSpread', 'executeInOrderBook' or 'doNotExecute' depending on spread and mm_Policy
 * - To draw nice smooth chart, it receives traderapi.getTradesHistory() and calculates smooth price change interval
 * - If mm_Policy === 'optimal' && executeInOrderBookAllowed === true,
 *   then it chooses to trade in spread or in orderbook depending on mm_isLiquidityActive and spread size
 * - When trading in order book, order amount can be limited
 * @param {String} type 'buy' or 'sell'
 * @param {Number} coin1Amount Amount to trade. This function can update it.
 * @returns {Object<Number, Number, String>}
 *  price: price to trade
 *  coin1Amount: updated amount to trade in case of 'executeInOrderBook'
 *  mmCurrentAction: 'executeInSpread', 'executeInOrderBook' or 'doNotExecute'
 *  In case of 'executeInOrderBook' additionally: startPrice, expectedPrice, newSpread, newSpreadNumber, newSpreadPercent
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

    let mmPolicy = tradeParams.mm_Policy; // optimal, spread | wash, orderbook
    if (mmPolicy === 'wash') {
      mmPolicy = 'spread';
    }

    let mmCurrentAction; // doNotExecute, executeInSpread, executeInOrderBook

    let lowHighString = `Low: ${bid_low.toFixed(coin2Decimals)}, high: ${ask_high.toFixed(coin2Decimals)} ${config.coin2}`;
    const checkObString = 'Check the order book and the Price watcher parameters.';

    let isSpreadCorrectedByPriceWatcher = false;
    let skipNotify = false;

    /**
     * Check if Price Watcher allows to trade, and set bid_low–ask_high
     */
    const pw = require('./mm_price_watcher');

    if (pw.getIsPriceWatcherEnabled()) {
      const orderInfo = 'mm-order';

      if (pw.getIsPriceAnomaly()) {
        output = `Refusing to place ${orderInfo}. Price watcher reported a price anomaly.`;
        skipNotify = true;

        mmCurrentAction = 'doNotExecute';
      } else if (pw.getIsPriceActual()) {
        const pwLowPrice = pw.getLowPrice();
        const pwHighPrice = pw.getHighPrice();

        if (type === 'buy') {
          if (bid_low > pwHighPrice) {
            output = `Refusing to buy higher than ${pwHighPrice.toFixed(coin2Decimals)}. Mm-order cancelled. ${lowHighString}. ${pw.getPwRangeString()} ${checkObString}`;
            skipNotify = true;

            mmCurrentAction = 'doNotExecute';
          } else if (ask_high > pwHighPrice) {
            output = `Price watcher corrected spread to buy not higher than ${pwHighPrice.toFixed(coin2Decimals)} while placing mm-order.`;

            if (mmPolicy === 'orderbook') {
              output += ` Market making settings deny trading in spread. Unable to set a price for ${config.pair}. Mm-order cancelled. ${lowHighString}. ${pw.getPwRangeString()} ${checkObString}`;
              skipNotify = true;

              mmCurrentAction = 'doNotExecute';
            } else {
              output += ` Will trade in spread. ${lowHighString}. ${pw.getPwRangeString()} ${checkObString}`;
              log.log(`Market-making: ${output}`);
              output = '';

              isSpreadCorrectedByPriceWatcher = true;
              mmPolicy = 'spread';
            }

            ask_high = pwHighPrice;
          }
        } else if (type === 'sell') {
          if (ask_high < pwLowPrice) {
            output = `Refusing to sell lower than ${pwLowPrice.toFixed(coin2Decimals)}. Mm-order cancelled. ${lowHighString}. ${pw.getPwRangeString()} ${checkObString}`;
            skipNotify = true;

            mmCurrentAction = 'doNotExecute';
          } else if (bid_low < pwLowPrice) {
            output = `Price watcher corrected spread to sell not lower than ${pwLowPrice.toFixed(coin2Decimals)} while placing mm-order.`;

            if (mmPolicy === 'orderbook') {
              output += ` Market making settings deny trading in spread. Unable to set a price for ${config.pair}. Mm-order cancelled. ${lowHighString}. ${pw.getPwRangeString()} ${checkObString}`;
              skipNotify = true;

              mmCurrentAction = 'doNotExecute';
            } else {
              output += ` Will trade in spread. ${lowHighString}. ${pw.getPwRangeString()} ${checkObString}`;
              log.log(`Market-making: ${output}`);
              output = '';

              isSpreadCorrectedByPriceWatcher = true;
              mmPolicy = 'spread';
            }

            bid_low = pwLowPrice;
          }
        }
      } else {
        if (pw.getIgnorePriceNotActual()) {
          log.log(`Market-making: While placing ${orderInfo}, the Price watcher reported the price range is not actual. According to settings, ignore and treat this like the Pw is disabled.`);
        } else {
          output = `Refusing to place ${orderInfo}. Price watcher reported the price range is not actual.`;
          skipNotify = true;

          mmCurrentAction = 'doNotExecute';
        }
      }
    }

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
    lowHighString = `Low: ${bid_low.toFixed(coin2Decimals)}, high: ${ask_high.toFixed(coin2Decimals)} ${config.coin2}`;

    if (mmCurrentAction === 'doNotExecute') {
      if (!output) {
        if (isSpreadCorrectedByPriceWatcher) {
          output = `Refusing to place mm-order because of price watcher. Corrected spread is too small. ${lowHighString}. ${pw.getPwRangeString()} ${checkObString}`;
          skipNotify = true;
        } else {
          output = `No spread currently, and market making settings deny trading in the order book. ${lowHighString}. Unable to set a price for ${config.pair}. Update settings or create spread manually.`;
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
      // Though we expect bid_low and ask_high to be not changed,
      // Restore them according to order book
      bid_low = orderBookInfo.highestBid;
      ask_high = orderBookInfo.lowestAsk;

      const startPrice = type === 'sell' ? bid_low : ask_high;

      // First, limit coin1Amount by liquidity (if mm_isLiquidityActive) or first order book order
      let amountInSpread; let amountInConfig; let amountMaxAllowed; let firstOrderAmount; let isAmountLimited = false;

      const allowedAmountKoef = tradeParams.mm_isLiquidityActive ?
        utils.randomValue(EXECUTE_IN_ORDER_BOOK_PERCENT_WITH_LIQ_ENABLED_MIN, EXECUTE_IN_ORDER_BOOK_PERCENT_WITH_LIQ_ENABLED_MAX) :
        utils.randomValue(EXECUTE_IN_ORDER_BOOK_PERCENT_WO_LIQ_ENABLED_MIN, EXECUTE_IN_ORDER_BOOK_PERCENT_WO_LIQ_ENABLED_MAX);

      const liqLimits = require('./mm_liquidity_provider').getLiqLimits();
      if (type === 'sell') {
        amountInSpread = orderBookInfo.liquidity.percentCustom.amountBids;
        amountInConfig = liqLimits.bidLimit / bid_low;
        firstOrderAmount = orderBook.bids[0].amount * allowedAmountKoef;
      } else {
        amountInSpread = orderBookInfo.liquidity.percentCustom.amountAsks;
        amountInConfig = liqLimits.askLimit;
        firstOrderAmount = orderBook.asks[0].amount * allowedAmountKoef;
      }

      amountMaxAllowed = amountInSpread > amountInConfig ? amountInConfig : amountInSpread;
      amountMaxAllowed *= allowedAmountKoef;

      let amountLimit; let limitedByString;
      if (utils.isPositiveNumber(amountMaxAllowed) && tradeParams.mm_isLiquidityActive) {
        amountLimit = amountMaxAllowed;
        limitedByString = 'Liquidity volume';
      } else {
        amountLimit = firstOrderAmount;
        limitedByString = 'First order amount';
      }

      const coin1AmountOriginal = coin1Amount;
      if (coin1Amount > amountLimit) {
        isAmountLimited = true;
        coin1Amount = amountLimit;
      }

      let executeInOrderBookString = `Market-making: Calculating coin1Amount (${mmPolicy} trading policy) to ${type === 'buy' ? 'buy from' : 'sell in'} order book.`;
      if (isAmountLimited) {
        executeInOrderBookString += ` Order amount is reduced from ${coin1AmountOriginal.toFixed(coin1Decimals)} to ${coin1Amount.toFixed(coin1Decimals)} ${config.coin1} to fit ${limitedByString}.`;
      } else {
        executeInOrderBookString += ` Order amount ${coin1AmountOriginal.toFixed(coin1Decimals)} ${config.coin1} is not reduced.`;
      }
      log.log(executeInOrderBookString);

      // Next and last, calculate price, so that not to change highestBid–lowestAsk more than maxPriceDeviation ~0.15%
      const maxPriceDeviation = utils.randomValue(0, constants.EXECUTE_IN_ORDER_BOOK_MAX_PRICE_CHANGE_PERCENT);
      price = type === 'sell' ? price = startPrice * (1 - maxPriceDeviation / 100) : startPrice * (1 + maxPriceDeviation / 100);

      orderBookInfo = utils.getOrderBookInfo(orderBook, maxPriceDeviation, price, coin1Amount);

      let isPriceMoved = false; let isOrderFilled = true; let priceChangePercent = 0;

      const placedAmountCount = type === 'sell' ? orderBookInfo.placedAmountCountBid : orderBookInfo.placedAmountCountAsk;
      let finalPrice = type === 'sell' ? orderBookInfo.placedAmountPriceBid : orderBookInfo.placedAmountPriceAsk;

      if (placedAmountCount > 0) {
        isPriceMoved = true;
        isOrderFilled = type === 'sell' ? finalPrice >= price : finalPrice <= price;
        if (!isOrderFilled) finalPrice = price;
        priceChangePercent = utils.numbersDifferencePercent(startPrice, finalPrice);
      }

      const newSpread = type === 'sell' ? ask_high - finalPrice : finalPrice - bid_low;
      const newSpreadNumber = Math.round(newSpread / precision);
      const newSpreadPercent = newSpread / finalPrice * 100;

      executeInOrderBookString = `Market-making: Calculating price (${mmPolicy} trading policy) to ${type === 'buy' ? 'buy from' : 'sell in'} order book.`;
      executeInOrderBookString += ` Trying to ${type} ${coin1Amount.toFixed(coin1Decimals)} ${config.coin1} at ${price.toFixed(coin2Decimals)} ${config.coin2}.`;
      if (isPriceMoved) {
        executeInOrderBookString += ` It will move ob-price from ${startPrice.toFixed(coin2Decimals)} to ${finalPrice.toFixed(coin2Decimals)} ${config.coin2} (${priceChangePercent.toFixed(4)}% change),`;
        if (isOrderFilled) {
          executeInOrderBookString += ' the order will be fully filled.';
        } else {
          executeInOrderBookString += ' the order will match all ob-orders and stay in the order book.';
        }
      } else {
        executeInOrderBookString += ` It will not change ob-price ${startPrice.toFixed(coin2Decimals)} ${config.coin2}, the order will be fully filled.`;
      }
      log.log(executeInOrderBookString);

      return {
        startPrice, // bid_low when sell and ask_high when buy
        price, // price to place order with
        expectedPrice: finalPrice, // set only in case of 'orderbook' policy
        coin1Amount, // can be updated (lowered)
        mmCurrentAction, // 'executeInOrderBook'
        newSpread, // set only in case of 'orderbook' policy
        newSpreadNumber, // set only in case of 'orderbook' policy
        newSpreadPercent, // set only in case of 'orderbook' policy
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
