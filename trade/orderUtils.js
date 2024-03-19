const constants = require('../helpers/const');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
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

module.exports = {
  readableModuleName: 'orderUtils',

  /**
   * Returns cross-type order
   * @param {String} type
   * @return {String}
   */
  crossType(type) {
    return type === 'buy' ? 'sell' : 'buy';
  },

  /**
   * Checks if it's enough balances to place an order
   * It uses second keypair, if set
   * E.g., Buy 2 BTC for 80,000 USDT on BTC/USDT
   * E.g., Sell 2 BTC for 80,000 USDT on BTC/USDT
   * @param {String} type buy | sell
   * @param {String} pair 'ADM/USDT' or pairObj from parseMarket()
   * @param {Number} base (When selling) Check if an account have enough base coin balance
   * @param {Number} quote (When buying) Check if an account have enough quote coin balance
   * @param {String} purpose Order purpose, e.g., pm
   * @param {String} additionalInfo E.g., ' to achieve 10.00 USDT price'. With leading space, no ending dot. Optional.
   * @param {String} moduleName For logging
   * @param {Object} api Set to traderapi2 if applicable
   * @return {Object<result, message>} Return error message only if you want to notify()
   */
  async isEnoughCoins(type, pair, base, quote, purpose, additionalInfo = '', moduleName, api = traderapi) {
    const logModule = `${utils.getModuleName(module.id)}/${moduleName}`;

    let pairObj;

    if (typeof pair === 'string') {
      pairObj = this.parseMarket(pair);
    } else {
      pairObj = pair;
    }

    if (typeof pairObj !== 'object') {
      log.warn(`${logModule}: Unable to check balances for placing ${purpose}-order. Unable to parse a market pair from '${pair}'.`);

      return {
        result: false,
      };
    }

    let balances;
    let onWhichAccount = '';

    if (api.isSecondAccount) {
      onWhichAccount = ' on second account';
      balances = await api.getBalances(false);
    } else {
      balances = await this.getBalancesCached(false, utils.getModuleName(module.id));
    }

    if (!balances) {
      log.warn(`${logModule}: Unable to receive balances${onWhichAccount} for placing ${purpose}-order.`);

      return {
        result: false,
      };
    }

    let balance1free; let balance2free;
    let balance1freezed; let balance2freezed;

    let isBalanceEnough = true;
    let output = '';

    try {
      balance1free = balances.filter((crypto) => crypto.code === pairObj.coin1)[0]?.free || 0;
      balance2free = balances.filter((crypto) => crypto.code === pairObj.coin2)[0]?.free || 0;
      balance1freezed = balances.filter((crypto) => crypto.code === pairObj.coin1)[0]?.freezed || 0;
      balance2freezed = balances.filter((crypto) => crypto.code === pairObj.coin2)[0]?.freezed || 0;

      let amount; let coin;
      let balanceFree; let balanceFreezed;
      let orderString;

      if (type === 'buy') {
        if (balance2free < quote) {
          // Not enough USDT balance to place buy tw-order for 40,000 USDT
          amount = quote.toFixed(pairObj.coin2Decimals);
          coin = pairObj.coin2;
          balanceFree = balance2free.toFixed(pairObj.coin2Decimals);
          balanceFreezed = balance2freezed.toFixed(pairObj.coin2Decimals);
          orderString = `${type} ${purpose}-order for ${amount} ${coin}`;
          isBalanceEnough = false;
        }
      } else {
        if (balance1free < base) {
          // Not enough BTC balance to place 1 BTC sell tw-order
          amount = base.toFixed(pairObj.coin1Decimals);
          coin = pairObj.coin1;
          balanceFree = balance1free.toFixed(pairObj.coin1Decimals);
          balanceFreezed = balance1freezed.toFixed(pairObj.coin1Decimals);
          orderString = `${amount} ${coin} ${type} ${purpose}-order`;
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
      log.warn(`${logModule}: Unable to process balances${onWhichAccount} for placing ${purpose}-order: ${e}`);

      return {
        result: false,
      };
    }
  },

  /**
   * Returns minimum order amount in coin1, allowed on the exchange, and upper bound for minimal order
   * Considers coin1MinAmount, coin2MinAmount (converted in coin1) set by an exchange
   * Or default values set in the config or by constants
   * @param {number} price Calculate min amount for a specific price, if coin2MinAmount is set for the trade pair. Optional.
   * @return {Object<number, number>} Minimum order amount, and upper bound for minimal order
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
            config.exchange_restrictions?.minOrderAmountUSD ??
            constants.DEFAULT_MIN_ORDER_AMOUNT_USD;
        minOrderAmount = exchangerUtils.convertCryptos('USD', config.coin1, defaultMinOrderAmountUSD).outAmount;

        const defaultMinOrderAmountUpperBoundUSD =
            config.exchange_restrictions?.minOrderAmountUpperBoundUSD ??
            constants.DEFAULT_MIN_ORDER_AMOUNT_UPPER_BOUND_USD;
        upperBound = exchangerUtils.convertCryptos('USD', config.coin1, defaultMinOrderAmountUpperBoundUSD).outAmount;
      }

      return {
        min: minOrderAmount,
        upperBound,
      };
    } catch (e) {
      log.warn(`Error in getMinOrderAmount() of ${utils.getModuleName(module.id)} module: ${e}.`);
    }
  },

  /**
   * Parses a market from string.
   * Then retrieves static info for a specific exchange: coin1, coin2, and decimals.
   * If an exchange is external, connect and retrieve market info, no socket
   * @param {String} pair String to parse, e.g., 'ETH/USDT'
   * @param {String} exchange Exchange to request market info. Optional, default to config.exchange.
   * @param {Boolean} noWarn Don't warn if we didn't receive market info. It may be because getMarkets() is not yet finished.
   * @return {Object|Boolean} { pair, coin1, coin2, coin1Decimals, coin2Decimals, isParsed, marketInfoSupported, exchangeApi } or false
   */
  parseMarket(pair, exchange, noWarn = false) {
    try {
      if (!pair || pair.indexOf('/') === -1) {
        log.warn(`orderUtils: parseMarket() is unable to parse a market pair from string '${pair}'. Returning 'false'.`);
        return false;
      }

      pair = pair.toUpperCase().trim();
      const [coin1, coin2] = pair.split('/');

      let exchangeApi;
      if (exchange) {
        exchangeApi = require('./trader_' + exchange.toLowerCase())(
            null, // API credentials
            null,
            null,
            log, // Same logger
            true, // publicOnly, no private endpoints
            undefined, // loadMarket, usually true by default
            false, // Don't connect socket
            false, // Don't connect socket
            undefined, // Use accountNo by default
            coin1, // Doesn't mean anything as we don't connect socket
            coin2,
        );
      } else {
        exchange = config.exchangeName;
        exchangeApi = traderapi;
      }

      const marketInfoSupported = exchangeApi.features().getMarkets;
      let marketInfo;
      if (marketInfoSupported) {
        marketInfo = exchangeApi.marketInfo(pair);
      }

      let isParsed = false;
      let coin1Decimals = 8; let coin2Decimals = 8;

      if (!marketInfo) {
        if (marketInfoSupported && !noWarn) {
          log.warn(`orderUtils: parseMarket() is unable to get info about ${pair} market on ${exchange} exchange. Returning default values for decimal places.`);
        }
      } else {
        coin1Decimals = marketInfo.coin1Decimals;
        coin2Decimals = marketInfo.coin2Decimals;
        isParsed = true;
      }

      return {
        pair,
        coin1,
        coin2,
        coin1Decimals,
        coin2Decimals,
        isParsed,
        marketInfoSupported,
        exchangeApi,
      };
    } catch (e) {
      log.warn(`Error in parseMarket() of ${utils.getModuleName(module.id)} module: ${e}. Returning 'false'.`);
      return false;
    }
  },

  /**
   * Places an order
   * @param {String} orderType 'buy or 'sell'
   * @param {String} pair Like 'ETH/USDT'
   * @param {Number} price Order price in case of limit order
   * @param {Number} coin1Amount
   * @param {Number} limit 1 for limit, 0 for market
   * @param {Number} coin2Amount
   * @param {String} purpose Order purpose to store in db
   * @param {Object} api Exchange API to use, can be a second trade account. If not set, the first account will be used.
   * @return {Object} Order db record
   */
  async addGeneralOrder(orderType, pair, price, coin1Amount, limit, coin2Amount, pairObj, purpose = 'man', api = traderapi) {
    let orderReq;

    try {
      let whichAccount = ''; let whichAccountMsg = ''; let isSecondAccountOrder;
      if (api.isSecondAccount) {
        isSecondAccountOrder = true;
        whichAccount = ' (using second account)';
        whichAccountMsg = '(_Using the second account_) ';
      } else {
        isSecondAccountOrder = undefined;
        api = traderapi;
      }

      const orderParamsString = `type=${orderType}, limit=${limit}, pair=${pair}, price=${limit === 1 ? price : 'Market'}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      log.log(`orderUtils: Placing an order${whichAccount} of ${orderParamsString}.`);

      orderReq = await api.placeOrder(orderType, pair, price, coin1Amount, limit, coin2Amount, pairObj);
      if (orderReq && orderReq.orderId) {
        const { ordersDb } = db;

        // Store coin1Amount and coin2Amount even in case of Market order (estimated)
        // It's to calculate statistics
        let isCoin1AmountEstimated;
        let coin1AmountEstimated = coin1Amount;
        if (!coin1AmountEstimated) {
          isCoin1AmountEstimated = true;
          if (price) {
            coin1AmountEstimated = coin2Amount / price;
          } else {
            const exchangerUtils = require('../helpers/cryptos/exchanger');
            coin1AmountEstimated = exchangerUtils.convertCryptos(pairObj.coin2, pairObj.coin1, coin2Amount).outAmount || null;
          }
        }
        let isCoin2AmountEstimated;
        let coin2AmountEstimated = coin2Amount;
        if (!coin2AmountEstimated) {
          isCoin2AmountEstimated = true;
          if (price) {
            coin2AmountEstimated = coin1Amount * price;
          } else {
            const exchangerUtils = require('../helpers/cryptos/exchanger');
            coin2AmountEstimated = exchangerUtils.convertCryptos(pairObj.coin1, pairObj.coin2, coin1Amount).outAmount || null;
          }
        }

        const order = new ordersDb({
          _id: orderReq.orderId,
          date: utils.unixTimeStampMs(),
          purpose,
          type: orderType,
          exchange: config.exchange,
          pair,
          coin1: pairObj.coin1,
          coin2: pairObj.coin2,
          price: limit ? price : 'Market',
          coin1Amount: coin1AmountEstimated,
          coin2Amount: coin2AmountEstimated,
          coin1AmountFilled: undefined,
          coin2AmountFilled: undefined,
          coin1AmountLeft: coin1AmountEstimated,
          coin2AmountLeft: coin2AmountEstimated,
          isCoin1AmountEstimated,
          isCoin2AmountEstimated,
          LimitOrMarket: limit, // 1 for limit price. 0 for Market price.
          isProcessed: limit ? false : true,
          isExecuted: false, // 'man' orders are not marked as executed
          isCancelled: false,
          isSecondAccountOrder,
          message: whichAccountMsg + orderReq?.message,
        });

        await order.save();

        const limit_marketString = limit === 1 ? `at ${price.toFixed(pairObj.coin2Decimals)} ${pairObj.coin2}` : 'at Market price';
        const output = coin1Amount ?
          `${orderType} ${coin1Amount.toFixed(pairObj.coin1Decimals)} ${pairObj.coin1} ${limit_marketString}` :
          `${orderType} ${pairObj.coin1} for ${coin2Amount.toFixed(pairObj.coin2Decimals)} ${pairObj.coin2}`;
        log.info(`orderUtils: Successfully executed ${purpose}-order${whichAccount} to ${output}.`);

        return order;
      } else {
        const details = orderReq?.message ? ` [${utils.trimAny(orderReq?.message, ' .')}].` : ' { No details }.';
        log.warn(`orderUtils: Unable to execute ${purpose}-order${whichAccount} with params: ${orderParamsString}.${details}`);
        return {
          message: whichAccountMsg + orderReq?.message,
        };
      }
    } catch (e) {
      log.error(`Error in addGeneralOrder() of ${utils.getModuleName(module.id)} module: ` + e);
    }
  },

  /**
   * Updates local bot's orders database dbOrders, independent of its purpose
   * It loops through all the orders in local dbOrders and compares them with the current exchange orders
   * If found one, updates its status.
   * If not found, closes it as not actual. Note: This method doesn't close ld-orders, as they may be saved but not exist.
   * Additionally, stores all order fills in the fillsDb
   * @param {Array<Object>} dbOrders Local orders database
   * @param {string} pair Trade pair to check orders from an exchange
   * @param {string} moduleName Name of the module, which requests the method. For logging only.
   * @param {boolean} [noCache=false] If true, get fresh data, not cached
   * @param {Object} [api=traderapi] Exchange API to use; may be a second trade account. If not set, the first account will be used.
   * @param {boolean} [hideNotOpened=true] Hide ld-order in states as Not opened, Filled, Cancelled (default)
   * @return {Array<Object>|Object} Updated local orders database, with or without details
  */
  async updateOrders(dbOrders, pair, moduleName, noCache = false, api = traderapi, hideNotOpened = true) {
    const paramString = `dbOrders-length: ${dbOrders.length}, pair: ${pair}, moduleName: ${moduleName}, noCache: ${noCache}, api: ${api}, hideNotOpened: ${hideNotOpened}`;

    let updatedOrders = [];

    const orderPurposes = require('./orderCollector').orderPurposes;
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

    let samePurpose; // If all of the orders are of same purpose, e.g., 'ld', moduleName receives value like 'Ladder:ld-'
    [moduleName, samePurpose = ''] = moduleName.split(':');

    try {
      const onWhichAccount = api.isSecondAccount ? ' (on second account)' : '';
      const exchangeOrders = await this.getOpenOrdersCached(pair, `${utils.getModuleName(module.id)}/${moduleName}`, noCache, api);

      log.log(`orderUtils: Updating ${dbOrders.length} ${samePurpose}dbOrders on ${pair} for ${moduleName}, noCache: ${noCache}, hideNotOpened: ${hideNotOpened}… Received ${exchangeOrders?.length} orders from the exchange.`);

      if (!exchangeOrders) {
        log.warn(`orderUtils: Unable to get exchangeOrders${onWhichAccount} in updateOrders(), leaving ${samePurpose}dbOrders as is.`);
        return dbOrders;
      }

      // If we don't trust the exchange API, it can return a false-empty order list even if there are orders. Re-check then.
      // Bullshit, but it's a reality. We'll deal with it.

      if (
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
          log.warn(`orderUtils: It seems ${config.exchangeName} API returned false empty order list: ${falseResultDetails}. Leaving ${samePurpose}dbOrders as is.`);
          return dbOrders;
        }
      }

      // Loop through all the orders in local dbOrders and compare them with the current exchange orders

      for (const dbOrder of dbOrders) {
        const orderInfoString = `${dbOrder.purpose}-order${dbOrder.subPurposeString || ''}${onWhichAccount} with params: id=${dbOrder._id}, type=${dbOrder.type}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount} (${dbOrder.coin1AmountLeft} left), coin2Amount=${dbOrder.coin2Amount}`;

        let isOrderFound = false;

        const coin1AmountBeforeIteration = dbOrder.coin1AmountLeft ?? dbOrder.coin1Amount;

        for (const exchangeOrder of exchangeOrders) {
          if (dbOrder._id?.toString() === exchangeOrder.orderId?.toString()) { // While dbOrders stores ids in native type (can be number), getOpenOrders always returns ids as strings
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

          const orderCollector = require('./orderCollector');
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
          });
        }
      }
    } catch (e) {
      log.error(`Error in updateOrders(${paramString})-1 of ${utils.getModuleName(module.id)} module: ${e}`);
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
          openOrdersString = ` (${orderCountHidden} not placed ld-orders are hidden)`;
        }
      } else {
        if (orderCountHidden > 0) {
          openOrdersString = ` (including ${orderCountHidden} not placed ld-orders)`;
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

      pair = this.parseMarket(pair);

      let logString = `orderUtils: ${samePurpose}dbOrders updated for ${moduleName} with ${updatedOrders.length} live orders${openOrdersString} on ${pair.pair}.`;

      if (fills['all'].filledOrders.length > 0) {
        logString += ` ${fills['all'].filledOrders.length} orders filled.`;
      }

      if (fills['all'].partlyFilledOrders.length > 0) {
        logString += ` ${fills['all'].partlyFilledOrders.length} orders partially filled.`;
      }

      if (fills['all'].filledOrders.length > 0 || fills['all'].partlyFilledOrders.length > 0) {
        logString += ` Asks are filled with ${fills['all'].sellFilledAmount} ${pair.coin1} (${fills['all'].sellFilledQuote} ${pair.coin2})`;
        logString += ` and bids with ${fills['all'].buyFilledAmount} ${pair.coin1} (${fills['all'].buyFilledQuote} ${pair.coin2}).`;
      }

      log.log(logString);

      if (ldFilledCount/tradeParams.mm_ladderCount > 0.7) {
        log.warn(`orderUtils: ${ldFilledCount} ld-orders considered as filled.`);
      }
    } catch (e) {
      log.error(`Error in updateOrders(${paramString})-2 of ${utils.getModuleName(module.id)} module: ${e}`);
      log.warn(`orderUtils: Because of error in updateOrders(), returning updated ${samePurpose}dbOrders, but the processing is finished partly.`);
    }

    return updatedOrders;
  },
};
