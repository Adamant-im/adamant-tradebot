const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');

module.exports = {

  /**
   * Parses a market info for specific exchange: coin1, coin2, and decimals.
   * @param {String} pair String to parse
   * @return {Object} or false
   */
  parseMarket(pair, exchange, noWarn = false) {
    try {
      if (!pair || pair.indexOf('/') === -1) {
        log.warn(`orderUtils: Unable to parse market pair from '${pair}'. Returning 'false'.`);
        return false;
      }

      pair = pair.toUpperCase().trim();
      const [coin1, coin2] = pair.split('/');

      let exchangeApi;
      if (exchange) {
        exchangeApi = require('./trader_' + exchange.toLowerCase())(null, null, null, log, true);
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
          log.warn(`orderUtils: Unable to get info about ${pair} market on ${exchange} exchange. Returning default values for decimal places.`);
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
      };
    } catch (e) {
      log.warn(`Error in parseMarket() of ${utils.getModuleName(module.id)} module: ${e}. Returning 'false'.`);
      return false;
    }
  },

  async addGeneralOrder(orderType, pair, price, coin1Amount, limit, coin2Amount, pairObj, purpose = 'man', api) {
    let orderReq;

    try {
      let whichAccount = ''; let isSecondAccountOrder;
      if (api) {
        isSecondAccountOrder = true;
        whichAccount = ' (using second account)';
      } else {
        isSecondAccountOrder = undefined;
        api = traderapi;
      }

      const orderParamsString = `type=${orderType}, limit=${limit}, pair=${pair}, price=${limit === 1 ? price : 'Market'}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      log.log(`orderUtils: Placing an order${whichAccount} of ${orderParamsString}.`);

      orderReq = await api.placeOrder(orderType, pair, price, coin1Amount, limit, coin2Amount, pairObj);
      if (orderReq && orderReq.orderid) {
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
          _id: orderReq.orderid,
          date: utils.unixTimeStampMs(),
          purpose: purpose,
          type: orderType,
          exchange: config.exchange,
          pair: pair,
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
          message: orderReq.message,
        });
        await order.save();

        const limit_marketString = limit === 1 ? `at ${price.toFixed(pairObj.coin2Decimals)} ${pairObj.coin2}` : `at Market price`;
        const output = coin1Amount ?
          `${orderType} ${coin1Amount.toFixed(pairObj.coin1Decimals)} ${pairObj.coin1} ${limit_marketString}` :
          `${orderType} ${pairObj.coin1} for ${coin2Amount.toFixed(pairObj.coin2Decimals)} ${pairObj.coin2}`;
        log.info(`orderUtils: Successfully executed ${purpose}-order${whichAccount} to ${output}.`);

        return order;
      } else {
        const details = orderReq?.message ? ` [${utils.trimAny(orderReq?.message, ' .')}].` : ' { No details }.';
        log.warn(`orderUtils: Unable to execute ${purpose}-order${whichAccount} with params: ${orderParamsString}.${details}`);
        return {
          message: orderReq?.message,
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
   * @param {Array of Object} dbOrders Local orders database
   * @param {String} pair Trade pair to check orders from exchange
   * @param {String} moduleName Name of module, which requests the method. For logging only.
   * @param {Boolean} noCache If true, get fresh data, not cached
   * @param {Object} api If api is set, consider we check orders from second trade account
   * @return {Array of Object} Updated local orders database
  */
  async updateOrders(dbOrders, pair, moduleName, noCache = false, api) {
    let updatedOrders = [];

    try {
      let onWhichAccount = '';
      let exchangeOrders;
      if (api) {
        onWhichAccount = ' (on second account)';
        exchangeOrders = await api.getOpenOrders(pair);
      } else {
        api = traderapi;
        exchangeOrders = await api.getOpenOrders(pair);
      }

      if (exchangeOrders) {
        for (const dbOrder of dbOrders) {

          let isLifeOrder = false;
          let isOrderFound = false;
          for (const exchangeOrder of exchangeOrders) {
            if (dbOrder._id?.toString() === exchangeOrder.orderid?.toString()) {
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
                    const prev_amount = dbOrder.coin1Amount;
                    await dbOrder.update({
                      isExecuted: true,
                      coin1Amount: exchangeOrder.amountLeft,
                    }, true);
                    log.log(`orderUtils: Updating ${dbOrder.purpose}-order${onWhichAccount} with params: id=${dbOrder._id}, type=${dbOrder.type}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${prev_amount}, coin2Amount=${dbOrder.coin2Amount}: order is partly filled. Amount left: ${dbOrder.coin1Amount}.`);
                  }
                  break;
                case 'closed': // not expected
                  await dbOrder.update({
                    isProcessed: true,
                    isClosed: true,
                  }, true);
                  isLifeOrder = false;
                  log.log(`orderUtils: Updating (closing) ${dbOrder.purpose}-order${onWhichAccount} with params: id=${dbOrder._id}, type=${dbOrder.type}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount}, coin2Amount=${dbOrder.coin2Amount}: order is closed.`);
                  break;
                case 'filled': // not expected
                  await dbOrder.update({
                    isProcessed: true,
                    isExecuted: true,
                  }, true);
                  isLifeOrder = false;
                  log.log(`orderUtils: Updating (closing) ${dbOrder.purpose}-order${onWhichAccount} with params: id=${dbOrder._id}, type=${dbOrder.type}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount}, coin2Amount=${dbOrder.coin2Amount}: order is filled.`);
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
            const cancelReq = await api.cancelOrder(dbOrder._id, dbOrder.type, dbOrder.pair);
            const orderInfoString = `${dbOrder.purpose}-order${onWhichAccount} with params: id=${dbOrder._id}, type=${dbOrder.type}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount}, coin2Amount=${dbOrder.coin2Amount}`;
            if (cancelReq !== undefined) {
              if (cancelReq) {
                dbOrder.update({
                  isProcessed: true,
                  isCancelled: true,
                  isClosed: true,
                  isNotFound: true,
                });
                log.log(`orderUtils: Successfully cancelled ${orderInfoString}. Unable to find it in the exchangeOrders.`);
              } else {
                dbOrder.update({
                  isProcessed: true,
                  isClosed: true,
                  isNotFound: true,
                });
                log.log(`orderUtils: Unable to cancel ${orderInfoString}. Unable to find it in the exchangeOrders and probably it doesn't exist anymore. Making it as closed.`);
              }
              await dbOrder.save();
            } else {
              log.log(`orderUtils: Request to update (close) not found ${orderInfoString} failed. Will try next time, keeping this order in the DB for now.`);
            }
          }

        } // for (const dbOrder of dbOrders)
      } else { // if exchangeOrders
        log.warn(`orderUtils: Unable to get exchangeOrders${onWhichAccount} in updateOrders(), leaving dbOrders as is.`);
        updatedOrders = dbOrders;
      }
    } catch (e) {
      log.error(`Error in updateOrders() of ${utils.getModuleName(module.id)} module: ` + e);
    }

    return updatedOrders;
  },
};
