const Atomars = require('./atomars_api');
const apiServer = 'https://api.atomars.com/v1';
// const log = require('../helpers/log');
const $u = require('../helpers/utils');
const { SAT } = require('../helpers/const');

// API endpoints:
// https://api.atomars.com/v1

module.exports = (apiKey, secretKey, pwd, log, publicOnly = false) => {

  // apiKey = username
  // secretKey = password
  Atomars.setConfig(apiServer, apiKey, secretKey, log, publicOnly);

  return {
    getBalances(nonzero = true) {
      return new Promise((resolve, reject) => {
        Atomars.getUserAssets().then(function(data) {
          try {
            // console.log(data);
            let assets = JSON.parse(data).data.list;
            if (!assets) {
              assets = [];
            }
            let result = [];
            assets.forEach((crypto) => {
              result.push({
                code: crypto.currency.iso3.toUpperCase(),
                free: +(crypto.balance_available / SAT).toFixed(8),
                freezed: +((+crypto.balance - +crypto.balance_available) / SAT).toFixed(8),
                total: +(crypto.balance / SAT).toFixed(8),
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
          log.log(`API request getBalances(nonzero: ${nonzero}) of ${$u.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },
    getOpenOrders(pair) {
      pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        Atomars.getUserNowEntrustSheet().then(function(data) {
          try {
            // console.log(data);
            // console.log(2);

            let openOrders = JSON.parse(data).data.list;
            if (!openOrders) {
              openOrders = [];
            }

            const result = [];
            openOrders.forEach((order) => {
              // console.log(order);
              let orderStatus;
              // no docs for order status for Atomars
              // https://docs.atomars.com/#api-Private_API-Active_Orders
              switch (order.status) {
                case 'OPEN':
                  break;
                case 'CANCELED':
                  break;
                case 'FILLED':
                  break;
                case 'PARTIAL_FILED':
                  break;
                default:
                  break;
              }

              if (order.volume_done === order.volume) {
                orderStatus = 'filled';
              } else if (order.volume_done > 0) {
                orderStatus = 'part_filled';
              } else {
                orderStatus = 'new';
              }

              if (order.pair === pair_.pair) {
                result.push({
                  orderid: order.id.toString(),
                  symbol: order.pair,
                  price: +order.rate,
                  side: order.type, // Buy/Sell (0/1)
                  type: order.type_trade, // Limit/Market (0/1)
                  timestamp: order.time_create,
                  amount: +order.volume,
                  amountExecuted: +order.volume_done,
                  amountLeft: +order.volume - +order.volume_done,
                  status: orderStatus,
                  uid: order.id.toString(),
                  coin2Amount: +order.price,
                  coinFrom: pair_.coin1,
                  coinTo: pair_.coin2,
                });
              }
            });
            // console.log(result);
            // console.log(3);

            resolve(result);

          } catch (e) {
            resolve(false);
            log.warn('Error while processing getOpenOrders() request: ' + e);
          };
        }).catch((err) => {
          log.log(`API request getOpenOrders(pair: ${pair}) of ${$u.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },
    cancelOrder(orderId) {
      return new Promise((resolve, reject) => {
        Atomars.cancelEntrustSheet(orderId).then(function(data) {
          try {
            // console.log(data);
            if (JSON.parse(data).status === true) { // it may be false, 401, etc.
              log.info(`Cancelling order ${orderId}..`);
              resolve(true);
            } else {
              log.info(`Order ${orderId} not found. Unable to cancel it.`);
              resolve(false);
            }
          } catch (e) {
            resolve(undefined);
            log.warn('Error while processing cancelOrder() request: ' + e);
          };
        }).catch((err) => {
          log.log(`API request ${arguments.callee.name}(orderId: ${orderId}) of ${$u.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },
    getRates(pair) {
      pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        Atomars.ticker(pair_.pair).then(function(data) {
          data = JSON.parse(data).data;
          // console.log(data);
          try {
            Atomars.orderBook(pair_.pair).then(function(data2) {
              try {
                // console.log(data2);
                if (data2) {
                  data2 = parseOrderBook(data2);
                  resolve({
                    last: +data.last,
                    ask: +data2.asks[0].price,
                    bid: +data2.bids[0].price,
                    volume: +data.volume_24H, // coin1
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
              log.log(`API request getRates(pair: ${pair_.pair}) of ${$u.getModuleName(module.id)} module failed. ${err}.`);
              resolve(undefined);
            });

          } catch (e) {
            resolve(false);
            log.warn('Error while processing getRates() ticker() request: ' + e);
          };
        }).catch((err) => {
          log.log(`API request getRates(pair: ${pair_.pair}) of ${$u.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },
    placeOrder(orderType, pair, price, coin1Amount, limit = 1, coin2Amount, pairObj) {

      const pair_ = formatPairName(pair);
      let output = '';
      let message;
      const order = {};

      const side = (orderType === 'sell') ? 1 : 0; // Buy/Sell (0/1)

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

      if (limit) { // Limit order Limit/Market/Stop Limit/Quick Market (0/1/2/3)
        output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at ${price} ${pair_.coin2.toUpperCase()}.`;

        return new Promise((resolve, reject) => {
          Atomars.addEntrustSheet(pair_.pair, coin1Amount, price, side, 0).then(function(data) {
            try {
              // console.log(data);
              const result = JSON.parse(data);
              if (result.data && result.data.id) {
                message = `Order placed to ${output} Order Id: ${result.data.id.toString()}.`;
                log.info(message);
                order.orderid = result.data.id.toString();
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
            log.log(`API request Atomars.addEntrustSheet-limit(pair: ${pair_.pair}, coin1Amount: ${coin1Amount}, price: ${price}, side: ${side}, 0) of ${$u.getModuleName(module.id)} module failed. ${err}.`);
            resolve(undefined);
          }); ;
        });

      } else { // Market order Limit/Market/Stop Limit/Quick Market (0/1/2/3)
        // console.log(orderType, pair, price, coin1Amount, 'market', coin2Amount, pairObj);
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
            size = coin1Amount;
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
          Atomars.addEntrustSheet(pair_.pair, size, '', side, 1).then(function(data) {
            try {
              // console.log(data);
              const result = JSON.parse(data);
              if (result.data && result.data.id) {
                message = `Order placed to ${output} Order Id: ${result.data.id.toString()}.`;
                log.info(message);
                order.orderid = result.data.id.toString();
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
            log.log(`API request Atomars.addEntrustSheet-market(pair: ${pair_.pair}, size: ${size}, '', side: ${side}, 1) of ${$u.getModuleName(module.id)} module failed. ${err}.`);
            resolve(undefined);
          }); ;
        });
      }
    }, // placeOrder()
    getOrderBook(pair) {

      const pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        Atomars.orderBook(pair_.pair).then(function(data) {
          try {
            // console.log(data);
            resolve(parseOrderBook(data));
          } catch (e) {
            resolve(false);
            log.warn('Error while processing orderBook() request: ' + e);
          };
        }).catch((err) => {
          log.log(`API request getOrderBook(pair: ${pair}) of ${$u.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },
    getDepositAddress(coin) {
      return new Promise((resolve, reject) => {
        Atomars.getDepositAddress(coin, 0).then(function(data) {
          try {
            // console.log(data);
            const address = JSON.parse(data).data.address;
            if (address) {
              resolve(address);
            } else {
              resolve(false);
            }
          } catch (e) {
            resolve(false);
            log.warn('Error while processing getDepositAddress() request: ' + e);
          };
        }).catch((err) => {
          log.log(`API request ${arguments.callee.name}(coin: ${coin}) of ${$u.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });

    },
  };
};

function parseOrderBook(data) {
  let book = JSON.parse(data).data;
  if (!book) {
    book = [];
  }
  // console.log(book);
  const result = {
    bids: new Array(),
    asks: new Array(),
  };
  book.buy.forEach((crypto) => {
    result.bids.push({
      amount: crypto.volume,
      price: crypto.rate,
      count: crypto.count,
      type: 'bid-buy-left',
    });
  });
  result.bids.sort(function(a, b) {
    return parseFloat(b.price) - parseFloat(a.price);
  });
  book.sell.forEach((crypto) => {
    result.asks.push({
      amount: crypto.volume,
      price: crypto.rate,
      count: crypto.count,
      type: 'ask-sell-right',
    });
  });
  result.asks.sort(function(a, b) {
    return parseFloat(a.price) - parseFloat(b.price);
  });
  return result;
}

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

