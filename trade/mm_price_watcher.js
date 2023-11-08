/**
 * Watch a coin price in a constant range or using other source
 * If a price is out of this range, buys or sells coins to fit this range (exception: 'depth' mm_Policy)
 * Provides pw range for other modules
 */

const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const exchangerUtils = require('../helpers/cryptos/exchanger');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./settings/tradeParams_' + config.exchange);
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');
const orderCollector = require('./orderCollector');
const orderUtils = require('./orderUtils');

const priceWatcherApi = traderapi;

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

const INTERVAL_MIN = 10000;
const INTERVAL_MAX = 30000;
const INTERVAL_MIN_SAME_EXCHANGE = 3000;
const INTERVAL_MAX_SAME_EXCHANGE = 7000; // If we trade on the same exchange, let pw work more often to prevent arbitraging

const LIFETIME_MIN = 2 * constants.MINUTE;
const LIFETIME_MAX = 10 * constants.MINUTE; // Don't set Lifetime too long—not to freeze funds, orders can be big

const priceChangeWarningPercent = 20;
const priceChangeNotifyPercent = 1;

let isPreviousIterationFinished = true;

let lowPrice; let highPrice;
let isPriceActual = false;
let setPriceRangeCount = 0;
let pwExchange; let pwExchangeCoin1; let pwExchangeCoin2; let pwExchangeApi;

log.log(`Module ${utils.getModuleName(module.id)} is loaded.`);

