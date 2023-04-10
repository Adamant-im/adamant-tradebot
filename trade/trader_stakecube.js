const StakeCubeApi = require('./api/stakecube_api');
const utils = require('../helpers/utils');

// API endpoints:
const apiServer = 'https://stakecube.io/api/v2';
const exchangeName = 'StakeCube';

module.exports = (
    apiKey,
    secretKey,
    pwd,
    log,
    publicOnly = false,
    loadMarket = true,
) => {
  const stakeCubeApiClient = StakeCubeApi();

  stakeCubeApiClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets on initialization
  if (loadMarket) {
    getMarkets();
  }

  /**
   * Get info on all markets or return info on a specific market
   * @param {String} pair In classic format like BTC/USDT. If not provided, update all markets.
   * @returns {Promise<unknown>|*}
   */
  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair];

    module.exports.gettingMarkets = true;
    return new Promise((resolve) => {
      stakeCubeApiClient.markets().then((markets) => {
        try {
          if (markets.errorMessage) {
            log.warn(`API request getMarkets(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${markets.errorMessage}`);
            resolve(undefined);
          }

          const result = {};

          Object.entries(markets).forEach(([pairName, market]) => {
            const pair = deformatPairName(pairName);

            result[pair.pairReadable] = {
              pairReadable: pair.pairReadable,
              pairPlain: pair.pair,
              coin1: market.tradeMarket, // base
              coin2: market.baseMarket, // quote
              coin1Decimals: +market.tradeMinDecimal,
              coin2Decimals: +market.baseMinDecimal,
              coin1Precision: utils.getPrecision(+market.tradeMinDecimal),
              coin2Precision: utils.getPrecision(+market.baseMinDecimal),
              coin1MinAmount: null,
              coin1MaxAmount: null,
              coin2MinAmount: null,
              coin2MaxAmount: null,
              coin2MinPrice: null,
              coin2MaxPrice: null,
              minTrade: null,
              status: market.status === 'ACTIVE' ? 'ONLINE' : 'OFFLINE',
            };
          });

          if (Object.keys(result).length > 0) {
            module.exports.exchangeMarkets = result;
            log.log(`Received info about ${Object.keys(result).length} markets on ${exchangeName} exchange.`);
          }

          resolve(result);
        } catch (e) {
          log.warn(`Error while processing getMarkets(${paramString}) request: ${e}`);
          return undefined;
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
    getMarkets,

    get markets() {
      return module.exports.exchangeMarkets;
    },

    /**
     * Get market info for a pair
     * @param pair In classic format like BTC/USDT
     * @returns {Promise<*>|*}
     */
    marketInfo(pair) {
      return getMarkets(pair);
    },

    features() {
      return {
        getMarkets: true,
        getCurrencies: false,
        placeMarketOrder: false,
        getDepositAddress: true,
        getTradingFees: false,
        getAccountTradeVolume: false,
        createDepositAddressWithWebsiteOnly: false,
        getFundHistory: false,
        getFundHistoryImplemented: false,
        supportCoinNetworks: false,
        allowAmountForMarketBuy: false,
        amountForMarketOrderNecessary: true,
      };
    },

    /**
     * List of account balances for all currencies
     * @param {Boolean} nonzero
     * @returns {Promise<[]|undefined>}
     */
    async getBalances(nonzero = true) {
      const paramString = `nonzero: ${nonzero}`;

      let userData;

      try {
        userData = await stakeCubeApiClient.getUserData();

        if (userData.errorMessage) {
          log.warn(`API request getBalances(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${userData.errorMessage}`);
          return undefined;
        }
      } catch (err) {
        log.warn(`API request getBalances(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        let result = [];

        for (crypto of userData.wallets) {
          result.push({
            code: crypto.asset,
            free: +crypto.balance,
            freezed: +crypto.balanceInOrder,
            total: +crypto.balance + +crypto.balanceInOrder,
          });
        }

        if (nonzero) {
          result = result.filter((crypto) => crypto.free || crypto.freezed);
        }

        return result;
      } catch (e) {
        log.warn(`Error while processing getBalances(${paramString}) request: ${e}`);
        return undefined;
      }
    },

    /**
     * List of all account open orders
     * @param {String} pair In classic format as BTC/USD
     * @returns {Promise<[]|undefined>}
     */
    async getOpenOrders(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      const marketInfo = this.marketInfo(pair);

      if (!marketInfo) {
        log.warn(`Unable to place an order on ${exchangeName} exchange. I don't have info about market ${pair}`);
        return undefined;
      }

      let orders;

      try {
        orders = await stakeCubeApiClient.getOrders(pair_.pair);

        if (orders.errorMessage) {
          if (orders.errorMessage === 'no data') {
            return [];
          } else {
            log.warn(`API request getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${orders.errorMessage}`);
            return undefined;
          }
        }
      } catch (err) {
        log.warn(`API request getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        const result = [];

        orders.forEach((order) => {
          let orderStatus;
          const pair = deformatPairName(order.market);

          const amountLeft = +order.amount - +order.executedAmount;

          if (+order.executedAmount && amountLeft) {
            orderStatus = 'part_filled';
          } else if (amountLeft) {
            orderStatus = 'new';
          } else {
            orderStatus = 'filled';
          }

          result.push({
            orderId: order.id?.toString(),
            symbol: pair.pairReadable,
            price: +order.price,
            side: order.side.toLowerCase(), // 'buy' or 'sell'
            type: 'limit', // StakeCube supports only limit orders
            timestamp: Date.parse(order.placed), // e.g. StakeCube timestamp (order.placed) 2023-04-10 10:17:03, converting to 1681111023000
            amount: +order.amount,
            amountExecuted: +order.executedAmount,
            amountLeft,
            status: orderStatus,
          });
        });

        return result;
      } catch (e) {
        log.warn(`Error while processing getOpenOrders(${paramString}) request: ${e}`);
        return undefined;
      }
    },

    /**
     * Cancel an order
     * @param {String} orderId Example: 285088438163
     * @param {String} side 'buy' or 'sell'. Not used for StakeCube.
     * @param {String} pair In classic format as BTC/USDT. Not used for StakeCube.
     * @returns {Promise<Boolean|undefined>}
     */
    async cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, pair: ${pair}`;
      const pair_ = formatPairName(pair);

      try {
        const data = await stakeCubeApiClient.cancelOrder(orderId);

        if (data.errorMessage) {
          if (data.errorMessage === 'Order already canceled or filled') {
            log.warn(`Order ${orderId} on ${pair_.pairReadable} pair is already canceled or filled`);
            return true;
          } else {
            log.warn(`API request cancelOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${data.errorMessage}`);
            return undefined;
          }
        }

        if (data.orderId === orderId) {
          log.log(`Cancelling order ${orderId} on ${pair_.pairReadable} pair…`);
          return true;
        } else {
          log.warn(`Failed to cancel order ${orderId} on ${pair_.pairReadable} pair: No details.`);
          return false;
        }
      } catch (err) {
        log.warn(`API request cancelOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }
    },

    /**
     * Cancel all orders on a specific pair
     * @param {String} pair In classic format as BTC/USD
     * @param {String} side Not used for StakeCube.
     * @returns {Promise<Boolean|undefined>}
     */
    async cancelAllOrders(pair, side = '') {
      const paramString = `pair: ${pair}, side: ${side}`;
      const pair_ = formatPairName(pair);

      try {
        const data = await stakeCubeApiClient.cancelAllOrders(pair_.pair);

        if (data.errorMessage) {
          if (data.errorMessage === 'no open order') {
            log.log(`No open orders on ${pair_.pairReadable}`);
            return true;
          } else {
            log.warn(`API request cancelOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${data.errorMessage}`);
            return undefined;
          }
        }

        return true;
      } catch (err) {
        log.warn(`API request cancelOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }
    },

    /**
     * Places an order
     * @param {String} side 'buy' or 'sell'
     * @param {String} pair In classic format like BTC/USD
     * @param {Number} price Order price
     * @param {Number} coin1Amount Base coin amount. Provide either coin1Amount or coin2Amount.
     * @param {Number} limit StakeCube supports only limit orders
     * @param {Number} coin2Amount Quote coin amount. Provide either coin1Amount or coin2Amount.
     * @returns {Promise<unknown>|undefined}
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

      if (coin1Amount) {
        coin1Amount = +(+coin1Amount).toFixed(marketInfo.coin1Decimals);
      }
      if (coin2Amount) {
        coin2Amount = +(+coin2Amount).toFixed(marketInfo.coin2Decimals);
      }
      if (price) {
        price = +(+price).toFixed(marketInfo.coin2Decimals);
      }

      if (coin1Amount && coin1Amount < marketInfo.coin1MinAmount) { // coin1Amount may be null
        message = `Unable to place an order on ${exchangeName} exchange. Order amount ${coin1Amount} ${marketInfo.coin1} is less minimum ${marketInfo.coin1MinAmount} ${marketInfo.coin1} on ${marketInfo.pairReadable} pair.`;
        log.warn(message);
        return {
          message,
        };
      }

      if (coin2Amount && coin2Amount < marketInfo.coin2MinAmount) { // coin2Amount may be null, and skip coin2AmountCalculated checking, it's for market order only
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
        output = `${side} ${coin1Amount} ${pairName.coin1} at ${price} ${pairName.coin2}.`;

        const order = {};
        let orderId;
        let errorMessage;
        let response;

        try {
          response = await stakeCubeApiClient.addOrder(marketInfo.pairPlain, coin1Amount, price, side);

          orderId = response?.orderId;
          errorMessage = response?.errorMessage;
        } catch (err) {
          message = `API request addOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}.`;
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
        } else if (!orderId && !errorMessage) {
          message = `Order executed to ${output}`;
          log.info(message);
          order.orderId = null;
          order.message = message;
        } else {
          const details = errorMessage ? ` Details: ${utils.trimAny(errorMessage, ' .')}.` : ' { No details }.';
          message = `Unable to place order to ${output}${details} Check parameters and balances.`;
          log.warn(message);
          order.orderId = false;
          order.message = message;
        }

        return order;
      } else { // Market order
        message = `Unable to place order to ${output} ${exchangeName} doesn't support Market orders.`;
        log.warn(message);
        order.orderId = false;
        order.message = message;
        return order;
      }
    },

    /**
     * Get deposit address for specific coin
     * @param coin e.g. BTC
     * @returns {Promise<[]|undefined>}
     */
    async getDepositAddress(coin) {
      const paramString = `coin: ${coin}`;

      let userData;
      try {
        userData = await stakeCubeApiClient.getUserData();

        if (userData.errorMessage) {
          log.warn(`API request getDepositAddress(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${userData.errorMessage}`);
          return undefined;
        }
      } catch (err) {
        log.warn(`API request getDepositAddress(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        const { wallets } = userData;
        let result;

        for (const wallet of wallets) {
          if (wallet.asset === coin.toUpperCase()) {
            result = [{ network: wallet.network, address: wallet.address }];
            break;
          }
        }

        return result;
      } catch (err) {
        log.warn(`Error while processing getDepositAddress(${paramString}) request: ${e}`);
        return undefined;
      }
    },

    /**
     * Get trade details for a market rates
     * @param {String} pair In classic format as BTC/USD
     * @returns {Promise<Object|undefined>}
     */
    async getRates(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let ticker;

      try {
        ticker = await stakeCubeApiClient.ticker(pair_.pair);

        if (ticker.errorMessage || !ticker[pair_.pair]) {
          log.warn(`API request getRates(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${ticker.errorMessage}`);
          return undefined;
        }
      } catch (err) {
        log.warn(`API request getRates(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      let orderBook;
      try {
        orderBook = await stakeCubeApiClient.orderBook(pair_.pair);

        if (orderBook.errorMessage) {
          log.warn(`API request getRates(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${orderBook.errorMessage}`);
          return undefined;
        }
      } catch (err) {
        log.warn(`API request getRates(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        ticker = ticker[pair_.pair];
        return {
          ask: +orderBook.asks[orderBook.asks.length - 1]?.price, // assuming asks are sorted in descending order by price. We need the lowest ask
          bid: +orderBook.bids[0]?.price, // assuming bids are sorted in descending order by price. We need the highest bid
          volume: +ticker.volumeTrade24h,
          volumeInCoin2: +ticker.volumeBase24h,
          high: +ticker.high24h,
          low: +ticker.low24h,
          last: +ticker.lastPrice,
        };
      } catch (e) {
        log.warn(`Error while processing getRates(${paramString}) request: ${e}`);
        return undefined;
      }
    },

    /**
     * Get market depth
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Object|undefined>}
     */
    async getOrderBook(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let book;
      try {
        book = await stakeCubeApiClient.orderBook(pair_.pair);

        if (book.errorMessage) {
          log.warn(`API request getOrderBook(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${book.errorMessage}`);
          return undefined;
        }
      } catch (err) {
        log.warn(`API request getOrderBook(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        const result = {
          bids: [],
          asks: [],
        };

        book.asks.forEach((crypto) => {
          result.asks.push({
            amount: +crypto.amount,
            price: +crypto.price,
            count: 1,
            type: 'ask-sell-right',
          });
        });
        result.asks.sort((a, b) => {
          return parseFloat(a.price) - parseFloat(b.price);
        });

        book.bids.forEach((crypto) => {
          result.bids.push({
            amount: +crypto.amount,
            price: +crypto.price,
            count: 1,
            type: 'bid-buy-left',
          });
        });
        result.bids.sort((a, b) => {
          return parseFloat(b.price) - parseFloat(a.price);
        });

        return result;
      } catch (e) {
        log.warn(`Error while processing orderBook(${paramString}) request: ${e}`);
        return undefined;
      }
    },

    /**
     * Get trades history
     * @param {String} pair In classic format as BTC/USDT
     * @param {Number} limit Number of records to return
     * @returns {Promise<[]|undefined>}
     */
    async getTradesHistory(pair, limit) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let trades = [];
      try {
        trades = await stakeCubeApiClient.getTradesHistory(pair_.pairPlain, limit);

        if (trades.errorMessage) {
          log.warn(`API request getTradesHistory(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${trades.errorMessage}}`);
          return undefined;
        }
      } catch (err) {
        log.warn(`API request getTradesHistory(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        const result = [];
        trades.forEach((trade) => {
          result.push({
            coin1Amount: +trade.amount, // amount in coin1
            price: +trade.price, // trade price
            coin2Amount: +trade.amount * +trade.price, // quote in coin2
            date: Date.parse(trade.timeConverted), // e.g. StakeCube timestamp (trade.timeConverted) 2023-04-10 10:17:03, converting to 1681111023000
            type: trade.direction.toLowerCase(), // 'buy' or 'sell'
            tradeId: null,
          });
        });

        // We need ascending sort order
        result.sort(function(a, b) {
          return parseFloat(a.date) - parseFloat(b.date);
        });

        return result;
      } catch (e) {
        log.warn(`Error while processing getTradesHistory(${paramString}) request: ${e}`);
        return undefined;
      }
    },
  };
};

/**
 * Returns pair in StakeCube format like BTC_USDT
 * @param pair Pair in any format
 * @returns {Object} Pair, coin1, coin2
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
    pairPlain: pair,
    pairReadable: `${coin1}/${coin2}`,
    coin1,
    coin2,
  };
}

/**
 * Returns pair in classic format like BTC/USDT
 * @param pair Pair in format BTC_USDT
 * @returns {Object}
 */
function deformatPairName(pair) {
  pair = pair?.toUpperCase();

  const [coin1, coin2] = pair.split('_');

  return {
    pair: `${coin1}_${coin2}`, // BTC_USDT
    pairReadable: `${coin1}/${coin2}`, // BTC/USDT
    coin1,
    coin2,
  };
}
