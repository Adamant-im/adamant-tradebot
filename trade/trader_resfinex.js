const RESFINEX = require('./api/resfinex_api');
const utils = require('../helpers/utils');

// API endpoints:
// https://api.resfinex.com/
const apiServer = 'https://api.resfinex.com';

module.exports = (apiKey, secretKey, pwd, log, publicOnly = false) => {

  RESFINEX.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  return {
    getBalances(nonzero = true) {
      return new Promise((resolve, reject) => {
        RESFINEX.getUserAssets().then(function(data) {
          try {
            let assets = data.data;
            if (!assets) {
              assets = [];
            }
            let result = [];
            assets.forEach((crypto) => {
              result.push({
                code: crypto.sym,
                free: +crypto.total - +crypto.inorder,
                freezed: +crypto.inorder,
                total: +crypto.total,
              });
            });
            if (nonzero) {
              result = result.filter((crypto) => crypto.free || crypto.freezed);
            }
            resolve(result);
          } catch (e) {
            resolve(false);
            log.warn('Error while processing getBalances() request: ' + e);
          };
        }).catch((err) => {
          log.log(`API request getBalances(nonzero: ${nonzero}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },
    getOpenOrders(pair) {
      pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        RESFINEX.getUserNowEntrustSheet(pair_.coin1, pair_.coin2).then(function(data) {
          try {
            // console.log(2);
            // console.log(data);

            let openOrders = data.data;
            if (!openOrders) {
              openOrders = [];
            }

            const result = [];

            // this doesn't work as Resfinex don't update orders' statuses
            openOrders.forEach((order) => {
              let orderStatus;
              switch (order.status) {
                case 'OPEN':
                  orderStatus = 'new';
                  break;
                case 'CANCELED':
                  orderStatus = 'closed';
                  break;
                case 'FILLED':
                  orderStatus = 'filled';
                  break;
                case 'PARTIAL_FILED':
                  orderStatus = 'part_filled';
                  break;
                case 'SUBMITTING':
                  orderStatus = order.status;
                  break;
                default:
                  orderStatus = order.status;
                  break;
              }

              // so we need to update orders' statuses our own way
              if (order.amount === order.filled) {
                orderStatus = 'filled';
              } else if (order.filled > 0) {
                orderStatus = 'part_filled';
              }

              result.push({
                orderid: order.orderId.toString(),
                symbol: order.pair,
                price: +order.price,
                side: order.side, // SELL or BUY
                type: order.type, // LIMIT or MARKET, etc.
                timestamp: order.timestamp,
                amount: +order.amount,
                amountExecuted: +order.filled,
                amountLeft: +order.amount - +order.filled,
                status: orderStatus, // OPEN, etc.
                uid: order.orderId.toString(),
                // coin2Amount: order.total,
                // coinFrom: order.baseCurrency,
                // coinTo: order.quoteCurrency
              });
            });
            // console.log(result[0]);
            // console.log(3);

            resolve(result);

          } catch (e) {
            resolve(false);
            log.warn('Error while processing getOpenOrders() request: ' + e);
          };
        }).catch((err) => {
          log.log(`API request getOpenOrders(pair: ${pair}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },
    cancelOrder(orderId) {
      /*
        Watch this: some orders on Resfinex are impossible to cancel, even on Resfinex UI
        API returns "ok", but order persists
      */
      return new Promise((resolve, reject) => {
        RESFINEX.cancelEntrustSheet(orderId).then(function(data) {
          try {
            if (data.status === 'ok') {
              log.log(`Cancelling order ${orderId}…`);
              resolve(true);
            } else {
              log.log(`Order ${orderId} not found. Unable to cancel it.`);
              resolve(false);
            }
          } catch (e) {
            resolve(undefined);
            log.warn('Error while processing cancelOrder() request: ' + e);
          };
        }).catch((err) => {
          log.log(`API request ${arguments.callee.name}(orderId: ${orderId}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },
    getRates(pair) {
      pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        RESFINEX.ticker(pair_.pair).then(function(data) {
          data = data.data;
          data = data.filter((symbol) => symbol.pair === pair_.pair)[0];
          try {
            RESFINEX.orderBook(pair_.pair, 1).then(function(data2) {
              data2 = data2.data;
              try {
                if (data2) {
                  resolve({
                    ask: +data2.asks[0].price,
                    bid: +data2.bids[0].price,

                    volume: +data.volumeBase,
                    volume_Coin2: +data.volume,
                    high: +data.high,
                    low: +data.low,
                  });
                } else {
                  resolve(false);
                }
              } catch (e) {
                resolve(false);
                log.warn('Error while processing getRates() orderBook() request: ' + e);
              };
            }).catch((err) => {
              log.log(`API request getRates(pair: ${pair_.pair}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
              resolve(undefined);
            });
          } catch (e) {
            resolve(false);
            log.warn('Error while processing getRates() ticker() request: ' + e);
          };
        }).catch((err) => {
          log.log(`API request getRates(pair: ${pair_.pair}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },
    placeOrder(orderType, pair, price, coin1Amount, limit = 1, coin2Amount, pairObj) {

      const pair_ = formatPairName(pair);
      let output = '';
      let message;
      const order = {};

      const side = (orderType === 'sell') ? 'SELL' : 'BUY';

      if (!coin1Amount && coin2Amount && price) { // both LIMIT and MARKET order amount are in coin1
        coin1Amount = coin2Amount / price;
      }

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
          RESFINEX.addEntrustSheet(pair_.pair, coin1Amount, price, side, 'LIMIT').then(function(data) {
            try {
              const result = data;
              if (result.data && result.data.orderId) {
                message = `Order placed to ${output} Order Id: ${result.data.orderId.toString()}.`;
                log.info(message);
                order.orderid = result.data.orderId.toString();
                order.message = message;
                resolve(order);
              } else {
                message = `Unable to place order to ${output} Check parameters and balances.`;
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
            log.log(`API request RESFINEX.addEntrustSheet-limit(pair: ${pair_.pair}, coin1Amount: ${coin1Amount}, price: ${price}, side: ${side}, 'LIMIT') of ${utils.getModuleName(module.id)} module failed. ${err}.`);
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
          if (coin1Amount) {
            output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market.`;
          } else {
            message = `Unable to place order to ${orderType} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market. Set ${pair_.coin1.toUpperCase()} amount.`;
            log.warn(message);
            order.orderid = false;
            order.message = message;
            return order;
          }
        }

        return new Promise((resolve, reject) => {
          RESFINEX.addEntrustSheet(pair_.pair, coin1Amount, '', side, 'MARKET').then(function(data) {
            try {
              const result = data;
              if (result.data && result.data.orderId) {
                message = `Order placed to ${output} Order Id: ${result.data.orderId.toString()}.`;
                log.info(message);
                order.orderid = result.data.orderId.toString();
                order.message = message;
                resolve(order);
              } else {
                message = `Unable to place order to ${output} Check parameters and balances.`;
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
            log.log(`API request RESFINEX.addEntrustSheet-market(pair: ${pair_.pair}, coin1Amount: ${coin1Amount}, '', side: ${side}, 'MARKET') of ${utils.getModuleName(module.id)} module failed. ${err}.`);
            resolve(undefined);
          });
        });
      }
    }, // placeOrder()
    getOrderBook(pair) {

      const pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        RESFINEX.orderBook(pair_.pair).then(function(data) {
          try {
            let book = data.data;
            if (!book) {
              book = [];
            }
            const result = {
              bids: new Array(),
              asks: new Array(),
            };
            book.asks.forEach((crypto) => {
              result.asks.push({
                amount: crypto.amount,
                price: crypto.price,
                count: 1,
                type: 'ask-sell-right',
              });
            });
            result.asks.sort(function(a, b) {
              return parseFloat(a.price) - parseFloat(b.price);
            });
            book.bids.forEach((crypto) => {
              result.bids.push({
                amount: crypto.amount,
                price: crypto.price,
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
          log.log(`API request getOrderBook(pair: ${pair}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },
    getDepositAddress(coin) {
      // Not available for Resfinex
    },

  };
};

function formatPairName(pair) {
  if (pair.indexOf('-') > -1) {
    pair = pair.replace('-', '_').toUpperCase();
  } else {
    pair = pair.replace('/', '_').toUpperCase();
  }
  const [coin1, coin2] = pair.split('_');
  return {
    pair,
    coin1: coin1.toUpperCase(),
    coin2: coin2.toUpperCase(),
  };
}
