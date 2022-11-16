const RESFINEX = require('./api/resfinex_api');
const utils = require('../helpers/utils');

// API endpoints:
// https://api.resfinex.com/
const apiServer = 'https://api.resfinex.com';
const exchangeName = 'Resfinex';

module.exports = (apiKey, secretKey, pwd, log, publicOnly = false) => {
  const RESFINEXClient = RESFINEX();

  RESFINEXClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets on initialization
  let exchangeMarkets;
  let gettingMarkets;
  getMarkets();

  function getMarkets(pair) {
    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair];

    module.exports.gettingMarkets = true;
    return new Promise((resolve, reject) => {
      RESFINEXClient.markets().then(function(data) {
        try {
          let markets = data.data.pairs;
          if (!markets) {
            markets = [];
          }
          let coins = data.data.coins;
          if (!coins) {
            coins = [];
          }
          const result = {};
          markets.forEach((market) => {
            const pairFormatted = `${market.primary.toUpperCase()}/${market.secondary.toUpperCase()}`;

            // Here we can get also withdrawalFee, withdrawalMin, tokenType, and other info
            const coin1info = coins.filter((coin) => coin.symbol.toUpperCase() === market.primary.toUpperCase())[0];

            result[pairFormatted] = {
              pairPlain: market.name,
              coin1: market.primary.toUpperCase(),
              coin2: market.secondary.toUpperCase(),
              coin1Decimals: +market.amountDecimal,
              coin2Decimals: +market.priceDecimal,
              coin1MinAmount: +coin1info?.minTrading, // but most do have null
              coin2MinAmount: +market.minBaseAmount,
              minTrade: +market.minBaseAmount, // in coin2
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
        placeMarketOrder: true,
        getDepositAddress: false,
        createDepositAddressWithWebsiteOnly: false,
        getFundHistory: false,
        getFundHistoryImplemented: false,
        allowAmountForMarketBuy: true,
        amountForMarketOrderNecessary: true,
      };
    },

    getBalances(nonzero = true) {
      return new Promise((resolve, reject) => {
        RESFINEXClient.getUserAssets().then(function(data) {
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
        RESFINEXClient.getUserNowEntrustSheet(pair_.coin1, pair_.coin2).then(function(data) {
          try {
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
                orderId: order.orderId.toString(),
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
        RESFINEXClient.cancelEntrustSheet(orderId).then(function(data) {
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
          log.log(`API request cancelOrder(orderId: ${orderId}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },
    getRates(pair) {
      pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        RESFINEXClient.ticker(pair_.pair).then(function(data) {
          data = data.data;
          data = data.filter((symbol) => symbol.pair === pair_.pair)[0];
          try {
            RESFINEXClient.orderBook(pair_.pair, 1).then(function(data2) {
              data2 = data2.data;
              try {
                if (data2) {
                  resolve({
                    ask: +data2.asks[0].price,
                    bid: +data2.bids[0].price,

                    volume: +data.volumeBase,
                    volumeInCoin2: +data.volume,
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
    placeOrder(orderType, pair, price, coin1Amount, limit = 1, coin2Amount) {

      const pair_ = formatPairName(pair);
      let output = '';
      let message;
      const order = {};

      const side = (orderType === 'sell') ? 'SELL' : 'BUY';

      if (!coin1Amount && coin2Amount && price) { // both LIMIT and MARKET order amount are in coin1
        coin1Amount = coin2Amount / price;
      }

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
          RESFINEXClient.addEntrustSheet(pair_.pair, coin1Amount, price, side, 'LIMIT').then(function(data) {
            try {
              const result = data;
              if (result.data && result.data.orderId) {
                message = `Order placed to ${output} Order Id: ${result.data.orderId.toString()}.`;
                log.info(message);
                order.orderId = result.data.orderId.toString();
                order.message = message;
                resolve(order);
              } else {
                const details = result?.msg ? ` Details: ${result?.code} ${utils.trimAny(result?.msg, ' .\n')}.` : ' { No details }.';
                message = `Unable to place order to ${output}${details} Check parameters and balances.`;
                log.warn(message);
                order.orderId = false;
                order.message = message;
                resolve(order);
              }
            } catch (e) {
              message = 'Error while processing placeOrder() request: ' + e;
              log.warn(message);
              order.orderId = false;
              order.message = message;
              resolve(order);
            };
          }).catch((err) => {
            log.log(`API request RESFINEXClient.addEntrustSheet-limit(pair: ${pair_.pair}, coin1Amount: ${coin1Amount}, price: ${price}, side: ${side}, 'LIMIT') of ${utils.getModuleName(module.id)} module failed. ${err}.`);
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
            order.orderId = false;
            order.message = message;
            return order;
          }
        } else { // buy
          if (coin1Amount) {
            output = `${orderType} ${coin1Amount} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market.`;
          } else {
            message = `Unable to place order to ${orderType} ${pair_.coin1.toUpperCase()} at Market Price on ${pair} market. Set ${pair_.coin1.toUpperCase()} amount.`;
            log.warn(message);
            order.orderId = false;
            order.message = message;
            return order;
          }
        }

        return new Promise((resolve, reject) => {
          RESFINEXClient.addEntrustSheet(pair_.pair, coin1Amount, '', side, 'MARKET').then(function(data) {
            try {
              const result = data;
              if (result.data && result.data.orderId) {
                message = `Order placed to ${output} Order Id: ${result.data.orderId.toString()}.`;
                log.info(message);
                order.orderId = result.data.orderId.toString();
                order.message = message;
                resolve(order);
              } else {
                const details = result?.msg ? ` Details: ${result?.code} ${utils.trimAny(result?.msg, ' .\n')}.` : ' { No details }.';
                message = `Unable to place order to ${output}${details} Check parameters and balances.`;
                log.warn(message);
                order.orderId = false;
                order.message = message;
                resolve(order);
              }
            } catch (e) {
              message = 'Error while processing placeOrder() request: ' + e;
              log.warn(message);
              order.orderId = false;
              order.message = message;
              resolve(order);
            };
          }).catch((err) => {
            log.log(`API request RESFINEXClient.addEntrustSheet-market(pair: ${pair_.pair}, coin1Amount: ${coin1Amount}, '', side: ${side}, 'MARKET') of ${utils.getModuleName(module.id)} module failed. ${err}.`);
            resolve(undefined);
          });
        });
      }
    }, // placeOrder()
    getOrderBook(pair) {

      const pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        RESFINEXClient.orderBook(pair_.pair).then(function(data) {
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
    getTradesHistory(pair) {

      const pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        RESFINEXClient.getTradesHistory(pair_.pair).then(function(data) {
          try {
            let trades = data.data;
            if (!trades) {
              trades = [];
            }

            const result = [];
            trades.forEach((trade) => {
              result.push({
                coin1Amount: +trade.amount, // amount in coin1
                price: +trade.price, // trade price
                coin2Amount: +trade.amount * +trade.price, // quote in coin2
                date: trade.timestamp, // must be as utils.unixTimeStampMs(): 1641121688194 - 1 641 121 688 194
                type: '', // Resfinex doesn't return type ('buy' or 'sell')
                tradeId: '', // Resfinex doesn't provide trade ID
              });
            });

            // We need ascending sort order
            result.sort(function(a, b) {
              return parseFloat(a.date) - parseFloat(b.date);
            });
            resolve(result);
          } catch (e) {
            resolve(false);
            log.warn('Error while processing getTradesHistory() request: ' + e);
          };
        }).catch((err) => {
          log.log(`API request getTradesHistory(pair: ${pair}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
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
