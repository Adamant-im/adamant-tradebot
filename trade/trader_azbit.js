const Azbit = require('./api/azbit_api');
const utils = require('../helpers/utils');

// API endpoints:
// Base URL for requests is https://data.azbit.com
const apiServer = 'https://data.azbit.com';
const exchangeName = 'Azbit';

module.exports = (apiKey, secretKey, pwd, log, publicOnly = false) => {
  const AzbitClient = Azbit();

  AzbitClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets on initialization
  getMarkets();

  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve, reject) => {
      AzbitClient.markets().then(function(data) {
        try {

          // console.log('markets() data: ' + data);
          // const markets = data.result;
          const result = {};

          data.forEach((market) => {
            // console.log('market: ' + JSON.stringify(market));
            const marketName = market.code;
            const pair = deformatPairName(marketName);
            // console.log('pair: ' + pair.pairReadable);
            result[pair.pairReadable] = {
              // stock — coin1, money — coin2
              pairPlain: marketName,
              pairReadable: pair.pairReadable,
              coin1: pair.coin1,
              coin2: pair.coin2,
              coin1Decimals: market.digitsPrice,
              coin2Decimals: market.digitsAmount,
              minTrade: +market.minQuoteAmount,
              // If the limit is 0, then this limit does not apply to this market
              /* coin1Precision: utils.getPrecision(+market.precision?.stock),
              coin2Precision: utils.getPrecision(+market.precision?.money),
              coin1MinAmount: +market.limits.min_amount,
              coin1MaxAmount: +market.limits.max_amount,
              coin2MinAmount: +market.limits.min_total,
              coin2MaxAmount: null,
              coin2MinPrice: +market.limits.min_price,
              coin2MaxPrice: +market.limits.max_price,
              minTrade: +market.limits.min_total, // in coin2*/
            };
            // console.log('result[]: ' + JSON.stringify(result[pair.pairReadable]));
          });

          // console.log('getMarkets result: ' + JSON.stringify(result));

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
      console.log('marketInfo');
      return getMarkets(pair);
    },

    features() {
      return {
        getDepositAddress: true,
        getMarkets: true,
        getCurrencies: true,
        placeMarketOrder: false,
        getTradingFees: true,
        selfTradeProhibited: false,
        createDepositAddressWithWebsiteOnly: false,
        getFundHistory: true,
        getFundHistoryImplemented: false,
        supportCoinNetworks: true,
        allowAmountForMarketBuy: false,
        amountForMarketOrderNecessary: false,
        openOrdersCacheSec: 180, // P2PB2B exchange say cache time is ~5 sec, but it's not true. Real cache time is unknown.
      };
    },

    /**
     * Get user balances
     * @param nonzero
     * @returns {Object[]} [code: String, free: Float, freezed: Float, total: Float]
     */

    getBalances(nonzero = true) {
      const paramString = `nonzero: ${nonzero}`;

      return new Promise((resolve, reject) => {
        AzbitClient.getBalances().then(function(data) {
          try {
            console.log('data: ' + data.length);

            let result = [];
            const assets = data.balances;
            assets.forEach((asset) => {
              const inOrder = data.balancesBlockedInOrder.find((obj) => obj.currencyCode === asset['currencyCode']);
              // console.log('inOrder: ' + inOrder);
              result.push({
                code: asset.currencyCode.toUpperCase(),
                free: asset.amount,
                freezed: inOrder.amount,
                total: asset.amount - inOrder.amount,
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
          log.warn(`API request getBalances(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}\n err_stack: ${err.stack}`);
          resolve(undefined);
        });
      });
    },

    /**
     * List of all account open orders
     * @param {String} pair
     * @returns {Object} [{orderId: String, symbol: String, price: Float, side: String, timestamp: Integer, status: String}]
     */
    async getOpenOrders(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let data;

      try {
        data = await AzbitClient.getOrders(pair_.pair);
      } catch (err) {
        log.warn(`API request getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        const openOrders = data;
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

          let side = 'sell';
          if (order.isBid) {
            side = 'buy';
          }

          result.push({
            orderId: order.id,
            symbol: order.currencyPairCode, // In Azbit format as ETH_USDT
            price: +order.price,
            side: side, // 'isBid' => 'buy' or 'sell'
            //type: order.type, // 'limit' or 'market'
            timestamp: new Date(order.date).getTime(), //  date str => Timestamp
            // TODO: figure out with amounts: initialAmount, amount, quoteAmount
            /* amount: +order.amount,
            amountExecuted: +order.dealStock,
            amountLeft: +order.left,*/
            status: order.status,
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
     * Cancel an order
     * @param {String} orderId
     * @param {String} side Not used for Azbit
     * @param {String} pair Not used for Azbit
     * @returns {Promise<unknown>}
     */
    cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, side: ${side}, pair: ${pair}`;
      // const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        AzbitClient.cancelOrder(orderId).then(function(data) {
          if (data?.success && data?.result?.orderId) {
            log.log(`Cancelling order ${orderId}`);
            // log.log(`Cancelling order ${orderId} on ${pair_.pairReadable} pair…`);
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

    /**
     * Cancel all order on specific pair
     * @param pair
     * @returns {Promise<unknown>}
     */
    cancelAllOrders(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        AzbitClient.cancelAllOrders(pair).then(function(data) {
          log.log(`Cancelling all orders on ${pair_.pairReadable} pair…`);
          resolve(true);
        }).catch((err) => {
          log.warn(`API request cancelAllOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },

    /**
     * Get info on trade pair
     * @param pair
     * @returns {Promise<unknown>}
     */
    getRates(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        AzbitClient.ticker(pair_.pair).then(function(data) {
          try {
            const ticker = data;
            resolve({
              ask: +ticker.askPrice,
              bid: +ticker.bidPrice,
              volume: +ticker.volume24h,
              /* volumeInCoin2: +ticker.deal,
              high: +ticker.high,
              low: +ticker.low,*/
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
        price = +(+price).toFixed(marketInfo.coin2Decimals);
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
          AzbitClient.addOrder(marketInfo.pairPlain, coin1Amount, price, orderType).then(function(data) {
            try {
              const result = data;
              console.log('order_id: ' + result);
              order.orderId = result;
              resolve(order);
              /*
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
              }*/
            } catch (e) {
              message = `Error while processing placeOrder(${paramString}) request: ${e}`;
              log.warn(message);
              order.orderId = false;
              order.message = message;
              resolve(order);
            };
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
        AzbitClient.orderBook(pair_.pair).then(function(data) {
          try {
            const result = {
              bids: [],
              asks: [],
            };

            data.forEach((crypto) => {
              if (crypto.isBid === true) {
                result.bids.push({
                  amount: +crypto.amount,
                  price: +crypto.price,
                  count: 1,
                  type: 'bid-buy-left',
                });
              } else {
                result.asks.push({
                  amount: +crypto[1],
                  price: +crypto[0],
                  count: 1,
                  type: 'ask-sell-right',
                });
              }
            });

            result.asks.sort(function(a, b) {
              return parseFloat(a.price) - parseFloat(b.price);
            });

            result.bids.sort(function(a, b) {
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

    async getTradesHistoryPage(pair, page, limit = 500) {
      const paramString = `pair: ${pair}, limit: ${limit}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        AzbitClient.getTradesHistory(pair_.pair, page, limit).then(function(data) {
          try {
            const trades = data;
            const result = [];

            trades.forEach((trade) => {
              let tradeType;
              if (trade.isBuy === true) {
                tradeType = 'buy';
              } else {
                tradeType = 'sell';
              }
              result.push({
                coin1Amount: +trade.volume, // amount in coin1
                price: +trade.price, // trade price
                coin2Amount: +trade.volume * +trade.price, // quote in coin2
                date: trade.dealDateUTC, // string date in UTC
                type: tradeType, // 'buy' or 'sell'
                tradeId: trade.id,
              });
            });

            console.log('getTradeHistory result: ' + JSON.stringify(result));

            // We need ascending sort order
            result.sort(function(a, b) {
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

    async getTradesHistory() {
      let allTrades = [];
      let ordersInfo;
      let page = 1;
      const limit = 5000;

      do {
        ordersInfo = await this.getTradesHistoryPage(pair, page);
        if (ordersInfo)
        {
          allTrades = allTrades.concat(ordersInfo);
        }
        page += 1;
      } while (ordersInfo.length === limit);
    },


    getCurrencies() {
      const paramString = ``;
      return new Promise((resolve, reject) => {
        AzbitClient.getCurrencies().then(function(data) {
          try {
            const result = data;
            console.log('getCurrencies len: ' + result.length);
            resolve(result);
          } catch (e) {
            log.warn(`Error while processing getCurrencies(${paramString}) request: ${e}`);
            resolve(undefined);
          }
        }).catch((err) => {
          log.log(`API request getCurrencies${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },

    getDepositAddress(coin) {
      const paramString = `coin: ${coin}`;
      return new Promise((resolve, reject) => {
        AzbitClient.getDepositAddress(coin).then(function(data) {
          try {

            console.log('getDepositAddress data: ' + JSON.stringify(data));
            const result = {};
            if (data.length > 0) {
              result.address = data[0].address;
              result.commission = data[0].commissionPercent;
              result.minAmount = data[0].minAmount;
              result.chain = data[0].chain;
            }
            console.log('getDepositAddress result: ' + JSON.stringify(result));

            resolve(result);
          } catch (e) {
            log.warn(`Error while processing getDepositAddress(${paramString}) request: ${e}`);
            resolve(undefined);
          }
        }).catch((err) => {
          log.log(`API request getDepositAddress${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },

    getFees() {
      const paramString = ``;
      return new Promise((resolve, reject) => {
        AzbitClient.getFees().then(function(data) {
          try {
            console.log('getDepositAddress data: ' + JSON.stringify(data));
            const result = [];

            data.forEach((fee) => {
              const commissionType = fee.commissionType.valueKey;
              if (commissionType === 'DealBid' || commissionType === 'DealAsk') {
                let dealBid = false;
                let dealAsk = false;
                if (commissionType === 'DealBid') {
                  dealBid = true;
                } else {
                  dealAsk = true;
                }
                result.push({
                  code: fee.currencyCode.toUpperCase(),
                  dealBid: dealBid,
                  dealAsk: dealAsk,
                  percent: fee.percent,
                });
              }
            });
            resolve(result);
          } catch (e) {
            log.warn(`Error while processing getFees(${paramString}) request: ${e}`);
            resolve(undefined);
          }
        }).catch((err) => {
          log.log(`API request getFees${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },

  };
};

/**
 * Returns pair in Azbit format like ETH_USDT
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
 * @param pair Pair in Azbit format ETH_USDT
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
