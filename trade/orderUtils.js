const utils = require('../helpers/utils');
const config = require('../modules/configReader');
const log = require('../helpers/log');
const traderapi = require('./trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);
const db = require('../modules/DB');

module.exports = {

  /**
   * Parses a trade pair object: coin1, coin2, and decimals.
   * If not isPairParsed, then aPair is not a valid trading pair, and default pair returned
   * @param {String} aPair String to parse
   * @return {Object} or false
   */
  parseTradePair(aPair) {
    try {

      console.log(traderapi.marketInfo('KOM/USDT'));
      let pair = (aPair || '').toUpperCase().trim();
      let coin1Decimals = 8;
      let coin2Decimals = 8;
      let isPairParsed = true;
      let coin1; let coin2;

      if (!pair || pair.indexOf('/') === -1 || pair === config.pair) {

        // aPair is not a pair, or is a default pair

        if (pair !== config.pair) {
          isPairParsed = false;
        }

        if ((pair.indexOf('/') === -1) && letCoin1only) {

          // aPair is not a pair, may be a coin only
          coin1 = pair;
          if (coin1 === config.coin1) {
            coin1Decimals = config.coin1Decimals;
          }
          pair = null;
          coin2 = null;

        } else {

          // Set a default trading pair
          pair = config.pair;
          coin1Decimals = config.coin1Decimals;
          coin2Decimals = config.coin2Decimals;

        }

      }

      if (pair) {
        coin1 = pair.substr(0, pair.indexOf('/'));
        coin2 = pair.substr(pair.indexOf('/') + 1, pair.length);
      }

      return {
        pair,
        coin1,
        coin2,
        coin1Decimals,
        coin2Decimals,
        isPairParsed,
      };

    } catch (e) {
      log.warn(`Error in getPairObject() of ${utils.getModuleName(module.id)} module: ${e}.`);
      return false;
    }

  },

  async addOrder(orderType, pair, price, coin1Amount, limit, coin2Amount, pairObj, purpose = 'man') {

    let orderReq;

    try {

      const orderParamsString = `type=${orderType}, limit=${limit}, pair=${pair}, price=${limit === 1 ? price : 'Market'}, coin1Amount=${coin1Amount}, coin2Amount=${coin2Amount}`;
      log.log(`Placing an order from orderUtils.addOrder(): ${orderParamsString}`);

      orderReq = await traderapi.placeOrder(orderType, pair, price, coin1Amount, limit, coin2Amount, pairObj);
      if (orderReq && orderReq.orderid) {
        const { ordersDb } = db;
        const order = new ordersDb({
          _id: orderReq.orderid,
          date: utils.unix(),
          purpose: purpose,
          type: orderType,
          exchange: config.exchange,
          pair: pair,
          coin1: pairObj.coin1,
          coin2: pairObj.coin2,
          price: limit === 1 ? price : 'Market',
          coin1Amount: coin1Amount,
          coin2Amount: coin2Amount,
          LimitOrMarket: limit, // 1 for limit price. 0 for Market price.
          isProcessed: false,
          isExecuted: false,
          isCancelled: false,
        });
        await order.save();

        const limit_marketString = limit === 1 ? `at ${price.toFixed(pairObj.coin2Decimals)} ${pairObj.coin2}` : `at Market price`;
        const output = `${orderType} ${coin1Amount.toFixed(pairObj.coin1Decimals)} ${pairObj.coin1} ${limit_marketString}`;
        log.info(`Successfully executed ${purpose}-order to ${output}.`);

      } else {
        log.warn(`${config.notifyName} unable to execute ${purpose}-order with params: ${orderParamsString}. No order id returned.`);
      }

    } catch (e) {
      log.error(`Error in addOrder() of ${utils.getModuleName(module.id)} module: ` + e);
    }

    return orderReq;
  },
  /**
     * Updates local bot's orders database dbOrders, independent of its purpose
     * It looks all of current exchange orders in dbOrders
     * If found one, updates its status
     * If not found, closes it as not actual
    */
  async updateOrders(dbOrders, pair) {

    let updatedOrders = [];
    try {

      const exchangeOrders = await traderapi.getOpenOrders(pair);
      if (exchangeOrders) {
        // console.log('exchangeOrders:', exchangeOrders.length);
        for (const dbOrder of dbOrders) {

          let isLifeOrder = false;
          let isOrderFound = false;
          for (const exchangeOrder of exchangeOrders) {
            // console.log(dbOrder._id, exchangeOrder.orderid, exchangeOrder.status);
            if (dbOrder._id === exchangeOrder.orderid) {
              // console.log('========');
              // console.log('match:', dbOrder._id, exchangeOrder.orderid, exchangeOrder.status);
              // console.log(exchangeOrder);
              // console.log('========');
              isOrderFound = true;
              switch (exchangeOrder.status) {
                case 'new':
                  isLifeOrder = true;
                  break;
                case 'closed':
                  await dbOrder.update({
                    isProcessed: true,
                    isClosed: true,
                  }, true);
                  isLifeOrder = false;
                  log.log(`Updating (closing) ${dbOrder.purpose}-order with params: id=${dbOrder._id}, type=${dbOrder.type}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount}, coin2Amount=${dbOrder.coin2Amount}: order is closed.`);
                  break;
                case 'filled':
                  await dbOrder.update({
                    isProcessed: true,
                    isFilled: true,
                  }, true);
                  isLifeOrder = false;
                  log.log(`Updating (closing) ${dbOrder.purpose}-order with params: id=${dbOrder._id}, type=${dbOrder.type}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount}, coin2Amount=${dbOrder.coin2Amount}: order is filled.`);
                  break;
                case 'part_filled':
                  isLifeOrder = true;
                  if (dbOrder.coin1Amount > exchangeOrder.amountLeft) {
                    const prev_amount = dbOrder.coin1Amount;
                    await dbOrder.update({
                      isFilled: true,
                      coin1Amount: exchangeOrder.amountLeft,
                    }, true);
                    log.log(`Updating ${dbOrder.purpose}-order with params: id=${dbOrder._id}, type=${dbOrder.type}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${prev_amount}, coin2Amount=${dbOrder.coin2Amount}: order is partly filled. Amount left: ${dbOrder.coin1Amount}.`);
                  }
                  break;
                default:
                  isLifeOrder = true;
                  break;
              } // switch

            } // if match orderId

          } // for (const exchangeOrder of exchangeOrders)

          if (isOrderFound) {

            if (isLifeOrder) {
              updatedOrders.push(dbOrder);
            }

          } else {

            const cancelReq = await traderapi.cancelOrder(dbOrder._id, dbOrder.type, dbOrder.pair);
            if (cancelReq !== undefined) {
              log.log(`Updating (closing) ${dbOrder.purpose}-order with params: id=${dbOrder._id}, type=${dbOrder.type}, pair=${dbOrder.pair}, price=${dbOrder.price}, coin1Amount=${dbOrder.coin1Amount}, coin2Amount=${dbOrder.coin2Amount}: unable to find it in the exchangeOrders.`);
              await dbOrder.update({
                isProcessed: true,
                isClosed: true,
                isNotFound: true,
              }, true);
            } else {
              log.log(`Request to update (close) not found ${dbOrder.purpose}-order with id=${dbOrder._id} failed. Will try next time, keeping this order in the DB for now.`);
            }

          }

        } // for (const dbOrder of dbOrders)

      } else { // if exchangeOrders

        log.warn(`Unable to get exchangeOrders in updateOrders(), leaving dbOrders as is.`);
        updatedOrders = dbOrders;
      }

    } catch (e) {
      log.error(`Error in updateOrders() of ${utils.getModuleName(module.id)} module: ` + e);
    }

    return updatedOrders;

  },
};
