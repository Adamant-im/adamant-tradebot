const COINDEAL = require('./api/coindeal_api');
const utils = require('../helpers/utils');

// API endpoints:
// https://apigateway.coindeal.com

const apiServer = 'https://apigateway.coindeal.com';

module.exports = (apiKey, secretKey, pwd, log, publicOnly = false) => {

  COINDEAL.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  return {
    getBalances(nonzero = true) {
      return new Promise((resolve, reject) => {
        COINDEAL.getUserAssets().then(function(data) {
          try {
            let assets = data;
            if (!assets) {
              assets = [];
            }
            let result = [];
            assets.forEach((crypto) => {
              result.push({
                code: crypto.symbol,
                free: +crypto.available,
                freezed: +crypto.reserved,
                total: +crypto.available + +crypto.reserved,
                btc: +crypto.estimatedBalanceBtc,
                usd: +crypto.estimatedBalanceUsd,
                pending: +crypto.pending,
              });
            });
            if (nonzero) {
              result = result.filter((crypto) => crypto.free || crypto.freezed);
            }
            // console.log(result);
            resolve(result);
          } catch (e) {
            resolve(false);
            log.warn('Error while processing getBalances() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request getBalances(nonzero: ${nonzero}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },
    getOpenOrders(pair) {
      pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        COINDEAL.getUserNowEntrustSheet(pair_.coin1, pair_.coin2).then(function(data) {
          try {
            let openOrders = data;
            if (!openOrders) {
              openOrders = [];
            }

            const result = [];
            openOrders.forEach((order) => {
              let orderStatus;
              switch (order.status) {
                case 'new':
                  orderStatus = 'new';
                  break;
                case 'canceled':
                  orderStatus = 'closed';
                  break;
                case 'filled':
                  orderStatus = 'filled';
                  break;
                case 'partiallyFilled':
                  orderStatus = 'part_filled';
                  break;
                case 'suspended':
                  break;
                case 'expired':
                  break;
                default:
                  break;
              }
              result.push({
                orderid: order.id.toString(),
                symbol: order.symbol,
                price: +order.price,
                side: order.side, // sell or buy
                type: order.type, // limit or market, etc.
                timestamp: order.createdAt,
                amount: +order.cumQuantity,
                amountExecuted: +order.cumQuantity - +order.quantity,
                amountLeft: +order.quantity,
                status: orderStatus,
                uid: order.clientOrderId.toString(),
                // coin2Amount: order.total,
                coinFrom: order.baseCurrency,
                coinTo: order.quoteCurrency,
              });
            });

            resolve(result);

          } catch (e) {
            resolve(false);
            log.warn('Error while processing getOpenOrders() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request getOpenOrders(pair: ${pair}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },
    cancelOrder(orderId) {
      /*
        Watch this: sometimes cancelled orders on Coindeal switched to "CANCELLING" state
        Balances stay frozen. To fix them, you need to contact Coindeal support.
      */
      return new Promise((resolve, reject) => {
        COINDEAL.cancelEntrustSheet(orderId).then(function(data) {
          try {
            if (data.id) {
              log.info(`Cancelling order ${orderId}…`);
              resolve(true);
            } else {
              log.info(`Order ${orderId} not found. Unable to cancel it.`);
              resolve(false);
            }
          } catch (e) {
            if (e instanceof SyntaxError) {
              /*
                Watch this: Sometimes you'll get <h2>The server returned a "404 Not Found".</h2> instead of JSON.
                This means this order does not exist.
              */
              resolve(false);
              log.warn(`Error while processing cancelOrder() request: ${e}. It seems the order ${orderId} does not exist.`);
            } else {
              resolve(false);
              log.warn(`Error while processing cancelOrder() request: ${e}. Data object I've got: ${data}.`);
            }
          };
        }).catch((err) => {
          log.warn(`API request ${arguments.callee.name}(orderId: ${orderId}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },
    getRates(pair) {
      pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        COINDEAL.stats().then(function(data2) {
          data2 = data2[pair_.coin1 + '_' + pair_.coin2];
          // console.log(data2);
          try {
            if (data2) {
              resolve({
                volume: +data2.baseVolume,
                volume_Coin2: +data2.quoteVolume,
                high: +data2.high24hr,
                low: +data2.low24hr,
                ask: +data2.lowestAsk,
                bid: +data2.highestBid,
              });
            } else {
              resolve(false);
            }
          } catch (e) {
            resolve(false);
            log.warn('Error while processing getRates() stats() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request getRates(pair: ${pair}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },

    placeOrder(orderType, pair, price, coin1Amount, limit = 1, coin2Amount, pairObj) {

      const pair_ = formatPairName(pair);
      let output = '';
      let message;
      const order = {};

      const type = (orderType === 'sell') ? 'sell' : 'buy';

      if (pairObj) { // Set precision (decimals)
        if (coin1Amount) {
          coin1Amount = (+coin1Amount).toFixed(pairObj.coin1Decimals);
        }
        if (coin2Amount) {
          coin2Amount = (+coin2Amount).toFixed(pairObj.coin2Decimals);
        }
        if (price) {
          price = (+price).toFixed(pairObj.coin2Decimals);
        }
      }

      if (limit) { // Limit order
        output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at ${price} ${pair_.coin2.toUpperCase()}.`;

        return new Promise((resolve, reject) => {
          COINDEAL.addEntrustSheet(pair_.pair, coin1Amount, price, type).then(function(data) {
            try {
              const result = data;
              if (result && result.id) {
                message = `Order placed to ${output} Order Id: ${result.id.toString()}.`;
                log.info(message);
                order.orderid = result.id.toString();
                order.message = message;
                resolve(order);
              } else {
                message = `Unable to place order to ${output} Check parameters and balances. Description: ${result.message}`;
                if (result.errors && result.errors.errors) {
                  message += `: ${result.errors.errors.join(', ')}`;
                }
                log.warn(message);
                order.orderid = false;
                order.message = message;
                resolve(order);
              }
            } catch (e) {
              message = 'Error while processing placeOrder() request: ' + e;
              log.warn(message);
              order.orderid = false;
              order.message = message;
              resolve(order);
            };
          }).catch((err) => {
            log.warn(`API request COINDEAL.addEntrustSheet-limit(pair: ${pair_.pair}, coin1Amount: ${coin1Amount}, price: ${price}, type: ${type}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
            resolve(undefined);
          });
        });

      } else { // Market order
        let size = 0;
        if (orderType === 'sell') {
          if (coin1Amount) {
            size = coin1Amount;
            output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market.`;
          } else {
            message = `Unable to place order to ${orderType} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market. Set ${pair_.coin1.toUpperCase()} amount.`;
            log.warn(message);
            order.orderid = false;
            order.message = message;
            return order;
          }
        } else { // buy
          if (coin2Amount) {
            output = `${orderType} ${pair_.coin1} for ${coin2Amount} ${pair_.coin2.toUpperCase()} at Market Price on ${pair} market.`;
          } else {
            message = `Unable to place order to ${orderType} ${pair_.coin1.toUpperCase()} for ${pair_.coin2.toUpperCase()} at Market Price on ${pair} market. Set ${pair_.coin2.toUpperCase()} amount.`;
            log.warn(message);
            order.orderid = false;
            order.message = message;
            return order;
          }
        }

        message = `Unable to place order to ${output} CoinDeal doesn't support Market orders yet.`;
        log.warn(message);
        order.orderid = false;
        order.message = message;
        return order;

      }
    },
    getOrderBook(pair) {
      const pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        COINDEAL.orderBook(pair_.pair).then(function(data) {
          try {
            let book = data;
            if (!book) {
              book = [];
            }
            const result = {
              bids: new Array(),
              asks: new Array(),
            };
            book.ask.forEach((crypto) => {
              result.asks.push({
                amount: +crypto.amount,
                price: +crypto.price,
                count: 1,
                type: 'ask-sell-right',
              });
            });
            result.asks.sort(function(a, b) {
              return parseFloat(a.price) - parseFloat(b.price);
            });
            book.bid.forEach((crypto) => {
              result.bids.push({
                amount: +crypto.amount,
                price: +crypto.price,
                count: 1,
                type: 'bid-buy-left',
              });
            });
            result.bids.sort(function(a, b) {
              return parseFloat(b.price) - parseFloat(a.price);
            });
            resolve(result);
          } catch (e) {
            resolve(false);
            log.warn('Error while processing orderBook() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request getOrderBook(pair: ${pair}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },
    getDepositAddress(coin) {
      return new Promise((resolve, reject) => {
        COINDEAL.getDepositAddress(coin).then(function(data) {
          data = data;
          try {
            if (data && data.items && data.items[0]) {
              resolve(data.items[0].address);
            } else {
              resolve(false);
            }
          } catch (e) {
            resolve(false);
            log.warn('Error while processing getDepositAddress() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request ${arguments.callee.name}(coin: ${coin}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },
  };
};

function formatPairName(pair) {
  let pair_; let coin1; let coin2;
  if (pair.indexOf('-') > -1) {
    pair_ = pair.replace('-', '').toUpperCase();
    [coin1, coin2] = pair.split('-');
  } else if (pair.indexOf('_') > -1) {
    pair_ = pair.replace('_', '').toUpperCase();
    [coin1, coin2] = pair.split('_');
  } else {
    pair_ = pair.replace('/', '').toUpperCase();
    [coin1, coin2] = pair.split('/');
  }

  return {
    pair: pair_,
    coin1: coin1.toUpperCase(),
    coin2: coin2.toUpperCase(),
  };
}
