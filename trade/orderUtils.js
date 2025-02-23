/**
 * Helpers for order processing
 */

/**
 * @module trade/orderUtils
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
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

const perpetualApi = undefined;

// Cache is stored for the first trading account only
let openOrdersCached = [];
const openOrdersValidMs = 1000;
let orderBookCached = [];
const orderBookCachedValidMs = 1000;
let balancesCached = { timestamp: 0, data: [] };
const balancesCachedValidMs = 1000;

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

module.exports = {
  readableModuleName: 'orderUtils',

  /**
   * Returns cross-type order
   * @param {string} type Order type, 'buy' | 'sell'
   * @return {'buy' | 'sell'}
   */
  crossType(type) {
    return type === 'buy' ? 'sell' : 'buy';
  },

  /**
   * Returns position type
   * @param {string} type Position familiar type, 'buy' | 'sell'
   * @param {boolean} [capitalize=false] long -> Long
   * @return {'long' | 'short' | 'Long' | 'Short'}
   */
  positionType(type, capitalize = false) {
    if (type === 'buy') {
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
   * @param {string} type Order type, 'buy' | 'sell'
   * @param {string | ParsedMarket} pair ADM/USDT, ADMUSDT, or formattedPair from parseMarket()
   * @param {number} [base] (When selling) Check if an account have enough base coin balance, 2 BTC
   * @param {number} [quote] (When buying) Check if an account have enough quote coin balance, 80000 USDT
   * @param {string} purpose Order purpose, e.g. 'pm', virtual order, 'fill', 'ld2'. For logging and send back message.
   * @param {string} [additionalInfo=''] E.g., ' to achieve 10.00 USDT price' or ' with 15 ladder index'. With leading space, no ending dot. For logging and send back message.
   * @param {string} callerModuleName For logging
   * @param {Object} [api=traderapi] Exchange API to use; may be a second trade account. If not set, the first spot account will be used.
   * @return {Promise<{ result: boolean, message?: string }>} Returns error message if you want to notify()
   */
  async isEnoughCoins(type, pair, base, quote, purpose, additionalInfo = '', callerModuleName, api = traderapi) {
    const logModule = `${moduleName}/${callerModuleName}`;

    let formattedPair;

    if (typeof pair === 'string') {
      formattedPair = /** @type {ParsedMarket} */ (this.parseMarket(pair));
    } else {
      formattedPair = pair;
    }

    const onWhichAccount = api.isSecondAccount ? ' on second account' : '';

    const walletType = formattedPair.perpetual ? '__contract' : '__spot';
    const balances = await this.getBalancesCached(false, `${moduleName}-isEnoughCoins`, false, walletType, api);

    if (!balances) {
      const errorString = `Unable to receive balances${onWhichAccount} for placing ${purpose}-order on ${formattedPair.pair}${additionalInfo}.`;
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
          // Perpetual contracts are always paid in coin2 independent from order type
          // Not enough USDT balance to place ob-order to buy/sell 1 BTC contracts for 40,000 USDT on BTCUSDT
          const baseString = base?.toFixed(formattedPair.coin1Decimals);
          const quoteString = quote.toFixed(formattedPair.coin2Decimals);
          coin = formattedPair.coin2;
          balanceFree = b.free2s;
          balanceFreezed = b.freezed2s;
          orderString = `${purpose}-order to ${type} ${baseString} ${formattedPair.coin1} contracts for ${quoteString} ${formattedPair.coin2} on ${formattedPair.pair}`;

          isBalanceEnough = false;
        }
      } else if (type === 'buy') {
        if (b.free2 < quote) {
          // Not enough USDT balance to place buy tw-order for 40,000 USDT on ADM/USDT
          amount = quote.toFixed(formattedPair.coin2Decimals);
          coin = formattedPair.coin2;
          balanceFree = b.free2s;
          balanceFreezed = b.freezed2s;
          orderString = `${type} ${purpose}-order for ${amount} ${coin} on ${formattedPair.pair}`;

          isBalanceEnough = false;
        }
      } else {
        if (b.free1 < base) {
          // Not enough BTC balance to place 1 BTC sell tw-order
          amount = base.toFixed(formattedPair.coin1Decimals);
          coin = formattedPair.coin1;
          balanceFree = b.free1s;
          balanceFreezed = b.freezed1s;
          orderString = `${amount} ${coin} ${type} ${purpose}-order on ${formattedPair.pair}`;

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
      const errorString = `Unable to process balances${onWhichAccount} for placing ${purpose}-order on ${formattedPair.pair}: ${e}`;
      log.warn(`${logModule}: ${errorString}`);

      return {
        result: false,
        message: errorString,
      };
    }
  },

  /**
   * Returns minimum order amount in coin1, allowed on the exchange, and upper bound for minimal order
   * Considers coin1MinAmount, coin2MinAmount (converted in coin1) set by an exchange
   * Or default values set in the config or by constants
   * @param {number} price Calculate min amount for a specific price, if coin2MinAmount is set for the trade pair. Optional.
   * @return {{ min: number, upperBound: number } | undefined} Minimum order amount, and upper bound for minimal order
   */
  getMinOrderAmount(price) {
    const exchangerUtils = require('../helpers/cryptos/exchanger');

    try {
      let minOrderAmount; let upperBound;

      // Consider both coin1MinAmount and coin2MinAmount on an exchange

      const coin1MinAmount = traderapi.marketInfo(config.pair)?.coin1MinAmount;
      if (utils.isPositiveNumber(coin1MinAmount)) {
        minOrderAmount = coin1MinAmount;
      }

      const coin2MinAmount = traderapi.marketInfo(config.pair)?.coin2MinAmount;
      if (utils.isPositiveNumber(coin2MinAmount)) {
        let coin2MinAmountInCoin1;

        if (utils.isPositiveNumber(price)) {
          coin2MinAmountInCoin1 = coin2MinAmount / price;
        } else {
          coin2MinAmountInCoin1 = exchangerUtils.convertCryptos(config.coin2, config.coin1, coin2MinAmount).outAmount;
        }

        if (utils.isPositiveNumber(coin2MinAmountInCoin1)) {
          if (utils.isPositiveNumber(coin1MinAmount)) {
            minOrderAmount = Math.max(coin1MinAmount, coin2MinAmountInCoin1);
          } else {
            minOrderAmount = coin2MinAmountInCoin1;
          }
        }
      }

      if (minOrderAmount) {
        upperBound = minOrderAmount * 2;
      } else {
        // Use constants if an exchange doesn't provide min amounts

        const defaultMinOrderAmountUSD =
            config.exchange_restrictions?.minOrderAmountUSD ||
            constants.DEFAULT_MIN_ORDER_AMOUNT_USD;
        minOrderAmount = exchangerUtils.convertCryptos('USD', config.coin1, defaultMinOrderAmountUSD).outAmount;

        const defaultMinOrderAmountUpperBoundUSD =
            config.exchange_restrictions?.minOrderAmountUpperBoundUSD ||
            constants.DEFAULT_MIN_ORDER_AMOUNT_UPPER_BOUND_USD;
        upperBound = exchangerUtils.convertCryptos('USD', config.coin1, defaultMinOrderAmountUpperBoundUSD).outAmount;
      }

      return {
        min: minOrderAmount,
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
      const isPerpetual = utils.isPerpetual(pair);

      if (!pair || (pair.indexOf('/') === -1 && !isPerpetual)) {
        log.warn(`orderUtils/parseMarket: Cannot parse a market pair/contract from the string '${pair}'.`);
        return false;
      }

      if (isPerpetual && !perpetualApi) {
        log.warn(`orderUtils/parseMarket: The pair '${pair}' seems to be a perpetual contract, but perpetual trading is disabled in the config.`);
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

      if (exchange && exchangeLc !== config.exchange +1) { // If not a config's exchange, create the exchange instance and fetch markets
        if (isPerpetual) {
          exchangeApi = undefined;

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

      return {
        pair,
        pairReadable,
        perpetual,
        coin1,
        coin2,
        coin1Decimals, // Fallback to 8 in case if we can't find the market
        coin2Decimals, // Fallback to 8 in case if we can't find the market
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
   * @param {'buy' | 'sell'} orderType Order type
   * @param {string} pair BTC/USDT for spot or BTCUSDT for perpetual
   * @param {number} [price] Order price in case of limit order
   * @param {number} [coin1Amount] Base coin qty
   * @param {1 | 0} limit 1 for limit order, 0 for market order
   * @param {number} [coin2Amount] Quote coin qty
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
      orderType,
      pair,
      price,
      coin1Amount,
      limit,
      coin2Amount,
      purpose = 'man',
      api = traderapi,
      perpetualOptions,
  ) {
    try {
      const isPerpetual = utils.isPerpetual(pair);
      const formattedPair = /** @type {ParsedMarket} */ (this.parseMarket(pair));

      const coin1 = formattedPair.coin1;
      const coin2 = formattedPair.coin2;

      let whichAccount = ''; let whichAccountMsg = ''; let isSecondAccountOrder;

      if (api.isSecondAccount && !isPerpetual) {
        isSecondAccountOrder = true;

        whichAccount = ' (using second account)';
        whichAccountMsg = '(_Using the second account_) ';
      }

      // Logging parameters

      let orderParamsString = `type=${orderType}, limit=${limit}, pair=${pair}, price=${limit ? price : 'Market'}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;

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
          await perpetualApi.placeOrder(orderType, pair, price, coin1Amount, limit ? 'limit' : 'market', perpetualOptions?.reduceOnly, perpetualOptions?.takeProfitPrice, perpetualOptions?.stopLossPrice, perpetualOptions?.timeInForce, perpetualOptions?.smpType) :
          await api.placeOrder(orderType, pair, price, coin1Amount, limit, coin2Amount);

      if (orderReq?.orderId) {
        const { ordersDb } = db;

        const order = new ordersDb({
          _id: orderReq.orderId,
          date: utils.unixTimeStampMs(),
          purpose,
          type: orderType,
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
          isProcessed: !limit,
          isExecuted: false, // 'man' orders are not marked as executed
          isCancelled: false,
          isSecondAccountOrder,
          message: whichAccountMsg + orderReq?.message,
        });

        await order.save();

        // Log order information

        let output;

        const amountString = coin1Amount?.toFixed(formattedPair.coin1Decimals);
        const quoteString = coin2Amount?.toFixed(formattedPair.coin2Decimals);
        const priceString = price?.toFixed(formattedPair.coin2Decimals);

        if (limit) {
          // buy 100 ADM for 1000 USDT at 10 USDT price
          // sell 100 ADM for 10 USDT at 10 USDT price
          output = `${orderType} ${amountString} ${coin1} for ${quoteString} ${coin2} at ${priceString} ${coin2} price`;
        } else {
          if (coin2Amount) {
            // buy ADM for 1000 USDT at Market price
            // sell ADM for 1000 USDT at Market price
            output = `${orderType} ${coin1} for ${quoteString} ${coin2} at Market Price`;
          } else {
            // buy 100 ADM at Market price
            // sell 100 ADM at Market price
            output = `${orderType} ${amountString} ${coin1} at Market Price`;
          }
        }

        log.info(`orderUtils: Successfully executed ${purpose}-order${whichAccount} to ${output} on ${formattedPair.pair}.`);

        return order;
      } else {
        const details = orderReq?.message ? ` [${utils.trimAny(orderReq?.message, ' .')}].` : ' { No details }.';

        log.warn(`orderUtils: Unable to execute ${purpose}-order${whichAccount} with params: ${orderParamsString}.${details}`);

        return {
          message: whichAccountMsg + orderReq?.message,
        };
      }
    } catch (e) {
      log.error(`Error in addGeneralOrder() of ${moduleName} module: ${e}`);
    }
  },

  /**
   * Updates local bot's orders database dbOrders, independent of its purpose (but logs purpose if received in moduleName).
   * It loops through all the orders in local dbOrders and compares them with the current exchange orders.
   * If found one, updates its status.
   * If not found, closes it as not actual. Note: This method doesn't close ld-orders, as they may be saved but not exist.
   * Additionally, stores all order fills in the fillsDb.
   * Works for both spot and perpetual contract orders.
   * Note: the function supposes that a pair/contract is valid and exists on exchange, and doesn't check it
   * @param {Array<Object>} dbOrders Local orders database
   * @param {string} pair BTC/USDT for spot or BTCUSDT for perpetual
   * @param {string} callerModuleName Name of the module (and order purpose), which requests the method. E.g., 'mm_ladder.js(2):ld2-'. For logging only.
   * @param {boolean} [noCache=false] If true, get fresh open order data, not cached
   * @param {Object} [api=traderapi] Exchange API to use; may be a second trade account. If not set, the first account will be used.
   * @param {boolean} [hideNotOpened=true] Hide ld-orders in [Not opened, Filled, Cancelled] states
   * @return {Promise<Array<Object> | Object>} Updated local orders database, with or without details
  */
  async updateOrders(dbOrders, pair, callerModuleName, noCache = false, api = traderapi, hideNotOpened = true) {
    const paramString = `dbOrders-length: ${dbOrders.length}, pair: ${pair}, moduleName: ${callerModuleName}, noCache: ${noCache}, api: ${api}, hideNotOpened: ${hideNotOpened}`;

    const isPerpetual = utils.isPerpetual(pair);

    let updatedOrders = [];

    const orderCollector = require('./orderCollector');

    // Create initial fills structure to update it later
    // Info about partly and fully filled orders
    // Used in Liquidity module to protect from balance depleting

    const orderPurposes = orderCollector.orderPurposes;
    const fills = Object.keys(orderPurposes).reduce((acc, purpose) => {
      acc[purpose] = {
        partlyFilledOrders: [],
        notFoundOrders: [],
        filledOrders: [],
        buyFilledAmount: 0,
        sellFilledAmount: 0,
        buyFilledQuote: 0,
        sellFilledQuote: 0,
      };
      return acc;
    }, {});

    let ldFilledCount = 0;

    let samePurpose; // If all of the orders are of same purpose, e.g., 'ld', callerModuleName receives value like 'Ladder:ld-' and 'ld2' like 'mm_ladder.js(2):ld2-'. For logging only.
    [callerModuleName, samePurpose = ''] = callerModuleName.split(':');

    const parsedPurpose = orderCollector.parsePurpose(samePurpose.replace('-', ''));
    const moduleIndexString = parsedPurpose.moduleIndexString || ''; // For logging like ld2-orders

    try {
      const onWhichAccount = api.isSecondAccount ? ' (on second account)' : '';
      const exchangeOrders = await this.getOpenOrdersCached(pair, `${moduleName}/${callerModuleName}`, noCache, api);

      log.log(`orderUtils: Updating ${dbOrders.length} ${samePurpose}dbOrders on ${pair} for ${callerModuleName}, noCache: ${noCache}, hideNotOpened: ${hideNotOpened}… Received ${exchangeOrders?.length} orders from the exchange.`);

      if (!exchangeOrders) {
        log.warn(`orderUtils: Unable to get ${pair} exchangeOrders${onWhichAccount} in updateOrders(), leaving ${samePurpose}dbOrders as is.`);
        return dbOrders;
      }

      // If we don't trust the exchange API, it can return a false-empty order list even if there are orders. Re-check then.
      // Bullshit, but it's a reality. We'll deal with it.
      // For spot only

      if (
        !isPerpetual &&
        dbOrders.length !== 0 &&
        exchangeOrders.length === 0 &&
        traderapi.features().dontTrustApi &&
        traderapi.getOrderDetails
      ) {
        let falseResultDetails;

        for (const dbOrder of dbOrders) {
          if (
            !dbOrder.isVirtual &&
            (!dbOrder.apikey || dbOrder.apikey === config.apikey)
          ) {
            const orderDetails = await traderapi.getOrderDetails(dbOrder._id, dbOrder.pair);
            const orderStatus = orderDetails?.status;

            /**
             * !orderStatus, 'new', 'part_filled' -> API failed, don't trust
             * 'filled', 'cancelled' -> Empty order list is still possible
             * 'unknown' means Order doesn't exist or Wrong orderId. It's possible/accepted, if:
             * - Order is virtual (ld-order which is not created)
             * - Order placed with other API keys. We check it where an order stores API key.
             * - On other exchange. Don't check it as we already filtered orders by exchange.
             * - If any order is not 'unknown', empty order list is still possible
             */

            if (!orderStatus) {
              falseResultDetails = `No order ${dbOrder._id} status received. Request result is ${JSON.stringify(orderDetails)}`;
              break;
            }

            if (['new', 'part_filled'].includes(orderStatus)) {
              falseResultDetails = `Order ${dbOrder._id} status is ${orderStatus}`;
              break;
            }
          }
        } // for (const dbOrder of dbOrders)

        if (falseResultDetails) {
          const falseResultString = `It seems ${config.exchangeName} API returned false empty order list: ${falseResultDetails}`;
          const checkLogsString = 'For additional info, check logs';

          log.warn(`orderUtils: ${falseResultString}. Leaving ${samePurpose}dbOrders as is.`);
          notify(`${config.notifyName}: ${falseResultString}. ${checkLogsString}`, 'warn', undefined, true); // Priority notification

          return dbOrders;
        }
      }

      // Loop through all orders in the local dbOrders and compare them with the current exchange orders

      for (const dbOrder of dbOrders) {
        const purposeIndexed = `${dbOrder.purpose}${dbOrder.moduleIndex > 1 ? dbOrder.moduleIndex : ''}`; // E.g., 'ld2' or 'man'
        const orderInfoString = `${purposeIndexed}-order${dbOrder.subPurposeString || ''}${onWhichAccount} with params: id=${dbOrder._id}, type=${dbOrder.type}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount} (${dbOrder.coin1AmountLeft} left), coin2Amount=${dbOrder.coin2Amount}`;

        let isOrderFound = false;

        const coin1AmountBeforeIteration = dbOrder.coin1AmountLeft ?? dbOrder.coin1Amount;

        for (const exchangeOrder of exchangeOrders) {
          if (dbOrder._id?.toString() === exchangeOrder.orderId?.toString()) { // While dbOrders stores IDs in native type (can be number), getOpenOrders always returns ids as strings
            isOrderFound = true;

            switch (exchangeOrder.status) {
              // Possible values: new, part_filled
              case 'part_filled':
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
                    amountUpdateCount: (dbOrder.amountUpdateCount || 0) + 1,
                  }, true);

                  const coin1AmountFilled = coin1AmountBeforeIteration - dbOrder.coin1AmountLeft;
                  const coin2AmountFilled = coin1AmountFilled * dbOrder.price;

                  fills[dbOrder.purpose][`${dbOrder.type}FilledAmount`] += coin1AmountFilled;
                  fills[dbOrder.purpose][`${dbOrder.type}FilledQuote`] += coin2AmountFilled;
                  fills[dbOrder.purpose].partlyFilledOrders.push({
                    orderId: dbOrder._id,
                    type: dbOrder.type,
                    coin1AmountFilled,
                    coin2AmountFilled,
                    price: dbOrder.price,
                    subPurpose: dbOrder.subPurpose,
                    subPurposeString: dbOrder.subPurposeString,
                  });

                  const filledPercent = (dbOrder.coin1AmountFilled / dbOrder.coin1Amount * 100).toFixed(2);

                  log.log(`orderUtils: Updating ${orderInfoString}. It's partly filled ${utils.inclineNumber(dbOrder.amountUpdateCount)} time: ${coin1AmountBeforeIteration} -> ${dbOrder.coin1AmountLeft} ${dbOrder.coin1} (${filledPercent}% filled${dbOrder.amountUpdateCount > 1 ? ' in total.' : '.'})`);
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

        // An order is missing in the exchangeOrders, remove it (if not an ld-order)

        let isOrderFilled = false;
        fills[dbOrder.purpose].notFoundOrders.push({
          orderId: dbOrder._id,
          type: dbOrder.type,
          coin1AmountFilled: coin1AmountBeforeIteration,
          coin2AmountFilled: coin1AmountBeforeIteration * dbOrder.price,
          price: dbOrder.price,
          subPurpose: dbOrder.subPurpose,
          subPurposeString: dbOrder.subPurposeString,
        });

        if (dbOrder.purpose === 'ld') {
          const previousState = dbOrder.ladderState;

          if (constants.LADDER_OPENED_STATES.includes(previousState)) {
            dbOrder.update({
              ladderState: 'Filled',
            });

            isOrderFilled = true;
            ldFilledCount++;

            log.log(`orderUtils: Changing state of ${orderInfoString} from ${previousState} to ${dbOrder.ladderState}. Ladder index: ${dbOrder.ladderIndex}. Unable to find it in the exchangeOrders, consider it's filled.`);
            await dbOrder.save();
          } else {
            log.log(`orderUtils: Not found ${orderInfoString}, it's ok for a ladder order with state ${dbOrder.ladderState}${dbOrder.ladderNotPlacedReason ? ' (' + dbOrder.ladderNotPlacedReason + ')' : ''}. Ladder index: ${dbOrder.ladderIndex}.`);
          }

          updatedOrders.push(dbOrder);
        } else {
          const reasonToClose = 'Unable to find it in the exchangeOrders';
          const reasonObject = {
            isNotFound: true,
          };

          const cancellation = await orderCollector.clearOrderById(
              dbOrder, dbOrder.pair, dbOrder.type, this.readableModuleName, reasonToClose, reasonObject, api);

          if (cancellation.isCancelRequestProcessed) {
            isOrderFilled = true;
          } else {
            updatedOrders.push(dbOrder);
          }
        }

        if (isOrderFilled) {
          fills[dbOrder.purpose][`${dbOrder.type}FilledAmount`] += coin1AmountBeforeIteration;
          fills[dbOrder.purpose][`${dbOrder.type}FilledQuote`] += coin1AmountBeforeIteration * dbOrder.price;
          fills[dbOrder.purpose].filledOrders.push({
            orderId: dbOrder._id,
            type: dbOrder.type,
            coin1AmountFilled: coin1AmountBeforeIteration,
            coin2AmountFilled: coin1AmountBeforeIteration * dbOrder.price,
            price: dbOrder.price,
            subPurpose: dbOrder.subPurpose,
            subPurposeString: dbOrder.subPurposeString,
          });
        }
      }
    } catch (e) {
      log.error(`Error in updateOrders(${paramString})-1 of ${moduleName} module: ${e}`);
      log.warn(`orderUtils: Because of error in updateOrders(), returning ${samePurpose}dbOrders before the processing is finished. It may be partly modified.`);

      return dbOrders;
    }

    try {
      // dbOrders may include 'not placed' orders ~placeholders for ladder
      // We can include them in the result, or hide

      const orderCountAll = updatedOrders.length;
      const updatedOrdersOpened = updatedOrders.filter((order) => order.purpose !== 'ld' || constants.LADDER_OPENED_STATES.includes(order.ladderState));
      const orderCountOpened = updatedOrdersOpened.length;
      const orderCountHidden = orderCountAll - orderCountOpened;

      let openOrdersString = '';

      if (hideNotOpened) {
        if (orderCountHidden > 0) {
          updatedOrders = updatedOrdersOpened;
          openOrdersString = ` (${orderCountHidden} not placed ld${moduleIndexString}-orders are hidden)`;
        }
      } else {
        if (orderCountHidden > 0) {
          openOrdersString = ` (including ${orderCountHidden} not placed ld${moduleIndexString}-orders)`;
        }
      }

      // Store non-empty fills data

      Object.keys(fills).forEach((purpose) => {
        if (purpose !== 'all') {
          fills[purpose].partlyFilledOrders.forEach((order) => fills['all'].partlyFilledOrders.push(order));
          fills[purpose].notFoundOrders.forEach((order) => fills['all'].notFoundOrders.push(order));
          fills[purpose].filledOrders.forEach((order) => fills['all'].filledOrders.push(order));
          fills['all'].buyFilledAmount += fills[purpose].buyFilledAmount;
          fills['all'].sellFilledAmount += fills[purpose].sellFilledAmount;
          fills['all'].buyFilledQuote += fills[purpose].buyFilledQuote;
          fills['all'].sellFilledQuote += fills[purpose].sellFilledQuote;
        }
      });

      const { fillsDb } = db;

      for (const purpose in fills) {
        const purposeFills = fills[purpose];

        if (purposeFills.partlyFilledOrders.length > 0 || purposeFills.filledOrders.length > 0) {
          const fill = new fillsDb({
            purpose,
            date: utils.unixTimeStampMs(),
            exchange: config.exchange,
            pair,
            isProcessed: false,
            ...purposeFills,
          });

          await fill.save();
        }
      }

      // Log results

      const formattedPair = /** @type {ParsedMarket} */ (this.parseMarket(pair));

      let logString = `orderUtils: ${samePurpose}dbOrders updated for ${callerModuleName} with ${updatedOrders.length} live orders${openOrdersString} on ${formattedPair.pair}.`;

      if (fills['all'].filledOrders.length > 0) {
        logString += ` ${fills['all'].filledOrders.length} orders filled.`;
      }

      if (fills['all'].partlyFilledOrders.length > 0) {
        logString += ` ${fills['all'].partlyFilledOrders.length} orders partially filled.`;
      }

      if (fills['all'].filledOrders.length > 0 || fills['all'].partlyFilledOrders.length > 0) {
        logString += ` Asks are filled with ${fills['all'].sellFilledAmount} ${formattedPair.coin1} (${fills['all'].sellFilledQuote} ${formattedPair.coin2})`;
        logString += ` and bids with ${fills['all'].buyFilledAmount} ${formattedPair.coin1} (${fills['all'].buyFilledQuote} ${formattedPair.coin2}).`;
      }

      log.log(logString);

      // Warn if most ladder orders are filled

      const ladderCount = tradeParams[`mm_ladderCount${moduleIndexString}`];

      if (ldFilledCount/ladderCount > 0.7) {
        log.warn(`orderUtils: ${ldFilledCount} of ${ladderCount} ld${moduleIndexString}-orders considered as filled.`);
      }
    } catch (e) {
      log.error(`Error in updateOrders(${paramString})-2 of ${callerModuleName} module: ${e}`);
      log.warn(`orderUtils: Because of error in updateOrders(), returning updated ${samePurpose}dbOrders, but the processing is finished partly.`);
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
   * @param {Object} [api=traderapi] Exchange API to use, it may be the second trading account (always makes a request, no cache). Default is the first trading API account.
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
        const exchangeOrders = isPerpetual ?
            await perpetualApi.getOpenOrders(pair) :
            await api.getOpenOrders(pair);

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
   * @return {Promise<Object[]>} Order book, cached or fresh
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

        log.log(`orderUtils: Returning cached ${pair} order book for ${moduleName} — ${result.bids.length} bids and ${result.asks.length} asks, term: ${isCacheValid} ms.`);
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
   * Refers to traderapi.getBalances, but caches request results.
   * Cache works with the first trading API account and 'trade' account/wallet type only. If the second trading API, perpetual API, or another account/wallet type is used, it always makes a request.
   * Returns socket data if available (no cache).
   * If cache data is outdated (balancesCachedValidMs), makes a new balances request.
   * @param {boolean} [nonzero=true] Filter out return zero balances. Anyway, store everything including zeroes.
   * @param {string} moduleName Name of module, which requested the method. For logging only.
   * @param {boolean} [noCache=false] If true, return fresh data (make a request unconditionally)
   * @param {'__contract' | '__spot' | string} [walletType] Account/wallet type. E.g., __spot, __contract, main, trade, margin, or 'full'.
   * @param {Object} [api=traderapi] Exchange API to use, it may be the second trading account (always makes a request, no cache). Default is the first trading API account.
   * @return {Promise<Object[] | { success: boolean, message: string } | undefined>} Account balances, cached or fresh
  */
  async getBalancesCached(nonzero = true, moduleName, noCache = false, walletType, api = traderapi) {
    let result;

    try {
      const onWhichAccount = api.isSecondAccount ? ' on second account' : '';

      const isPerpetual = Boolean(perpetualApi) && (!walletType || walletType === '__contract');

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

        log.log(`orderUtils: Returning cached balances for ${moduleName}, cache term: ${cacheTerm} ms. ${result.length} coin balances retrieved. ${coinString}`);
      } else {
        const balances = isPerpetual ?
            await perpetualApi.getBalances(false, walletType) :
            await api.getBalances(false, walletType);

        const b = utils.balanceHelper(balances, config.defaultPair);
        const coinString = isPerpetual ?
            `-> ${b.coin2s}.` :
            `-> ${b.coin1s}. ${b.coin2s}.`;

        log.log(`orderUtils: Getting fresh${walletTypeString} balances${onWhichAccount} for ${moduleName}… ${balances?.length} coin balances received. ${coinString}`);

        const errorMessage = balances?.message; // For some exchanges, getBalances() implementations may include 'message' error info

        if (balances && !errorMessage) {
          // Update cached balances
          if (!walletType && !api.isSecondAccount) {
            balancesCached.data = balances;
            balancesCached.timestamp = Date.now(); // in ms
          }

          result = utils.cloneArray(balances);
        } else {
          const message = `Unable to get${walletTypeString} balances${onWhichAccount}: ${errorMessage || '{ No details }'}`;
          log.warn(`orderUtils: ${message}`);

          return {
            success: false,
            message,
          };
        }
      }

      if (nonzero) {
        result = result.filter((crypto) => crypto.free || crypto.freezed);
      }
    } catch (e) {
      log.error(`Error in getBalancesCached() of ${moduleName} module: ${e}`);
    }

    return result;
  },
};
