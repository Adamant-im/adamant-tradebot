const Azbit = require('./api/azbit_api');
const utils = require('../helpers/utils');
const constants = require('../helpers/const');

// API endpoints:
// Base URL for requests: https://data.azbit.com for v1, https://api2.azbit.com for v2 (public requests only)
const apiServer = 'https://data.azbit.com';
const exchangeName = 'Azbit';

module.exports = (
    apiKey,
    secretKey,
    pwd,
    log,
    publicOnly = false,
    loadMarket = true,
) => {
  const azbitClient = Azbit();

  azbitClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets and currencies on initialization
  if (loadMarket) {
    getMarkets();
    getCurrencies();
  }

  /**
   * Get exchange trade pairs config
   * @param {String} pair In classic format as BTC/USDT
   * @returns {Object}
   */
  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve, reject) => {
      azbitClient.markets().then(async (data) => {
        try {
          const result = {};

          data.forEach((market) => {
            const marketName = market.code;
            const pair = deformatPairName(marketName);

            result[pair.pairReadable] = {
              pairPlain: pair.pairPlain,
              pairReadable: pair.pairReadable,
              coin1: pair.coin1,
              coin2: pair.coin2,
              coin1Decimals: market.digitsAmount,
              coin2Decimals: market.digitsPrice,
              coin1Precision: utils.getPrecision(market.digitsAmount),
              coin2Precision: utils.getPrecision(market.digitsPrice),
              coin1MinAmount: market.minBaseAmount, // in coin1
              coin1MaxAmount: null,
              coin2MinAmount: market.minQuoteAmount, // in coin2
              coin2MaxAmount: null,
              coin2MinPrice: null,
              coin2MaxPrice: null,
              minTrade: market.minQuoteAmount, // in coin2
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

  /**
   * Get exchange coins
   * @param {String} coin As BTC
   * @returns {Object}
   */
  function getCurrencies(coin) {
    const paramString = `coin: ${coin}`;

    if (module.exports.gettingCurrencies) return;
    if (module.exports.exchangeCurrencies) return module.exports.exchangeCurrencies[coin];

    module.exports.gettingCurrencies = true;

    return new Promise((resolve, reject) => {
      azbitClient.getCurrencies().then((data) => {
        try {
          const result = [];

          data.forEach((currency) => {
            result[currency] = {
              symbol: currency,
            };
          });

          if (Object.keys(result).length > 0) {
            module.exports.exchangeCurrencies = result;
            log.log(`Received info about ${Object.keys(result).length} currencies on ${exchangeName} exchange.`);
            resolve(result);
          }
        } catch (e) {
          log.warn(`Error while processing getCurrencies(${paramString}) request: ${e}`);
          resolve(undefined);
        }
      }).catch((err) => {
        log.warn(`API request getCurrencies(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        resolve(undefined);
      }).finally(() => {
        module.exports.gettingCurrencies = false;
      });
    });
  }

  return {
    /**
     * Getter for stored markets info
     * @returns {Object}
     */
    get markets() {
      return module.exports.exchangeMarkets;
    },

    /**
     * Getter for stored currencies info
     * @returns {Object}
     */
    get currencies() {
      return module.exports.exchangeCurrencies;
    },

    /**
     * Get info for a specific market
     * @param pair In classic format as BTC/USDT
     * @returns {Object}
     */
    marketInfo(pair) {
      return getMarkets(pair);
    },

    /**
     * Get info for a specific coin
     * @param coin As BTC
     * @returns {Object}
     */
    currenciesInfo(coin) {
      return getCurrencies(coin);
    },

    features() {
      return {
        getDepositAddress: true,
        getMarkets: true,
        getCurrencies: false, // Use v2 to get currencies
        placeMarketOrder: false,
        getTradingFees: true,
        selfTradeProhibited: false,
        createDepositAddressWithWebsiteOnly: false,
        getFundHistory: true,
        getFundHistoryImplemented: false,
        supportCoinNetworks: true, // Use v2 to get info
        allowAmountForMarketBuy: false,
        amountForMarketOrderNecessary: false,
        dontTrustApi: true, // Azbit can return false empty order list even if there are orders
      };
    },

    /**
     * Get user balances
     * @param {Boolean} nonzero Return only non-zero balances
     * @returns {Object[]} [code: String, free: Float, freezed: Float, total: Float]
     */
    getBalances(nonzero = true) {
      const paramString = `nonzero: ${nonzero}`;

      return new Promise((resolve, reject) => {
        azbitClient.getBalances().then((data) => {
          try {
            let result = [];

            data.balances.forEach((asset) => {
              const inOrders = data.balancesBlockedInOrder.find((obj) => obj.currencyCode === asset['currencyCode']);

              result.push({
                code: asset.currencyCode.toUpperCase(),
                free: asset.amount,
                freezed: inOrders.amount,
                total: asset.amount + inOrders.amount,
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
     * List of all account open orders
     * @param {String} pair  In classic format as BTC/USDT
     * @returns {Object} [{orderId: String, symbol: String, price: Float, side: String, timestamp: Integer, status: String}]
     */
    async getOpenOrders(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let data;

      try {
        data = await azbitClient.getOrders(pair_.pair, 'active');
      } catch (err) {
        log.warn(`API request getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        const openOrders = data;
        const result = [];

        openOrders.forEach((order) => {
          let orderStatus;
          if (order.initialAmount === order.amount) {
            orderStatus = 'new';
          } else if (order.amount === 0) {
            orderStatus = 'filled';
          } else {
            orderStatus = 'part_filled';
          }

          result.push({
            orderId: order.id.toString(),
            symbol: order.currencyPairCode, // In Azbit format as ETH_USDT
            price: +order.price,
            side: order.isBid ? 'buy' : 'sell', // 'buy' or 'sell'
            type: 'limit', // 'limit' or 'market'
            timestamp: new Date(order.date + '+00:00').getTime(), // '2023-03-17T18:31:13.225615'
            amount: +order.initialAmount,
            amountExecuted: +order.initialAmount - +order.amount,
            amountLeft: +order.amount,
            status: orderStatus,
            // Additionally: isCanceled
          });
        });

        return result;
      } catch (e) {
        log.warn(`Error while processing getOpenOrders(${paramString}) request results: ${JSON.stringify(data)}. ${e}`);
        return undefined;
      }
    },

    /**
     * Get specific order details
     * What's important is to understand the order was filled or closed by other reason
     * status: unknown, new, filled, part_filled, cancelled
     * @param {String} orderId Example: '70192a8b-c34e-48ce-badf-889584670507'
     * @param {String} pair In classic format as BTC/USDT. For logging purposes.
     * @returns {Promise<unknown>}
     */
    async getOrderDetails(orderId, pair) {
      const paramString = `orderId: ${orderId}, pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let data;

      try {
        data = await azbitClient.getOrderDeals(orderId);
      } catch (err) {
        log.warn(`API request getOrderDetails(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        if (data && !data.azbitErrorInfo) {
          const orderTrades = data.deals;

          let orderStatus;
          if (data.isCanceled) {
            orderStatus = 'cancelled';
          } else if (data.initialAmount === data.amount) {
            orderStatus = 'new';
          } else if (data.amount === 0) {
            orderStatus = 'filled';
          } else {
            orderStatus = 'part_filled';
          }

          const result = {
            orderId: data.id,
            tradesCount: orderTrades.length,
            amount: data.initialAmount,
            volume: data.quoteAmount,
            pairPlain: pair_.pairPlain,
            pairReadable: pair_.pairReadable,
            totalFeeInCoin2: undefined, // Azbit doesn't provide fee info
            amountExecuted: 0, // In coin1
            volumeExecuted: 0, // In coin2
            status: orderStatus,
          };

          orderTrades.forEach((trade) => {
            result.amountExecuted += +trade.volume; // Finally should be as (initialAmount - amount)
            result.volumeExecuted += +trade.volume * +trade.price;
          });

          return result;
        } else {
          const errorMessage = data?.azbitErrorInfo || 'No details';
          log.log(`Unable to get order ${orderId} details: ${errorMessage}.`);

          return {
            orderId,
            status: 'unknown', // Order doesn't exist or Wrong orderId
          };
        }
      } catch (e) {
        log.warn(`Error while processing getOrderDetails(${paramString}) request results: ${JSON.stringify(data)}. ${e}`);
        return undefined;
      }
    },

    /**
     * Cancel an order
     * @param {String} orderId Example: '70192a8b-c34e-48ce-badf-889584670507'
     * @param {String} side Not used for Azbit
     * @param {String} pair Not used for Azbit
     * @returns {Promise<unknown>}
     */
    cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, side: ${side}, pair: ${pair}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        azbitClient.cancelOrder(orderId).then((data) => {
          if (data && !data.azbitErrorInfo) {
            log.log(`Cancelling order ${orderId} on ${pair_.pairReadable} pair…`);
            resolve(true);
          } else {
            const errorMessage = data?.azbitErrorInfo || 'No details';
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
     * @param pair In classic format as BTC/USDT
     * @returns {Promise<unknown>}
     */
    cancelAllOrders(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        azbitClient.cancelAllOrders(pair_.pairPlain).then((data) => {
          if (data && !data.azbitErrorInfo) {
            log.log(`Cancelling all orders on ${pair_.pairReadable} pair…`);
            resolve(true);
          } else {
            const errorMessage = data?.azbitErrorInfo || 'No details';
            log.log(`Unable to cancel all orders on ${pair_.pairReadable}: ${errorMessage}.`);
            resolve(false);
          }
        }).catch((err) => {
          log.warn(`API request cancelAllOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
          resolve(undefined);
        });
      });
    },

    /**
     * Get info on trade pair
     * @param pair In classic format as BTC/USDT
     * @returns {Object} [{ask: Number, bid: Number, volume: Number, volumeInCoin2: Number}]
     */
    getRates(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        azbitClient.ticker(pair_.pair).then((data) => {
          try {
            const ticker = data[0];

            resolve({
              ask: +ticker.askPrice,
              bid: +ticker.bidPrice,
              volume: +ticker.volume24h / +ticker.price,
              volumeInCoin2: +ticker.volume24h,
              high: +ticker.high24h,
              low: +ticker.low24h,
              last: +ticker.price,
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

    /**
     * Create buy or sell limit order on a specific pair
     * @param {String} orderType 'buy' or 'sell'
     * @param {String} pair In classic format as BTC/USDT
     * @param {Number} price Order price
     * @param {Number} coin1Amount Amount for coin1
     * @param {Number} limit Azbit supports only limits orders
     * @param {Number} coin2Amount Quote coin value
     * @returns {Object}
     */
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
        const pairName = formatPairName(pair);
        output = `${orderType} ${coin1Amount} ${pairName.coin1} at ${price} ${pairName.coin2}.`;

        return new Promise((resolve, reject) => {
          azbitClient.addOrder(marketInfo.pairPlain, coin1Amount, price, orderType).then((data) => {
            try {
              if (data && !data.azbitErrorInfo && data.match(constants.REGEXP_UUID)) {
                message = `Order placed to ${output} Order Id: ${data}.`;
                log.info(message);
                order.orderId = data;
                order.message = message;
                resolve(order);
              } else {
                message = `Unable to place order to ${output} Check parameters and balances. Details: ${data.azbitErrorInfo}.`;
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

    /**
     * Get orderbook on a specific pair
     * @param pair In classic format as BTC/USDT
     * @returns {Object}
     */
    getOrderBook(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        azbitClient.orderBook(pair_.pair).then((data) => {
          try {
            const result = {
              bids: [],
              asks: [],
            };

            data.forEach((order) => {
              if (order.isBid) {
                result.bids.push({
                  amount: +order.amount,
                  price: +order.price,
                  count: 1,
                  type: 'bid-buy-left',
                });
              } else {
                result.asks.push({
                  amount: +order.amount,
                  price: +order.price,
                  count: 1,
                  type: 'ask-sell-right',
                });
              }
            });

            result.asks.sort((a, b) => {
              return parseFloat(a.price) - parseFloat(b.price);
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

    /**
     * Get history of trades
     * @param {String} pair In classic format as BTC/USDT
     * @param {Number} limit Number of records to return
     * @returns {Object[]} [{coin1Amount: Number, price: Number, coin2Amount: Number, date: Date, type: String,
     *   tradeId: String (GUID)}]
     */
    async getTradesHistory(pair, limit) {
      const paramString = `pair: ${pair}, limit: ${limit}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        azbitClient.getTradesHistory(pair_.pair, limit).then((data) => {
          try {
            const result = [];

            data.forEach((trade) => {
              result.push({
                coin1Amount: +trade.volume, // amount in coin1
                price: +trade.price, // trade price
                coin2Amount: +trade.volume * +trade.price, // quote in coin2
                date: new Date(trade.dealDateUtc + '+00:00').getTime(), // '2023-03-21T20:18:17.0724200'
                type: trade.isBuy? 'buy' : 'sell', // 'buy' or 'sell'
                tradeId: trade.id,
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

    /**
     * Get deposit address for a coin
     * @param {String} coin As BTC
     * @returns {Object}
     */
    getDepositAddress(coin) {
      const paramString = `coin: ${coin}`;
      coin = coin?.toUpperCase();

      return new Promise((resolve, reject) => {
        azbitClient.getDepositAddress(coin).then((data) => {
          try {
            const result = {};

            if (data?.length) {
              // Note: chain returns as Id (Number). To map it, re-build getCurrencies() with all the info.
              // Also, getDepositAddress() returns additional fields.
              resolve(data.map(({ chain, address }) => ({ network: chain, address })));
            } else {
              resolve(false);
            }

            resolve(result);
          } catch (e) {
            log.warn(`Error while processing getDepositAddress(${paramString}) request: ${e}`);
            resolve(undefined);
          }
        }).catch((err) => {
          log.log(`API request getDepositAddress(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}.`);
          resolve(undefined);
        });
      });
    },

    /**
     * Get trading fees for account
     * @param coinOrPair Coin in classic format as BTC, or pair in classic format as BTC/USD
     */
    async getFees(coinOrPair) {
      // Azbit supports it, but we haven't implemented
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