module.exports = {
  readableModuleName: 'Price watcher',

  /**
   * Save Pw parameters to restore them later
   * Used to restore Pw after Pm finished its job with 'depth' mm_Policy
   * @param {String} reason Who saves parameters
   * @returns {Void}
   */
  savePw(reason) {
    tradeParams.saved_mm_isPriceWatcherActive = tradeParams.mm_isPriceWatcherActive;
    tradeParams.saved_mm_priceWatcherLowPriceInSourceCoin = tradeParams.mm_priceWatcherLowPriceInSourceCoin;
    tradeParams.saved_mm_priceWatcherMidPriceInSourceCoin = tradeParams.mm_priceWatcherMidPriceInSourceCoin;
    tradeParams.saved_mm_priceWatcherHighPriceInSourceCoin = tradeParams.mm_priceWatcherHighPriceInSourceCoin;
    tradeParams.saved_mm_priceWatcherDeviationPercent = tradeParams.mm_priceWatcherDeviationPercent;
    tradeParams.saved_mm_priceWatcherSource = tradeParams.mm_priceWatcherSource;
    tradeParams.saved_mm_priceWatcherSourcePolicy = tradeParams.mm_priceWatcherSourcePolicy;
    tradeParams.saved_mm_priceWatcher_timestamp = Date.now();
    tradeParams.saved_mm_priceWatcher_callerName = reason;
    utils.saveConfig(false, 'PriceWatcher-savePw()');
    log.log(`Price watcher: Parameters saved. Reason: ${reason}. Mm policy is ${tradeParams.mm_Policy}.`);
  },

  /**
   * Restore Pw parameters using last saved values
   * Used to restore Pw after Pm finished its job with 'depth' mm_Policy
   * @param {String} reason Who restores parameters
   * @returns {Boolean} If parameters restored
   */
  restorePw(reason) {
    if (tradeParams.saved_mm_priceWatcher_timestamp) {
      tradeParams.mm_isPriceWatcherActive = tradeParams.saved_mm_isPriceWatcherActive;
      tradeParams.mm_priceWatcherLowPriceInSourceCoin = tradeParams.saved_mm_priceWatcherLowPriceInSourceCoin;
      tradeParams.mm_priceWatcherMidPriceInSourceCoin = tradeParams.saved_mm_priceWatcherMidPriceInSourceCoin;
      tradeParams.mm_priceWatcherHighPriceInSourceCoin = tradeParams.saved_mm_priceWatcherHighPriceInSourceCoin;
      tradeParams.mm_priceWatcherDeviationPercent = tradeParams.saved_mm_priceWatcherDeviationPercent;
      tradeParams.mm_priceWatcherSource = tradeParams.saved_mm_priceWatcherSource;
      tradeParams.mm_priceWatcherSourcePolicy = tradeParams.saved_mm_priceWatcherSourcePolicy;
      tradeParams.restore_mm_priceWatcher_timestamp = Date.now();
      tradeParams.restore_mm_priceWatcher_callerName = reason;
      utils.saveConfig(false, 'PriceWatcher-restorePw()');
      this.setIsPriceActual(false, reason);
      const whenSaved = Date(tradeParams.saved_mm_priceWatcher_timestamp);
      const timePassedMs = Date.now() - tradeParams.saved_mm_priceWatcher_timestamp;
      const timePassed = utils.timestampInDaysHoursMins(timePassedMs);
      let restoredString = `Price watcher: Restored parameters, saved by '${tradeParams.saved_mm_priceWatcher_callerName}'`;
      restoredString += ` at ${whenSaved} (${timePassed} ago).`;
      restoredString += ` Reason: ${reason}.`;
      log.log(restoredString);
      return true;
    } else {
      log.log(`Price watcher: Parameters were not saved earlier, and therefore were not restored. Called with a reason: ${reason}.`);
    }
  },

  /**
   * Returns lower bound of Price watcher's range
   * It's in coin2 independent of mm_priceWatcherSource
   * @returns {Number}
   */
  getLowPrice() {
    return lowPrice;
  },

  /**
   * Returns upper bound of Price watcher's range
   * It's in coin2 independent of mm_priceWatcherSource
   * @returns {Number}
   */
  getHighPrice() {
    return highPrice;
  },

  /**
   * Returns if Pw/Sp is active
   * Note: also check if Market-making is active and isPriceActual
   * @returns {Boolean}
   */
  getIsPriceWatcherEnabled() {
    return tradeParams.mm_isPriceWatcherActive || tradeParams.mm_priceSupportLowPrice;
  },

  /**
   * Returns if price range is set and Pw/Sp is active
   * Note: also check if Market-making is active
   * @returns {Boolean}
   */
  getIsPriceActualAndEnabled() {
    return isPriceActual && this.getIsPriceWatcherEnabled();
  },

  /**
   * Returns if price range is set
   * Note: also check if Pw/Sp/Mm is active
   * @returns {Boolean}
   */
  getIsPriceActual() {
    return isPriceActual;
  },

  getIsPriceRangeSetWithSupportPrice() {
    return false;
  },

  /**
   * Returns Pw's parameters for other modules
   * Sample: `Price watcher is set ${pw.getPwInfoString()}.`
   * Not ending with a dot
   * @returns {String} Log string
   */
  getPwInfoString() {
    if (!tradeParams.mm_isPriceWatcherActive) {
      return 'disabled';
    }

    const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;
    let pwInfoString;
    let sourceString;
    let marketDecimals;

    if (tradeParams.mm_priceWatcherSource?.indexOf('@') > -1) {
      pwInfoString = `based on _${tradeParams.mm_priceWatcherSource}_ with _${tradeParams.mm_priceWatcherSourcePolicy}_ policy and _${tradeParams.mm_priceWatcherDeviationPercent.toFixed(2)}%_ deviation`;
    } else {
      if (tradeParams.mm_priceWatcherSource === config.coin2) {
        sourceString = `${tradeParams.mm_priceWatcherSource}`;
        marketDecimals = coin2Decimals;
      } else {
        sourceString = `${tradeParams.mm_priceWatcherSource} (global rate)`;
        marketDecimals = 8;
      }
      pwInfoString = `from ${tradeParams.mm_priceWatcherLowPriceInSourceCoin.toFixed(marketDecimals)} to ${tradeParams.mm_priceWatcherHighPriceInSourceCoin.toFixed(marketDecimals)} ${sourceString}—${tradeParams.mm_priceWatcherDeviationPercent.toFixed(2)}% price deviation`;
    }

    return pwInfoString;
  },

  /**
   * Returns log string for other modules
   * Ending with a dot
   * @returns {String} Log string
   */
  getPwRangeString() {
    const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;
    const upperBound = highPrice === Number.MAX_VALUE ? 'Infinity' : `${highPrice.toFixed(coin2Decimals)}`;
    return `Pw's range ${lowPrice.toFixed(coin2Decimals)}–${upperBound} ${config.coin2}.${this.getSetWithSupportPriceString()}`;
  },

  /**
   * Returns log string if price range is set with support price
   * @returns {String} Log string
   */
  getSetWithSupportPriceString() {
    return '';
  },

  /**
   * Sets isPriceActual by other modules. This module sets isPriceActual directly
   * Goal to force price range update
   * @param {Boolean} value If price is actual
   * @param {String} callerName Caller for logging
   */
  setIsPriceActual(value, callerName) {
    let logString = `Price watcher: Manually set isPriceActual to ${value} by ${callerName}.`;
    if (!value) {
      logString += ' This will force the bot to wait until pw range updated.';
    }
    log.log(logString);
    isPriceActual = value;
  },

  /**
   * Sets Price watcher exchange traderapi and stores it as pwExchangeApi (and exchange name as pwExchange)
   * It can be same traderapi as set in config, or it will create one with no keys (only public endpoints)
   * @param {String} exchange Exchange name, as 'Bittrex'
   * @param {String} coin1 Socket connection subscribes to a specific pair
   * @param {String} coin2
   */
  setPwExchangeApi(exchange, coin1, coin2) {
    if (
      exchange.toLowerCase() === config.exchange &&
      pwExchange !== exchange
    ) {
      // Same exchange; Don't use socket connection for a trading pair we are watching
      pwExchangeApi = traderapi;

      log.info(`Price watcher: Switched to internal ${exchange} exchange API.`);
    } else if (
      exchange.toLowerCase() !== config.exchange &&
      (pwExchange !== exchange || pwExchangeCoin1 !== coin1 || pwExchangeCoin2 !== coin2)
    ) {
      pwExchangeApi = require('./trader_' + exchange.toLowerCase())(
          null, // API credentials
          null,
          null,
          log, // Same logger
          true, // publicOnly, no private endpoints
          undefined, // loadMarket, usually true by default
          config.exchange_socket, // Use socket
          config.exchange_socket_pull,
          undefined, // Use accountNo by default
          coin1, // Socket connects to a single specific pair
          coin2,
      );

      let socketInfo;
      if (config.exchange_socket) {
        if (pwExchangeApi.features().socketSupport) {
          socketInfo = `Socket uses the ${coin1}/${coin2} trading pair.`;
        } else {
          socketInfo = 'The exchange does not support socket connections.';
        }
      } else {
        socketInfo = 'The socket connections are disabled in the config, using REST.';
      }

      log.info(`Price watcher: Switched to external ${exchange} exchange API. ${socketInfo}`);
    }

    pwExchange = exchange;
    pwExchangeCoin1 = coin1;
    pwExchangeCoin2 = coin2;
  },

  /**
   * Checks if the Price watcher is set to the same exchange
   * If we trade on Gateio, will be true for ADM/BTC@Gateio, ADM/ETH@Gateio, etc.
   * @return {Boolean}
   */
  getIsSameExchangePw() {
    return (tradeParams.mm_priceWatcherSource?.indexOf('@') > -1) && (pwExchange?.toLowerCase() === config.exchange);
  },

  run() {
    this.iteration();
  },

  async iteration() {
    const interval = setPause();
    if (
      interval &&
      tradeParams.mm_isActive &&
      this.getIsPriceWatcherEnabled() // Checks also if MM_POLICIES_REGULAR policies
    ) {
      if (isPreviousIterationFinished) {
        isPreviousIterationFinished = false;
        await this.reviewPrices();
        isPreviousIterationFinished = true;
      } else {
        log.log(`Price watcher: Postponing iteration of the price watcher for ${interval} ms. Previous iteration is in progress yet.`);
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
   * The main Price Watcher function, which in each iteration:
   * - Updates current pw-orders
   * - Set a price range
   * - Retrieves current order book an coin price
   * - If the coin price is out of the price range, buys or sells coins to fit this range (action depends on mm_Policy)
   */
  async reviewPrices() {
    try {
      const { ordersDb } = db;
      let pwOrders = await ordersDb.find({
        isProcessed: false,
        purpose: 'pw', // pw: price watcher order
        pair: config.pair,
        exchange: config.exchange,
      });

      pwOrders = await orderUtils.updateOrders(pwOrders, config.pair, utils.getModuleName(module.id) + ':pw-', false); // update orders which partially filled or not found
      pwOrders = await this.closePriceWatcherOrders(pwOrders); // close orders which expired

      await setPriceRange();

      if (isPriceActual) {
        const orderBook = await traderapi.getOrderBook(config.pair);
        if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
          log.warn(`Price watcher: Order books are empty for ${config.pair}, or temporary API error. Unable to check if I need to place pw-order.`);
          return;
        }

        const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

        let bidOrAsk; let targetPrice; let currentPrice; let orderType;

        const askPrice = orderBook.asks[0].price;
        const bidPrice = orderBook.bids[0].price;
        const midPrice = (askPrice + bidPrice) / 2;

        if (askPrice < lowPrice) {
          bidOrAsk = 'ask';
          orderType = 'buy';
          currentPrice = askPrice;
          targetPrice = lowPrice;
        } else if (bidPrice > highPrice) {
          bidOrAsk = 'bid';
          orderType = 'sell';
          currentPrice = bidPrice;
          targetPrice = highPrice;
        }

        if (targetPrice) {
          const targetPriceString = `Price watcher: Target price is ${targetPrice.toFixed(coin2Decimals)} ${config.coin2} (from ${bidOrAsk} ${currentPrice.toFixed(coin2Decimals)}).`;
          const orderBookInfo = utils.getOrderBookInfo(orderBook, tradeParams.mm_liquiditySpreadPercent, targetPrice);
          let placingInSpreadNote = '';
          if (orderBookInfo.typeTargetPrice === 'inSpread') {
            // If we've cancelled bot's orders, there may be no orders up to targetPrice
            orderBookInfo.typeTargetPrice = orderType;
            orderBookInfo.amountTargetPrice = utils.randomValue(tradeParams.mm_minAmount, tradeParams.mm_maxAmount);
            orderBookInfo.amountTargetPriceQuote = orderBookInfo.amountTargetPrice * targetPrice;
            placingInSpreadNote = '(After cancelling bot\'s orders, no orders to match; Placing order in spread) ';
          } else {
            const reliabilityKoef = utils.randomValue(1.05, 1.1);
            orderBookInfo.amountTargetPrice *= reliabilityKoef;
            orderBookInfo.amountTargetPriceQuote *= reliabilityKoef;
          }

          const onWhichAccount = '';
          const priceString = `${config.pair} price of ${targetPrice.toFixed(coin2Decimals)} ${config.coin2}`;
          const actionString = `${orderBookInfo.typeTargetPrice} ${orderBookInfo.amountTargetPrice.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${config.coin1} ${orderBookInfo.typeTargetPrice === 'buy' ? 'with' : 'for'} ${orderBookInfo.amountTargetPriceQuote.toFixed(coin2Decimals)} ${config.coin2}${onWhichAccount}`;
          const logMessage = `${placingInSpreadNote}To make ${priceString}, the bot is going to ${actionString}.`;
          log.info(`${targetPriceString} ${logMessage} ${this.getPwRangeString()}`);

          const placedOrder = await this.placePriceWatcherOrder(targetPrice, orderBookInfo, currentPrice);
        } else {
          let logString = `Price watcher: Current ${config.coin1} price is within Pw's range, bid ${bidPrice.toFixed(coin2Decimals)} ${config.coin2} < upper bound ${highPrice.toFixed(coin2Decimals)} and `;
          logString += `ask ${askPrice.toFixed(coin2Decimals)} ${config.coin2} > lower bound ${lowPrice.toFixed(coin2Decimals)}, no action needed. `;
          logString += `Current mid price is ${midPrice.toFixed(coin2Decimals)} ${config.coin2} (${bidPrice.toFixed(coin2Decimals)}–${askPrice.toFixed(coin2Decimals)}) ${config.coin2}. `;
          logString += `${this.getPwRangeString()}`;

          log.info(logString);
        }
      }
    } catch (e) {
      log.error(`Error in reviewPrices() of ${utils.getModuleName(module.id)} module: ` + e);
    }
  },

  /**
   * Closes Price watcher orders, if any
   * @param {Array<Object>} fsOrders Price watcher orders from the DB
   * @returns {Array<Object>} updatedPwOrders
   */
  async closePriceWatcherOrders(pwOrders) {
    const updatedPwOrders = [];

    for (const order of pwOrders) {
      try {
        let reasonToClose = ''; const reasonObject = {};
        if (order.dateTill < utils.unixTimeStampMs()) {
          reasonToClose = 'It\'s expired.';
          reasonObject.isExpired = true;
        }

        if (reasonToClose) {
          const cancellation = await orderCollector.clearOrderById(
              order, order.pair, order.type, this.readableModuleName, reasonToClose, reasonObject, priceWatcherApi);

          if (!cancellation.isCancelRequestProcessed) {
            updatedPwOrders.push(order);
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

  /**
   * Places a new Price watcher order (pw type)
   * Checks for balances. If not enough balances,
   *   Notify/log, and return false/undefined
   * It uses second keypair, if set. Then make sure to close placed order to eliminate possible SELF_TRADE.
   * @param {Number} targetPrice New token price to be set
   * @param {Object} orderBookInfo Order book snapshot with additional calculated info
   * @return {Boolean} True in case of successfully placed pw-order
   */
  async placePriceWatcherOrder(targetPrice, orderBookInfo, currentPrice) {
    try {
      const coin1Decimals = orderUtils.parseMarket(config.pair).coin1Decimals;
      const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

      const whichAccount = '';
      const type = orderBookInfo.typeTargetPrice;
      const price = targetPrice;
      const coin1Amount = orderBookInfo.amountTargetPrice;
      const coin2Amount = orderBookInfo.amountTargetPriceQuote;
      const lifeTime = setLifeTime();

      let output = '';
      let orderParamsString = '';

      orderParamsString = `type=${type}, pair=${config.pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      if (!type || !price || !coin1Amount || !coin2Amount) {
        log.warn(`Price watcher: Unable to run pw-order${whichAccount} with params: ${orderParamsString}.`);
        return;
      }

      // Check balances first time
      const balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount, type, false);
      if (!balances.result) {
        if (balances.message) {
          if (Date.now()-lastNotifyBalancesTimestamp > constants.HOUR) {
            notify(`${config.notifyName}: ${balances.message}`, 'warn', config.silent_mode);
            lastNotifyBalancesTimestamp = Date.now();
          } else {
            log.log(`Price watcher: ${balances.message}`);
          }
        }
        return;
      }

      const orderReq = await priceWatcherApi.placeOrder(type, config.pair, price, coin1Amount, 1, null);
      if (orderReq && orderReq.orderId) {
        const { ordersDb } = db;
        const order = new ordersDb({
          _id: orderReq.orderId,
          date: utils.unixTimeStampMs(),
          dateTill: utils.unixTimeStampMs() + lifeTime,
          purpose: 'pw', // pw: price watcher order
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
          isExecuted: true,
          isCancelled: false,
          isClosed: false,
          isSecondAccountOrder: undefined,
        }, true);

        output = `${type} ${coin1Amount.toFixed(coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(coin2Decimals)} ${config.coin2} at ${price.toFixed(coin2Decimals)} ${config.coin2}`;
        log.info(`Price watcher: Successfully placed pw-order${whichAccount} to ${output}.`);

        return true;
      } else {
        log.warn(`Price watcher: Unable to execute pw-order${whichAccount} with params: ${orderParamsString}. No order id returned.`);
        return false;
      }
    } catch (e) {
      log.error(`Error in placePriceWatcherOrder() of ${utils.getModuleName(module.id)} module: ` + e);
    }
  },
};

/**
 * Checks if enough funds to place pw-order
 * It uses second account, if set in config
 * @param {String} coin1 = config.coin1 (base)
 * @param {String} coin2 = config.coin2 (quote)
 * @param {Number} amount1 Amount in coin1 (base)
 * @param {Number} amount2 Amount in coin2 (quote)
 * @param {String} type 'buy' or 'sell'
 * @returns {Object<Boolean, String>}
 *  result: if enough funds to place order
 *  message: error message
 */
async function isEnoughCoins(coin1, coin2, amount1, amount2, type, noCache = false) {
  const onWhichAccount = '';
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
        output = `Not enough balance${onWhichAccount} to place ${amount1.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1} ${type} pw-order. Free: ${balance1free.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}, frozen: ${balance1freezed.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${coin1}.`;
        isBalanceEnough = false;
      }
      if ((!balance2free || balance2free < amount2) && type === 'buy') {
        output = `Not enough balance${onWhichAccount} to place ${amount2.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2} ${type} pw-order. Free: ${balance2free.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}, frozen: ${balance2freezed.toFixed(orderUtils.parseMarket(config.pair).coin2Decimals)} ${coin2}.`;
        isBalanceEnough = false;
      }

      return {
        result: isBalanceEnough,
        message: output,
      };
    } catch (e) {
      log.warn('Price watcher: Unable to process balances for placing pw-order: ' + e);
      return {
        result: false,
      };
    }
  } else {
    log.warn(`Price watcher: Unable to get balances${onWhichAccount} for placing pw-order.`);
    return {
      result: false,
    };
  }
}

async function setPriceRange() {
  try {
    const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

    const previousLowPrice = lowPrice;
    const previousHighPrice = highPrice;

    setPriceRangeCount += 1;
    let l; let h;

    if (tradeParams.mm_priceWatcherSource?.indexOf('@') > -1) {
      // Price range is set targeted to other pair like ADM/USDT@Bittrex

      const pair = tradeParams.mm_priceWatcherSource.split('@')[0];
      const exchange = tradeParams.mm_priceWatcherSource.split('@')[1];

      const pairObj = orderUtils.parseMarket(pair, exchange, true);
      if (pairObj.marketInfoSupported && !pairObj.isParsed) {
        errorSettingPriceRange(`Unable to get market info for ${pair} pair at ${exchange} exchange. It may be a temporary API error.`);
        return false;
      }

      module.exports.setPwExchangeApi(exchange, pairObj.coin1, pairObj.coin2);

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

      lowPrice = l * utils.randomValue(1 - tradeParams.mm_priceWatcherDeviationPercent/100, 1) * utils.randomValue(1, 1.005);
      highPrice = h * utils.randomValue(1, 1 + tradeParams.mm_priceWatcherDeviationPercent/100) * utils.randomValue(0.995, 1);
      if (lowPrice >= highPrice) {
        lowPrice = l;
        highPrice = h;
      }
      isPriceActual = true;
      setPriceRangeCount = 0;

    } else {
      // Price range is set in some coin using global rates

      const crossMarketGlobalRate = exchangerUtils.getRate(tradeParams.mm_priceWatcherSource, config.coin2);
      log.log(`Price watcher: Global exchange rate for ${tradeParams.mm_priceWatcherSource}/${config.coin2} conversion: ${crossMarketGlobalRate.toFixed(coin2Decimals)}.`);

      l = exchangerUtils.convertCryptos(tradeParams.mm_priceWatcherSource, config.coin2,
          tradeParams.mm_priceWatcherLowPriceInSourceCoin).outAmount;
      h = exchangerUtils.convertCryptos(tradeParams.mm_priceWatcherSource, config.coin2,
          tradeParams.mm_priceWatcherHighPriceInSourceCoin).outAmount;

      if (!l || l <= 0 || !h || h <= 0) {
        errorSettingPriceRange(`Wrong results of exchangerUtils.convertCryptos function: l=${l}, h=${h}.`);
        return false;
      } else {

        lowPrice = l * utils.randomValue(1, 1.005);
        highPrice = h * utils.randomValue(0.995, 1);
        if (lowPrice >= highPrice) {
          lowPrice = l;
          highPrice = h;
        }
        isPriceActual = true;
        setPriceRangeCount = 0;

      }
    }

    let highPriceString;
    if (highPrice === Number.MAX_VALUE) {
      highPriceString = 'Infinity';
    } else {
      highPriceString = highPrice.toFixed(coin2Decimals);
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
        changedByStringLow = '(no changes)';
      } else {
        changedByStringLow = `(${directionLow} by ${deltaLowPercent.toFixed(0)}%)`;
      }
      if (deltaHighPercent < priceChangeNotifyPercent) {
        changedByStringHigh = ' (no changes)';
      } else {
        changedByStringHigh = ` (${directionHigh} by ${deltaHighPercent.toFixed(0)}%)`;
      }

      const priceRangeString = `from ${lowPrice.toFixed(coin2Decimals)} ${changedByStringLow} to ${highPriceString}${changedByStringHigh} ${config.coin2}`;

      if (
        (deltaLowPercent > priceChangeWarningPercent || deltaHighPercent > priceChangeWarningPercent) &&
        highPrice !== Number.MAX_VALUE &&
        previousHighPrice !== Number.MAX_VALUE
      ) {
        notify(`${config.notifyName}: Price watcher's new price range changed much—new values are ${priceRangeString}.${module.exports.getSetWithSupportPriceString()}`, 'warn');
      } else {
        log.log(`Price watcher: Set a new price range ${priceRangeString}.${module.exports.getSetWithSupportPriceString()}`);
      }
    } else {
      log.log(`Price watcher: Set a price range from ${lowPrice.toFixed(coin2Decimals)} to ${highPriceString} ${config.coin2}.${module.exports.getSetWithSupportPriceString()}`);
    }

  } catch (e) {
    errorSettingPriceRange(`Error in setPriceRange() of ${utils.getModuleName(module.id)} module: ${e}.`);
    return false;
  }
}

/**
 * General function to log/notify about setting price range errors
 * It concatenates base error message with a specific error message
 * @param {String} errorMessage Specific error message
 */
function errorSettingPriceRange(errorMessage) {
  try {
    const baseNotifyMessage = `Unable to set the Price Watcher's price range ${setPriceRangeCount} times in series. I've temporary turned off watching the ${config.coin1} price.`;
    const baseMessage = `Price watcher: Unable to set the Price Watcher's price range ${setPriceRangeCount} times.`;

    if (setPriceRangeCount > 10) {
      isPriceActual = false;
      if (Date.now()-lastNotifyPriceTimestamp > constants.HOUR) {
        notify(`${config.notifyName}: ${baseNotifyMessage} ${errorMessage}`, 'warn');
        lastNotifyPriceTimestamp = Date.now();
      } else {
        log.log(`${baseMessage} ${errorMessage}`);
      }
    } else {
      if (isPriceActual) {
        log.log(`${baseMessage} ${errorMessage} I will continue watching ${config.coin1} price according to previous values.`);
      } else {
        log.log(`${baseMessage} ${errorMessage} No data to watch ${config.coin1} price. Price watching is temporary disabled.`);
      }
    }
  } catch (e) {
    log.error(`Error in errorSettingPriceRange() of ${utils.getModuleName(module.id)} module: ` + e);
  }
}

/**
 * Sets order life time in ms
 * When life time is expired, an order will be closed
 * @returns {Number}
*/
function setLifeTime() {
  return utils.randomValue(LIFETIME_MIN, LIFETIME_MAX, true);
}

/**
 * Set a random pause in ms for next Price watcher iteration
 * Pause depends on if Pw targets same exchange or not
 * @return {Number} Pause in ms
 */
function setPause() {
  let pause; let pairInfoString;

  if (module.exports.getIsSameExchangePw()) {
    pause = utils.randomValue(INTERVAL_MIN_SAME_EXCHANGE, INTERVAL_MAX_SAME_EXCHANGE, true);
    pairInfoString = ` (watching same exchange pair ${tradeParams.mm_priceWatcherSource})`;
  } else {
    pause = utils.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
    pairInfoString = ' (watching not the same exchange pair)';
  }

  if (tradeParams.mm_isActive && module.exports.getIsPriceWatcherEnabled()) {
    log.log(`Price watcher: Setting interval to ${pause}${pairInfoString}.`);
  }

  return pause;
}
