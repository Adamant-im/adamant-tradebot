const P2PB2B = require('./api/p2pb2b_api');
const utils = require('../helpers/utils');

// API endpoints:
// https://api.p2pb2b.io
const apiServer = 'https://api.p2pb2b.io';
const exchangeName = 'P2PB2B';

module.exports = (apiKey, secretKey, pwd, log, publicOnly = false) => {

  P2PB2B.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets on initialization
  let exchangeMarkets;
  let gettingMarkets;
  getMarkets();

  function getMarkets(pair) {
    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair];

    module.exports.gettingMarkets = true;
    return new Promise((resolve, reject) => {
      P2PB2B.markets().then(function(data) {
        try {
          let markets = data.result;
          if (!markets) {
            markets = {};
          }
          const result = {};
          Object.keys(markets).forEach((market) => {
            const pairFormatted = `${markets[market].stock.toUpperCase()}/${markets[market].money.toUpperCase()}`;
            result[pairFormatted] = {
              pairPlain: markets[market].name,
              coin1: markets[market].stock.toUpperCase(),
              coin2: markets[market].money.toUpperCase(),
              coin1Decimals: Number(markets[market].precision.stock),
              coin2Decimals: Number(markets[market].precision.money),
              // Not necessary
              // If the limit is 0, then this limit does not apply to this market
              coin1Precision: Number(markets[market].limits.step_size), // ~ if !== 0, utils.getPrecision(3) = 0.001
              coin2Precision: Number(markets[market].limits.tick_size),
              coin1MinAmount: Number(markets[market].limits.min_amount),
              coin1MaxAmount: Number(markets[market].limits.max_amount),
              coin2MinPrice: Number(markets[market].limits.min_price),
              coin2MaxPrice: Number(markets[market].limits.max_price),
              minTrade: Number(markets[market].limits.min_total), // in coin2
            };
          });

          if (Object.keys(result).length > 0) {
            module.exports.exchangeMarkets = result;
            log.log(`Received info about ${Object.keys(result).length} markets on ${exchangeName} exchange.`);
          }
          resolve(result);
        } catch (e) {
          resolve(false);
          log.warn('Error while processing getMarkets() request: ' + e);
        };
      }).catch((err) => {
        log.warn(`API request getMarkets() of ${utils.getModuleName(module.id)} module failed. ${err}`);
        resolve(undefined);
      }).finally(() => {
        module.exports.gettingMarkets = false;
      });
    });
  }

  return {
    get markets() {
      return module.exports.exchangeMarkets;
    },
    marketInfo(pair) {
      return getMarkets(pair);
    },
    features() {
      return {
        getMarkets: true,
        placeMarketOrder: false,
        getDepositAddress: false,
      };
    },

    getBalances(nonzero = true) {
      return new Promise((resolve, reject) => {
        P2PB2B.getBalances().then(function(data) {
          try {
            let assets = data.result;
            if (!assets) {
              assets = {};
            }
            let result = [];
            Object.keys(assets).forEach((crypto) => {
              result.push({
                code: crypto.toUpperCase(),
                free: +assets[crypto].available,
                freezed: +assets[crypto].freeze,
                total: +assets[crypto].available + +assets[crypto].freeze,
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
          log.warn(`API request getBalances(nonzero: ${nonzero}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },

    async getOpenOrders(pair) {
      let allOrders = [];
      let ordersInfo;
      let offset = 0;
      const limit = 100;

      do {
        ordersInfo = await this.getOpenOrdersPage(pair, offset, limit);
        allOrders = allOrders.concat(ordersInfo.result);
        offset += limit;
      } while (ordersInfo.result.length === limit);

      return allOrders;
    },

    getOpenOrdersPage(pair, offset = 0, limit = 100) {
      pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        P2PB2B.getOrders(pair_.pair, offset, limit).then(function(data) {
          try {
            let openOrders = data.result;
            if (!openOrders) {
              openOrders = [];
            }

            const result = [];
            openOrders.forEach((order) => {
              let orderStatus;
              if (order.left === order.amount) {
                orderStatus = 'new';
              } else if (order.left === '0') {
                orderStatus = 'filled';
              } else {
                orderStatus = 'part_filled';
              }

              result.push({
                orderid: order.orderId.toString(),
                symbol: order.market,
                price: +order.price,
                side: order.side, // 'buy' or 'sell'
                type: 1, // limit
                timestamp: order.timestamp,
                amount: +order.amount,
                amountExecuted: +order.dealStock,
                amountLeft: +order.left,
                status: orderStatus,
                // Not necessary
                // uid: order.uid.toString(),
                // coin2Amount: +order.total,
                // coinFrom: deformatPairName(order.market).coin1,
                // coinTo: deformatPairName(order.market).coin2,
              });
            });

            // That's not good, but sometimes API doesn't return limit-offset-total fields
            const total = data.total;

            resolve({ result, total });

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

    cancelOrder(orderId, side, pair) {
      pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        P2PB2B.cancelOrder(orderId, pair_.pair).then(function(data) {
          try {
            if (data.success) {
              log.log(`Cancelling order ${orderId}…`);
              resolve(true);
            } else {
              log.log(`Unable to cancel ${orderId}: ${data ? data.errorCode + ' ' + data.message : ' no details'}.`);
              resolve(false);
            }
          } catch (e) {
            resolve(false);
            log.warn('Error while processing cancelOrder() request: ' + e);
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
        P2PB2B.ticker(pair_.pair).then(function(data) {
          try {
            ticker = data.result;
            if (ticker && data.success) {
              resolve({
                ask: +ticker.ask,
                bid: +ticker.bid,
                volume: +ticker.volume,
                volumeInCoin2: +ticker.deal,
                high: +ticker.high,
                low: +ticker.low,
              });
            } else {
              resolve(false);
            }
          } catch (e) {
            resolve(false);
            log.warn('Error while processing getRates() request: ' + e);
          };
        }).catch((err) => {
          log.warn(`API request getRates(pair: ${pair_.pair}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },

    placeOrder(orderType, pair, price, coin1Amount, limit = 1, coin2Amount) {

      const pair_ = formatPairName(pair);
      let output = '';
      let message;
      const order = {};
      const type = orderType;

      if (!this.marketInfo(pair)) {
        log.warn(`Unable to place an order on ${exchangeName} exchange. I don't have info about market ${pair}.`);
        return undefined;
      }

      if (coin1Amount) {
        coin1Amount = (+coin1Amount).toFixed(this.marketInfo(pair).coin1Decimals);
      }
      if (coin2Amount) {
        coin2Amount = (+coin2Amount).toFixed(this.marketInfo(pair).coin2Decimals);
      }
      if (price) {
        price = (+price).toFixed(this.marketInfo(pair).coin2Decimals);
      }

      if (limit) { // Limit order
        output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at ${price} ${pair_.coin2.toUpperCase()}.`;

        return new Promise((resolve, reject) => {
          P2PB2B.addOrder(pair_.pair, coin1Amount, price, type).then(function(data) {
            try {
              const result = data.result;
              if (data.success && result && result.orderId) {
                message = `Order placed to ${output} Order Id: ${result.orderId.toString()}.`;
                log.info(message);
                order.orderid = result.orderId.toString();
                order.message = message;
                resolve(order);
              } else {
                message = `Unable to place order to ${output} Check parameters and balances. Description: ${data.errorCode} ${data.message}`;
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
            log.warn(`API request P2PB2B.addOrder-limit(pair: ${pair_.pair}, coin1Amount: ${coin1Amount}, price: ${price}, type: ${type}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
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

        message = `Unable to place order to ${output} ${exchangeName} doesn't support Market orders yet.`;
        log.warn(message);
        order.orderid = false;
        order.message = message;
        return order;
      }
    }, // placeOrder()

    getOrderBook(pair) {
      const pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        P2PB2B.orderBook(pair_.pair).then(function(data) {
          try {
            let book = data.result;
            if (!book) {
              book = [];
            }
            const result = {
              bids: new Array(),
              asks: new Array(),
            };
            book.asks.forEach((crypto) => {
              result.asks.push({
                amount: +crypto[1],
                price: +crypto[0],
                count: 1,
                type: 'ask-sell-right',
              });
            });
            result.asks.sort(function(a, b) {
              return parseFloat(a.price) - parseFloat(b.price);
            });
            book.bids.forEach((crypto) => {
              result.bids.push({
                amount: +crypto[1],
                price: +crypto[0],
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
      // Not available for P2PB2B
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

function deformatPairName(pair) {
  const [coin1, coin2] = pair.split('_');
  pair = `${coin1}/${coin2}`;
  return {
    pair: pair.toUpperCase(),
    coin1: coin1.toUpperCase(),
    coin2: coin2.toUpperCase(),
  };
}
