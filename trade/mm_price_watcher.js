/**
 * Watches a coin price in a constant range or using another exchange as a source
 *
 * Provides the Pw range for other modules
 * How other modules behave when setting an order price and it's out of Pw's range:
 * - mm_trader: Don't place an order or correct price depending on a trade type. We don't close out-of-range mm-orders (we don't expect them).
 * - mm_orderbook_builder: Correct price to fit the Pw's range (placing an order anyway). While updating out-of-range ob-orders, it closes them.
 * - mm_orderbook_spread: Don't place an order. While updating out-of-range obs-orders, it closes them.
 * - mm_antigap: Don't place an order. While updating out-of-range ag-orders, it closes them.
 * - mm_cleaner: Don't place an order. We don't close out-of-range cl-orders (we don't expect them).
 * - mm_liquidity_provider: Correct price to fit Pw's range. While updating out-of-range liq-orders, it closes them.
 * - mm_price_maker: Don't place an order. We don't close out-of-range pm-orders (we don't expect them).
 * - mm_quote_hunter: Correct price to the minimum allowed. We don't close out-of-range qh-orders (we don't expect them).
 * - mm_spread_maintainer: We don't check Pw; the module itself doesn't calculate positions to place orders. While updating out-of-range sm-orders, it closes them.
 * - mm_balance_equalizer: Ignores Pw. TODO.
 * - mm_fund_balancer: We don't check Pw; the module itself doesn't place orders.
 * - mm_fund_supplier: We don't check Pw; the module places orders on mainstream pairs.
 * - mm_ladder: We don't check Pw; the module places orders independently and doesn't lose.
 *
 * Pw is enabled if mm_isActive && (mm_isPriceWatcherActive || mm_priceSupportLowPrice)
 * Exception: Pw always disabled with 'wash' mm_Policy, as the only mm module that works is mm_trader then. Only MM_POLICIES_REGULAR activates Pw.
 * You can set a price range:
 * - Pair@Exchange: ADM/USDT@Azbit 2% strict/smart
 * - Value: 0.1—0.2 USDT or 0.5 USDT 1%
 * - TODO: Watch ADM/USDT global rate via Infoservice
 *
 * The Support price is an additional particular case. Pw combines both the price range and the sp: e.g., ADM/USDT@Azbit and not less than sp.
 *
 * In case of Pair@Exchange, Pw verifies the price is consistent with the Infoservice, and if not:
 * - The bot sets isPriceAnomaly = true. Note, isPriceActual can be also true.
 * - The bot notifies about price anomaly (once in 10 minutes)
 * - Other modules prevent placing orders, they pause their work
 * - Other modules keep already opened orders, they don't close them
 * - You can ignore anomaly price with setting GLOBAL_RATE_DIFFERENCE_ACTION = 'notify'
 *
 * In case if isPriceActual = false:
 * - Other modules prevent placing orders, they pause their work
 * - You can ignore it with setting NOT_ACTUAL_PRICE_ACTION = 'log': other modules ignore and treat !isPriceActual like the Pw is disabled.
 *
 * You can set Pw action:
 * - 'fill': Buy or sell to restore Pw range
 * - 'prevent': Don't place pw-orders, but prevent other modules to buy high and sell low
 *
 * If isPriceActual and it's out of Pw range, Pw restores the price back to the range or skip this action:
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
let lastNotifyPriceErrorTimestamp = 0;
let lastNotifyPriceAnomalyTimestamp = 0;

const ACTUAL_RETRIES_COUNT = 10; // After 10 unsuccessful price range updates, mark the Pw's price range as not actual

const ALLOWED_GLOBAL_RATE_DIFFERENCE_PERCENT = 30;

const GLOBAL_RATE_DIFFERENCE_ACTION = 'block'; // notify | block; for Pw and other modules
const NOT_ACTUAL_PRICE_ACTION = 'block'; // log | block; for other modules only -> they use getIgnorePriceNotActual(). Pw always use 'block' when setting a new price range or correcting a price.

const INTERVAL_MIN = 15000;
const INTERVAL_MAX = 30000;
const INTERVAL_MIN_SAME_EXCHANGE = 3000;
const INTERVAL_MAX_SAME_EXCHANGE = 7000; // If we trade on the same exchange, let pw work more often to prevent arbitraging

const LIFETIME_MIN = 5 * constants.MINUTE;
const LIFETIME_MAX = 20 * constants.MINUTE; // Don't set Lifetime too long—not to freeze funds, orders can be big

const priceChangeWarningPercent = 20;
const priceChangeNotifyPercent = 1;

let isPreviousIterationFinished = true;

let lowPrice; let highPrice;
let isPriceRangeSetWithSupportPrice;
let isPriceActual = false; // Pw range is successfully updated recently
let isPriceAnomaly = false; // Pw range, targeted to Pair@Exchange, is inconsistent with the global rate (Infoservice)
let setPriceRangeCount = 0;
let pwExchange; let pwExchangeCoin1; let pwExchangeCoin2; let pwExchangeApi;

const PRICE_RANDOMIZATION_PERCENT = 0.2; // For any price source, randomize low and high bounds ±0.2%
const HIGH_PRICE_ADDITION_PERCENT = 1;

log.log(`Module ${utils.getModuleName(module.id)} is loaded.`);

module.exports = {
  readableModuleName: 'Price watcher',

  /**
   * Save Pw parameters to restore them later
   * Used to restore Pw after Pm finished its job with 'depth' mm_Policy
   * @param {string} reason Who saves parameters
   * @returns {void}
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
   * @param {string} reason Who restores parameters
   * @returns {boolean} If parameters restored
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
   * @returns {boolean}
   */
  getIsPriceWatcherEnabled() {
    return constants.MM_POLICIES_REGULAR.includes(tradeParams.mm_Policy) &&
      (tradeParams.mm_isPriceWatcherActive || tradeParams.mm_priceSupportLowPrice);
  },

  /**
   * Returns if price range is set and Pw/Sp is active
   * Note: also check if Market-making is active
   * See also: getIsPriceActualConsistentAndEnabled()
   * @returns {boolean}
   */
  getIsPriceActualAndEnabled() {
    return isPriceActual && this.getIsPriceWatcherEnabled();
  },

  /**
   * Returns if price range is set and Pw/Sp is active and consistent
   * Note: also check if Market-making is active
   * @returns {boolean}
   */
  getIsPriceActualConsistentAndEnabled() {
    return this.getIsPriceActualAndEnabled() && !isPriceAnomaly;
  },

  /**
   * Returns if price range is not consistent within different sources
   * E.g., Pair@Exchange and Infoservice
   * Note: also check if Pw/Sp/Mm is active
   * @returns {boolean}
   */
  getIsPriceAnomaly() {
    return isPriceAnomaly;
  },

  /**
   * Returns if price range is set
   * Note: also check if Pw/Sp/Mm is active
   * @returns {boolean}
   */
  getIsPriceActual() {
    return isPriceActual;
  },

  /**
   * Returns if other modules can treat !isPriceActual same as disabled Pw
   * Note: also check if Pw/Sp/Mm is active
   * @returns {boolean}
   */
  getIgnorePriceNotActual() {
    return NOT_ACTUAL_PRICE_ACTION === 'log';
  },

  getIsPriceRangeSetWithSupportPrice() {
    return isPriceRangeSetWithSupportPrice;
  },

  /**
   * Returns Pw's parameters for other modules
   * Sample: `Price watcher is set ${pw.getPwInfoString()}.`
   * Not ending with a dot
   * @returns {string} Log string
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
   * @returns {string} Log string
   */
  getPwRangeString() {
    const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;
    const upperBound = highPrice === Number.MAX_VALUE ? 'Infinity' : `${highPrice.toFixed(coin2Decimals)}`;
    return `Pw's range ${lowPrice.toFixed(coin2Decimals)}–${upperBound} ${config.coin2}.${this.getSetWithSupportPriceString()}`;
  },

  /**
   * Returns log string if price range is set with support price
   * @returns {string} Log string
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
   * Sets isPriceActual by other modules. This module sets isPriceActual directly.
   * Goal to force price range update
   * @param {boolean} value If price is actual
   * @param {string} callerName Caller for logging
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
   * @param {string} exchange Exchange name, as 'Bittrex'
   * @param {string} coin1 Socket connection subscribes to a specific pair
   * @param {string} coin2
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
   * @return {boolean}
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
   * - Sets the new Pw's price range
   * - Retrieves current order book and the coin price
   * - If the coin price is out of the price range, it buys or sells coins to fit this range (action depends on mm_Policy and mm_priceWatcherAction)
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

      // Update already opened pw-orders
      pwOrders = await orderUtils.updateOrders(pwOrders, config.pair, utils.getModuleName(module.id) + ':pw-', false, traderapi2); // update orders which partially filled or not found
      await this.closePriceWatcherOrders(pwOrders); // close orders which expired

      // Calculate new price range
      await setPriceRange();

      // If we have actual and consistent Pw range, buy or sell coins to fit this range
      if (isPriceActual && !isPriceAnomaly) {
        let orderBook = await orderUtils.getOrderBookCached(config.pair, utils.getModuleName(module.id));
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
              orderBook = await orderUtils.getOrderBookCached(config.pair, utils.getModuleName(module.id), true);
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
      log.error(`Error in reviewPrices() of ${utils.getModuleName(module.id)} module: ${e}`);
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
    balances = await orderUtils.getBalancesCached(false, utils.getModuleName(module.id), noCache);
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
      // Price range is set targeted to other pair like ADM/USDT@Azbit or ADM/BTC@Biconomy
      // Coin1 always equals config.coin1

      const targetPair = tradeParams.mm_priceWatcherSource.split('@')[0];
      const targetExchange = tradeParams.mm_priceWatcherSource.split('@')[1];

      const targetPairObj = orderUtils.parseMarket(targetPair, targetExchange, true);
      if (targetPairObj.marketInfoSupported && !targetPairObj.isParsed) {
        errorSettingPriceRange(`Unable to get market info for ${targetPair} pair at ${targetExchange} exchange. It may be a temporary API error.`);
        return false;
      }

      module.exports.setPwExchangeApi(targetExchange, targetPairObj.coin1, targetPairObj.coin2);

      let orderBook;
      if (targetExchange.toLowerCase() === config.exchange) {
        orderBook = await orderUtils.getOrderBookCached(targetPairObj.pair, utils.getModuleName(module.id), true);
      } else {
        orderBook = await pwExchangeApi.getOrderBook(targetPair);
      }

      if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
        errorSettingPriceRange(`Unable to get the order book for ${targetPair} at ${targetExchange} exchange. It may be a temporary API error.`);
        return false;
      }

      const orderBookInfo = utils.getOrderBookInfo(orderBook, 0, false);
      if (!orderBookInfo || !orderBookInfo.smartAsk || !orderBookInfo.smartBid) {
        errorSettingPriceRange(`Unable to calculate the orderBookInfo for ${targetPair} at ${targetExchange} exchange.`);
        return false;
      }

      const bidPriceStrict = orderBook.bids[0].price;
      const askPriceStrict = orderBook.asks[0].price;

      const targetObSpreadStrict = utils.numbersDifferencePercent(bidPriceStrict, askPriceStrict);
      const targetObSpreadSmart = utils.numbersDifferencePercent(orderBookInfo.smartBid, orderBookInfo.smartAsk);

      let targetObString = `Got reference ${tradeParams.mm_priceWatcherSource} target order book.`;
      targetObString += ` Strict prices are ${bidPriceStrict.toFixed(targetPairObj.coin2Decimals)}—${askPriceStrict.toFixed(targetPairObj.coin2Decimals)} ${targetPairObj.coin2} (${targetObSpreadStrict.toFixed(2)}% spread),`;
      targetObString += ` smart are ${orderBookInfo.smartBid.toFixed(targetPairObj.coin2Decimals)}—${orderBookInfo.smartAsk.toFixed(targetPairObj.coin2Decimals)} ${targetPairObj.coin2} (${targetObSpreadSmart.toFixed(2)}% spread).`;
      log.log(`Price watcher: ${targetObString}`);

      let bidPriceInTargetCoin; let askPriceInTargetCoin;
      if (tradeParams.mm_priceWatcherSourcePolicy === 'strict') {
        bidPriceInTargetCoin = bidPriceStrict; // E.g., 0.00000047 BTC for ADM/USDT@Biconomy
        askPriceInTargetCoin = askPriceStrict; // E.g., 0.00000049 BTC
      } else {
        bidPriceInTargetCoin = orderBookInfo.smartBid;
        askPriceInTargetCoin = orderBookInfo.smartAsk;
      }

      let priceRangeInfoString = '';

      if (config.pair === targetPairObj.pair) {
        // The same pair traded on another exchange
        l = bidPriceInTargetCoin;
        h = askPriceInTargetCoin;

        differenceString = ` (the same pair but on ${targetExchange} exchange)`;
      } else {
        // Not the same pair, it may be on the same exchange or on another
        // Get cross-market rates for config.coin2 / pairObj.coin2 and compare with global rates
        // E.g., ADM/USDT@Azbit targeted to ADM/BTC@Azbit or ADM/BTC@Biconomy. Working with the target exchange.

        let crossMarketBid; let crossMarketAsk;

        // Try direct rate
        let crossMarketPair = `${config.coin2}/${targetPairObj.coin2}`; // E.g., USDT/BTC
        let crossMarket = orderUtils.parseMarket(crossMarketPair, targetExchange, true);

        if (!crossMarket.isParsed || crossMarket.isReversed) { // Consider the DEX's isReversed as no market found, as we try the inversed rate especially
          // Try inversed rate
          crossMarketPair = `${targetPairObj.coin2}/${config.coin2}`; // USDT/BTC -> BTC/USDT
          crossMarket = orderUtils.parseMarket(crossMarketPair, targetExchange, true);
        }

        if (crossMarket.isParsed) {
          // Found the cross-market on a target exchange

          const crossMarketRates = await pwExchangeApi.getRates(crossMarketPair);
          if (!crossMarketRates) {
            errorSettingPriceRange(`Unable to get rates for the ${crossMarketPair} cross-pair at ${targetExchange} exchange. It may be a temporary API error.`);
            return false;
          }

          crossMarketBid = crossMarketRates.bid; // E.g., 64400 for BTC/USDT
          crossMarketAsk = crossMarketRates.ask; // E.g., 64600 for BTC/USDT

          const crossMarketSpread = utils.numbersDifferencePercent(crossMarketBid, crossMarketAsk);
          priceRangeInfoString += `Found rates for the ${crossMarketPair} cross-pair at ${targetExchange} exchange: bid is ${crossMarketBid.toFixed(crossMarket.coin2Decimals)}, ask is ${crossMarketAsk.toFixed(crossMarket.coin2Decimals)} (${crossMarketSpread.toFixed(2)}% spread).`;
          priceRangeInfoString += ` Using these rates for ${targetPairObj.coin2} -> ${config.coin2} conversion.`;

          l = exchangerUtils.convertCryptos(targetPairObj.coin2, config.coin2, bidPriceInTargetCoin, false, crossMarketBid)
              .outAmount; // E.g., 0.00000047 BTC -> 0.0302 USDT
          h = exchangerUtils.convertCryptos(targetPairObj.coin2, config.coin2, askPriceInTargetCoin, false, crossMarketAsk)
              .outAmount; // E.g., 0.00000049 BTC -> 0.0316 USDT
        } else {
          // Both direct and reversed pairs don't exist on the target exchange, using global exchange rates
          const crossMarketGlobalRate = exchangerUtils.getRate(targetPairObj.coin2, config.coin2); // E.g., 1 BTC = 64500 USDT

          l = exchangerUtils.convertCryptos(targetPairObj.coin2, config.coin2, bidPriceInTargetCoin, false).outAmount;
          h = exchangerUtils.convertCryptos(targetPairObj.coin2, config.coin2, askPriceInTargetCoin, false).outAmount;

          priceRangeInfoString += `Unable to find both ${config.coin2}/${targetPairObj.coin2} and ${targetPairObj.coin2}/${config.coin2} markets on ${targetExchange} exchange.`;
          priceRangeInfoString += ` Using the global conversion rate: 1 ${targetPairObj.coin2} = ${crossMarketGlobalRate.toFixed(coin2Decimals)} ${config.coin2}.`;
        }

        log.log(`Price watcher: ${priceRangeInfoString}`);
      } // The same pair or not for the Pair@Exchange case

      if (!utils.isPositiveNumber(l) || !utils.isPositiveNumber(h)) {
        errorSettingPriceRange(`Wrong results of exchangerUtils.convertCryptos function: l=${l}, h=${h}.`);
        return false;
      }

      log.log(`Price watcher: Calculated the ${config.pair} price range according to ${targetPair} at ${targetExchange} exchange (${tradeParams.mm_priceWatcherSourcePolicy} policy) — from ${l.toFixed(coin2Decimals)} to ${h.toFixed(coin2Decimals)} ${config.coin2}${differenceString}.`);

      // Verify that calculated price range is consistent with the Infoservice (global rates as CMC/Cg)

      l_global = exchangerUtils.convertCryptos(targetPairObj.coin2, config.coin2, bidPriceInTargetCoin, false).outAmount;
      h_global = exchangerUtils.convertCryptos(targetPairObj.coin2, config.coin2, askPriceInTargetCoin, false).outAmount;
      lDifferencePercent = utils.numbersDifferencePercent(l, l_global);
      hDifferencePercent = utils.numbersDifferencePercent(h, h_global);

      let rangeDifferenceString = `Difference between ${tradeParams.mm_priceWatcherSource} and global ${config.coin1} rates is excessive:`;
      rangeDifferenceString += ` low bound is ${l.toFixed(coin2Decimals)} vs ${l_global.toFixed(coin2Decimals)} ${config.coin2} (diff ${lDifferencePercent.toFixed(2)}%),`;
      rangeDifferenceString += ` high bound is ${h.toFixed(coin2Decimals)} vs ${h_global.toFixed(coin2Decimals)} ${config.coin2} (diff ${hDifferencePercent.toFixed(2)}%).`;

      if (Math.max(lDifferencePercent, hDifferencePercent) > ALLOWED_GLOBAL_RATE_DIFFERENCE_PERCENT) {
        anomalyPriceRange(rangeDifferenceString);

        if (GLOBAL_RATE_DIFFERENCE_ACTION === 'block') {
          isPriceAnomaly = true;
        }
      } else {
        isPriceAnomaly = false;
      }

      // Use allowed price deviation mm_priceWatcherDeviationPercent
      l = l * (1 - tradeParams.mm_priceWatcherDeviationPercent/100);
      h = h * (1 + tradeParams.mm_priceWatcherDeviationPercent/100);

      setLowHighPrices(l, h);
    } else {
      // Price range is set in some coin using global rates

      const pwCoin = tradeParams.mm_priceWatcherSource; // E.g., USDT or BTC
      const lowPriceInPwCoin = tradeParams.mm_priceWatcherLowPriceInSourceCoin; // E.g., 0.00000047 BTC
      const highPriceInPwCoin = tradeParams.mm_priceWatcherHighPriceInSourceCoin; // E.g., 0.00000049 BTC

      const crossMarketGlobalRate = exchangerUtils.getRate(pwCoin, config.coin2); // E.g., 1 BTC = 64500 USDT
      log.log(`Price watcher: Global exchange rate for ${pwCoin}/${config.coin2} conversion: 1 ${pwCoin} = ${crossMarketGlobalRate.toFixed(coin2Decimals)} ${config.coin2}.`);

      l = exchangerUtils.convertCryptos(pwCoin, config.coin2, lowPriceInPwCoin).outAmount;
      h = exchangerUtils.convertCryptos(pwCoin, config.coin2, highPriceInPwCoin).outAmount;

      if (!utils.isPositiveNumber(l) || !utils.isPositiveNumber(h)) {
        errorSettingPriceRange(`Wrong results of exchangerUtils.convertCryptos function: l=${l}, h=${h}.`);
        return false;
      }

      log.log(`Price watcher: Calculated the ${config.pair} price range according to ${lowPriceInPwCoin}–${highPriceInPwCoin} ${pwCoin} global exchange rate — from ${l.toFixed(coin2Decimals)} to ${h.toFixed(coin2Decimals)} ${config.coin2}.`);

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
 * Sets lowPrice and highPrice for the Pw's price range.
 * They aren't set directly as it's necessary to consider mm_priceSupportLowPrice. Also, the values are randomized.
 * Once set, isPriceActual = true. Note, isPriceAnomaly can be true along with isPriceActual.
 * @param {number} low Low price range interval. If -1, then set the price range considering sp only.
 * @param {number} high High price range interval
 */
