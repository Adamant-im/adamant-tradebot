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

const MAX_SMALL_ORDER_USD = 10;

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
   * Returns minimum order amount in coin1, allowed on the exchange, and upper bound for minimal order
   * Consider mm_minAmount and exchange's coin1MinAmount, coin2MinAmount in coin1
   * With reliabilityKoef
   * @param {Number} price Calculate min amount for a specific price, if coin2MinAmount is set for the trade pair. Optional.
   * @return {Object<Number, Number>} Minimum order amount, and upper bound for minimal order
   */
  getMinOrderAmount(price) {
    const reliabilityKoef = 1.1;
    let minOrderAmount = tradeParams.mm_minAmount * reliabilityKoef;

    const exchangerUtils = require('../helpers/cryptos/exchanger');
    try {
      const coin1MinAmount = traderapi.marketInfo(config.pair)?.coin1MinAmount * reliabilityKoef;
      if (utils.isPositiveNumber(coin1MinAmount)) {
        minOrderAmount = coin1MinAmount;
      }

      const coin2MinAmount = traderapi.marketInfo(config.pair)?.coin2MinAmount * reliabilityKoef;
      if (utils.isPositiveNumber(coin2MinAmount)) {
        let coin2MinAmountInCoin1;

        if (utils.isPositiveNumber(price)) {
          coin2MinAmountInCoin1 = coin2MinAmount / price;
        } else {
          coin2MinAmountInCoin1 = exchangerUtils.convertCryptos(config.coin2, config.coin1, coin2MinAmount).outAmount || null;
        }

        if (utils.isPositiveNumber(coin2MinAmountInCoin1)) {
          if (utils.isPositiveNumber(coin1MinAmount)) {
            minOrderAmount = Math.max(coin1MinAmount, coin2MinAmountInCoin1);
          } else {
            minOrderAmount = coin2MinAmountInCoin1;
          }
        }
      }
    } catch (e) {
      log.warn(`Error in getMinOrderAmount() of ${utils.getModuleName(module.id)} module: ${e}. Returning mm_minAmount.`);
    }

    let upperBound = Math.max(tradeParams.mm_minAmount, minOrderAmount) * 2;
    const maxSmallOrderInCoin1 = exchangerUtils.convertCryptos('USD', config.coin1, MAX_SMALL_ORDER_USD).outAmount || upperBound;
    upperBound = Math.min(upperBound, maxSmallOrderInCoin1);

    return {
      min: minOrderAmount,
      upperBound,
    };
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
   * It looks through all of current exchange orders in dbOrders
   * If found one, updates its status. If not found, closes it as not actual.
   * Note: This method don't close ld-orders, as they may be saved, but not exist.
   * @param {Array of Object} dbOrders Local orders database
   * @param {String} pair Trade pair to check orders from exchange
   * @param {String} moduleName Name of module, which requests the method. For logging only.
   * @param {Boolean} noCache If true, get fresh data, not cached
   * @param {Object} api Exchange API to use, can be a second trade account. If not set, the first account will be used.
   * @param {Boolean} hideNotOpened Hide ld-order in states as Not opened, Filled, Cancelled (default)
   * @return {Array of Object} Updated local orders database
  */
  async updateOrders(dbOrders, pair, moduleName, noCache = false, api = traderapi, hideNotOpened = true) {
    const paramString = `dbOrders: ${dbOrders}, pair: ${pair}, moduleName: ${moduleName}, noCache: ${noCache}, api: ${api}, hideNotOpened: ${hideNotOpened}`;
    let updatedOrders = [];
    let ldFilledCount = 0;

    let samePurpose;
    [moduleName, samePurpose] = moduleName.split(':');
    samePurpose = samePurpose || '';

    try {
      const onWhichAccount = api.isSecondAccount ? ' (on second account)' : '';
      const exchangeOrders = await api.getOpenOrders(pair);

      log.log(`orderUtils: Updating ${dbOrders.length} ${samePurpose}dbOrders on ${pair} for ${moduleName}, noCache: ${noCache}, hideNotOpened: ${hideNotOpened}… Received ${exchangeOrders?.length} orders from exchange.`);

      if (exchangeOrders) {

        // If we don't trust exchange API, it can return false empty order list even if there are orders. Re-check then.
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

        for (const dbOrder of dbOrders) {

          const orderInfoString = `${dbOrder.purpose}-order${onWhichAccount} with params: id=${dbOrder._id}, type=${dbOrder.type}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1AmountInitial || dbOrder.coin1Amount}, coin2Amount=${dbOrder.coin2Amount}`;

          let isLifeOrder = false;
          let isOrderFound = false;
          for (const exchangeOrder of exchangeOrders) {
            if (dbOrder._id?.toString() === exchangeOrder.orderId?.toString()) {
              isOrderFound = true;
              switch (exchangeOrder.status) {
                // Possible values: new, part_filled, filled
                // But because we get only life orders, actually statuses are: new, part_filled
                case 'new':
                  isLifeOrder = true;
                  break;
                case 'part_filled':
                  isLifeOrder = true;

                  if (dbOrder.coin1Amount > exchangeOrder.amountLeft) {
                    if (dbOrder.purpose === 'ld') {
                      dbOrder.update({
                        ladderState: 'Partly filled',
                      });
                    }

                    if (!dbOrder.coin1AmountInitial) {
                      dbOrder.coin1AmountInitial = dbOrder.coin1Amount;
                      dbOrder.amountUpdateCount = 0;
                    }

                    await dbOrder.update({
                      isExecuted: true,
                      coin1Amount: exchangeOrder.amountLeft,
                      amountUpdateCount: dbOrder.amountUpdateCount + 1,
                    }, true);

                    log.log(`orderUtils: Updating ${orderInfoString}. It's partly filled (${utils.inclineNumber(dbOrder.amountUpdateCount)} update): ${dbOrder.coin1AmountInitial} -> ${dbOrder.coin1Amount} ${dbOrder.coin1}.`);
                  }
                  break;
                default:
                  isLifeOrder = true;
                  break;
              }
            } // if match orderId
          } // for (const exchangeOrder of exchangeOrders)

          if (isOrderFound) {
            if (isLifeOrder) {
              updatedOrders.push(dbOrder);
            }
          } else {
            if (dbOrder.purpose === 'ld') {
              const previousState = dbOrder.ladderState;

              if (constants.LADDER_OPENED_STATES.includes(previousState)) {
                dbOrder.update({
                  ladderState: 'Filled',
                });

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

              if (!cancellation.isCancelRequestProcessed) {
                updatedOrders.push(dbOrder);
              }
            }
          }

        } // for (const dbOrder of dbOrders)
      } else { // if exchangeOrders
        log.warn(`orderUtils: Unable to get exchangeOrders${onWhichAccount} in updateOrders(), leaving ${samePurpose}dbOrders as is.`);
        return dbOrders;
      }
    } catch (e) {
      log.error(`Error in updateOrders(${paramString}) of ${utils.getModuleName(module.id)} module: ${e}`);
      log.warn(`orderUtils: Because of error in updateOrders(), returning ${samePurpose}dbOrders before processing finished. It may be partly modified.`);
      return dbOrders;
    }

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

    log.log(`orderUtils: ${samePurpose}dbOrders updated for ${moduleName} with ${updatedOrders.length} live orders${openOrdersString} on ${pair}.`);
    if (ldFilledCount/tradeParams.mm_ladderCount > 0.7) {
      log.warn(`orderUtils: ${ldFilledCount} orders considered as filled.`);
    }

    return updatedOrders;
  },
};
