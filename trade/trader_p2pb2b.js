const P2PB2B = require('./api/p2pb2b_api');
const utils = require('../helpers/utils');

// API endpoints:
// Base URL for requests is https://api.p2pb2b.com
const apiServer = 'https://api.p2pb2b.com';
const exchangeName = 'P2PB2B';

module.exports = (
    apiKey,
    secretKey,
    pwd,
    log,
    publicOnly = false,
    loadMarket = true,
) => {
  const P2PB2BClient = P2PB2B();

  P2PB2BClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets on initialization
  if (loadMarket) {
    getMarkets();
  }

  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve, reject) => {
      P2PB2BClient.markets().then((data) => {
        try {
          if (!data.success) {
            throw new Error(`Request failed with data ${JSON.stringify(data)}.`);
          }

          const markets = data.result;
          const result = {};

          Object.keys(markets).forEach((marketName) => {
            const market = markets[marketName];
            const pair = deformatPairName(market.name);

            result[pair.pairReadable] = {
              // stock — coin1, money — coin2
              pairPlain: market.name,
              pairReadable: pair.pairReadable,
              coin1: pair.coin1,
              coin2: pair.coin2,
              coin1Decimals: +market.precision?.stock,
              coin2Decimals: +market.precision?.money,
              // If the limit is 0, then this limit does not apply to this market
              coin1Precision: utils.getPrecision(+market.precision?.stock),
              coin2Precision: utils.getPrecision(+market.precision?.money),
              coin1MinAmount: +market.limits.min_amount,
              coin1MaxAmount: +market.limits.max_amount,
              coin2MinAmount: +market.limits.min_total,
              coin2MaxAmount: null,
              coin2MinPrice: +market.limits.min_price,
              coin2MaxPrice: +market.limits.max_price,
              minTrade: +market.limits.min_total, // in coin2
            };
          });

          if (Object.keys(result).length > 0) {
            module.exports.exchangeMarkets = result;
            log.log(`Received info about ${Object.keys(result).length} markets on ${exchangeName} exchange.`);
          }

          resolve(result);
        } catch (e) {
          log.warn(`Error while processing getMarkets(${paramString}) request: ${e}`);
          resolve(undefined);
        }
      }).catch((err) => {
        log.warn(`API request getMarkets(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
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
        createDepositAddressWithWebsiteOnly: false,
        getFundHistory: false,
        getFundHistoryImplemented: false,
        allowAmountForMarketBuy: false,
        amountForMarketOrderNecessary: false,
        openOrdersCacheSec: 180, // P2PB2B exchange say cache time is ~5 sec, but it's not true. Real cache time is unknown.
      };
    },

    getBalances(nonzero = true) {
      const paramString = `nonzero: ${nonzero}`;

      return new Promise((resolve, reject) => {
        P2PB2BClient.getBalances().then((data) => {
          try {
            if (!data.success) {
              throw new Error(`Request failed with data ${JSON.stringify(data)}.`);
            }

            const assets = data.result;
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
            log.warn(`Error while processing getBalances(${paramString}) request: ${e}`);
            resolve(undefined);
          }
        }).catch((err) => {
          log.warn(`API request getBalances(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },

    /**
     * Get one page of account open orders
     * @param {String} pair
     * @param {Number} offset
     * @param {String} limit
     * @returns {Promise<Array>}
     */
    async getOpenOrdersPage(pair, offset = 0, limit = 100) {
      const paramString = `pair: ${pair}, offset: ${offset}, limit: ${limit}`;
      const pair_ = formatPairName(pair);

      let data;

      try {
        data = await P2PB2BClient.getOrders(pair_.pair, offset, limit);
      } catch (err) {
        log.warn(`API request getOpenOrdersPage(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        const openOrders = data.result;
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
            orderId: order.orderId.toString(),
            symbol: order.market, // In P2PB2B format as ETH_USDT
            price: +order.price,
            side: order.side, // 'buy' or 'sell'
            type: order.type, // 'limit' or 'market'
            timestamp: Math.round(order.timestamp), // 1676576771.061857
            amount: +order.amount,
            amountExecuted: +order.dealStock,
            amountLeft: +order.left,
            status: orderStatus,
            // Additionally: dealStock, takerFee, makerFee, dealFee
          });
        });

        return result;
      } catch (e) {
        log.warn(`Error while processing getOpenOrdersPage(${paramString}) request results: ${JSON.stringify(data)}. ${e}`);
        return undefined;
      }
    },

    /**
     * List of all account open orders
     * @param {String} pair
     * @returns {Promise<*[]|undefined>}
     */
    async getOpenOrders(pair) {
      let allOrders = [];
      let ordersInfo;
      let offset = 0;
      const limit = 100;

      do {
        ordersInfo = await this.getOpenOrdersPage(pair, offset, limit);
        if (!ordersInfo) return undefined;
        allOrders = allOrders.concat(ordersInfo);
        offset += limit;
      } while (ordersInfo.length === limit);

      return allOrders;
    },

    /**
     * Get specific order details
     * What's important is to understand the order was filled or closed by other reason
     * @param {String} orderId Example: 120531775560
     * @param {String} pair In classic format as BTC/USDT. For logging purposes.
     * @returns {Promise<unknown>}
     */
    async getOrderDetails(orderId, pair) {
      const paramString = `orderId: ${orderId}, pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let data;

      try {
        data = await P2PB2BClient.getOrderDeals(orderId);
      } catch (err) {
        log.warn(`API request getOrderDetails(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        const orderTrades = data.result.records;

        const result = {
          orderId,
          tradesCount: 0,
          amount: undefined, // P2PB2B doesn't provide initial order amount
          volume: undefined, // P2PB2B doesn't provide initial order volume
          pairPlain: pair_.pairPlain,
          pairReadable: pair_.pairReadable,
          totalFeeInCoin2: 0,
          amountExecuted: 0, // In coin1
          volumeExecuted: 0, // In coin2
          status: 'unknown', // For zero records, we don't know if order never exists or cancelled
        };

        orderTrades.forEach((trade) => {
          result.tradesCount += 1;
          result.totalFeeInCoin2 += +trade.fee;
          result.amountExecuted += +trade.amount;
          result.volumeExecuted += +trade.deal;
          result.status = 'part_filled'; // Actually, we don't know if it's fully filled or partially filled
        });

        return result;
      } catch (e) {
        log.warn(`Error while processing getOrderDetails(${paramString}) request results: ${JSON.stringify(data)}. ${e}`);
        return undefined;
      }
    },

    /**
     * Cancel an order
     * @param {String} orderId
     * @param {String} side Not used for P2PB2B
     * @param {String} pair
     * @returns {Promise<unknown>}
     */
    cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, side: ${side}, pair: ${pair}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        P2PB2BClient.cancelOrder(orderId, pair_.pair).then((data) => {
          if (data?.success && data?.result?.orderId) {
            log.log(`Cancelling order ${data.result.orderId} on ${pair_.pairReadable} pair…`);
            resolve(true);
          } else {
            const errorMessage = data?.p2bErrorInfo || 'No details';
            log.log(`Unable to cancel ${orderId} on ${pair_.pairReadable}: ${errorMessage}.`);
            resolve(false);
          }
        }).catch((err) => {
          log.warn(`API request cancelOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },

    getRates(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        P2PB2BClient.ticker(pair_.pair).then((data) => {
          try {
            if (!data.success) {
              throw new Error(`Request failed with data ${JSON.stringify(data)}.`);
            }

            const ticker = data.result;

            resolve({
              ask: +ticker.ask,
              bid: +ticker.bid,
              volume: +ticker.volume,
              volumeInCoin2: +ticker.deal,
              high: +ticker.high,
              low: +ticker.low,
            });
          } catch (e) {
            log.warn(`Error while processing getRates(${paramString}) request: ${e}`);
            resolve(undefined);
          }
        }).catch((err) => {
          log.warn(`API request getRates(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },

    placeOrder(orderType, pair, price, coin1Amount, limit = 1, coin2Amount) {
      const paramString = `orderType: ${orderType}, pair: ${pair}, price: ${price}, coin1Amount: ${coin1Amount}, limit: ${limit}, coin2Amount: ${coin2Amount}`;

      const marketInfo = this.marketInfo(pair);

      let message;

      if (!marketInfo) {
        message = `Unable to place an order on ${exchangeName} exchange. I don't have info about market ${pair}.`;
        log.warn(message);
        return {
          message,
        };
      }

      // for Limit orders, calculate coin1Amount if only coin2Amount is provided
      if (!coin1Amount && coin2Amount && price) {
        coin1Amount = coin2Amount / price;
      }

      // for Limit orders, calculate coin2Amount if only coin1Amount is provided
      if (!coin2Amount && coin1Amount && price) {
        coin2Amount = coin1Amount * price;
      }

      if (coin1Amount) {
        coin1Amount = +(+coin1Amount).toFixed(marketInfo.coin1Decimals);
      }
      if (coin2Amount) {
        coin2Amount = +(+coin2Amount).toFixed(marketInfo.coin2Decimals);
      }
      if (price) {
        price = (+price).toFixed(marketInfo.coin2Decimals);
      }

      if (coin1Amount < marketInfo.coin1MinAmount) {
        message = `Unable to place an order on ${exchangeName} exchange. Order amount ${coin1Amount} ${marketInfo.coin1} is less minimum ${marketInfo.coin1MinAmount} ${marketInfo.coin1} on ${marketInfo.pairReadable} pair.`;
        log.warn(message);
        return {
          message,
        };
      }

      if (coin2Amount < marketInfo.coin2MinAmount) {
        message = `Unable to place an order on ${exchangeName} exchange. Order volume ${coin2Amount} ${marketInfo.coin2} is less minimum ${marketInfo.coin2MinAmount} ${marketInfo.coin2} on ${marketInfo.pairReadable} pair.`;
        log.warn(message);
        return {
          message,
        };
      }

      const order = {};
      let output;

      if (limit) { // Limit order
        output = `${orderType} ${coin1Amount} ${marketInfo.coin1} at ${price} ${marketInfo.coin2}.`;

        return new Promise((resolve, reject) => {
          P2PB2BClient.addOrder(marketInfo.pairPlain, coin1Amount, price, orderType).then((data) => {
            try {
              const result = data.result;

              if (data.success && result?.orderId) {
                message = `Order placed to ${output} Order Id: ${result.orderId}.`;
                log.info(message);
                order.orderId = result.orderId.toString();
                order.message = message;
                resolve(order);
              } else {
                message = `Unable to place order to ${output} Check parameters and balances. Details: ${data.p2bErrorInfo}.`;
                log.warn(message);
                order.orderId = false;
                order.message = message;
                resolve(order);
              }
            } catch (e) {
              message = `Error while processing placeOrder(${paramString}) request: ${e}`;
              log.warn(message);
              order.orderId = false;
              order.message = message;
              resolve(order);
            }
          }).catch((err) => {
            log.warn(`API request addOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
            resolve(undefined);
          });
        });

      } else { // Market order
        message = `Unable to place order to ${output} ${exchangeName} doesn't support Market orders.`;
        log.warn(message);
        order.orderId = false;
        order.message = message;
        return Promise.resolve(order);
      }
    }, // placeOrder()

    getOrderBook(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        P2PB2BClient.orderBook(pair_.pair).then((data) => {
          try {
            if (!data.success) {
              throw new Error(`Request failed with data ${JSON.stringify(data)}.`);
            }

            const book = data.result;

            const result = {
              bids: [],
              asks: [],
            };

            book.asks.forEach((crypto) => {
              result.asks.push({
                amount: +crypto[1],
                price: +crypto[0],
                count: 1,
                type: 'ask-sell-right',
              });
            });
            result.asks.sort((a, b) => {
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
            result.bids.sort((a, b) => {
              return parseFloat(b.price) - parseFloat(a.price);
            });

            resolve(result);
          } catch (e) {
            log.warn(`Error while processing orderBook(${paramString}) request: ${e}`);
            resolve(undefined);
          }
        }).catch((err) => {
          log.warn(`API request getOrderBook(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },

    getTradesHistory(pair, limit) {
      const paramString = `pair: ${pair}, limit: ${limit}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        P2PB2BClient.getTradesHistory(pair_.pair, undefined, limit).then((data) => {
          try {
            if (!data.success) {
              throw new Error(`Request failed with data ${JSON.stringify(data)}.`);
            }

            const trades = data.result;

            const result = [];

            trades.forEach((trade) => {
              result.push({
                coin1Amount: +trade.amount, // amount in coin1
                price: +trade.price, // trade price
                coin2Amount: +trade.amount * +trade.price, // quote in coin2
                date: Math.round(trade.time), // 1546505899.001003
                type: trade.type, // 'buy' or 'sell'
                tradeId: trade.id?.toString(),
              });
            });

            // We need ascending sort order
            result.sort((a, b) => {
              return parseFloat(a.date) - parseFloat(b.date);
            });

            resolve(result);
          } catch (e) {
            log.warn(`Error while processing getTradesHistory(${paramString}) request: ${e}`);
            resolve(undefined);
          }
        }).catch((err) => {
          log.log(`API request getTradesHistory(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },

    getDepositAddress(coin) {
      // Not available for P2PB2B
    },
  };
};

/**
 * Returns pair in P2PB2B format like ETH_USDT
 * @param pair Pair in any format
 * @returns { Object }
 */
function formatPairName(pair) {
  pair = pair?.toUpperCase();

  if (pair.indexOf('-') > -1) {
    pair = pair.replace('-', '_').toUpperCase();
  } else {
    pair = pair.replace('/', '_').toUpperCase();
  }

  const [coin1, coin2] = pair.split('_');

  return {
    pair,
    pairReadable: `${coin1}/${coin2}`,
    pairPlain: `${coin1}_${coin2}`,
    coin1,
    coin2,
  };
}

/**
 * Returns pair in classic format like ETH/USDT
 * @param pair Pair in P2PB2B format ETH_USDT
 * @returns { Object }
 */
function deformatPairName(pair) {
  pair = pair?.toUpperCase();
  const [coin1, coin2] = pair.split('_');

  return {
    pair: `${coin1}/${coin2}`,
    pairReadable: `${coin1}/${coin2}`,
    pairPlain: `${coin1}_${coin2}`,
    coin1,
    coin2,
  };
}
