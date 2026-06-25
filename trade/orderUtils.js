/**
 * Helpers for order processing.
 *
 * @module trade/orderUtils
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('../types/bot/checkBalanceReq.d').CheckBalanceRequest} CheckBalanceRequest
 * @typedef {import('types/depth.d').DepthResult} DepthResult
 * @typedef {import('types/assets.d').Result} AssetsResult
 * @typedef {import('types/assets.d').ResultWithTimestamp} AssetsResultWithTimestamp
 * @typedef {import('types/bot/orderMetrics.d.js').FillsByPurposeMap} FillsByPurposeMap
 * @typedef {import('types/bot/orderMetrics.d.js').FillsDbRecord} FillsDbRecord
 * @typedef {import('types/bot/orderMetrics.d').FillOrder} FillOrder
 * @typedef {import('types/bot/ordersDb.d.js').BotOrderDbRecord} BotOrderDbRecord
 * @typedef {import('types/bot/perpetualApi.d.js').GetPerpetualApi} GetPerpetualApi
 */

const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const notify = require('../helpers/notify');
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

const db = require('../modules/DB');
const tradeParams = require('./settings/tradeParams_' + config.exchange);
const balancesHistory = require('../helpers/balancesHistory');

// Optional: modules/perpetualApi.js — loaded via softRequire; used only when config.perpetual is set
const perpetualEnabled = Boolean(config.perpetual);
const perpetualApiModule = './../modules/perpetualApi'; // Optional: omitted in trimmed/free bot builds
/** @type {GetPerpetualApi | undefined} */
const getPerpetualApi = utils.softRequire(perpetualApiModule, __filename);
let perpetualApi;
if (perpetualEnabled && getPerpetualApi) {
  perpetualApi = getPerpetualApi();
}

// Cache is stored for the first trading account only
let openOrdersCached = [];
const openOrdersValidMs = constants.REST_DATA_CACHE_MS;
let orderBookCached = [];
const orderBookCachedValidMs = constants.REST_DATA_CACHE_MS;
let balancesCached = { timestamp: 0, data: [] };
const balancesCachedValidMs = constants.REST_DATA_CACHE_MS;

// Conditions for a falsely empty order list
const SUSPICIOUS_PRICE_DELTA_PERCENT = 20;
const SUSPICIOUS_ORDER_COUNT = 5;
const SUSPICIOUS_TOTAL_USD = config.amount_to_confirm_usd || 500;
const SUSPICIOUS_RECENT_CHECKTIME = 5 * constants.MINUTE;

const lastOrdersSnapshot = {};
let lastNotifyFalsyEmptyOrdersTs = 0;

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

