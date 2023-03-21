const Azbit = require('./api/azbit_api');
const utils = require('../helpers/utils');

// API endpoints:
// Base URL for requests: https://data.azbit.com for v1, https://api2.azbit.com for v2 (public requests only)
const apiServer = 'https://data.azbit.com';
const exchangeName = 'Azbit';

module.exports = (apiKey, secretKey, pwd, log, publicOnly = false) => {
  const azbitClient = Azbit();

  azbitClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets and currencies on initialization
  getMarkets();
  getCurrencies();

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
      azbitClient.markets().then(async function(data) {
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
              coin1MinAmount: null,
              coin1MaxAmount: null,
              coin2MinAmount: market.minQuoteAmount,
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
      azbitClient.getCurrencies().then(function(data) {
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
        azbitClient.getBalances().then(function(data) {
          try {
            let result = [];
            const assets = data.balances;
            assets.forEach((asset) => {
              const inOrder = data.balancesBlockedInOrder.find((obj) => obj.currencyCode === asset['currencyCode']);
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
        data = await azbitClient.getOrders(pair_.pair);
      } catch (err) {
        log.warn(`API request getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        const openOrders = data;
        const result = [];

        openOrders.forEach((order) => {
          let side = 'sell';
          if (order.isBid) {
            side = 'buy';
          }

          result.push({
            orderId: order.id,
            symbol: order.currencyPairCode, // In Azbit format as ETH_USDT
            price: +order.price,
            side: side, // 'isBid' => 'buy' or 'sell'
            // type: order.type, // 'limit' or 'market'
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
     * @param {String} orderId GUID i.e "70192a8b-c34e-48ce-badf-889584670507"
     * @param {String} side Not used for Azbit
     * @param {String} pair Not used for Azbit
     * @returns {Promise<unknown>}
     */
    cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, side: ${side}, pair: ${pair}`;
      // const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        azbitClient.cancelOrder(orderId).then(function(data) {
          if (!data?.errors ) {
            log.log(`Cancelling order ${orderId}`);
            resolve(true);
          } else {
            const errorMessage = JSON.stringify(data?.errors) || 'No details';
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
     * @returns {Object} true || undefined
     */
    cancelAllOrders(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);
      return new Promise((resolve, reject) => {
        azbitClient.cancelAllOrders(pair).then(function(data) {
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
     * @returns {Object} [{ask: Number, bid: Number, volume: Number, volumeInCoin2: Number}]
     */
    getRates(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        azbitClient.ticker(pair_.pair).then(function(data) {
          try {
            const ticker = data;
            resolve({
              ask: +ticker.askPrice,
              bid: +ticker.bidPrice,
              volume: +ticker.volume24h,
              volumeInCoin2: +ticker.volume24h * ticker.price,
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
     * @param {String} orderType
     * @param {String} pair
     * @param {Number} price
     * @param {Number} coin1Amount
     * @param {BigInteger} limit - Azbit supports only limits orders
     * @param {Number} coin2Amount
     * @returns {String} Order GUID string i.e. "e2cd407c-28c8-4768-bd73-cd7357fbccde"
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
        log.log('pairName: ' + JSON.stringify(pairName));
        output = `${orderType} ${coin1Amount} ${pairName.coin1} at ${price} ${pairName.coin2}.`;

        return new Promise((resolve, reject) => {
          azbitClient.addOrder(marketInfo.pairPlain, coin1Amount, price, orderType).then(function(data) {
            try {
              const result = data;
              log.log(`Place new order on ${exchangeName}. ${output}`);
              order.orderId = result;
              resolve(order);
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
     * Get orderbook (40 bids + 40 asks) on a specific pair
     * @param pair
     * @returns {Object} {amount: Number, price: Number, count: BigInteger, type: String}
     */

    getOrderBook(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        azbitClient.orderBook(pair_.pair).then(function(data) {
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

    /**
     * Get history of trade page
     * @param {String} pair
     * @param {BigInteger} page
     * @param {BigInteger} limit = 500 for Azbit
     * @returns {Object} {coin1Amount: Number, price: Number, coin2Amount: Number, date: Date, type: String,
     * tradeId: String (GUID)}
     */

    async getTradesHistoryPage(pair, page, limit = 500) {
      const paramString = `pair: ${pair}, limit: ${limit}`;
      const pair_ = formatPairName(pair);

      return new Promise((resolve, reject) => {
        azbitClient.getTradesHistory(pair_.pair, page, limit).then(function(data) {
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

    /**
     * Get trade history for currency pair
     * @param {String} pair
     * @returns {Object} - the same as getTradesHistoryPage
     */
    async getTradesHistory(pair) {
      let allTrades = [];
      let ordersInfo;
      let page = 1;
      // Total records limit
      const limit = 1000;

      do {
        ordersInfo = await this.getTradesHistoryPage(pair, page);
        if (ordersInfo) {
          allTrades = allTrades.concat(ordersInfo);
        }
        page += 1;
      } while (allTrades.length < limit);
      return allTrades;
    },

    /**
     * Get all currencies codes
     * @returns {Object} [{String}]
     */

    getCurrencies() {
      const paramString = ``;
      return new Promise((resolve, reject) => {
        azbitClient.getCurrencies().then(function(data) {
          try {
            const result = data;
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

    /**
     * Get inforamtion for deposit
     * @param {String} coin
     * @returns {Object} {address: String, addressPublicKey: String, addressMemo: String, commissionPercent: Number,
     * commissionMinimum: Number, minAmount: Number, chain: BigInteger}
     */

    getDepositAddress(coin) {
      const paramString = `coin: ${coin}`;
      return new Promise((resolve, reject) => {
        azbitClient.getDepositAddress(coin).then(function(data) {
          try {

            const result = {};
            if (data.length > 0) {
              result.address = data[0].address;
              result.addressPublicKey = data[0].addressPublicKey;
              result.addressMemo = data[0].addressMemo;
              result.commissionPercent = data[0].commissionPercent;
              result.commissionMinimum = data[0].commissionMinimum;
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

    /**
     * Get currency pair commissions
     * @returns {Object} {code: String, dealBid: Boolean, dealAsk: Boolean, percent: Number}
     */

    getFees() {
      const paramString = ``;
      return new Promise((resolve, reject) => {
        azbitClient.getFees().then(function(data) {
          try {
            //console.log('getFees data: ' + JSON.stringify(data));
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
