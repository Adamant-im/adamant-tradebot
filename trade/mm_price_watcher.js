/**
 * Watches a coin price in a constant range or using another exchange as a source
 *
 * Provides the Pw range for other modules
 * How other modules behave when setting an order price and it's out of Pw's range:
 * - mm_trader: Don't place an order. We don't close out-of-range mm-orders (we don't expect them).
 * - mm_orderbook_builder: Correct price to fit the Pw's range (placing an order anyway).
 *   While updating out-of-range ob-orders, it closes them.
 * - mm_orderbook_spread: We don't place an order. While updating out-of-range obs-orders, it closes them.
 * - mm_antigap: Don't place an order. While updating out-of-range ag-orders, it closes them.
 * - mm_cleaner: Don't place an order. We don't close out-of-range cl-orders (we don't expect them).
 * - mm_liquidity_provider: Correct price to fit Pw's range. While updating out-of-range liq-orders, it closes them.
 * - mm_price_maker: Don't place an order. We don't close out-of-range pm-orders (we don't expect them).
 * - mm_quote_hunter: Don't place an order. We don't close out-of-range qh-orders (we don't expect them).
 * - mm_spread_maintainer: We don't check Pw; the module itself doesn't calculate positions to place orders.
 *   While updating out-of-range sm-orders, it closes them.
 * - mm_balance_equalizer: Ignores Pw. TODO.
 * - mm_fund_balancer: We don't check Pw; the module itself doesn't place orders.
 * - mm_fund_supplier: We don't check Pw; the module places orders on mainstream pairs.
 * - mm_ladder: We don't check Pw; the module places orders independently and doesn't lose.
 *
 * Pw is enabled if mm_isActive && (mm_isPriceWatcherActive || mm_priceSupportLowPrice)
 * Exception: Pw always disabled with 'wash' mm_Policy, as the only mm module that works is mm_trader then.
 * You can set a price range:
 * - Pair@Exchange: ADM/USDT@Azbit 2% strict/smart
 * - Value: 0.1—0.2 USDT or 0.5 USDT 1%
 * - TODO: Watch ADM/USDT global rate via Infoservice
 * Support price is an additional special case. Pw combines both the price range and the sp: e.g., ADM/USDT@Azbit and not less than sp.
 *
 * You can set a Pw action:
 * - 'fill': Buy or sell to restore Pw range
 * - 'prevent': Don't place pw-orders, but prevent other modules to buy high and sell low
 *
 * If a price is out of Pw range, Pw may act:
 * - Support price case: Always buy to restore sp
 * - 'depth' mm_Policy or 'prevent' mm_priceWatcherAction: Log only
 * - Other cases: Buy or sell coins to fit Pw range
 * It uses a second account (if set) to place pw-orders
 */

const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const exchangerUtils = require('../helpers/cryptos/exchanger');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./settings/tradeParams_' + config.exchange);
const db = require('../modules/DB');
const orderCollector = require('./orderCollector');
const orderUtils = require('./orderUtils');
const TraderApi = require('./trader_' + config.exchange);

const traderapi = TraderApi(
    config.apikey,
    config.apisecret,
    config.apipassword,
    log,
    undefined,
    undefined,
    config.exchange_socket,
    config.exchange_socket_pull,
);

let traderapi2;
if (config.apikey2) {
  traderapi2 = TraderApi(
      config.apikey2,
      config.apisecret2,
      config.apipassword2,
      log,
      undefined,
      undefined,
      config.exchange_socket,
      config.exchange_socket_pull,
      1,
  );
  traderapi2.isSecondAccount = true;
}

const priceWatcherApi = traderapi2 ? traderapi2 : traderapi;

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

const ACTUAL_RETRIES_COUNT = 10; // After 10 unsuccessful price range updates, mark the Pw's price range as not actual

const ALLOWED_GLOBAL_RATE_DIFFERENCE_PERCENT = 20;

const INTERVAL_MIN = 15000;
const INTERVAL_MAX = 30000;
const INTERVAL_MIN_SAME_EXCHANGE = 3000;
const INTERVAL_MAX_SAME_EXCHANGE = 7000; // If we trade on the same exchange, let pw work more often to prevent arbitraging

