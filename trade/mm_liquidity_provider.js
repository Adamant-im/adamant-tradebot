/**
 * Places liquidity orders within ±mm_liquiditySpreadPercent.
 * Also maintains the mm_liquiditySpreadPercent orderbook spread.
 *
 * Liquidity (liq) is enabled when:
 *   mm_isActive && mm_isLiquidityActive && mm_Policy !== 'wash'
 *
 * Examples:
 * - '/enable liq 2% 1000 ADM 100 USDT middle':
 *      Place liq-orders in the 0–2% deviation range.
 *
 * - '/enable liq 2% 1000 ADM 100 USDT middle ss':
 *      Same as above, but with spread support (mm_liquiditySpreadSupport).
 *      The "ss" option places additional small-support orders within ±LIQUIDITY_SS_MAX_SPREAD_PERCENT.
 *
 *      “Additional” means:
 *        – Their count and total volume are in addition to regular liq-orders.
 *      “Small” means:
 *        – Each order size is between getMinOrderAmount() and +100% of it
 *          (typically ~5–10 USDT depending on the trading pair/exchange).
 *
 *      Support-order count is determined by getMaxOrderNumberOneSide(side),
 *      and limited within MIN_SS_ORDERS_ONE_SIDE … MAX_SS_ORDERS_ONE_SIDE.
 *
 *      Optional module: trade/mm_liquidity_ss.js.
 *
 * - '/enable liq 1.5-2% 1000 ADM 100 USDT middle':
 *      Place liq-orders in the 1.5–2% deviation range (further from the midpoint).
 *
 * - '/enable liq 1.5-2% 1000 ADM 100 USDT middle ss':
 *      Same as above, plus spread support.
 *
 * mm_liquidityTrend controls the midpoint of the spread — how to fill the
 * bid–ask gap: “middle”, “downtrend”, or “uptrend”.
 * It may shift price upward or downward when no third-party orders exist.
 *
 * Safe Liquidity — built-in protection:
 *   - Never buy higher than your sell prices; never sell lower than your buys.
 *     VWAP is calculated separately for bids and asks.
 *   - Flowing liquidity: when you sell, the same amount is placed back on the
 *     buy side at a lower price.
 *   - Details: [2024-03 MM bot / Safe liquidity]
 *   - Optional module: trade/mm_liquidity_safe.js
 */

/**
 * @module trade/mm_liquidity_provider
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/liquidity.d').LiqLimits} LiqLimits
 * @typedef {import('types/bot/ordersDb.d.js').BotOrderDbRecord} BotOrderDbRecord
 */

const utils = require('../helpers/utils');
const constants = require('../helpers/const');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
const tradeParams = require('./settings/tradeParams_' + config.exchange);

const traderapi = require('./trader_' + config.exchange)(
    config.apikey,
    config.apisecret,
    config.apipassword,
    log,
    undefined,
    undefined,
    config.exchange_socket,
    config.exchange_socket_pull,
);

const isPerpetual = Boolean(config.perpetual);

const db = require('../modules/DB');
const orderUtils = require('./orderUtils');
const exchangerUtils = require('../helpers/cryptos/exchanger');
const orderCollector = require('./orderCollector');

// Optional sub-modules (loaded via softRequire so the bot works even without them)
const safeLiq = utils.softRequire('../trade/mm_liquidity_safe'); // Safe Liquidity: liqLimits, VWAP bounds
const ss = utils.softRequire('../trade/mm_liquidity_ss'); // Spread-support (SS) liq-orders

let lastNotifyBalancesTimestamp = 0;
let lastNotifyPriceTimestamp = 0;

const INTERVAL_MIN = 10 * 1000;
const INTERVAL_MAX = 20 * 1000;
const LIFETIME_MIN = 1000 * 60 * 7; // 7 minutes
const LIFETIME_MAX = constants.HOUR * 7; // 7 hours

const DEFAULT_MAX_ORDERS_ONE_SIDE = 5;

const minMaxAmounts = {}; // Stores min-max amounts for depth liq-orders (buy, sell)

// Local cache of Safe Liquidity limits; synced from mm_liquidity_safe after each updateLiqLimits() call.
// Falls back to raw tradeParams amounts when mm_liquidity_safe is absent.
/** @type {LiqLimits} */
let liqLimits = createDefaultLiqLimits();

let isPreviousIterationFinished = true;

const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(config.defaultPair));
const { pair, coin1, coin2, coin1Decimals, coin2Decimals, coin2DecimalsForStable } = formattedPair;
const exchange = config.exchange;

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);
const readableModuleName = 'Liquidity';

log.log(`Module ${moduleName} is loaded.`);

