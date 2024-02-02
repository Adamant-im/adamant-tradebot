const BitcastleAPI = require('./api/bitcastle_api');
const utils = require('../helpers/utils');

/**
 * API endpoints:
 * https://developer.bitcastle.io/exchange
 */
const apiServer = 'https://developer.bitcastle.io';
const exchangeName = 'Bitcastle';

module.exports = (
    apiKey,
    secretKey,
    pwd,
    log,
    publicOnly = false,
    loadMarket = true,
) => {
  const bitcastleApiClient = BitcastleAPI();

  bitcastleApiClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets on initialization
  if (loadMarket) {
    getMarkets();
  }

  /**
   * Get info on all markets and store in module.exports.exchangeMarkets
   * It's an internal function, not called outside of this module
   * @param {String} [pair] In classic format as BTC/USDT. If markets are already cached, get info for the pair.
   * @returns {Promise<unknown>|*}
   */
  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair ? formatPairName(pair).pairPlain : pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve) => {
      bitcastleApiClient.markets().then((markets) => {
        try {
          const result = {};

          for (const market of markets) {
            const pairNames = formatPairName(market.ticker_id);

            result[pairNames.pairPlain] = {
              pairReadable: pairNames.pairReadable,
              pairPlain: pairNames.pairPlain,
              coin1: pairNames.coin1,
              coin2: pairNames.coin2,
              coin1Decimals: null,
              coin2Decimals: null,
              coin1Precision: null,
              coin2Precision: null,
              coin1MinAmount: null,
              coin1MaxAmount: null,
              coin2MinPrice: null,
              coin2MaxPrice: null,
              minTrade: null,
              status: null,
            };
          }

          if (Object.keys(result).length > 0) {
            module.exports.exchangeMarkets = result;
            log.log(`Received info about ${Object.keys(result).length} markets on ${exchangeName} exchange.`);
          }

          console.log(result)
          resolve(result);
        } catch (error) {
          log.warn(`Error while processing getMarkets(${paramString}) request: ${error}`);
          resolve(undefined);
        }
      }).catch((error) => {
        log.warn(`API request getMarkets() of ${utils.getModuleName(module.id)} module failed. ${error}`);
        resolve(undefined);
      }).finally(() => {
        module.exports.gettingMarkets = false;
      });
    });
  }

  return {
    getMarkets,

    /**
     * Getter for stored markets info
     * @return {Object}
     */
    get markets() {
      return module.exports.exchangeMarkets;
    },

    marketInfo(pair) {
      return getMarkets(pair);
    },

    /**
     * Features available on Bitcastle exchange
     * @returns {Object}
     */
    features() {
      return {
        getMarkets: true,
        getCurrencies: true,
        placeMarketOrder: true,
        getDepositAddress: false,
        getTradingFees: false,
        getAccountTradeVolume: false,
        createDepositAddressWithWebsiteOnly: true,
        getFundHistory: false,
        getFundHistoryImplemented: false,
        allowAmountForMarketBuy: true,
        amountForMarketOrderNecessary: true,
        accountTypes: false, // Bitcastle doesn't supports main, trade, margin accounts
        withdrawAccountType: '', // Withdraw funds from single account
        withdrawalSuccessNote: false, // No additional action needed after a withdrawal by API
        supportTransferBetweenAccounts: false,
        supportCoinNetworks: false,
      };
    },

    /**
     * Get user balances
     * @param {Boolean} [nonzero=true] Return only non-zero balances
     * @returns {Promise<Array|undefined>}
     */
    async getBalances(nonzero = true) {
      const paramString = `nonzero: ${nonzero}`;

      let balances;

      try {
        balances = await bitcastleApiClient.getBalances();
        balances = balances.data;
      } catch (error) {
        log.warn(`API request getBalances(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        let result = [];

        for (const crypto of balances) {
          result.push({
            code: crypto.currency.toUpperCase(),
            free: +crypto.available_balance,
            freezed: +crypto.actual_balance - +crypto.available_balance,
            total: +crypto.actual_balance,
          });
        }

        if (nonzero) {
          result = result.filter((crypto) => crypto.free || crypto.freezed);
        }

        return result;
      } catch (error) {
        log.warn(`Error while processing getBalances(${paramString}) request results: ${JSON.stringify(balances)}. ${error}`);
        return undefined;
      }
    },


    /**
     * List of all account open orders
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Array|undefined>}
     */
    async getOpenOrders(pair) {
      const paramString = `pair: ${pair}`;
      const coinPair = formatPairName(pair);

      let orders;

      try {
        orders =   await bitcastleApiClient.getOrders(coinPair.coin1, coinPair.coin2);
        orders = orders.data;
      } catch (error) {
        log.warn(`API request getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined ;
      }

      try {
        const result = [];

        for (const order of orders) {
          let orderStatus;
          if (+order.filled_volume === 0) {
            orderStatus = 'new';
          } else if (order.filled_volume === order.volume) {
            orderStatus = 'filled';
          } else {
            orderStatus = 'part_filled';
          }

          result.push({
            orderId: order.order_id.toString(),
            symbol: `${order.coin}/${order.currency}`.toUpperCase(), // In readable format
            price: +order.price, // limit price
            side: +order.order_type === 1 ? 'buy' : 'sell', // 'buy' or 'sell'
            type: +order.order_class === 1 ? 'market' : 'limit',
            timestamp: Math.floor(+order.create_time / 1000), // must be as utils.unixTimeStampMs(): 1641121688194 - 1 641 121 688 194
            amount: +order.volume,
            amountExecuted: +order.filled_volume, // quantity filled in base currency
            amountLeft: +order.volume - +order.filled_volume,
            status: orderStatus,
          });
        }

        return result;
      } catch (error) {
        log.warn(`Error while processing getOpenOrders(${paramString}) request results: ${JSON.stringify(orders)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Get specific order details
     * What's important is to understand the order was filled or closed by other reason
     * status: unknown, new, filled, part_filled, cancelled
     * @param {String} orderId Example: '112321'
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Object|undefined>}
     */
    async getOrderDetails(orderId, pair) {
      const paramString = `orderId: ${orderId}, pair: ${pair}`;
      const coinPair = formatPairName(pair);

      let order;

      try {
        order = await bitcastleApiClient.getOrder(orderId);
      } catch (error) {
        log.warn(`API request getOrderDetails(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (order.status_code === 200) {
          order = order.data[0];

          let orderStatus;
          if (+order.status === 1) {
            if (+order.filled_volume === 0) {
              orderStatus = 'new';
            } else {
              orderStatus = 'part_filled';
            }
          } else if (+order.status === 2 || +order.status === 5) {
            orderStatus = 'filled';
          } else {
            orderStatus = 'cancelled';
          }

          const result = {
            orderId: order.order_id.toString(),
            tradesCount: undefined, // Bitcastle doesn't provide trades info
            price: +order.price, // filled price for market orders
            side: +order.order_type === 1 ? 'buy' : 'sell', // 'buy' or 'sell'
            type: +order.order_class === 1 ? 'market' : 'limit',
            amount: +order.volume, // In coin1
            volume: +order.volume * +order.price, // In coin2
            pairPlain: coinPair.pairPlain,
            pairReadable: coinPair.pairReadable,
            totalFeeInCoin2: undefined, // Bitcastle doesn't provide fee info
            amountExecuted: +order.filled_volume, // In coin1
            volumeExecuted: +order.filled_volume * +order.price, // In coin2
            timestamp: +order.create_time, // must be as utils.unixTimeStampMs(): 1641121688194 - 1 641 121 688 194
            updateTimestamp: +order.update_time, // must be as utils.unixTimeStampMs(): 1641121688194 - 1 641 121 688 194
            status: orderStatus,
          };

          return result;
        } else {
          const errorMessage = order.bitcastleErrorInfo ?? 'No details.';
          log.log(`Unable to get order ${orderId} details: ${JSON.stringify(errorMessage)}. Returning unknown order status.`);

          return {
            orderId,
            status: 'unknown', // Order doesn't exist or Wrong orderId
          };
        }
      } catch (error) {
        log.warn(`Error while processing getOrderDetails(${paramString}) request results: ${JSON.stringify(order)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Cancel an order
     * @param {String} orderId Example: '112321'
     * @param {String} side Not used for Bitcastle
     * @param {String} pair Not used for Bitcastle. In classic format as BTC/USDT
     * @returns {Promise<Boolean|undefined>}
     */
    async cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, side: ${side}, pair: ${pair}`;

      let order;

      try {
        order = await bitcastleApiClient.cancelOrders([orderId]);
      } catch (error) {
        log.warn(`API request cancelOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (order.status_code === 200) {
          log.log(`Cancelling order ${orderId} on ${pair} pair…`);
          return true;
        } else {
          const errorMessage = order?.bitcastleErrorInfo ?? 'No details';
          log.log(`Unable to cancel order ${orderId} on ${pair} pair: ${errorMessage}.`);
          return false;
        }
      } catch (error) {
        log.warn(`Error while processing cancelOrder(${paramString}) request results: ${JSON.stringify(order)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Cancel all orders on a specific pair
     * @param {String} pair In classic format as BTC/USD
     * @returns {Promise<Boolean|undefined>}
     */
    async cancelAllOrders(pair) {
      const paramString = `pair: ${pair}`;
      const coinPair = formatPairName(pair);

      let ordersToCancel;

      const marketInfo = this.marketInfo(pair);
      if (!marketInfo) {
        log.warn(`Unable to cancel orders on pair: ${pair}. Pair doesn't exist`);
        return false;
      }

      try {
        ordersToCancel = await this.getOpenOrders(pair.pairPlain);
      } catch (error) {
        log.warn(`API request cancelAllOrders-getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const ordersToCancelCount = ordersToCancel.length;

        let response;

        if (ordersToCancelCount > 1) {
          const orderIds = ordersToCancel.map((order) => order.orderId);

          try {
            response = await bitcastleApiClient.cancelOrders(orderIds);
          } catch (error) {
            log.warn(`API request cancelAllOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
            return undefined;
          }
        }

        if (ordersToCancelCount === 0) {
          log.log(`Cancelling all ${coinPair.pairReadable} orders: No open orders.`);
          return true;
        } else if (+response.status_code === 200) {
          log.log(`Cancelled all orders on ${coinPair.pairReadable} pair…`);
          return true;
        } else {
          log.warn(`Unable to cancel orders on ${coinPair.pairReadable} pair…`);
          return false;
        }
      } catch (error) {
        log.warn(`Error while processing cancelAllOrders-1(${paramString}) request: ${error}`);
        return undefined;
      }
    },

    /**
     * Get info on trade pair
     * @param pair In classic format as BTC/USDT
     * @returns {Promise<Object|undefined>}
     */
    async getRates(pair) {
      const paramString = `pair: ${pair}`;
      const coinPair = formatPairName(pair);

      let ticker;
      let book;

      try {
        ticker = await bitcastleApiClient.ticker(coinPair.coin1, coinPair.coin2);
        ticker = ticker?.data[0];
      } catch (error) {
        log.warn(`API request getRates(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        book = await this.getOrderBook(pair);
      } catch (error) {
        log.warn(`API request getOrderBook(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (+ticker?.price && book.asks.length) {
          return {
            ask: +book.asks[0].price,
            bid: +book.bids[0].price,
            last: +ticker.price,
            volume: +ticker.volume,
            volumeInCoin2: +ticker.total,
            high: +ticker.high,
            low: +ticker.low,
          };
        }
      } catch (error) {
        log.warn(`Error while processing getRates(${paramString}) request result: ${JSON.stringify(ticker)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Places an order
     * Bitcastle supports both limit and market orders
     * @param {String} side 'buy' or 'sell'
     * @param {String} pair In classic format like BTC/USDT
     * @param {Number} price Order price
     * @param {Number} coin1Amount Base coin amount. Provide either coin1Amount or coin2Amount.
     * @param {Number} limit 1 if order is limit (default), 0 in case of market order
     * @param {Number} coin2Amount Quote coin amount. Provide either coin1Amount or coin2Amount.
     * @returns {Promise<Object>|undefined}
     */
    async placeOrder(side, pair, price, coin1Amount, limit = 1, coin2Amount) {
      const paramString = `side: ${side}, pair: ${pair}, price: ${price}, coin1Amount: ${coin1Amount}, limit: ${limit}, coin2Amount: ${coin2Amount}`;

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
      let coin2AmountCalculated;
      if (!coin2Amount && coin1Amount && price) {
        coin2AmountCalculated = coin1Amount * price;
      }

      if (coin1Amount < marketInfo.coin1MinAmount) {
        message = `Unable to place an order on ${exchangeName} exchange. Order amount ${coin1Amount} ${marketInfo.coin1} is less minimum ${marketInfo.coin1MinAmount} ${marketInfo.coin1} on ${pair} pair.`;
        log.warn(message);
        return {
          message,
        };
      }

      if (coin2Amount && coin2Amount < marketInfo.coin2MinAmount) { // coin2Amount may be null
        message = `Unable to place an order on ${exchangeName} exchange. Order volume ${coin2Amount} ${marketInfo.coin2} is less minimum ${marketInfo.coin2MinAmount} ${marketInfo.coin2} on ${pair} pair.`;
        log.warn(message);
        return {
          message,
        };
      }

      let orderType;
      let output = '';

      if (limit) {
        orderType = 'limit';
        if (coin2Amount) {
          output = `${side} ${coin1Amount} ${marketInfo.coin1} for ${coin2Amount} ${marketInfo.coin2} at ${price} ${marketInfo.coin2}.`;
        } else {
          output = `${side} ${coin1Amount} ${marketInfo.coin1} for ~${coin2AmountCalculated.toFixed(marketInfo.coin2Decimals)} ${marketInfo.coin2} at ${price} ${marketInfo.coin2}.`;
        }
      } else {
        orderType = 'market';
        if (coin2Amount) {
          output = `${side} ${marketInfo.coin1} for ${coin2Amount} ${marketInfo.coin2} at Market Price on ${pair} pair.`;
        } else {
          output = `${side} ${coin1Amount} ${marketInfo.coin1} at Market Price on ${pair} pair.`;
        }
      }

      const order = {};
      let response;
      let orderId;
      let errorMessage;

      try {
        response = await bitcastleApiClient.addOrder(marketInfo.coin1, marketInfo.coin2, coin1Amount, price, side, orderType);

        errorMessage = response?.bitcastleErrorInfo;
        orderId = response?.data?.order_id;
      } catch (error) {
        message = `API request addOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}.`;
        log.warn(message);
        order.orderId = false;
        order.message = message;

        return order;
      }

      if (orderId) {
        message = `Order placed to ${output} Order Id: ${orderId}.`;
        log.info(message);
        order.orderId = orderId;
        order.message = message;
      } else {
        const details = errorMessage ? ` Details: ${utils.trimAny(errorMessage, ' .')}.` : ' { No details }.';
        message = `Unable to place order to ${output}${details} Check parameters and balances.`;
        log.warn(message);
        order.orderId = false;
        order.message = message;
      }

      return order;
    },

    /**
     * Get orderbook on a specific pair
     * @param pair In classic format as BTC/USDT
     * @returns {Promise<Object|undefined>}
     */
    async getOrderBook(pair) {
      const paramString = `pair: ${pair}`;
      const coinPair = formatPairName(pair);

      let book;

      try {
        book = await bitcastleApiClient.orderBook(coinPair.coin1, coinPair.coin2);
        book = book.data.orderbook;
      } catch (error) {
        log.warn(`API request getOrderBook(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const result = {
          bids: [],
          asks: [],
        };

        for (const crypto of book.asks) {
          result.asks.push({
            amount: +crypto.volume,
            price: +crypto.price,
            count: 1,
            type: 'ask-sell-right',
          });
        }
        result.asks.sort((a, b) => {
          return parseFloat(a.price) - parseFloat(b.price);
        });

        for (const crypto of book.asks) {
          result.bids.push({
            amount: +crypto.volume,
            price: +crypto.price,
            count: 1,
            type: 'bid-buy-left',
          });
        }
        result.bids.sort((a, b) => {
          return parseFloat(b.price) - parseFloat(a.price);
        });

        return result;
      } catch (error) {
        log.warn(`Error while processing getOrderBook(${paramString}) request result: ${JSON.stringify(book)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Get history of trades
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Boolean|undefined>}
     */
    async getTradesHistory(pair) {
      const paramString = `pair: ${pair}`;
      const coinPair = formatPairName(pair);

      let trades;

      try {
        trades = await bitcastleApiClient.getTradesHistory(coinPair.coin1, coinPair.coin2);
      } catch (error) {
        log.warn(`API request getTradesHistory(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (trades.buy.length && trades.sell.length) {
          const result = [];

          for (const trade of [...trades.buy, ...trades.sell]) {
            result.push({
              coin1Amount: +trade.base_volume, // amount in coin1
              price: +trade.price, // trade price
              coin2Amount: +trade.target_volume, // quote in coin2
              date: +trade.trade_timestamp, // must be as utils.unixTimeStampMs(): 1641121688194 - 1 641 121 688 194
              type: trade.type.toLowerCase(), // 'buy' or 'sell'
              tradeId: trade.trade_id.toString(),
            });
          }

          // We need ascending sort order
          result.sort((a, b) => {
            return parseFloat(a.date) - parseFloat(b.date);
          });

          return trades;
        }
      } catch (error) {
        log.warn(`Error while processing getTradesHistory(${paramString}) request result: ${JSON.stringify(trades)}. ${error}`);
        return undefined;
      }
    },
  };
};

/**
 * Returns pair in Bitcastle format like 'BTC_USDT'
 * @param pair Pair in any format
 * @returns {Object|Boolean} pairReadable, pairPlain, coin1, coin2
*/
function formatPairName(pair) {
  if (pair.indexOf('/') > -1) {
    pair = pair.replace('/', '_').toUpperCase();
  } else if (pair.indexOf('-') !== -1) {
    pair = pair.replace('-', '_').toUpperCase();
  }
  const [coin1, coin2] = pair.split('_');
  return {
    coin1: coin1.toLowerCase(),
    coin2: coin2.toLowerCase(),
    pairReadable: `${coin1}/${coin2}`,
    pairPlain: pair,
  };
}