const LIFETIME_MIN = 2 * constants.MINUTE;
const LIFETIME_MAX = 10 * constants.MINUTE; // Don't set Lifetime too long—not to freeze funds, orders can be big

const priceChangeWarningPercent = 20;
const priceChangeNotifyPercent = 1;

let isPreviousIterationFinished = true;

let lowPrice; let highPrice;
let isPriceRangeSetWithSupportPrice;
let isPriceActual = false;
let setPriceRangeCount = 0;
let pwExchange; let pwExchangeCoin1; let pwExchangeCoin2; let pwExchangeApi;

const PRICE_RANDOMIZATION_PERCENT = 0.4;
const HIGH_PRICE_ADDITION_PERCENT = 1;

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
    tradeParams.saved_mm_priceWatcherAction = tradeParams.mm_priceWatcherAction;
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
      tradeParams.mm_priceWatcherAction = tradeParams.saved_mm_priceWatcherAction;
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
    return constants.MM_POLICIES_REGULAR.includes(tradeParams.mm_Policy) &&
      (tradeParams.mm_isPriceWatcherActive || tradeParams.mm_priceSupportLowPrice);
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
    return isPriceRangeSetWithSupportPrice;
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
      pwInfoString = `based on _${tradeParams.mm_priceWatcherSource}_ with _${tradeParams.mm_priceWatcherSourcePolicy}_ policy, _${tradeParams.mm_priceWatcherDeviationPercent.toFixed(2)}%_ deviation and _${tradeParams.mm_priceWatcherAction}_ action`;
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
    const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;
    if (isPriceRangeSetWithSupportPrice) {
      const pwDisabledInfo = tradeParams.mm_isPriceWatcherActive ? '.' : ' with disabled Price watcher.';
      return ` Note: Price range is set considering support price of ${tradeParams.mm_priceSupportLowPrice.toFixed(coin2Decimals)} ${config.coin2}${pwDisabledInfo}`;
    }

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
   * - Sets a price range
   * - Retrieves current order book ann the coin price
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

      pwOrders = await orderUtils.updateOrders(pwOrders, config.pair, utils.getModuleName(module.id) + ':pw-', false, traderapi2); // update orders which partially filled or not found
      await this.closePriceWatcherOrders(pwOrders); // close orders which expired

      await setPriceRange();

      if (isPriceActual) {
        let orderBook = await traderapi.getOrderBook(config.pair);
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
          // Current price is out of the Pw range

          const watchOnly = tradeParams.mm_Policy === 'depth' || tradeParams.mm_priceWatcherAction === 'prevent';
          const watchOnlyReason = tradeParams.mm_Policy === 'depth' ? '\'depth\' mm_Policy' : '\'prevent\' mm_priceWatcherAction';

          let restoreSp = false;
          if (watchOnly && orderType === 'buy') {
            if (isPriceRangeSetWithSupportPrice) {
              restoreSp = true;
            } else if (tradeParams.mm_priceSupportLowPrice > currentPrice) {
              restoreSp = true;
              log.log(`Price watcher: Corrected Target price from ${targetPrice.toFixed(coin2Decimals)} ${config.coin2} to ${tradeParams.mm_priceSupportLowPrice.toFixed(coin2Decimals)} ${config.coin2} to achieve the Support price even with ${watchOnlyReason}. ${this.getPwRangeString()}`);
              targetPrice = tradeParams.mm_priceSupportLowPrice;
            }
          }

          if (watchOnly && !restoreSp) {
            // Skip placing pw-order

            const supportPriceString = tradeParams.mm_priceSupportLowPrice ? `${tradeParams.mm_priceSupportLowPrice.toFixed(coin2Decimals)} ${config.coin2}` : 'disabled';
            log.log(`Price watcher: Though current price ${currentPrice.toFixed(coin2Decimals)} ${config.coin2} is out of Pw's range, leaving it as is due to ${watchOnlyReason} (not a Support price case, it's ${supportPriceString}). ${this.getPwRangeString()}`);
          } else {
            // Place pw-order to restore the price to the Pw range

            const watchOnlyComment = watchOnly ? `[Ignoring ${watchOnlyReason}, achieve the Support price by any means] ` : '';
            const targetPriceString = `Price watcher: ${watchOnlyComment}Target price is ${targetPrice.toFixed(coin2Decimals)} ${config.coin2} (from ${bidOrAsk} ${currentPrice.toFixed(coin2Decimals)}).`;

            if (
              !tradeParams.mm_isPriceChangeVolumeActive ||
              (tradeParams.mm_Policy === 'depth' && !traderapi2)
            ) {
              // Cancel bot's orders, don't create additional volume trading with ourself
              // For depth mm_Policy, cancel bot's orders not to SELF_TRADE, except
              // Don't clear account 1 orders in case of two accounts trading (no SELF_TRADE possible for two accounts)
              const cleanUpReason = tradeParams.mm_Policy === 'depth' ? 'Depth mm_Policy, clean up not to SELF_TRADE' : 'Don`t create additional volume';
              await orderCollector.clearPriceStepOrders(orderType, targetPrice, 'Price watcher', cleanUpReason);
              orderBook = await traderapi.getOrderBook(config.pair);
              if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
                log.warn(`Price watcher: (After cancelling bot's orders) Order books are empty for ${config.pair}, or temporary API error.`);
                return;
              }
            }

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

            const onWhichAccount = traderapi2 ? ' using second account' : '';
            const priceString = `${config.pair} price of ${targetPrice.toFixed(coin2Decimals)} ${config.coin2}`;
            const actionString = `${orderBookInfo.typeTargetPrice} ${orderBookInfo.amountTargetPrice.toFixed(orderUtils.parseMarket(config.pair).coin1Decimals)} ${config.coin1} ${orderBookInfo.typeTargetPrice === 'buy' ? 'with' : 'for'} ${orderBookInfo.amountTargetPriceQuote.toFixed(coin2Decimals)} ${config.coin2}${onWhichAccount}`;
            const logMessage = `${placingInSpreadNote}To make ${priceString}, the bot is going to ${actionString}.`;
            log.info(`${targetPriceString} ${logMessage} ${this.getPwRangeString()}`);

            const placedOrder = await this.placePriceWatcherOrder(targetPrice, orderBookInfo, currentPrice);
            if (placedOrder) {
              // Maintain spread tiny in case of 'orderbook' market making
              const sm = require('./mm_spread_maintainer');
              await sm.maintainSpreadAfterPriceChange(orderBookInfo.typeTargetPrice, targetPrice, 'Price watcher', orderBook);
            }
          }
        } else {
          // Current price is within the Pw range. Log only.

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
   * @param {Array<Object>} pwOrders Price watcher orders from the DB
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
   * Checks for balances. If balances are insufficient, notify/log and return false/undefined.
   * It uses a second keypair if set. Then, make sure to close the placed order to eliminate possible SELF_TRADE.
   * @param {number} targetPrice New token price to be set
   * @param {Object} orderBookInfo Order book snapshot with additional calculated info
   * @return {boolean} True in case of successfully placed pw-order
   */
  async placePriceWatcherOrder(targetPrice, orderBookInfo, currentPrice) {
    try {
      const coin1Decimals = orderUtils.parseMarket(config.pair).coin1Decimals;
      const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

      const whichAccount = traderapi2 ? ' (using second account)' : '';
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

      let priorityMessage = '';

      // Check balances first time
      let balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount, type, false);
      if (!balances.result) {
        // Cancel bot's orders, so the bot have to buy/sell less
        await orderCollector.clearPriceStepOrders(type, price, 'Price watcher', 'Not enough funds to achieve Pw\'s range');

        // Check balances second time
        balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount, type, true);

        const isSupportPriceCase = type === 'buy' && tradeParams.mm_priceSupportLowPrice > currentPrice;
        if (!balances.result && isSupportPriceCase) {
          // Cancel all of bot's buy orders, so the bot free up quote-coins to achieve support price by any means
          priorityMessage = ` Warn: Not enough funds to achieve Support price ${tradeParams.mm_priceSupportLowPrice} ${config.coin2}. Current price is ${currentPrice.toFixed(coin2Decimals)} ${config.coin2}. Cleared all orders except manually placed.`;
          await orderCollector.clearBuyOrdersToFreeQuoteCoin(false, true, 'Price watcher', 'Not enough funds to achieve Support price — But leave man-orders', priceWatcherApi);

          // Check balances third time
          balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount, type, true);

          if (!balances.result) {
            priorityMessage = ` Warn: Not enough funds to achieve Support price ${tradeParams.mm_priceSupportLowPrice} ${config.coin2}. Current price is ${currentPrice.toFixed(coin2Decimals)} ${config.coin2}. Cleared all orders already.`;
            await orderCollector.clearBuyOrdersToFreeQuoteCoin(true, true, 'Price watcher', 'Not enough funds to achieve Support price — Last try', priceWatcherApi);

            // Check balances fourth time, last one
            balances = await isEnoughCoins(config.coin1, config.coin2, coin1Amount, coin2Amount, type, true);
          }
        }

        if (!balances.result) {
          if (balances.message) {
            if (Date.now()-lastNotifyBalancesTimestamp > constants.HOUR) {
              notify(`${config.notifyName}: ${balances.message}${priorityMessage}`, 'warn', config.silent_mode, !!priorityMessage);
              lastNotifyBalancesTimestamp = Date.now();
            } else {
              log.log(`Price watcher: ${balances.message}${priorityMessage}`);
            }
          }
          return;
        }
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
          coin1AmountFilled: undefined,
          coin2AmountFilled: undefined,
          coin1AmountLeft: coin1Amount,
          coin2AmountLeft: coin2Amount,
          LimitOrMarket: 1, // 1 for limit price. 0 for Market price.
          isProcessed: false,
          isExecuted: true,
          isCancelled: false,
          isClosed: false,
          isSecondAccountOrder: traderapi2 ? true : undefined,
        }, true);

        output = `${type} ${coin1Amount.toFixed(coin1Decimals)} ${config.coin1} for ${coin2Amount.toFixed(coin2Decimals)} ${config.coin2} at ${price.toFixed(coin2Decimals)} ${config.coin2}`;
        log.info(`Price watcher: Successfully placed pw-order${whichAccount} to ${output}.`);

        if (traderapi2) {
          const reasonToClose = 'Avoid SELF_TRADE';
          await orderCollector.clearOrderById(
              order, order.pair, order.type, this.readableModuleName, reasonToClose, undefined, traderapi2);
        }

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
 * Checks if there are enough funds to place a pw-order.
 * It uses a second account if set in the config.
 * @param {string} coin1 The base currency. Defaults to config.coin1.
 * @param {string} coin2 The quote currency. Defaults to config.coin2.
 * @param {number} amount1 Amount in coin1 (base)
 * @param {number} amount2 Amount in coin2 (quote)
 * @param {string} type The order type, either 'buy' or 'sell'
 * @returns {{result: boolean, message: string}} An object containing:
 * - result: true if there are enough funds to place the order, false otherwise.
 * - message: An error message if there are not enough funds.
 */