module.exports = {
  readableModuleName,

  run() {
    this.iteration();
  },

  /**
   * Executes the Liquidity provider instance loop at a time interval,
   * as long as it is enabled.
   */
  async iteration() {
    const interval = setPause();
    if (
      interval &&
      tradeParams.mm_isActive &&
      tradeParams.mm_isLiquidityActive &&
      (
        !tradeParams.mm_isTraderActive ||
        constants.MM_POLICIES_REGULAR.includes(tradeParams.mm_Policy)
      ) &&
      !isPerpetual
    ) {
      if (isPreviousIterationFinished) {
        isPreviousIterationFinished = false;
        await this.updateLiquidity();
        isPreviousIterationFinished = true;
      } else {
        log.log(`${readableModuleName}: Postponing iteration of the liquidity provider for ${interval} ms. Previous iteration is in progress yet.`);
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
   * Top-level logic of the Liquidity Provider.
   * Updates existing liq-orders, places spread-support orders, then depth (regular) liq-orders,
   * and logs the module statistics.
   */
  async updateLiquidity() {
    try {
      const { ordersDb } = db;
      /** @type {BotOrderDbRecord[]} */
      let liquidityOrders = await ordersDb.find({
        isProcessed: false,
        purpose: 'liq', // liq: liquidity order
        pair,
        exchange,
      });

      const orderBook = await orderUtils.getOrderBookCached(pair, moduleName);
      let orderBookInfo = utils.getOrderBookInfo(orderBook, tradeParams.mm_liquiditySpreadPercent);

      if (!orderBookInfo) {
        log.warn(`${readableModuleName}: Order books are empty for ${pair}, or the exchange returned a temporary API error. Unable to retrieve spread information while placing liquidity orders.`);
        return;
      }

      if (!setMinMaxAmounts(orderBookInfo.highestBid)) {
        log.warn(`${readableModuleName}: Unable to calculate min-max amounts while placing liq-orders.`);
        return;
      }

      liquidityOrders = await orderUtils.updateOrders(liquidityOrders, pair, moduleName + ':liq-'); // Update orders that were partially filled or not found
      liquidityOrders = await this.closeLiquidityOrders(liquidityOrders, orderBookInfo); // Close orders which expired or not met conditions
      await this.updateLiqLimits();
      if (ss) await ss.updateSsVwap();

      let liqInfoString; let liqSsInfoString;

      // 1. Place spread support liq-orders

      if (ss && tradeParams.mm_liquiditySpreadSupport) {
        const ssResult = await ss.updateSsLiquidity(liquidityOrders, orderBookInfo);
        liqSsInfoString = ssResult.liqSsInfoString;

        // Reload liq-orders from DB to include newly placed SS orders
        liquidityOrders = await ordersDb.find({
          isProcessed: false,
          purpose: 'liq', // liq: liquidity order
          pair,
          exchange,
        });

        // Refresh order book (no cache) before placing depth orders
        const freshObAfterSs = await orderUtils.getOrderBookCached(pair, moduleName, true);
        if (freshObAfterSs) {
          const freshObInfoAfterSs = utils.getOrderBookInfo(freshObAfterSs, tradeParams.mm_liquiditySpreadPercent);
          if (freshObInfoAfterSs) orderBookInfo = freshObInfoAfterSs;
        }
      } else {
        liqSsInfoString = ' Spread-support orders are not enabled.';
      }

      // 2. Place regular (depth) liq-orders

      const liquidityDepthOrders = liquidityOrders.filter((order) => order.subPurpose !== 'ss');
      const liquidityDepthStats = utils.calculateOrderStats(liquidityDepthOrders);

      let amountPlaced;

      do {
        amountPlaced = await this.placeLiquidityOrder(liquidityDepthStats.bidsTotalQuoteAmount, liquidityDepthStats.bidsCount, 'buy', orderBookInfo);
        if (amountPlaced) {
          liquidityDepthStats.bidsTotalQuoteAmount += amountPlaced;
          liquidityDepthStats.bidsCount += 1;
        }
      } while (amountPlaced);

      do {
        amountPlaced = await this.placeLiquidityOrder(liquidityDepthStats.asksTotalAmount, liquidityDepthStats.asksCount, 'sell', orderBookInfo);
        if (amountPlaced) {
          liquidityDepthStats.asksTotalAmount += amountPlaced;
          liquidityDepthStats.asksCount += 1;
        }
      } while (amountPlaced);

      liqInfoString = `Liquidity: Opened ${liquidityDepthStats.bidsCount} bid-buy depth orders for ${liquidityDepthStats.bidsTotalQuoteAmount.toFixed(coin2DecimalsForStable)} of ${tradeParams.mm_liquidityBuyQuoteAmount} ${coin2} (safe: ${liqLimits.bidLimit.toFixed(coin2DecimalsForStable)} ${coin2}, ${liqLimits.bidLimitPercent.toFixed(2)}%)`;
      liqInfoString += ` and ${liquidityDepthStats.asksCount} ask-sell depth orders with ${liquidityDepthStats.asksTotalAmount.toFixed(coin1Decimals)} of ${tradeParams.mm_liquiditySellAmount} ${coin1} (safe: ${liqLimits.askLimit.toFixed(coin1Decimals)} ${coin1}, ${liqLimits.askLimitPercent.toFixed(2)}%) ${coin1}.`;
      liqInfoString += liqSsInfoString;

      log.log(liqInfoString);
    } catch (e) {
      log.error(`Error in updateLiquidity() of ${moduleName} module: ${e}`);
    }
  },

  /**
   * Sets liquidity trend to fill the spread gap after a price movement.
   * Triggers an extraordinary updateLiquidity() iteration, which also closes
   * out-of-spread and out-of-Pw orders.
   *
   * Note: This method is not called directly by the Liquidity provider.
   *       It is invoked by the Spread maintainer when needed.
   *
   * @param {string} orderSide The side of the triggering order: 'buy' or 'sell'
   * @param {string} callerName Name of the calling module for logging purposes
   */
  async updateLiquidityAfterPriceChange(orderSide, callerName) {
    log.log(`${readableModuleName}/${callerName}: Updating ${orderSide} liq-orders after a price movement.`);

    if (isPreviousIterationFinished) {
      const previousLiquidityTrend = tradeParams.mm_liquidityTrend;
      tradeParams.mm_liquidityTrend = orderSide === 'buy' ? 'uptrend' : 'downtrend';

      // utils.saveConfig(false, 'Liquidity-UpdateTrend'); // Don't save, it's a one-time operation
      log.log(`${readableModuleName}/${callerName}: After a price move triggered by a ${orderSide}-order, a one-time liquidity trend was set to '${tradeParams.mm_liquidityTrend}' from '${previousLiquidityTrend}'.`);

      isPreviousIterationFinished = false;
      await this.updateLiquidity();
      isPreviousIterationFinished = true;

      tradeParams.mm_liquidityTrend = previousLiquidityTrend;
    } else {
      log.log(`${readableModuleName}/${callerName}: Skipping liq-orders update as previous iteration is in progress.`);
    }
  },

  /**
   * Closes active liq-orders when any of the following conditions are met:
   * - Order lifetime has expired
   * - The order is outside the Price Watcher range
   * - The order is outside the VWAP range
   * - The order is outside the current spread
   *   (except when it was intentionally placed out of spread due to Price Watcher or VWAP correction)
   *
   * @param {BotOrderDbRecord[]} liqOrders List of liq-purpose orders fetched from the internal DB
   * @param {Object} orderBookInfo Result of utils.getOrderBookInfo(), used to verify if an order is outside the spread
   * @return {Promise<BotOrderDbRecord[]>} Updated list of orders with removed ones excluded
   */
  async closeLiquidityOrders(liqOrders, orderBookInfo) {
    const updatedLiquidityOrders = [];

    for (const order of liqOrders) {
      try {
        let reasonToClose = ''; const reasonObject = {};

        if (order.dateTill < utils.unixTimeStampMs()) {
          reasonToClose = 'It\'s expired.';
          reasonObject.isExpired = true;
        } else if (utils.isOrderOutOfPriceWatcherRange(order)) {
          const pw = require('./mm_price_watcher');
          reasonToClose = `It's out of ${pw.getPwRangeString()}`;
          reasonObject.isOutOfPwRange = true;
        } else if (
          order.subPurpose === 'ss' && ss ?
              utils.isOrderOutOfPriceRange(order, ss.getCachedSsVwap().soldVwap, ss.getCachedSsVwap().boughtVwap) :
              utils.isOrderOutOfPriceRange(order, liqLimits?.boughtVwap, liqLimits?.soldVwap)
        ) {
          // SS orders: lowPrice=soldVwap (sell floor), highPrice=boughtVwap (buy ceiling) — matches getSsPrice placement logic
          // Depth orders: lowPrice=boughtVwap (sell floor), highPrice=soldVwap (buy ceiling)
          const rangeString = (order.subPurpose === 'ss' && ss) ? ss.getSsVwapRangeString() : this.getVwapRangeString();
          reasonToClose = `It's out of ${rangeString}`;
          reasonObject.isOutOfVwapRange = true;
        } else {
          const outOfSpreadInfo = utils.isOrderOutOfSpread(order, orderBookInfo);

          if (outOfSpreadInfo?.isOrderOutOfSpread) {
            let outOfSpreadString;

            if (outOfSpreadInfo.isOrderOutOfMinMaxSpread) {
              outOfSpreadString = `Its price ${outOfSpreadInfo.orderPrice.toFixed(coin2Decimals)} ${coin2} out of ±${outOfSpreadInfo.spreadPercent}% spread: [${outOfSpreadInfo.minPrice.toFixed(coin2Decimals)}, ${outOfSpreadInfo.maxPrice.toFixed(coin2Decimals)}].`;
            } else {
              outOfSpreadString = `Its price ${outOfSpreadInfo.orderPrice.toFixed(coin2Decimals)} ${coin2} in the ±${outOfSpreadInfo.spreadPercentMin}% disallowed inner spread: [${outOfSpreadInfo.innerLowPrice.toFixed(coin2Decimals)}, ${outOfSpreadInfo.innerHighPrice.toFixed(coin2Decimals)}].`;
            }

            reasonObject.isOutOfSpread = true;

            if (order.priceCorrected) {
              log.debug(`${readableModuleName}: Although the ${order.side} liq-order${order.subTypeString || order.subPurposeString} with id=${order._id} is placed out of spread, this is intentional due to Pw or VWAP correction. Details: ${outOfSpreadString}`);
            } else {
              reasonToClose = outOfSpreadString;
            }
          }
        }

        if (reasonToClose) {
          const cancellation = await orderCollector.clearOrderById(
              order, order.pair, order.side, this.readableModuleName, reasonToClose, reasonObject, traderapi);

          if (!cancellation.isCancelRequestProcessed) {
            updatedLiquidityOrders.push(order);
          }
        } else {
          updatedLiquidityOrders.push(order);
        }
      } catch (e) {
        log.error(`Error in closeLiquidityOrders() of ${moduleName} module: ${e}`);
      }
    }

    return updatedLiquidityOrders;
  },

  /**
   * Places a new depth Liquidity order (purpose: 'liq', subPurpose: 'depth').
   *
   * - Sets the order price within ±mm_liquiditySpreadPercent of the spread midpoint.
   * - Sets the order amount within the depth min–max range.
   * - Checks balances: if insufficient, logs/notifies and returns false.
   * - Ensures limits: does not exceed the Safe Liquidity bid/ask limit.
   *
   * @param {number} totalQtyPlaced Total amount already placed for depth liq-orders:
   *   quote amount for buy-orders, base amount for sell-orders.
   * @param {number} totalOrdersPlaced Total number of depth liq-orders already placed on one side
   * @param {string} orderSide Order side: 'buy' or 'sell'
   * @param {Object} orderBookInfo Order book metrics used to calculate the order price
   * @return {Promise<number|false|undefined>}
   *   Quote amount (buy) or base amount (sell) placed; false if limit reached; undefined on error
   */
  async placeLiquidityOrder(totalQtyPlaced, totalOrdersPlaced, orderSide, orderBookInfo) {
    try {
      const side = orderSide;
      const subPurpose = 'depth';
      const subPurposeString = ' (depth)';

      // Due to the Safe Liquidity mechanism, the bot may shift liquidity between bids and asks.
      // As a result, the actual available liquidity can exceed the initially configured limits.
      const isOverLiquidityOrder = side === 'sell' ?
          totalQtyPlaced > tradeParams.mm_liquiditySellAmount :
          totalQtyPlaced > tradeParams.mm_liquidityBuyQuoteAmount;

      // Set a price for the depth liq-order
      const priceReq = await setPrice(side, orderBookInfo, subPurposeString, isOverLiquidityOrder);
      const price = priceReq.price;
      if (!price) {
        if (priceReq.message) {
          if (Date.now()-lastNotifyPriceTimestamp > constants.HOUR) {
            notify(priceReq.message, 'warn');
            lastNotifyPriceTimestamp = Date.now();
          } else {
            log.log(`${readableModuleName}: ${priceReq.message}`);
          }
        }
        return;
      }

      const coin1Amount = setAmount(side);
      const coin2Amount = coin1Amount * price;
      const lifeTime = setLifeTime();

      let output = '';
      let orderParamsString = '';

      orderParamsString = `side=${side}, pair=${pair}, price=${price}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      if (!side || !price || !coin1Amount || !coin2Amount) {
        log.warn(`${readableModuleName}: Unable to run liq-order${subPurposeString} with params: ${orderParamsString}.`);
        return;
      }

      // Don't exceed Safe Liquidity bid/ask limit for depth liq-orders
      if (side === 'sell') {
        if (coin1Amount + totalQtyPlaced > liqLimits.askLimit) {
          return false;
        }
      } else {
        if (coin2Amount + totalQtyPlaced > liqLimits.bidLimit) {
          return false;
        }
      }

      if (priceReq.message) {
        log.log(`${readableModuleName}: ${priceReq.message}`);
      }

      // Check balances
      const additionalInfo = ` (depth)`;
      const balances = await orderUtils.isEnoughCoins(side, formattedPair, coin1Amount, coin2Amount, 'liq', additionalInfo, this.readableModuleName);
      if (!balances.result) {
        if (balances.message) {
          if (Date.now()-lastNotifyBalancesTimestamp > constants.HOUR) {
            notify(`${config.notifyName}: ${balances.message}`, 'warn', config.silent_mode);
            lastNotifyBalancesTimestamp = Date.now();
          } else {
            log.log(`${readableModuleName}: ${balances.message}`);
          }
        }
        return;
      }

      // Place liq-order

      const orderReq = await traderapi.placeOrder(side, pair, price, coin1Amount, 1, null);

      if (orderReq?.orderId) {
        const { ordersDb } = db;

        /** @type {BotOrderDbRecord} */
        const order = new ordersDb({
          _id: orderReq.orderId,
          date: utils.unixTimeStampMs(),
          dateTill: utils.unixTimeStampMs() + lifeTime,
          purpose: 'liq', // liq: liquidity & spread
          subPurpose,
          subPurposeString,
          side,
          // targetSide: side,
          exchange,
          pair,
          coin1,
          coin2,
          price,
          priceCorrected: priceReq.isCorrected, // If the price is corrected by Pw or VWAP range intentionally, closeLiquidityOrders() will not close the order in case of out of ±% spread
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
          isClosed: false,
        });

        await order.save();

        output = `${side} ${coin1Amount.toFixed(coin1Decimals)} ${coin1} for ${coin2Amount.toFixed(coin2Decimals)} ${coin2} at ${price.toFixed(coin2Decimals)} ${coin2}`;
        log.info(`${readableModuleName}: Successfully placed liq-order${subPurposeString} to ${output}.`);

        return side === 'sell' ? coin1Amount : coin2Amount;
      } else {
        log.warn(`${readableModuleName}: Unable to execute liq-order${subPurposeString} with params: ${orderParamsString}. No order id returned.`);
        return false;
      }
    } catch (e) {
      log.error(`Error in placeLiquidityOrder() of ${moduleName} module: ${e}`);
    }
  },

  /**
   * Delegates to mm_liquidity_safe.updateLiqLimits() and syncs the local liqLimits cache.
   * When mm_liquidity_safe is absent, resets to raw tradeParams amounts (no flowing liquidity).
   */
  async updateLiqLimits() {
    if (safeLiq) {
      await safeLiq.updateLiqLimits();
      liqLimits = safeLiq.getLiqLimits();
    } else {
      // Fallback: use raw parameters without Safe Liquidity
      liqLimits = createDefaultLiqLimits();
    }
  },

  /**
   * Delegates to mm_liquidity_safe.loadLiqLimits() and syncs the local liqLimits cache.
   * When mm_liquidity_safe is absent, initializes liqLimits with raw tradeParams defaults.
   */
  async loadLiqLimits() {
    if (safeLiq) {
      await safeLiq.loadLiqLimits();
      liqLimits = safeLiq.getLiqLimits();
    } else {
      // Fallback: initialize with defaults (Safe Liquidity not available)
      liqLimits = createDefaultLiqLimits();
      log.debug(`${readableModuleName}: mm_liquidity_safe is not loaded. Using raw liquidity limits without Safe Liquidity.`);
    }
  },

  /**
   * Delegates to mm_liquidity_safe.storeLiqLimits().
   * @param {string} callerName The module and function performing the save (for logging)
   */
  async storeLiqLimits(callerName) {
    if (safeLiq) {
      await safeLiq.storeLiqLimits(callerName);
    } else {
      log.debug(`${readableModuleName}: mm_liquidity_safe is not loaded, skipping limit storage called by ${callerName}.`);
    }
  },

  /**
   * Delegates to mm_liquidity_safe.resetLiqLimits() and syncs the local liqLimits cache.
   * When mm_liquidity_safe is absent, resets local liqLimits to raw tradeParams defaults.
   * @param {string} side Side of an order: 'buy', 'sell', or 'both sides'
   * @param {string} callerName The module and function performing the reset (for logging)
   */
  async resetLiqLimits(side, callerName) {
    if (safeLiq) {
      await safeLiq.resetLiqLimits(side, callerName);
      liqLimits = safeLiq.getLiqLimits();
    } else {
      liqLimits = createDefaultLiqLimits();
      log.debug(`${readableModuleName}: Limits for ${side} liq-orders are reset by ${callerName} to initial values (Safe Liquidity not available) – ${JSON.stringify(liqLimits)}.`);
    }

    if (ss) await ss.resetSsVwap();
  },

  /**
   * Returns actual liq-order limits.
   * Used in other modules (mm_trader.js) instead of mm_liquidityBuyQuoteAmount and mm_liquiditySellAmount.
   * @returns {LiqLimits}
   */
  getLiqLimits() {
    return safeLiq ? safeLiq.getLiqLimits() : liqLimits;
  },

  /**
   * Creates a log string with VWAP range.
   * Delegates to mm_liquidity_safe when available.
   * @returns {string} Log string
   */
  getVwapRangeString() {
    if (safeLiq) return safeLiq.getVwapRangeString();

    // Fallback using local liqLimits
    const lowerBound = liqLimits?.boughtVwap?.toFixed(coin2Decimals) || 'NaN';
    const upperBound = liqLimits?.soldVwap?.toFixed(coin2Decimals) || 'NaN';

    return `VWAP range – buying below ${upperBound} ${coin2} and selling above ${lowerBound} ${coin2}.`;
  },

  /**
   * Returns the maximum number of depth liq-orders for one side.
   * Wraps the private getMaxOrderNumberOneSide() for external usage, e.g., in display functions.
   * @param {string} side Order side: 'buy' or 'sell'
   * @param {Object} minOrderAmount Min order amounts from `orderUtils.getMinOrderAmount()`
   * @returns {number} Maximum allowed number of depth liq-orders for the side
   */
  getMaxDepthOrdersOneSide(side, minOrderAmount) {
    return getMaxOrderNumberOneSide(side, minOrderAmount);
  },
};

/**
 * Calculates an order price for a depth liq-order.
 *
 * - The price is set relative to the midpoint of the spread, which depends on mm_liquidityTrend
 * - Price Watcher and the current VWAP range may adjust the final price
 *
 * @param {string} side Order side: 'buy' or 'sell'
 * @param {Object} orderBookInfo Order book info, including average prices for different mm_liquidityTrend values
 * @param {string} subPurposeString Human-readable suffix for logging (always ' (depth)' for this function)
 * @param {boolean} isOverLiquidityOrder When true, indicates an order placed over the initial liquidity limit.
 *   Such orders are moved closer to the spread, regardless of mm_liquiditySpreadPercentMin.
 * @return {Promise<{ price: number, message?: string, isCorrected?: boolean }>}
 *   'price' is the calculated order price; 'message' is a human-readable error message or a note;
 *   'isCorrected' is whether the Pw or VWAP adjusted the price
 */
async function setPrice(side, orderBookInfo, subPurposeString, isOverLiquidityOrder) {
  try {
    let high; let low;
    let targetPrice;
    let message = '';

    /**
     * trendAveragePrice is a price between highestBid and lowestAsk (in spread)
     * middleAveragePrice is randomly ±15% closer to the middle of spread
     * uptrendAveragePrice is randomly <15% closer to lowestAsk
     * downtrendAveragePrice is randomly <15% closer to highestBid
     */

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

    const precision = utils.getPrecision(coin2Decimals);

    // Set coefficients to calculate price bounds (depth orders only)

    let liqKoefMin; let liqKoefMax;
    if (isOverLiquidityOrder) {
      // Place orders over the initial liquidity closer to the spread
      message = `As this ${side} liq-order${subPurposeString} is over the initial liquidity, placing this order closer to the spread:`;
      message += ` the price range changed from ${tradeParams.mm_liquiditySpreadPercentMin || 0}–${tradeParams.mm_liquiditySpreadPercent}% to 0–${constants.OVER_LIQUIDITY_SPREAD_PERCENT}%.`;
      liqKoefMin = 0;
      liqKoefMax = constants.OVER_LIQUIDITY_SPREAD_PERCENT/100;
    } else {
      liqKoefMin = tradeParams.mm_liquiditySpreadPercentMin/100 || 0;
      liqKoefMax = tradeParams.mm_liquiditySpreadPercent/100;
    }

    // Set Pw's and VWAP's ranges

    let price; let pwLowPrice; let pwHighPrice; let vwapLowPrice; let vwapHighPrice;
    let priceBeforePwCorrection; let priceBeforeVwapCorrection;

    const pw = require('./mm_price_watcher');

    if (pw.getIsPriceWatcherEnabled()) {
      const orderInfo = `${side} liq-order${subPurposeString}`;

      if (pw.getIsPriceAnomaly()) {
        log.log(`${readableModuleName}: Skipped placing ${orderInfo}. Price watcher reported a price anomaly.`);

        return {
          price: undefined,
        };
      } else if (pw.getIsPriceActual()) {
        pwLowPrice = pw.getLowPrice();
        pwHighPrice = pw.getHighPrice();
      } else {
        if (pw.getIgnorePriceNotActual()) {
          log.log(`${readableModuleName}: While placing ${orderInfo}, the Price Watcher reported that the price range is not actual. According to settings, ignoring this and treating it as if the Pw is disabled.`);
        } else {
          log.log(`${readableModuleName}: Skipped placing ${orderInfo}. The Price Watcher reported that the price range is not actual.`);

          return {
            price: undefined,
          };
        }
      }
    }

    if (utils.isObjectNotEmpty(liqLimits)) {
      vwapLowPrice = liqLimits.boughtVwap;
      vwapHighPrice = liqLimits.soldVwap;
    }

    // Keep the spread wide enough for in-spread trading
    const delta = tradeParams.mm_isTraderActive && constants.MM_POLICIES_IN_SPREAD_TRADING.includes(tradeParams.mm_Policy) ?
        precision * 3 :
        precision;

    // Calculate a liq-order price and adjust it according to the Pw's range

    if (side === 'sell') {
      low = targetPrice * (1 + liqKoefMin);
      high = targetPrice * (1 + liqKoefMax);
      price = utils.randomValue(low, high);

      if (pwLowPrice && price < pwLowPrice) {
        priceBeforePwCorrection = price;
        price = utils.randomValue(pwLowPrice, pwLowPrice * (1 + liqKoefMax));
      }

      if (vwapLowPrice && price < vwapLowPrice) {
        priceBeforeVwapCorrection = price;
        price = utils.randomValue(vwapLowPrice, vwapLowPrice * (1 + liqKoefMax));
      }

      if (price - delta < orderBookInfo.highestBid) {
        price = orderBookInfo.highestBid + delta;
      }
    } else {
      high = targetPrice * (1 - liqKoefMin);
      low = targetPrice * (1 - liqKoefMax);
      price = utils.randomValue(low, high);

      if (pwHighPrice && price > pwHighPrice) {
        priceBeforePwCorrection = price;
        price = utils.randomValue(pwHighPrice * (1 - liqKoefMax), pwHighPrice);
      }

      if (vwapHighPrice && price > vwapHighPrice) {
        priceBeforeVwapCorrection = price;
        price = utils.randomValue(vwapHighPrice * (1 - liqKoefMax), vwapHighPrice);
      }

      if (price + delta > orderBookInfo.lowestAsk) {
        price = orderBookInfo.lowestAsk - delta;
      }
    }

    if (priceBeforePwCorrection) {
      message += ` Price watcher corrected the price from ${priceBeforePwCorrection.toFixed(coin2Decimals)} ${coin2} to ${price.toFixed(coin2Decimals)} ${coin2} while placing ${side} liq-order${subPurposeString}. ${pw.getPwRangeString()}`;
    }

    if (priceBeforeVwapCorrection) {
      const vwapMessage = ` VWAP corrected the price from ${priceBeforeVwapCorrection.toFixed(coin2Decimals)} ${coin2} to ${price.toFixed(coin2Decimals)} ${coin2} while placing ${side} liq-order${subPurposeString}. ${module.exports.getVwapRangeString()}`;

      message += message ? ` Additionally,${vwapMessage}` : vwapMessage;
    }

    return {
      price,
      message: message.trim(),
      isCorrected: !!message,
    };
  } catch (e) {
    log.error(`Error in setPrice() of ${moduleName} module: ${e}`);

    return {
      price: undefined,
    };
  }
}

/**
 * Returns a random amount for placing a depth liq-order.
 * Min–max intervals are stored in the global `minMaxAmounts.depth`.
 * @param {string} side Side of the order: 'buy' or 'sell'
 * @return {number|undefined} Amount to place the order with
 */
function setAmount(side) {
  try {
    return utils.randomValue(minMaxAmounts.depth[side].min, minMaxAmounts.depth[side].max);
  } catch (e) {
    log.error(`Error in setAmount() of ${moduleName} module: ${e}`);
  }
}

/**
 * Calculates min–max amounts for depth liq-orders on both sides and stores them in `minMaxAmounts.depth`.
 * @param {number} price Price used to convert quote amounts into base amounts
 * @return {boolean} True if values were successfully calculated and saved
 */
function setMinMaxAmounts(price) {
  try {
    minMaxAmounts.depth = {
      buy: {},
      sell: {},
    };

    const minOrderAmount = orderUtils.getMinOrderAmount(price);

    // Calculate min–max amounts for depth orders

    function calcSide(side, limit, price = 1) {
      const orders = getMaxOrderNumberOneSide(side, minOrderAmount);

      const mid = limit / price / orders;
      let max = mid * 1.8;
      let min = mid / 2;

      if (min < minOrderAmount.minReliable) {
        max = minOrderAmount.upperBound;
        min = minOrderAmount.minReliable;
      }

      return { orders, max, min };
    }

    minMaxAmounts.depth.sell = calcSide('sell', liqLimits.askLimit);
    minMaxAmounts.depth.buy = calcSide('buy', liqLimits.bidLimit, price);

    let minMaxAmountsString = `Liquidity: Setting maximum number of depth liq-orders to ${minMaxAmounts.depth.buy.orders} buys and ${minMaxAmounts.depth.sell.orders} sells.`;
    minMaxAmountsString += ` Order amounts are ${minMaxAmounts.depth.buy.min.toFixed(coin1Decimals)}–${minMaxAmounts.depth.buy.max.toFixed(coin1Decimals)} ${coin1} buys`;
    minMaxAmountsString += ` and ${minMaxAmounts.depth.sell.min.toFixed(coin1Decimals)}–${minMaxAmounts.depth.sell.max.toFixed(coin1Decimals)} ${coin1} sells.`;
    log.log(minMaxAmountsString);

    return true;
  } catch (e) {
    log.error(`Error in setMinMaxAmounts() of ${moduleName} module: ${e}`);
  }
}

/**
 * Calculates the maximum number of depth liq-orders for one side.
 * Order count depends on the total Safe Liquidity value converted to USD.
 *
 * @param {string} side Side of the order: 'buy' or 'sell'
 * @param {Object} minOrderAmount Min order amounts from `orderUtils.getMinOrderAmount()`
 * @return {number} Maximum allowed number of depth orders
 */
function getMaxOrderNumberOneSide(side, minOrderAmount) {
  try {
    let liqCoin; let liqValue;

    if (side === 'sell') {
      liqCoin = coin1;
      liqValue = liqLimits.askLimit;
    } else {
      liqCoin = coin2;
      liqValue = liqLimits.bidLimit;
    }

    const minOrderUsd = minOrderAmount.minCoin2Reliable;
    const valueInUSD = exchangerUtils.convertCryptos(liqCoin, 'USD', liqValue).outAmount;

    // Calculate perfect order number
    let n = calcOrderCount(valueInUSD, minOrderUsd) || DEFAULT_MAX_ORDERS_ONE_SIDE;

    // Additionally, reduce the number of orders if an exchange's API applies limits
    const apiOrderNumberLimit = traderapi.features(pair).orderNumberLimit;
    if (apiOrderNumberLimit <= 100) {
      n = Math.ceil(n / 1.8);
    } else if (apiOrderNumberLimit <= 200) {
      n = Math.ceil(n / 1.4);
    }

    return n;
  } catch (e) {
    log.error(`Error in getMaxOrderNumberOneSide() of ${moduleName} module: ${e}`);
    return DEFAULT_MAX_ORDERS_ONE_SIDE;
  }
}

/**
 * Calculates the number of liquidity orders to place based on total liquidity size.
 * The function grows non-linearly (using sqrt(sqrt(value))) to avoid placing too many orders
 * while still scaling with available liquidity.
 *
 * Rules:
 * - Minimum result is always 1 order
 * - The count is capped by how many minimum-size orders can fit into valueInUSD
 * - The nonlinear root function controls smooth, slow growth (ideal 4–8 orders for mid-sized liquidity)
 *
 * Examples:
 *   valueInUSD = 50,     minOrderUsd = 5   →   n = 3
 *   valueInUSD = 100,    minOrderUsd = 5   →   n = 4
 *   valueInUSD = 100000, minOrderUsd = 5   →   n ≈ 18
 *
 * @param {number} valueInUSD Total liquidity available in USD
 * @param {number} [minOrderUsd=5] Minimum order size in USD
 * @return {number} Calculated number of orders (n ≥ 1)
 */
function calcOrderCount(valueInUSD, minOrderUsd = 5) {
  if (!utils.isPositiveOrZeroNumber(valueInUSD)) return;

  // If liquidity is too small to place more than one order
  if (valueInUSD <= minOrderUsd) return 1;

  // Nonlinear growth: sqrt(sqrt(value)) gives smooth, controlled scaling
  const base = Math.sqrt(Math.sqrt(valueInUSD));

  // Upper bound: how many minimal orders can physically fit
  const maxByMin = Math.floor(valueInUSD / minOrderUsd);

  // Final result: at least 1, and not exceeding practical maxByMin
  return Math.max(1, Math.min(maxByMin, Math.ceil(base)));
}

/**
 * Set a random liq-order lifetime
 * @return {number} Pause in ms
 */
function setLifeTime() {
  return utils.randomValue(LIFETIME_MIN, LIFETIME_MAX, true);
}

/**
 * Set a random pause in ms for the next Liquidity iteration
 * @return {number} Pause in ms
 */
function setPause() {
  return utils.randomValue(INTERVAL_MIN, INTERVAL_MAX, true);
}

/**
 * Creates a LiqLimits object with default values from current tradeParams.
 * Initial epoch state: full bid/ask limits, no fills, no VWAP.
 * @returns {LiqLimits}
 */
function createDefaultLiqLimits() {
  return {
    bidLimit: tradeParams.mm_liquidityBuyQuoteAmount,
    askLimit: tradeParams.mm_liquiditySellAmount,
    bidLimitPercent: 100,
    askLimitPercent: 100,
    totalBidFilledAmount: 0,
    totalAskFilledAmount: 0,
    totalBidFilledQuote: 0,
    totalAskFilledQuote: 0,
    soldVwap: 0,
    boughtVwap: 0,
  };
}

// mm_liquidity_safe auto-initializes itself (module.exports.loadLiqLimits() at its bottom).
// Only call loadLiqLimits() here when running without mm_liquidity_safe (plain tradeParams fallback).
if (!safeLiq) module.exports.loadLiqLimits();