module.exports = {
  readableModuleName: 'orderUtils',

  /**
   * Returns cross-side order direction
   * @param {string} side Order side, 'buy' | 'sell'
   * @return {'buy' | 'sell'}
   */
  crossSide(side) {
    return side === 'buy' ? 'sell' : 'buy';
  },

  /**
   * Returns financial position side using trade side, 'buy' or 'sell' -> 'long' or 'short'
   * @param {string} side Position familiar side, 'buy' | 'sell'
   * @param {boolean} [capitalize=false] long -> Long
   * @return {'long' | 'short' | 'Long' | 'Short'}
   */
  positionSide(side, capitalize = false) {
    if (side === 'buy') {
      return capitalize ? 'Long' : 'long';
    } else {
      return capitalize ? 'Short' : 'short';
    }
  },

  /**
   * Checks if it's enough balances to place an order
   * E.g., Buy 2 BTC for 80,000 USDT on BTC/USDT
   * E.g., Sell 2 BTC for 80,000 USDT on BTCUSDT
   * Works with Spot and Contracts, and the second trading account
   * Note: the function supposes that a pair/contract is valid and exists on exchange, and doesn't check it
   * @param {string} side Order side, 'buy' | 'sell'
   * @param {string | ParsedMarket} pairFp ADM/USDT, ADMUSDT, or formattedPair from parseMarket()
   * @param {number} base (When selling) Check if an account have enough base coin balance, 2 BTC
   * @param {number} quote (When buying) Check if an account have enough quote coin balance, 80000 USDT
   * @param {string} purpose Order purpose, e.g. 'pm', virtual order, 'fill', 'ld2'. For logging and send back message.
   * @param {string} additionalInfo='' E.g., ' to achieve 10.00 USDT price' or ' with 15 ladder index'. With leading space, no ending dot. For logging and send back message.
   * @param {string} callerModuleName For logging
   * @param {Object} [api=traderapi] Exchange API to use; may be a second trade account. If not set, the first spot account will be used.
   * @return {Promise<CheckBalanceRequest>} Returns error message if you want to notify()
   */
  async isEnoughCoins(side, pairFp, base, quote, purpose, additionalInfo = '', callerModuleName, api = traderapi) {
    const logModule = `${moduleName}/${callerModuleName}`;

    let formattedPair;

    if (typeof pairFp === 'string') {
      formattedPair = /** @type {ParsedMarket} */ (this.parseMarket(pairFp));
    } else {
      formattedPair = pairFp;
    }

    const { coin1, coin2, coin1Decimals, coin2Decimals, pair } = formattedPair;

    const onWhichAccount = api.isSecondAccount ? ' on second account' : '';

    const walletType = formattedPair.perpetual ? '__contract' : '__spot';
    const balances = /** @type {AssetsResult} */ (await this.getBalancesCached(false, `${logModule}-isEnoughCoins`, false, walletType, api));

    if (!balances) {
      const errorString = `Unable to receive balances${onWhichAccount} for placing ${purpose}-order on ${pair}${additionalInfo}.`;
      log.warn(`${logModule}: ${errorString}`);

      return {
        result: false,
        message: errorString,
      };
    }

    let isBalanceEnough = true;
    let output = '';

    try {
      const b = utils.balanceHelper(balances, formattedPair);

      let amount; let coin;
      let balanceFree; let balanceFreezed;
      let orderString;

      if (formattedPair.perpetual) {
        if (b.free2 < quote) {
          // Perpetual contracts are always paid in coin2 independent from order side
          // Not enough USDT balance to place ob-order to buy/sell 1 BTC contracts for 40,000 USDT on BTCUSDT
          const baseString = base?.toFixed(coin1Decimals);
          const quoteString = quote.toFixed(coin2Decimals);
          coin = coin2;
          balanceFree = b.free2s;
          balanceFreezed = b.freezed2s;
          orderString = `${purpose}-order to ${side} ${baseString} ${coin1} contracts for ${quoteString} ${coin2} on ${pair}`;

          isBalanceEnough = false;
        }
      } else if (side === 'buy') {
        if (b.free2 < quote) {
          // Not enough USDT balance to place buy tw-order for 40,000 USDT on ADM/USDT
          amount = quote.toFixed(coin2Decimals);
          coin = coin2;
          balanceFree = b.free2s;
          balanceFreezed = b.freezed2s;
          orderString = `${side} ${purpose}-order for ${amount} ${coin} on ${pair}`;

          isBalanceEnough = false;
        }
      } else {
        if (b.free1 < base) {
          // Not enough BTC balance to place 1 BTC sell tw-order
          amount = base.toFixed(coin1Decimals);
          coin = coin1;
          balanceFree = b.free1s;
          balanceFreezed = b.freezed1s;
          orderString = `${amount} ${coin} ${side} ${purpose}-order on ${pair}`;

          isBalanceEnough = false;
        }
      }

      if (!isBalanceEnough) {
        output = `Not enough ${coin} balance${onWhichAccount} to place ${orderString}`;
        output += `${additionalInfo}`;
        output += `. Free: ${balanceFree} ${coin}, frozen: ${balanceFreezed} ${coin}.`;
      }

      return {
        result: isBalanceEnough,
        message: output,
      };
    } catch (e) {
      const errorString = `Unable to process balances${onWhichAccount} for placing ${purpose}-order on ${pair}: ${e}`;
      log.warn(`${logModule}: ${errorString}`);

      return {
        result: false,
        message: errorString,
      };
    }
  },

  /**
   * Returns the minimum order amount in coin1 allowed on the exchange — and the upper bound used for minimal orders.
   * Considers both coin1MinAmount and coin2MinAmount (converted into coin1), depending on what the exchange provides,
   * falling back to defaults defined in config or constants.
   * Works with both Spot and Contracts.
   *
   * @param {number} [price] When provided, calculates the minimum amount for a specific price
   *                         (used when the pair defines `coin2MinAmount`). Optional.
   * @return {{
   *     min: number, minFixed: string,
   *     minReliable: number,
   *     minCoin2: number, minCoin2Fixed: string,
   *     minCoin2Reliable: number,
   *     upperBound: number,
   *   } | undefined }
   *   Minimum amount in coin1, and the upper bound for minimal orders;
   *   Minimum value in coin2,
   *   Reliable values with 10% added on top.
   */
  getMinOrderAmount(price) {
    const exchangerUtils = require('../helpers/cryptos/exchanger');

    try {
      let minOrderAmount;
      let upperBound;

      const formattedPair = /** @type {ParsedMarket} */ (this.parseMarket(config.defaultPair));
      const { coin1, coin2, coin1Decimals, coin2Decimals, pair, isPerpetual } = formattedPair;

      const marketInfo = isPerpetual ?
          perpetualApi?.instrumentInfo(pair) :
          traderapi.marketInfo(pair);

      // Consider both coin1MinAmount and coin2MinAmount defined by the exchange

      const coin1MinAmount = marketInfo?.coin1MinAmount;
      if (utils.isPositiveNumber(coin1MinAmount)) {
        minOrderAmount = coin1MinAmount;
      }

      const coin2MinAmount = marketInfo?.coin2MinAmount;
      if (utils.isPositiveNumber(coin2MinAmount)) {
        let coin1MinAmountCalculated;

        if (utils.isPositiveNumber(price)) {
          coin1MinAmountCalculated = coin2MinAmount / price;
        } else {
          coin1MinAmountCalculated = exchangerUtils.convertCryptos(coin2, coin1, coin2MinAmount).outAmount;
        }

        if (utils.isPositiveNumber(coin1MinAmountCalculated)) {
          if (utils.isPositiveNumber(coin1MinAmount)) {
            minOrderAmount = Math.max(coin1MinAmount, coin1MinAmountCalculated);
          } else {
            minOrderAmount = coin1MinAmountCalculated;
          }
        }
      }

      if (minOrderAmount) {
        upperBound = minOrderAmount * 2;
      } else {
        // Use constants if the exchange doesn't provide min amounts

        const defaultMinOrderAmountUSD =
            config.exchange_restrictions?.minOrderAmountUSD ||
            constants.DEFAULT_MIN_ORDER_AMOUNT_USD;
        minOrderAmount = exchangerUtils.convertCryptos('USD', config.coin1, defaultMinOrderAmountUSD).outAmount;

        const defaultMinOrderAmountUpperBoundUSD =
            config.exchange_restrictions?.minOrderAmountUpperBoundUSD ||
            constants.DEFAULT_MIN_ORDER_AMOUNT_UPPER_BOUND_USD;
        upperBound = exchangerUtils.convertCryptos('USD', config.coin1, defaultMinOrderAmountUpperBoundUSD).outAmount;
      }

      const minCoin2 = exchangerUtils.convertCryptos(coin1, coin2, minOrderAmount).outAmount;

      return {
        min: minOrderAmount,
        minFixed: minOrderAmount?.toFixed(coin1Decimals),
        minReliable: minOrderAmount * 1.1,
        minCoin2,
        minCoin2Fixed: minCoin2?.toFixed(coin2Decimals),
        minCoin2Reliable: minCoin2 * 1.1,
        upperBound,
      };
    } catch (e) {
      log.warn(`Error in getMinOrderAmount() of ${moduleName} module: ${e}.`);
    }
  },

  /**
   * Clears balances, open orders, order book cache
   * Cache is for the first trading account only
   * @param {string} callerName Module & function name for logging
   */
  clearCache(callerName) {
    openOrdersCached = [];
    orderBookCached = [];
    balancesCached = { timestamp: 0, data: [] };

    log.log(`orderUtils: Cache cleared${callerName ? ' by ' + callerName : ''}.`);
  },

  /**
   * Parses a market/contract from string.
   * Retrieves static info for this pair/contract on a specific exchange.
   * If exchange is external, connects and retrieves market info (no socket is used, REST only; contract API is not supported).
   * @param {string} pair String to parse a market/contract, e.g., 'ETH/USDT' ot 'ETHUSDT'
   * @param {string} [exchange] Exchange to request market/contract info. Optional, default to config.exchange.
   * @param {boolean} [noWarn=false] Don't warn if we didn't receive market info. It may be because the getMarkets() is not yet finished.
   * @return { ParsedMarket | boolean} False if errored (pair/contract is not parsed)
   */
  parseMarket(pair, exchange, noWarn = false) {
    const exchangeLc = exchange?.toLowerCase();

    try {
      const isPerpetual = !!utils.isPerpetual(pair);

      if (!pair || (pair.indexOf('/') === -1 && !isPerpetual)) {
        log.warn(`orderUtils/parseMarket: Cannot parse a market pair/contract from the string '${pair}'.`);
        return false;
      }

      if (isPerpetual && !perpetualApi) {
        log.warn(`orderUtils/parseMarket: The pair '${pair}' seems to be a perpetual contract, but perpetual trading is disabled in the config or modules/perpetualApi.js is missing.`);
        return false;
      }

      let pairReadable;
      let perpetual;
      let exchangeApi;

      if (isPerpetual) {
        const formattedPair = perpetualApi.formatPairName(pair);

        pairReadable = formattedPair.pairReadable;

        pair = formattedPair.pairPerpetual;
        perpetual = formattedPair.pairPerpetual;
      } else {
        pair = pair.toUpperCase().trim();
        pairReadable = pair;
      }

      const [coin1, coin2] = pairReadable.split('/');

      if (exchange && exchangeLc !== config.exchange) { // If not a config's exchange, create the exchange instance and fetch markets
        if (isPerpetual) {
          exchangeApi = getPerpetualApi ? getPerpetualApi(exchangeLc) : undefined;

          if (!exchangeApi) {
            log.warn(`orderUtils/parseMarket: Failed to create perpetual API for the ${exchange} exchange.`);
            return false;
          }
        } else {
          exchangeApi = require(`./trader_${exchangeLc}`)(
              null, // API credentials
              null,
              null,
              log, // Same logger
              true, // publicOnly, no private endpoints
              undefined, // loadMarket, usually true by default
              false, // Don't connect socket
              false, // Don't connect socket
              undefined, // Use accountNo by default
              coin1, // DEX connectors may use this to fetch the market info
              coin2,
          ); // Fetching market info in the constructor
        }
      } else { // The same exchange as in the config
        exchange = config.exchangeName;
        exchangeApi = isPerpetual ?
            perpetualApi :
            traderapi;
      }

      const marketInfoSupported = isPerpetual ?
          exchangeApi.features().getInstruments :
          exchangeApi.features().getMarkets;

      let marketInfo;
      if (marketInfoSupported) {
        // Warn: It's not possible to get market/contract info for a newly initialized exchange, as it takes time to fetch markets/instruments
        marketInfo = isPerpetual ?
            exchangeApi.instrumentInfo(pair) :
            exchangeApi.marketInfo(pair);
      }

      let isParsed = false;
      let coin1Decimals = 8; let coin2Decimals = 8; // Fallback in case if we can't find the market

      if (marketInfo) {
        coin1Decimals = marketInfo.coin1Decimals;
        coin2Decimals = marketInfo.coin2Decimals;
        isParsed = true;
      } else if (marketInfoSupported && !noWarn) {
        log.warn(`orderUtils/parseMarket: Cannot get info about the ${pair} market/contract on the ${exchange} exchange. Returning default values for decimal places.`);
      }

      const coin2DecimalsForStable = utils.isStableCoin(coin2) ?
          Math.min(coin2Decimals, 4) :
          coin2Decimals;

      return {
        pair, // Spot trading pair (e.g., `ADM/USDT`) or perpetual contract ticker (e.g., `ADMUSDT`)
        pairReadable,
        isPerpetual,
        perpetual, // Perpetual contract ticker (e.g., `ADMUSDT`). If the market is not a perpetual contract, the value is `undefined`.
        coin1,
        coin2,
        coin1Decimals, // Fallback to 8 in case if we can't find the market
        coin2Decimals, // Fallback to 8 in case if we can't find the market
        coin2DecimalsForStable, // 13.5578 USDT instead of excessive 13.55787133 USDT (don't use it for price!)
        isParsed,
        marketInfoSupported,
        exchangeApi,
        isReversed: marketInfo?.isReversed,
      };
    } catch (e) {
      log.warn(`Error in parseMarket() of ${moduleName} module: ${e}.`);
      return false;
    }
  },

  /**
   * A general function to place an order and store it in the database
   * It's called by /buy, /sell, fill commands and Price Maker (with NOW option)
   * Works both for Spot and Contracts
   * Note: the function supposes that a pair/contract is valid and exists on exchange, and doesn't check it
   * Also, all other params are expected to be correct, including a set of price, coin1Amount and coin2Amount
   * If price is set, the function calculates coin1Amount from coin2Amount and vice versa
   * @param {'buy' | 'sell'} orderSide Order side
   * @param {string} pairRaw BTC/USDT for spot or BTCUSDT for perpetual
   * @param {number} price Order price, required for limit orders
   * @param {number} coin1Amount Base coin quantity. May be omitted if coin2Amount is set.
   * @param {1 | 0} limit 1 for limit order, 0 for market order
   * @param {number} [coin2Amount] Quote coin quantity. May be omitted if coin1Amount is set.
   * @param {string} [purpose='man'] Order purpose to store in the database
   * @param {Object} [api=traderapi] Exchange API to use; may be a second trade account. If not set, the first account will be used.
   * @param {{
   *    reduceOnly?: Boolean,
   *    timeInForce?: String,
   *    takeProfitPrice?: Number,
   *    stopLossPrice?: Number,
   *    smpType?: String,
   * }} [perpetualOptions] Options for perpetual contract order
   * @return {Promise<Object | { message: string } | undefined>} A database record for a placed orders
   */
  async addGeneralOrder(
      orderSide,
      pairRaw,
      price,
      coin1Amount,
      limit,
      coin2Amount,
      purpose = 'man',
      api = traderapi,
      perpetualOptions,
  ) {
    try {
      const formattedPair = /** @type {ParsedMarket} */ (this.parseMarket(pairRaw));
      const { pair, coin1, coin2, coin1Decimals, coin2Decimals, isPerpetual } = formattedPair;

      let whichAccount = ''; let whichAccountMsg = ''; let isSecondAccountOrder;

      if (api.isSecondAccount && !isPerpetual) {
        isSecondAccountOrder = true;

        whichAccount = ' (using second account)';
        whichAccountMsg = '(_Using the second account_) ';
      }

      // Logging parameters

      let orderParamsString = `side=${orderSide}, limit=${limit}, pair=${pairRaw}, price=${limit ? price : 'Market'}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;

      if (isPerpetual) {
        orderParamsString += `, reduceOnly=${perpetualOptions?.reduceOnly}, takeProfitPrice=${perpetualOptions?.takeProfitPrice}, stopLossPrice=${perpetualOptions?.stopLossPrice}, timeInForce=${perpetualOptions?.timeInForce}, smpType=${perpetualOptions?.smpType}`;
      }

      log.log(`orderUtils: Placing the order${whichAccount} of ${orderParamsString}…`);

      // Calculate coin1Amount from coin2Amount and vice versa, if price is set

      // Store coin1Amount and coin2Amount even in case of Market order (estimated)
      // It's to calculate statistics
      let amountEstimated;
      let quoteEstimated;

      const exchangerUtils = require('../helpers/cryptos/exchanger');

      if (!coin1Amount) {
        if (price) {
          coin1Amount = coin2Amount / price;
        } else {
          amountEstimated = exchangerUtils.convertCryptos(coin2, coin1, coin2Amount).outAmount || null;
        }
      }

      if (!coin2Amount) {
        if (price) {
          coin2Amount = coin1Amount * price;
        } else {
          quoteEstimated = exchangerUtils.convertCryptos(coin1, coin2, coin1Amount).outAmount || null;
        }
      }

      const orderReq = isPerpetual ?
          await perpetualApi.placeOrder(orderSide, pair, price, coin1Amount, limit ? 'limit' : 'market', perpetualOptions?.reduceOnly, perpetualOptions?.takeProfitPrice, perpetualOptions?.stopLossPrice, perpetualOptions?.timeInForce, perpetualOptions?.smpType) :
          await api.placeOrder(orderSide, pair, price, coin1Amount, limit, coin2Amount);

      if (orderReq?.orderId) {
        const { ordersDb } = db;

        const order = new ordersDb({
          _id: orderReq.orderId,
          date: utils.unixTimeStampMs(),
          purpose,
          side: orderSide,
          exchange: config.exchange,
          pair,
          coin1,
          coin2,
          price: limit ? price : 'Market',
          coin1Amount: coin1Amount || amountEstimated,
          coin2Amount: coin2Amount || quoteEstimated,
          coin1AmountFilled: undefined,
          coin2AmountFilled: undefined,
          coin1AmountLeft: coin1Amount || amountEstimated,
          coin2AmountLeft: coin2Amount || quoteEstimated,
          isCoin1AmountEstimated: !coin1Amount,
          isCoin2AmountEstimated: !coin2Amount,
          LimitOrMarket: limit, // 1 for limit price. 0 for Market price.
          ...perpetualOptions,
          isProcessed: false, // Man-orders are not processed initially as well; orderCollector and orderStats may call updateOrders() to process them later
          isExecuted: false, // Limit orders are marked as executed when they fill; Market orders are immediately executed, but we can't be sure that the order was actually executed or cancelled
          isCancelled: false,
          isSecondAccountOrder,
          message: whichAccountMsg + orderReq?.message,
        });

        await order.save();

        // Log order information

        let output;

        const amountString = coin1Amount?.toFixed(coin1Decimals);
        const quoteString = coin2Amount?.toFixed(coin2Decimals);
        const priceString = price?.toFixed(coin2Decimals);

        if (limit) {
          // buy 100 ADM for 1000 USDT at 10 USDT price
          // sell 100 ADM for 10 USDT at 10 USDT price
          output = `${orderSide} ${amountString} ${coin1} for ${quoteString} ${coin2} at ${priceString} ${coin2} price`;
        } else {
          if (coin2Amount) {
            // buy ADM for 1000 USDT at Market price
            // sell ADM for 1000 USDT at Market price
            output = `${orderSide} ${coin1} for ${quoteString} ${coin2} at Market Price`;
          } else {
            // buy 100 ADM at Market price
            // sell 100 ADM at Market price
            output = `${orderSide} ${amountString} ${coin1} at Market Price`;
          }
        }

        log.info(`orderUtils: Successfully placed ${purpose}-order${whichAccount} to ${output} on ${pair}.`);

        return order;
      } else {
        const details = orderReq?.message ? ` [${utils.trimAny(orderReq?.message, ' .')}].` : ' { No details }.';

        log.warn(`orderUtils: Unable to place ${purpose}-order${whichAccount} with params: ${orderParamsString}.${details}`);

        return {
          message: whichAccountMsg + orderReq?.message,
        };
      }
    } catch (e) {
      log.error(`Error in addGeneralOrder() of ${moduleName} module: ${e}`);
    }
  },

  /**
   * If we don’t fully trust the exchange API,
   * It may sometimes return a falsely empty order list `[]` even when orders actually exist on the exchange.
   *
   * This function performs an additional verification to decide whether we should:
   * - trust the empty order list and continue normal processing, or
   * - treat it as a likely API failure and keep local orders unchanged, or
   * - enter a SAFE mode and pause trading.
   *
   * Process:
   * 1. Analyze the current local orders `dbOrders`:
   *    - detect whether there are both buy and sell orders,
   *    - measure the price delta between the farthest buy/sell orders,
   *    - calculate the total notional value of the orders in USD,
   *    - read the last known snapshot for this pair (time and number of orders).
   * 2. Based on this data, decide whether individual order re-checks are needed (`shouldRecheckOrdersIndividually`), for example when:
   *    - the API is marked as "dontTrustApi", or
   *    - there is a large price delta, or
   *    - there are many orders with a large total notional, or
   *    - a lot of orders were present on the previous check not long ago.
   * 3. If individual re-checks are needed and the exchange provides `getOrderDetails()`:
   *    - for each local order (skipping virtual orders and orders from other API keys),
   *      call `api.getOrderDetails(orderId, pair)`;
   *    - if any order still has status 'new' or 'part_filled', or no status is returned,
   *      consider the empty order list result to be false-positive and fill `falseResultDetails`.
   * 4. If `falseResultDetails` is set:
   *    - the caller should keep `dbOrders` unchanged,
   *    - send a high-priority notification,
   *    - and re-try fetching a correct order list on the next iteration.
   * 5. If we couldn’t verify the result, but the situation still looks highly suspicious
   *    (many orders on both sides, large price delta, recent snapshot with many orders),
   *    `shouldEnterSafeMode` is set to `true`, and the caller may pause all trading modules
   *    until manual intervention.
   *
   * @param {Object[]} dbOrdersOpened Local orders database. Excludes ld-orders which are not in open states. The function does not modify the orders themselves, but analyses them to decide how risky the situation is.
   * @param {ParsedMarket} formattedPair Parsed market information, spot or perpetual
   * @param {Object} api Exchange API instance to use; may represent the main or a secondary spot account, or perpetual account
   * @param {string} purposeSuffix Suffix used to access the correct record in `lastOrdersSnapshot`. E.g., `ld2-` results in key `ETHUSDTld2-`.
   * @return {Promise<{falseResultDetails: string | undefined, shouldEnterSafeMode: boolean}>}
   *         - `falseResultDetails`: non-empty string if the exchange most likely returned a
   *           falsely empty order list (based on `getOrderDetails()` checks). In this case,
   *           the caller should keep `dbOrders` unchanged and notify.
   *         - `shouldEnterSafeMode`: `true` if we were unable to prove the API failure, but
   *           there is a strong suspicion that the empty order list is unreliable. In this case,
   *           the caller may pause trading until manual review.
   */
  async verifyEmptyOrderList(dbOrdersOpened, formattedPair, api, purposeSuffix) {
    const paramString = `dbOrdersOpened-length: ${dbOrdersOpened.length}, pair: ${formattedPair.pair}, purposeSuffix: ${purposeSuffix}, api-isPerpetual: ${api.isPerpetual}, api-isSecondAccount: ${api.isSecondAccount}`;

    let falseResultDetails;
    let shouldEnterSafeMode;

    try {
      log.log(`orderUtils: Verifying whether the exchange correctly returned an empty order list → and whether the ${dbOrdersOpened.length} locally stored ${purposeSuffix}orders are actually filled…`);

      const buyOrders = dbOrdersOpened.filter((o) => o.side === 'buy');
      const sellOrders = dbOrdersOpened.filter((o) => o.side === 'sell');

      const hasBothSides = buyOrders.length > 0 && sellOrders.length > 0;

      let hasBigPriceDelta = false;

      if (hasBothSides) {
        const maxSell = Math.max(...sellOrders.map((o) => o.price));
        const minBuy = Math.min(...buyOrders.map((o) => o.price));
        hasBigPriceDelta = utils.numbersDifferencePercent(minBuy, maxSell) > SUSPICIOUS_PRICE_DELTA_PERCENT;
      }

      const orderCount = dbOrdersOpened.length;
      const totalQuote = dbOrdersOpened.reduce((sum, o) => sum + (o.coin2AmountLeft || o.coin2Amount || 0), 0);

      const exchangerUtils = require('../helpers/cryptos/exchanger');
      const totalUsd = exchangerUtils.convertCryptos(formattedPair.coin2, 'USD', totalQuote).outAmount;

      const hasManyOrders = orderCount > SUSPICIOUS_ORDER_COUNT;
      const hasBigNotional = totalUsd > SUSPICIOUS_TOTAL_USD;

      const lastSnapshot = lastOrdersSnapshot[formattedPair.pair + purposeSuffix] || { ts: 0, count: 0 };
      const wasRecentlyChecked = Date.now() - lastSnapshot.ts <= SUSPICIOUS_RECENT_CHECKTIME;
      const hadManyOrdersLastTime = lastSnapshot.count > SUSPICIOUS_ORDER_COUNT;

      const shouldRecheckOrdersIndividually =
          api.features().dontTrustApi ||
          (hasBothSides && hasBigPriceDelta) ||
          (hasManyOrders && hasBigNotional) ||
          (wasRecentlyChecked && hadManyOrdersLastTime);

      if (shouldRecheckOrdersIndividually) {
        if (api.getOrderDetails) {
          log.log(`orderUtils: Received an empty order list from the ${config.exchangeName} API while we have ${dbOrdersOpened.length} ${purposeSuffix}orders stored locally. Verifying orders one by one, since we don’t fully trust the exchange API…`);

          for (const dbOrder of dbOrdersOpened) {
            if (
              !dbOrder.isVirtual && // Skip virtual ld-orders that are not created
              (!dbOrder.apikey || dbOrder.apikey === config.apikey) // Skip orders that were placed with other API keys
            ) {
              const orderDetails = await api.getOrderDetails(dbOrder._id, dbOrder.pair);
              const orderStatus = orderDetails?.status;

              /**
               * Checking possible order statuses:
               *   - 'new', 'part_filled', or no `orderStatus` → API failure, do not trust the result
               *   - 'filled', 'cancelled' → an empty order list is still possible
               *   - 'unknown' → the order does not exist or the orderId is wrong → an empty order list is still possible
               */

              if (!orderStatus) {
                falseResultDetails = `No status received for order ${dbOrder._id}; the exchange API may be experiencing issues. Request result: ${JSON.stringify(orderDetails)}`;
                break;
              }

              if (['new', 'part_filled'].includes(orderStatus)) {
                falseResultDetails = `Order ${dbOrder._id} real status is '${orderStatus}'`;
                break;
              }
            }
          }
        } else {
          log.warn(`orderUtils: Received an empty order list from the ${config.exchangeName} API while we have ${dbOrdersOpened.length} ${purposeSuffix}orders stored locally. However, we are unable to verify this because the exchange does not provide a getOrderDetails() method.`);
        }
      }

      shouldEnterSafeMode =
          // hasBigNotional doesn't matter
          !falseResultDetails &&
          hasBothSides &&
          hasBigPriceDelta &&
          hasManyOrders &&
          wasRecentlyChecked &&
          hadManyOrdersLastTime;
    } catch (e) {
      log.error(`Error in verifyEmptyOrderList(${paramString}) of ${moduleName} module: ${e}`);
    }

    return {
      // Whether the exchange returned a falsely empty order list (verified using `getOrderDetails()`).
      // In this case, skip further `updateOrders()` processing, send a notification,
      // and re-try fetching a correct order list on the next iteration.
      // String containing order check details.
      falseResultDetails,
      // Unable to verify whether the empty order list is false-positive,
      // but there is strong suspicion it is. Notify and pause all bot modules.
      shouldEnterSafeMode,
    };
  },

  /**
   * Updates the bot's local orders database (dbOrders), regardless of purpose.
   * If `callerModuleName` is provided, it may contain the purpose for logging.
   *
   * Process:
   * - Iterates through all orders in local dbOrders and compares them with current exchange orders
   * - If an order is found → updates its status
   * - If an order is not found → means cancelled or filled, but we always consider it filled. Removes it from the local database (and cautiously try to cancel it on the exchange).
   * - Stores all order fills in fillsDb
   *
   * Note: This method does not close or cancel ld-orders, since they may be stored locally as 'Not opened' but not actually exist on the exchange.
   * The Ladder module handles missing ld-orders on its own.
   * Pay attention to `hideNotOpened` parameter.
   * Note: The trading pair/contract is valid and exists on the exchange. This function does not validate the pair/contract itself.
   *
   * @param {Object[]} dbOrders Local orders database. The function modifies it, e.g., with new order states and filled amounts.
   * @param {string} pairRaw BTC/USDT for spot or BTCUSDT for perpetual
   * @param {string} callerModuleName Name of the module (and order purpose), which requests the method. E.g., 'mm_ladder.js(2):ld2-'. For logging only.
   * @param {boolean} [noCache=false] If true, get fresh open order data, not cached
   * @param {Object} [api=traderapi] API instance to use: spot (first or second account) or perpetual. Defaults to the first spot API.
   * @param {boolean} [hideNotOpened=true] Hide ld-orders in [Not opened, Filled, Cancelled, Missed, To be removed, Removed] states
   * @return {Promise<Object[]>} Updated local orders database `updatedOrders`, with or without details
  */
  async updateOrders(dbOrders, pairRaw, callerModuleName, noCache = false, api = traderapi, hideNotOpened = true) {
    const paramString = `dbOrders-length: ${dbOrders.length}, pair: ${pairRaw}, moduleName: ${callerModuleName}, noCache: ${noCache}, api-isPerpetual: ${api.isPerpetual}, api-isSecondAccount: ${api.isSecondAccount}, hideNotOpened: ${hideNotOpened}`;
    const formattedPair = /** @type {ParsedMarket} */ (this.parseMarket(pairRaw));
    const { pair, coin1, coin2, coin1Decimals, coin2Decimals } = formattedPair;

    let updatedOrders = [];

    const orderCollector = require('./orderCollector');

    // Create initial fills structure to update it later
    // Info about partly and fully filled orders
    // Used in Liquidity module to protect from balance depleting

    const orderPurposes = orderCollector.orderPurposes;
    // Optional: helpers/fillsEngine.js — when omitted, order sync still runs but fillsDb/VWAP are not updated
    const fillsEngine = utils.softRequire('../helpers/fillsEngine', __filename);

    /** @type {FillsByPurposeMap} */
    const fills = Object.keys(orderPurposes).reduce((acc, purpose) => {
      acc[purpose] = fillsEngine ?
        fillsEngine.emptyFill() :
        {
          partlyFilledOrders: [],
          filledOrders: [],
          buyFilledAmount: 0,
          sellFilledAmount: 0,
          buyFilledQuote: 0,
          sellFilledQuote: 0,
        };
      return acc;
    }, {});

    let ldFilledCountBuy = 0;
    let ldFilledCountSell = 0;

    let samePurpose; // If all orders have the same purpose, e.g., 'ld', callerModuleName receives value like 'Ladder:ld-' and 'ld2' like 'mm_ladder.js(2):ld2-'
    [callerModuleName, samePurpose = ''] = callerModuleName.split(':');

    const parsedPurpose = orderCollector.parsePurpose(samePurpose.replace('-', ''));
    const moduleIndexString = parsedPurpose.moduleIndexString || ''; // For logging like ld2-orders

    let exchangeOrdersCount;

    try {
      const onWhichAccount = api.isSecondAccount ? ' (on second account)' : '';
      const exchangeOrders = await this.getOpenOrdersCached(pair, `${moduleName}/${callerModuleName}`, noCache, api);

      exchangeOrdersCount = exchangeOrders?.length;
      log.log(`orderUtils: Updating ${dbOrders.length} ${samePurpose}dbOrders on ${pair} for ${callerModuleName}, noCache: ${noCache}, hideNotOpened: ${hideNotOpened}… Received ${exchangeOrdersCount} orders from the exchange.`);

      if (!exchangeOrders) {
        log.warn(`orderUtils: Unable to get ${pair} exchangeOrders${onWhichAccount} in updateOrders(), keeping ${samePurpose}dbOrders unchanged.`);
        return dbOrders;
      }

      // We do not fully trust the exchange API. If it returns an empty order list, verify that the response is not false.

      const dbOrdersOpened = dbOrders.filter((order) => order.purpose !== 'ld' || constants.LADDER_OPENED_STATES.includes(order.ladderState));
      const isSuspiciousEmptyResult = dbOrdersOpened.length > 0 && exchangeOrdersCount === 0;

      if (isSuspiciousEmptyResult) {
        const verification = await this.verifyEmptyOrderList(dbOrdersOpened, formattedPair, api, samePurpose);
        const { falseResultDetails, shouldEnterSafeMode } = verification;

        if (falseResultDetails) {
          const falseResultString = `It seems the ${config.exchangeName} API returned a falsely empty order list: ${falseResultDetails}`;

          log.warn(`orderUtils: ${falseResultString}. Keeping ${samePurpose}dbOrders unchanged.`);

          if (Date.now()-lastNotifyFalsyEmptyOrdersTs > 5 * constants.MINUTE) {
            notify(`${config.notifyName}: ${falseResultString}. If the issue is temporary, the bot resolves it automatically without your involvement. Logs contain more details. (This notification won't repeat more often than every 5 minutes.)`, 'warn', undefined, true); // Priority notification
            lastNotifyFalsyEmptyOrdersTs = Date.now();
          }

          return dbOrders;
        } else if (shouldEnterSafeMode) {
          log.error(`orderUtils: Exchange API returned a suspicious empty order list. Local records contain many orders on both sides, the price delta is significant, and the recent snapshot also includes multiple orders.`);

          const commandTxs = require('../modules/commandTxs');

          let details = `The ${config.exchangeName} API returned a suspicious empty order list. To prevent unexpected behavior, the bot has been stopped as a safety measure. `;
          details += `It may happen due to an unhandled exchange API failure, or if you cancelled orders manually via the exchange UI, or if the bot was inactive for a long time and market conditions changed significantly`;

          commandTxs.commands.emergencyStop('orderUtils', details);

          return dbOrders;
        } else {
          log.log(`orderUtils: Empty order list is a valid response from the exchange, and ${dbOrdersOpened.length} ${samePurpose}dbOrders are likely filled.`);
        }
      }

      // Loop through all orders in local dbOrders and compare them with current exchange orders
      // Note: ld-orders are not sorted by ladderIndex, which does not affect functionality

      for (const dbOrder of dbOrders) {
        const purposeIndexed = `${dbOrder.purpose}${dbOrder.moduleIndex > 1 ? dbOrder.moduleIndex : ''}`; // E.g., 'ld2' or 'man'
        const orderInfoString = `${purposeIndexed}-order${dbOrder.subTypeString || dbOrder.subPurposeString || ''}${onWhichAccount} with params: id=${dbOrder._id}, side=${dbOrder.side}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount} (${dbOrder.coin1AmountLeft} left), coin2Amount=${dbOrder.coin2Amount}`;

        let isOrderFound = false;

        const coin1AmountBeforeIteration = dbOrder.coin1AmountLeft ?? dbOrder.coin1Amount;

        for (const exchangeOrder of exchangeOrders) {
          if (dbOrder._id?.toString() === exchangeOrder.orderId?.toString()) { // While dbOrders stores IDs in native format (can be number), getOpenOrders always returns ids as strings
            isOrderFound = true;

            switch (exchangeOrder.status) {
              // Possible values: new, part_filled

              case 'part_filled':
                // Update order's filled amounts and `fills` object

                if (coin1AmountBeforeIteration > exchangeOrder.amountLeft) {
                  if (dbOrder.purpose === 'ld') {
                    dbOrder.update({
                      ladderState: 'Partly filled',
                    });
                  }

                  await dbOrder.update({
                    isExecuted: true,
                    coin1AmountFilled: exchangeOrder.amountExecuted,
                    coin1AmountLeft: exchangeOrder.amountLeft,
                    // Update coin2 amounts when price is known (limit orders)
                    ...(utils.isPositiveNumber(dbOrder.price) && {
                      coin2AmountFilled: exchangeOrder.amountExecuted * dbOrder.price,
                      coin2AmountLeft: exchangeOrder.amountLeft * dbOrder.price,
                    }),
                    amountUpdateCount: (dbOrder.amountUpdateCount || 0) + 1,
                  }, true);

                  const coin1AmountFilled = coin1AmountBeforeIteration - dbOrder.coin1AmountLeft;
                  // Record the partial fill information in fillsDb, later fills may be processed via fillsEngine.processFills()
                  // To calculate VWAP/fill stats
                  if (fillsEngine) {
                    fillsEngine.addFill(fills[dbOrder.purpose], dbOrder, 'partlyFilledOrders', coin1AmountFilled);
                  }

                  const filledPercent = (dbOrder.coin1AmountFilled / dbOrder.coin1Amount * 100).toFixed(2);
                  log.log(`orderUtils: Updating ${orderInfoString}. It's partly filled ${utils.inclineNumber(dbOrder.amountUpdateCount)} time: ${coin1AmountBeforeIteration} -> ${dbOrder.coin1AmountLeft} ${dbOrder.coin1} (${filledPercent}% filled${dbOrder.amountUpdateCount > 1 ? ' in total' : ''}).`);
                }

                break;
              case 'new':
                break;
              default:
                break;
            }
          }
        }

        // An order is found, keep it

        if (isOrderFound) {
          updatedOrders.push(dbOrder);
          continue;
        }

        // When we are here, the order is missing in exchangeOrders:
        //   - Check that it's not a ld-order stub
        //   - Treat it as filled and record the fill information in fillsDb
        //   - Remove it from the local database (and cautiously attempt to cancel it on the exchange,
        //     except for ld-orders, which are handled separately by the Ladder module)

        let isOrderFilled;

        if (dbOrder.purpose === 'ld') {
          // Ladder orders are a special case, and the Ladder module performs an extra check to confirm whether the order is truly filled

          const previousState = dbOrder.ladderState;

          if (constants.LADDER_OPENED_STATES.includes(previousState)) {
            dbOrder.update({
              ladderBeforeFilledState: previousState, // 'Open' or 'Partly filled'
              ladderFlaggedFilledTs: Date.now(),
              ladderState: 'Filled',
            });

            dbOrder.side === 'buy' ? ldFilledCountBuy++ : ldFilledCountSell++;

            isOrderFilled = true;

            log.info(`orderUtils: Changing ladder state of ${orderInfoString} from ${previousState} to ${dbOrder.ladderState}. Ladder index: ${dbOrder.ladderIndex}. Unable to find it in exchangeOrders — considering it filled. The Ladder module will verify and handle it next.`);

            await dbOrder.save();
          } else {
            isOrderFilled = false;

            log.debug(`orderUtils: Did not find ${orderInfoString}. This is expected for a ladder order in state ${dbOrder.ladderState}${dbOrder.ladderNotPlacedReason ? ' (' + dbOrder.ladderNotPlacedReason + ')' : ''}. Ladder index: ${dbOrder.ladderIndex}.`);
          }

          updatedOrders.push(dbOrder); // Keep all ld-orders here; filtering is handled below
        } else {
          // All other order purposes except Ld: Treat the order as filled
          // Even if the order is already closed on the exchange, try to cancel it to avoid leaving it as `unknown`

          const reasonToClose = 'Unable to find it in exchangeOrders — considering it filled';
          const reasonObject = {
            isNotFound: true,
          };

          // Any processed cancellation marks an order as isProcessed & isClosed; successful cancellation also marks it as isCancelled
          const cancellation = await orderCollector.clearOrderById(
              dbOrder, dbOrder.pair, dbOrder.side, this.readableModuleName, reasonToClose, reasonObject, api);

          if (cancellation.isOrderCancelled) {
            isOrderFilled = true;

            log.info(`orderUtils: Unable to find ${orderInfoString} in exchangeOrders. Although the cautious cancellation request was reported as successful, we still count it as filled — some exchanges respond this way even for already filled orders.`);
          } else if (cancellation.isCancelRequestProcessed) {
            isOrderFilled = true;

            log.info(`orderUtils: Considering the ${orderInfoString} as filled.`);
          } else {
            isOrderFilled = false;

            updatedOrders.push(dbOrder);

            log.warn(`orderUtils: Unable to find ${orderInfoString} in exchangeOrders. Keeping it in ordersDb until next time because the cautious cancellation request failed.`);
          }
        }

        if (isOrderFilled) {
          // Record the fill information in fillsDb, later fills may be processed via fillsEngine.processFills()
          // To mark orders as isExecuted (verify fill via API) and calculate VWAP/fill stats
          if (fillsEngine) {
            fillsEngine.addFill(fills[dbOrder.purpose], dbOrder, 'filledOrders', coin1AmountBeforeIteration);
          }
        }
      } // for (const dbOrder of dbOrders)
    } catch (e) {
      log.error(`Error in updateOrders(${paramString})-1 of ${moduleName} module: ${e}`);
      log.warn(`orderUtils: Because of an error in updateOrders(), returning ${samePurpose}dbOrders before processing is finished. The result set may be partially modified.`);

      return dbOrders;
    }

    // At this point, updatedOrders is populated from dbOrders.
    // The new updated set includes only orders that exist on the exchange, plus non-existent ld-orders as a special case.

    try {
      // Include non-existent ld-orders in the result, or filter them out,
      // Depending on the `hideNotOpened` parameter

      const orderCountAll = updatedOrders.length;
      const updatedOrdersOpened = updatedOrders.filter((order) => order.purpose !== 'ld' || constants.LADDER_OPENED_STATES.includes(order.ladderState));
      const orderCountOpened = updatedOrdersOpened.length;
      const orderCountHidden = orderCountAll - orderCountOpened;

      let openOrdersString = '';
      const andFilledLdString = ldFilledCountBuy || ldFilledCountSell ? ' & filled' : '';

      if (hideNotOpened) {
        if (orderCountHidden > 0) {
          updatedOrders = updatedOrdersOpened;
          openOrdersString = ` (${orderCountHidden} not placed${andFilledLdString} ld${moduleIndexString}-orders are hidden)`;
        }
      } else {
        if (orderCountHidden > 0) {
          openOrdersString = ` (including ${orderCountHidden} not placed${andFilledLdString} ld${moduleIndexString}-orders)`;
        }
      }

      // Store non-empty fills data for this specific updateOrders() call

      Object.keys(fills).forEach((purpose) => {
        if (purpose !== 'all') {
          fills[purpose].partlyFilledOrders.forEach((order) => fills['all'].partlyFilledOrders.push(order));
          fills[purpose].filledOrders.forEach((order) => fills['all'].filledOrders.push(order));
          fills['all'].buyFilledAmount += fills[purpose].buyFilledAmount;
          fills['all'].sellFilledAmount += fills[purpose].sellFilledAmount;
          fills['all'].buyFilledQuote += fills[purpose].buyFilledQuote;
          fills['all'].sellFilledQuote += fills[purpose].sellFilledQuote;
        }
      });

      if (fillsEngine) {
        for (const purpose in fills) {
          const purposeFills = fills[purpose];
          await fillsEngine.addFillsDbRecord({
            purpose,
            callerModuleName,
            noCache,
            dbOrdersCount: dbOrders.length,
            exchangeOrdersCount,
          }, purposeFills, api);
        }
      }

      // Log results

      let logString = `orderUtils: ${samePurpose}dbOrders updated for ${callerModuleName} with ${updatedOrders.length} live orders${openOrdersString} on ${pair}.`;

      if (fills['all'].filledOrders.length > 0) {
        logString += ` ${fills['all'].filledOrders.length} orders filled.`;
      }

      if (fills['all'].partlyFilledOrders.length > 0) {
        logString += ` ${fills['all'].partlyFilledOrders.length} orders partially filled.`;
      }

      if (fills['all'].filledOrders.length > 0 || fills['all'].partlyFilledOrders.length > 0) {
        logString += ` Asks are filled with ${fills['all'].sellFilledAmount?.toFixed(coin1Decimals)} ${coin1} (${fills['all'].sellFilledQuote?.toFixed(coin2Decimals)} ${coin2})`;
        logString += ` and bids with ${fills['all'].buyFilledAmount?.toFixed(coin1Decimals)} ${coin1} (${fills['all'].buyFilledQuote?.toFixed(coin2Decimals)} ${coin2}).`;
      }

      log.log(logString);

      // Warn if most ladder orders are filled

      const ladderCount = tradeParams[`mm_ladderCount${moduleIndexString}`]; // One side ld-order count

      if (ladderCount) {
        const ldFilledWarning = [];

        if (ldFilledCountBuy / ladderCount > 0.5) {
          ldFilledWarning.push(`${ldFilledCountBuy} of ${ladderCount} buy ld${moduleIndexString}-orders`);
        }

        if (ldFilledCountSell / ladderCount > 0.5) {
          ldFilledWarning.push(`${ldFilledCountSell} of ${ladderCount} sell ld${moduleIndexString}-orders`);
        }

        if (ldFilledWarning.length) {
          log.warn(`orderUtils: ${ldFilledWarning.join(' and ')} considered as filled.`);
        }
      }

      lastOrdersSnapshot[pair + samePurpose] = { // E.g, `ETHUSDTld2-`, or `ETH/USDT`
        ts: Date.now(),
        count: orderCountOpened,
      };
    } catch (e) {
      log.error(`Error in updateOrders(${paramString})-2 of ${callerModuleName} module: ${e}`);
      log.warn(`orderUtils: Because of an error in updateOrders(), returning ${samePurpose}updatedOrders, but processing was only partially completed.`);
    }

    return updatedOrders;
  },

  /**
   * Refers to traderapi.getOpenOrders, but caches request results
   * Cache works with the first trading account and the main exchange only. If the second API or perpetual API is used, always makes a request.
   * Note: the function supposes that a pair/contract is valid and exists on exchange, and doesn't check it
   * @param {string} pair BTC/USDT for spot or BTCUSDT for perpetual
   * @param {string} moduleName Name of module, which requests the method. For logging only.
   * @param {boolean} [noCache=false] If true, return fresh data (make a request unconditionally)
   * @param {Object} [api=traderapi] API instance to use: spot (first or second account) or perpetual. Defaults to the first spot API.
   * @return {Promise<Object[]> | undefined} A clone of Open orders, cached or fresh
  */
  async getOpenOrdersCached(pair, moduleName, noCache = false, api = traderapi) {
    let result;

    try {
      const onWhichAccount = api.isSecondAccount ? ' on second account' : '';
      const cached = openOrdersCached[pair];
      const socketDataAvailable = api.features().socketEnabled && api.isPrivateWsEnabled('orders');

      const isPerpetual = utils.isPerpetual(pair);

      if (isPerpetual && !perpetualApi) {
        log.warn(`orderUtils: Unable to get ${pair} open orders${onWhichAccount}. Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);

        return undefined;
      }

      const cacheTerm = Date.now() - cached?.timestamp;
      const isCacheValid = cacheTerm < openOrdersValidMs;

      if (
        !socketDataAvailable &&
        !api.isSecondAccount &&
        !noCache &&
        cached?.timestamp &&
        isCacheValid &&
        !isPerpetual
      ) {
        result = utils.cloneArray(cached.data);

        log.log(`orderUtils: Returning cached ${pair} open orders for ${moduleName}, term: ${cacheTerm} ms. ${result.length} orders retrieved.`);
      } else {
        const exchangeOrders = await api.getOpenOrders(pair);

        const maxRateCounter = exchangeOrders?.[0]?.maxRateCounter;
        const rateCounterString = utils.isPositiveOrZeroInteger(maxRateCounter) ? ` Rate limit counter: ${maxRateCounter}.` : '';

        log.log(`orderUtils: Getting fresh ${pair} open orders${onWhichAccount} for ${moduleName}… ${exchangeOrders?.length} orders received.${rateCounterString}`);

        if (exchangeOrders ) {
          if (!api.isSecondAccount && !isPerpetual) {
            openOrdersCached[pair] = {};
            openOrdersCached[pair].data = exchangeOrders;
            openOrdersCached[pair].timestamp = Date.now(); // in ms
          }

          result = utils.cloneArray(exchangeOrders);
        } else {
          log.warn(`orderUtils: Unable to get ${pair} open orders${onWhichAccount}.`);

          return undefined;
        }
      }
    } catch (e) {
      log.error(`Error in getOpenOrdersCached() of ${moduleName} module: ${e}`);
    }

    return result;
  },

  /**
   * Refers to traderapi.getOrderBook, but caches request results
   * Cache works with the first trading account and the main exchange only. If the second API or perpetual API is used, always makes a request.
   * Note: the function supposes that a pair/contract is valid and exists on exchange, and doesn't check it
   * @param {string} pair BTC/USDT for spot or BTCUSDT for perpetual
   * @param {string} moduleName Name of module, which requests the method. For logging only.
   * @param {boolean} [noCache=false] If true, return fresh data (make a request unconditionally)
   * @return {Promise<DepthResult | undefined>} Order book, cached or fresh
  */
  async getOrderBookCached(pair, moduleName, noCache = false) {
    let result;

    try {
      const cached = orderBookCached[pair];
      const socketDataAvailable = traderapi.features().socketEnabled && traderapi.isPublicWsEnabled('depth');

      const isPerpetual = utils.isPerpetual(pair);

      if (isPerpetual && !perpetualApi) {
        log.warn(`orderUtils: Unable to get ${pair} order book. Perpetual contract trading on ${config.exchangeName} is not enabled in the config.`);

        return undefined;
      }

      const cacheTerm = Date.now() - cached?.timestamp;
      const isCacheValid = cacheTerm < orderBookCachedValidMs;

      if (
        !socketDataAvailable &&
        !noCache &&
        cached &&
        cached.timestamp &&
        isCacheValid &&
        !isPerpetual
      ) {
        result = utils.cloneObject(cached.data);

        log.log(`orderUtils: Returning cached ${pair} order book for ${moduleName} — ${result.bids.length} bids and ${result.asks.length} asks, term: ${cacheTerm} ms.`);
      } else {
        const ob = isPerpetual ?
            await perpetualApi.getOrderBook(pair) :
            await traderapi.getOrderBook(pair);

        const formattedPair = /** @type {ParsedMarket} */ (this.parseMarket(pair));

        // Log order book summary

        const bid_low = ob?.bids?.[0]?.price;
        const ask_high = ob?.asks?.[0]?.price;

        if (bid_low && ask_high) {
          const spread = ask_high - bid_low;
          const priceAvg = (ask_high + bid_low) / 2;
          const spreadPercent = spread / priceAvg * 100;
          const precision = utils.getPrecision(formattedPair.coin2Decimals);
          const spreadNumber = Math.round(spread / precision);

          const orderBookSpreadInfo = `Spread is ${spreadPercent.toFixed(4)}% (${spread.toFixed(formattedPair.coin2Decimals)} ${formattedPair.coin2}, ${spreadNumber} units)`;
          let logMessage = `orderUtils: Received fresh ${pair} order book for ${moduleName} — ${ob.bids.length} bids and ${ob.asks.length} asks.`;
          logMessage += ` Highest bid and lowest ask are ${bid_low.toFixed(formattedPair.coin2Decimals)}–${ask_high.toFixed(formattedPair.coin2Decimals)} ${formattedPair.coin2}.`;
          logMessage += ` ${orderBookSpreadInfo}.`;
          log.log(logMessage);

          orderBookCached[formattedPair.pair] = {};
          orderBookCached[formattedPair.pair].data = ob;
          orderBookCached[formattedPair.pair].timestamp = Date.now(); // in ms
          result = utils.cloneObject(ob);
        } else {
          log.warn(`orderUtils: Unable to get ${pair} order book.`);

          return undefined;
        }
      }
    } catch (e) {
      log.error(`Error in getOrderBookCached() of ${moduleName} module: ${e}`);
    }

    return result;
  },

  /**
   * Refers to `traderapi.getBalances`, but caches the results.
   *
   * Cache is used **only** for:
   *   - the first trading API account, and
   *   - the default account/wallet type.
   *
   * If the second trading API, perpetual API, or any non-default account/wallet type is used,
   * the method always makes a fresh request (no cache).
   * If socket-delivered balance data is available, it is returned directly (no caching).
   * If cached data is outdated (based on `balancesCachedValidMs`), a new balance request is made.
   *
   * @param {boolean} nonzero=true Whether to filter out zero balances in the returned result. Zero balances are still stored internally in the cache.
   * @param {string} moduleName Name of the module calling the method — used only for logging
   * @param {boolean} [noCache=false] If `true`, always return fresh data (skip cache)
   * @param {'__contract' | '__spot' | string} [walletType]
   *   Account/wallet type (e.g., `__spot`, `__contract`, `main`, `trade`, `margin`, or `full`).
   *   The actual list depends on `features().accountTypes`.
   * @param {Object} [api=traderapi] Exchange API instance to use. If the second trading account's API is passed, caching is bypassed and a fresh request is made.
   * @return {Promise<AssetsResultWithTimestamp | { success: boolean, message: string } | undefined>}
   *   Account balances — cached or fresh, depending on conditions
   */
  async getBalancesCached(nonzero = true, moduleName, noCache = false, walletType, api = traderapi) {
    /** @type {AssetsResultWithTimestamp} */
    let result;

    try {
      const onWhichAccount = api.isSecondAccount ? ' on second account' : '';

      const isPerpetual = perpetualEnabled && (!walletType || walletType === '__contract');

      if (walletType === '__contract') {
        walletType = perpetualApi.features().tradingAccountType;
      } else if (walletType === '__spot') {
        walletType = api.features().tradingAccountType;
      }

      const walletTypeString = walletType ?
          ` '${walletType}'-type` :
          isPerpetual ?
              ` {contract_default}-type` :
              ` {spot_default}-type`;

      const cached = balancesCached;
      const socketDataAvailable = api.features().socketEnabled && api.isPrivateWsEnabled('balance');

      const cacheTerm = Date.now() - cached?.timestamp;
      const isCacheValid = cacheTerm < balancesCachedValidMs;

      if (
        !socketDataAvailable &&
        !api.isSecondAccount &&
        !walletType &&
        !noCache &&
        cached?.timestamp &&
        isCacheValid &&
        !isPerpetual
      ) {
        result = utils.cloneArray(cached.data);

        const b = utils.balanceHelper(result, config.defaultPair);
        const coinString = isPerpetual ?
            `-> ${b.coin2s}.` :
            `-> ${b.coin1s}. ${b.coin2s}.`;

        // Use original fetch timestamp
        result._timestamp = cached.timestamp;

        log.log(`orderUtils: Returning cached balances for ${moduleName}, cache term: ${cacheTerm} ms. ${result.length} coin balances retrieved. ${coinString}`);
      } else {
        const balances = isPerpetual ?
            await perpetualApi.getBalances(false, walletType) :
            await api.getBalances(false, walletType);

        const b = utils.balanceHelper(balances, config.defaultPair);
        const coinString = isPerpetual ?
            `-> ${b?.coin2s}.` :
            `-> ${b?.coin1s}. ${b?.coin2s}.`;

        log.log(`orderUtils: Getting fresh${walletTypeString} balances${onWhichAccount} for ${moduleName}… ${balances?.length} coin balances received. ${coinString}`);

        const errorMessage = balances?.message; // For some exchanges, getBalances() implementations may include 'message' error info

        if (balances && !errorMessage) {
          const fetchTimestamp = Date.now();

          // Update cached balances
          if (!walletType && !api.isSecondAccount) {
            balancesCached.data = balances;
            balancesCached.timestamp = fetchTimestamp;
          }

          result = utils.cloneArray(balances);
          result._timestamp = fetchTimestamp;

          const historyBalances = utils.cloneArray(balances);
          const addedTotals = balancesHistory.addBalanceTotals(historyBalances, 'allcoins');
          const balancesWithTotals = addedTotals.balancesWithTotals;

          // Store all balances history
          const accountNo = api.isSecondAccount ? 1 : 0;
          balancesHistory.saveSnapshotIfChanged({
            accountNo,
            walletType: walletType || null,
            balances: balancesWithTotals,
            source: 'getBalancesCached',
            callerName: `${moduleName}|getBalancesCached`,
            timestamp: fetchTimestamp,
          });

          // Balance Watcher && Guard

          const bw = utils.softRequire('../trade/mm_balance_watcher');
          await bw?.guardBalances(accountNo, walletType, `${moduleName}|getBalancesCached`);
        } else {
          const message = `Unable to get${walletTypeString} balances${onWhichAccount}: ${errorMessage || '{ No details }'}`;
          log.warn(`orderUtils: ${message}`);

          return {
            success: false,
            message,
          };
        }
      }

      // Filter out zero balances
      if (nonzero && Array.isArray(result)) {
        // Filter in-place to preserve array identity and its extra properties (like _timestamp)
        for (let i = result.length - 1; i >= 0; i -= 1) {
          const crypto = result[i];
          if (!crypto.free && !crypto.freezed) {
            result.splice(i, 1);
          }
        }
      }
    } catch (e) {
      log.error(`Error in getBalancesCached() of ${moduleName} module: ${e}`);
    }

    return result;
  },

  /**
   * Compose contract position information for logs and notifications
   * @param {Object} p Position object
   * @param {'human multi-line' | 'values' | 'block'} presentation Type of information representation: human multi-line, comma-delimited values, or code block
   * @param {boolean} [fullInfo=false] Whether to include:
   *   - Position status (usually it's `normal`)
   *   - Entry price
   *   - Liquidation price
   * @returns {string}
   */
  getPositionString(p, presentation, fullInfo = false) {
    let positionString = '';

    try {
      const formattedPair = /** @type {ParsedMarket} */ (this.parseMarket(p.symbol));
      const { coin1, coin2, coin1Decimals, coin2Decimals } = formattedPair;

      const side = this.positionSide(p.side, true);
      const leverage = +p.leverage?.toFixed(2);

      const amountString = p.size?.toFixed(coin1Decimals);
      const quoteString = +p.positionValue?.toFixed(coin2Decimals);
      const priceString = p.avgPrice?.toFixed(coin2Decimals);

      const liqPriceString = p.liqPrice?.toFixed(coin2Decimals);
      const tpPriceString = p.takeProfit?.toFixed(coin2Decimals);
      const slPriceString = p.stopLoss?.toFixed(coin2Decimals);

      const unrealisedPnlString = +p.unrealisedPnl?.toFixed(coin2Decimals);
      const realisedPnlString = +p.curRealisedPnl?.toFixed(coin2Decimals);

      if (presentation === 'human multi-line') {
        positionString = `${side} ${amountString} ${coin1} @ avg entry ${priceString} ${coin2} · ${leverage}× → position value: ${quoteString} ${coin2}`;
        positionString += `\nUnrealised P&L ${unrealisedPnlString} ${coin2}`;

        if (p.curRealisedPnl) {
          positionString += `, Realised P&L ${realisedPnlString} ${coin2}`;
        }

        positionString += `\nLiquidation @ ${liqPriceString} ${coin2}`;

        if (p.stopLoss) {
          positionString += `\nStop loss @ ${slPriceString} ${coin2}`;
        }

        if (p.takeProfit) {
          positionString += `\nTake profit @ ${tpPriceString} ${coin2}`;
        }

        if (fullInfo) {
          positionString += `\nOpened: ${utils.formatDate(new Date(p.time))} | Reduce only: ${p.isReduceOnly} | Status: ${p.positionStatus} | Risk ID: ${p.riskId} | Risk limit value: ${p.riskLimitValue}`;
        }
      } else if (presentation === 'values') {
        if (fullInfo) {
          positionString += `status '${p.positionStatus}, `;
        }

        positionString += `side ${side}, size ${amountString} ${coin1}, value ${quoteString} ${coin2}, leverage '${leverage}, `;

        if (fullInfo) {
          positionString += `entry price ${priceString} ${coin2}, liquidation price ${liqPriceString} ${coin2}, `;
        }

        if (p.curRealisedPnl) {
          positionString += `realised PnL ${realisedPnlString} ${coin2} and `;
        }

        positionString += `unrealised PnL ${unrealisedPnlString} ${coin2}`;
      } else {
        positionString = utils.codeBlock(JSON.stringify(p, null, 2));
      }
    } catch (e) {
      log.error(`Error in getPositionString() of ${moduleName} module: ${e}`);
    }

    return positionString;
  },

  /**
   * Builds a human-readable order description string for logging.
   * Works with both Fill records (which use `orderId`) and Order objects (which use `_id`).
   * @param {FillOrder | BotOrderDbRecord} order Fill record or OrderDbRecord object
   * @returns {string} Human-readable order info, e.g. `sell liq-order (spread support) with id=3e5b69fa-042e-434c-a3c6-4d0371d1a5e5`
   */
  buildShortOrderInfo(order) {
    const anyOrder = /** @type {any} */ (order);
    const orderId = anyOrder.orderId || anyOrder._id; // Universal for both Fill order record and Order object
    const { side, purpose, subPurposeString, subTypeString } = order;
    return `${side} ${purpose}-order${subTypeString || subPurposeString || ''} with id=${orderId}`;
  },
};