async function isEnoughCoins(coin1, coin2, amount1, amount2, type, noCache = false) {
  let onWhichAccount = '';
  let balances;
  if (traderapi2) {
    onWhichAccount = ' on second account';
    balances = await priceWatcherApi.getBalances(false);
  } else {
    balances = await traderapi.getBalances(false);
  }

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

/**
 * Calculates the Pw's price range, updating the module's vars:
 * - lowPrice: lower limit
 * - highPrice: higher limit
 * - isPriceActual: if the data is updated recently
 * - isPriceRangeSetWithSupportPrice: if sp influenced the price range interval
 */
async function setPriceRange() {
  try {
    const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

    const previousLowPrice = lowPrice;
    const previousHighPrice = highPrice;

    setPriceRangeCount += 1;
    let l; let h;
    let l_global; let h_global; let lDifferencePercent; let hDifferencePercent; let differenceString = '';

    // Calculate the price range

    if (!tradeParams.mm_isPriceWatcherActive && tradeParams.mm_priceSupportLowPrice) {
      // Price range is set targeted to Support price with Price watcher disabled

      log.log(`Price watcher: It's disabled, setting price range according to ${tradeParams.mm_priceSupportLowPrice.toFixed(coin2Decimals)} ${config.coin2} support price.`);
      setLowHighPrices(-1);

    } else if (tradeParams.mm_priceWatcherSource?.indexOf('@') > -1) {
      // Price range is set targeted to other pair like ADM/USDT@Bittrex

      const pair = tradeParams.mm_priceWatcherSource.split('@')[0];
      const exchange = tradeParams.mm_priceWatcherSource.split('@')[1];

      const pairObj = orderUtils.parseMarket(pair, exchange, true);
      if (pairObj.marketInfoSupported && !pairObj.isParsed) {
        errorSettingPriceRange(`Unable to get market info for ${pair} pair at ${exchange} exchange. It may be a temporary API error.`);
        return false;
      }

      module.exports.setPwExchangeApi(exchange, pairObj.coin1, pairObj.coin2);

      let orderBook;
      if (exchange.toLowerCase() === config.exchange) {
        orderBook = await traderapi.getOrderBook(pairObj.pair);
      } else {
        orderBook = await pwExchangeApi.getOrderBook(pair);
      }

      if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
        errorSettingPriceRange(`Unable to get the order book for ${pair} at ${exchange} exchange. It may be a temporary API error.`);
        return false;
      }

      let bidPrice; let askPrice;
      if (tradeParams.mm_priceWatcherSourcePolicy === 'strict') {
        bidPrice = orderBook.bids[0].price;
        askPrice = orderBook.asks[0].price;
      } else {
        const orderBookInfo = utils.getOrderBookInfo(orderBook, 0, false);
        if (!orderBookInfo || !orderBookInfo.smartAsk || !orderBookInfo.smartBid) {
          errorSettingPriceRange(`Unable to calculate the orderBookInfo for ${pair} at ${exchange} exchange.`);
          return false;
        }
        bidPrice = orderBookInfo.smartBid;
        askPrice = orderBookInfo.smartAsk;
      }

      let priceRangeInfoString = '';
      if (config.pair === pairObj.pair) {
        // Same pair traded on other exchange
        l = bidPrice;
        h = askPrice;
        differenceString = ` (same pair but on ${exchange} exchange)`;
        const marketSpread = utils.numbersDifferencePercent(orderBook.bids[0].price, orderBook.asks[0].price);
        priceRangeInfoString += `Rates for ${pairObj.pair} pair at ${exchange} exchange: bid is ${orderBook.bids[0].price.toFixed(coin2Decimals)}, ask is ${orderBook.asks[0].price.toFixed(coin2Decimals)} (${marketSpread.toFixed(2)}% spread).`;
        log.log(`Price watcher: ${priceRangeInfoString}`);
      } else {
        // Get cross-market rates for config.coin2 / pairObj.coin2 and compare with global rates
        let crossMarketBid; let crossMarketAsk; let crossMarketMid; let crossMarketDirection;

        const crossMarketGlobalRate = exchangerUtils.getRate(config.coin2, pairObj.coin2);

        // Try direct rate
        let crossMarketPair = `${config.coin2}/${pairObj.coin2}`;
        let crossMarket = orderUtils.parseMarket(crossMarketPair, exchange, true);

        if (crossMarket.isParsed) {
          crossMarketDirection = 'direct';
        } else {
          // Try inversed rate
          crossMarketPair = `${pairObj.coin2}/${config.coin2}`;
          crossMarket = orderUtils.parseMarket(crossMarketPair, exchange, true);

          if (crossMarket.isParsed) crossMarketDirection = 'inversed';
        }

        if (crossMarket.isParsed) {
          const crossMarketRates = await pwExchangeApi.getRates(crossMarketPair);
          if (!crossMarketRates) {
            errorSettingPriceRange(`Unable to get rates for ${crossMarketPair} cross-pair at ${exchange} exchange. It may be a temporary API error.`);
            return false;
          }

          if (crossMarketDirection === 'direct') {
            crossMarketBid = crossMarketRates.bid;
            crossMarketAsk = crossMarketRates.ask;
          } else {
            crossMarketBid = 1/crossMarketRates.bid;
            crossMarketAsk = 1/crossMarketRates.ask;
          }

          crossMarketMid = (crossMarketBid + crossMarketAsk) / 2;
          const crossMarketSpread = utils.numbersDifferencePercent(crossMarketBid, crossMarketAsk);
          priceRangeInfoString += `Rates for ${crossMarketPair} cross-pair at ${exchange} exchange: bid is ${crossMarketBid.toFixed(crossMarket.coin2Decimals)}, ask is ${crossMarketAsk.toFixed(crossMarket.coin2Decimals)} (${crossMarketSpread.toFixed(2)}% spread).`;

          const rateDifferencePercent = utils.numbersDifferencePercent(crossMarketGlobalRate, crossMarketMid);
          if (rateDifferencePercent > ALLOWED_GLOBAL_RATE_DIFFERENCE_PERCENT) {
            errorSettingPriceRange(`Difference between ${crossMarketPair} cross-pair at ${exchange} exchange and global ${config.coin2} rate is too much: ${crossMarketMid.toFixed(crossMarket.coin2Decimals)}—${crossMarketGlobalRate.toFixed(crossMarket.coin2Decimals)} (${rateDifferencePercent.toFixed(2)}%).`);
            return false;
          }

          if (crossMarketBid > crossMarketGlobalRate) {
            priceRangeInfoString += ` Note: highest bid on ${crossMarketPair} cross-pair at ${exchange} exchange is greater, than global ${config.coin2} rate: ${crossMarketBid.toFixed(crossMarket.coin2Decimals)} > ${crossMarketGlobalRate.toFixed(crossMarket.coin2Decimals)} (${rateDifferencePercent.toFixed(2)}%).`;
          } else if (crossMarketAsk < crossMarketGlobalRate) {
            priceRangeInfoString += ` Note: lowest ask on ${crossMarketPair} cross-pair at ${exchange} exchange is below, than global ${config.coin2} rate: ${crossMarketAsk.toFixed(crossMarket.coin2Decimals)} < ${crossMarketGlobalRate.toFixed(crossMarket.coin2Decimals)} (${rateDifferencePercent.toFixed(2)}%).`;
          } else {
            priceRangeInfoString += ` Global ${config.coin2} rate is between bid-ask on ${crossMarketPair} cross-pair at ${exchange} exchange: ${crossMarketBid.toFixed(crossMarket.coin2Decimals)} < ${crossMarketGlobalRate.toFixed(crossMarket.coin2Decimals)} < ${crossMarketAsk.toFixed(crossMarket.coin2Decimals)}.`;
          }
        } else {
          priceRangeInfoString += `Unable to find both ${config.coin2}/${pairObj.coin2} and ${pairObj.coin2}/${config.coin2} markets on ${exchange} exchange. Using global rates.`;
          crossMarketDirection = 'not found';
        }

        log.log(`Price watcher: ${priceRangeInfoString}`);

        if (crossMarketDirection === 'not found') {
          // Using global market rates
          l = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, bidPrice, false).outAmount;
          h = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, askPrice, false).outAmount;
          differenceString = ' (using global rates)';
        } else {
          // Using exchange market rates and compare to global
          l_global = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, bidPrice, false).outAmount;
          h_global = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, askPrice, false).outAmount;
          l = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, bidPrice, false, 1/crossMarketMid).outAmount;
          h = exchangerUtils.convertCryptos(pairObj.coin2, config.coin2, askPrice, false, 1/crossMarketMid).outAmount;
          lDifferencePercent = utils.numbersDifferencePercent(l, l_global);
          hDifferencePercent = utils.numbersDifferencePercent(h, h_global);
          if (Math.max(lDifferencePercent, hDifferencePercent) > ALLOWED_GLOBAL_RATE_DIFFERENCE_PERCENT) {
            errorSettingPriceRange(`Difference between ${crossMarketPair} cross-pair at ${exchange} exchange and global ${config.coin2} low–high range is too much: lows are ${l.toFixed(crossMarket.coin2Decimals)}—${l_global.toFixed(crossMarket.coin2Decimals)} (${lDifferencePercent.toFixed(2)}%), highs are ${h.toFixed(crossMarket.coin2Decimals)}—${h_global.toFixed(crossMarket.coin2Decimals)} (${hDifferencePercent.toFixed(2)}%).`);
            return false;
          }
          differenceString = `, global from ${l_global.toFixed(coin2Decimals)} to ${h_global.toFixed(coin2Decimals)} ${config.coin2}. Differences are ${lDifferencePercent.toFixed(2)}% for low and ${hDifferencePercent.toFixed(2)}% for high values`;
        }
      }

      if (!l || l <= 0 || !h || h <= 0) {
        errorSettingPriceRange(`Wrong results of exchangerUtils.convertCryptos function: l=${l}, h=${h}.`);
        return false;
      }

      log.log(`Price watcher: Calculated ${config.pair} price range according to ${pair} at ${exchange} exchange (${tradeParams.mm_priceWatcherSourcePolicy} policy) — from ${l.toFixed(coin2Decimals)} to ${h.toFixed(coin2Decimals)} ${config.coin2}${differenceString}.`);

      l = l * utils.randomValue(1 - tradeParams.mm_priceWatcherDeviationPercent/100, 1);
      h = h * utils.randomValue(1, 1 + tradeParams.mm_priceWatcherDeviationPercent/100);
      setLowHighPrices(l, h);

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
      }

      log.log(`Price watcher: Calculated ${config.pair} price range according to ${+tradeParams.mm_priceWatcherLowPriceInSourceCoin.toFixed(8)}–${+tradeParams.mm_priceWatcherHighPriceInSourceCoin.toFixed(8)} ${tradeParams.mm_priceWatcherSource} global exchange rate — from ${l.toFixed(coin2Decimals)} to ${h.toFixed(coin2Decimals)} ${config.coin2}.`);

      setLowHighPrices(l, h);

    }

    // Log and notify if the new price range significantly differs from the previous one

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
 * Sets lowPrice and highPrice.
 * They aren't set directly as it's necessary to consider mm_priceSupportLowPrice. Also, the values are randomized.
 * @param {number} low Low price range interval. If -1, then set the price range considering sp only.
 * @param {number} high High price range interval
 */