function setLowHighPrices(low, high) {
  if (low < tradeParams.mm_priceSupportLowPrice) {
    // Consider sp
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

  // Randomize the price range
  const rKoef = PRICE_RANDOMIZATION_PERCENT/100;
  let lowRandomized = low * utils.randomValue(1 - rKoef, 1 + rKoef);
  let highRandomized = high === Number.MAX_VALUE ? high : high * utils.randomValue(1 - rKoef, 1 + rKoef);
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
 * If error occurs several times in sequence, sets isPriceActual = false
 * @param {string} errorMessage Specific error message
 */
function errorSettingPriceRange(errorMessage) {
  try {
    const baseMessage = `Unable to set the Price Watcher's price range ${setPriceRangeCount} times in series.`;

    let actionMessage;

    if (setPriceRangeCount > ACTUAL_RETRIES_COUNT) {
      isPriceActual = false;

      actionMessage = 'Setting the price range is not actual. According to settings, other modules';
      actionMessage += module.exports.getIgnorePriceNotActual() ?
          ' ignore and treat this like the Pw is disabled.' :
          ' block placing orders until the price range is updated.';

      // Notify or log
      if (Date.now()-lastNotifyPriceErrorTimestamp > constants.HOUR) {
        notify(`${config.notifyName}: ${baseMessage} ${errorMessage} ${actionMessage}`, 'warn');
        lastNotifyPriceErrorTimestamp = Date.now();
      } else {
        log.warn(`Price watcher: ${baseMessage} ${errorMessage} ${actionMessage}`);
      }
    } else {
      actionMessage = `I continue watching the ${config.coin1} price according to the previous values.`;
      log.log(`Price watcher: ${baseMessage} ${errorMessage} ${actionMessage}`);
    }
  } catch (e) {
    log.error(`Error in errorSettingPriceRange() of ${utils.getModuleName(module.id)} module: ${e}`);
  }
}

/**
 * General function to log/notify about anomaly price
 * It concatenates base error message with a specific error message
 * Doesn't set isPriceActual or isPriceAnomaly
 * @param {string} errorMessage Specific error message
 */
function anomalyPriceRange(errorMessage) {
  try {
    const baseMessage = 'Price anomaly.';

    const actionMessage = GLOBAL_RATE_DIFFERENCE_ACTION === 'block' ?
        'According to settings, all modules block placing orders until the price range becomes consistent.' :
        'According to settings, Pw ignores it and accepts the new price range.';

    // Notify or log
    if (Date.now()-lastNotifyPriceAnomalyTimestamp > 10 * constants.MINUTE) {
      notify(`${config.notifyName}: ${baseMessage} ${errorMessage} ${actionMessage}`, 'warn');
      lastNotifyPriceAnomalyTimestamp = Date.now();
    } else {
      log.warn(`Price watcher: ${baseMessage} ${errorMessage} ${actionMessage}`);
    }
  } catch (e) {
    log.error(`Error in anomalyPriceRange() of ${utils.getModuleName(module.id)} module: ${e}`);
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