function setLowHighPrices(low, high) {
  if (low < tradeParams.mm_priceSupportLowPrice) {
    low = tradeParams.mm_priceSupportLowPrice;
    if (high) {
      const highAdded = low * (1 + HIGH_PRICE_ADDITION_PERCENT/100);
      high = Math.max(high, highAdded);
    } else {
      high = Number.MAX_VALUE;
    }
    isPriceRangeSetWithSupportPrice = true;
  } else {
    isPriceRangeSetWithSupportPrice = false;
  }

  let lowRandomized = low * utils.randomValue(1, 1 + PRICE_RANDOMIZATION_PERCENT/100);
  let highRandomized = high === Number.MAX_VALUE ? high : high * utils.randomValue(1 - PRICE_RANDOMIZATION_PERCENT/100, 1);
  if (lowRandomized >= highRandomized) {
    lowRandomized = low;
    highRandomized = high;
  }

  lowPrice = lowRandomized;
  highPrice = highRandomized;
  isPriceActual = true;
  setPriceRangeCount = 0;
}

/**
 * General function to log/notify about setting price range errors
 * It concatenates base error message with a specific error message
 * @param {string} errorMessage Specific error message
 */
function errorSettingPriceRange(errorMessage) {
  try {
    const baseNotifyMessage = `Unable to set the Price Watcher's price range ${setPriceRangeCount} times in series. I've temporary turned off watching the ${config.coin1} price.`;
    const baseMessage = `Price watcher: Unable to set the Price Watcher's price range ${setPriceRangeCount} times.`;

    if (setPriceRangeCount > ACTUAL_RETRIES_COUNT) {
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
 * @returns {number}
*/
function setLifeTime() {
  return utils.randomValue(LIFETIME_MIN, LIFETIME_MAX, true);
}

/**
 * Set a random pause in ms for next Price watcher iteration
 * Pause depends on if Pw targets same exchange or not
 * @return {number} Pause in ms
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
