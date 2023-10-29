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
      stakeCubeApiClient.markets().then((scData) => {
        try {
          const markets = scData.result;

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
              status: market.state === 'ACTIVE' ? 'ONLINE' : 'OFFLINE',
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
        createDepositAddressWithWebsiteOnly: true,
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

      let scData;

      try {
        scData = await stakeCubeApiClient.getUserData();
      } catch (err) {
        log.warn(`API request getBalances(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      const userData = scData.result;

      try {
        let result = [];

        for (const crypto of userData.wallets) {
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

      let scData;

      try {
        scData = await stakeCubeApiClient.getOrders(pair_.pair);
      } catch (err) {
        log.warn(`API request getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      const orders = scData.result;

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
            orderId: order.id?.toString(), // Store all order ids as string
            symbol: pair.pairReadable,
            price: +order.price,
            side: order.side.toLowerCase(), // 'buy' or 'sell'
            type: 'limit', // StakeCube supports only limit orders
            timestamp: Date.parse(order.placed + '+00:00'), // e.g. StakeCube timestamp (order.placed) 2023-04-29 13:22:44, converting to 1681111023000
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
     * @param {String} orderId Example: 5547806
     * @param {String} side 'buy' or 'sell'. Not used for StakeCube.
     * @param {String} pair In classic format as BTC/USDT. Not used for StakeCube.
     * @returns {Promise<Boolean|undefined>}
     *   Undefined: the exchange didn't process a request; try one more time later
     *   True: an order was cancelled
     *   False: the exchange processed a request, but didn't cancel an order; it may be cancelled already, or orderId doesn't exist
     */
    async cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let scData;

      try {
        scData = await stakeCubeApiClient.cancelOrder(orderId);
      } catch (err) {
        log.warn(`API request cancelOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        const data = scData.result;

        if (data.orderId) {
          log.log(`Cancelling order ${orderId} on ${pair_.pairReadable} pair…`);
          return true;
        } else {
          const errorMessage = scData?.errorMessage || JSON.stringify(scData) || 'No details';

          log.log(`Failed to cancel order ${orderId} on ${pair_.pairReadable} pair: ${errorMessage}. Assuming it doesn't exist or already cancelled.`);
          return false;
        }
      } catch (e) {
        log.warn(`Error while processing cancelOrder(${paramString}) request: ${e}`);
        return undefined;
      }
    },

    /**
     * Cancel all orders on a specific pair
     * @param {String} pair In classic format as BTC/USD
     * @param {String} side Not used for StakeCube
     * @returns {Promise<Boolean|undefined>}
     */
    async cancelAllOrders(pair, side = '') {
      const paramString = `pair: ${pair}, side: ${side}`;
      const pair_ = formatPairName(pair);

      let scData;

      try {
        scData = await stakeCubeApiClient.cancelAllOrders(pair_.pair);
      } catch (err) {
        log.warn(`API request cancelAllOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      try {
        const data = scData.result;

        if (data.length) {
          log.log(`Cancelling all ${data.length} orders on ${pair_.pairReadable} pair…`);
          return true;
        } else {
          const errorMessage = scData?.errorMessage || JSON.stringify(scData) || 'No details';

          log.log(`Cancelling all orders on ${pair_.pairReadable} pair: ${errorMessage}.`);
          return false;
        }
      } catch (e) {
        log.warn(`Error while processing cancelAllOrders(${paramString}) request: ${e}`);
        return undefined;
      }
    },

    /**
     * Places an order
     * Note: market orders are not supported via API
     * @param {String} side 'buy' or 'sell'
     * @param {String} pair In classic format like BTC/USD
     * @param {Number} price Order price
     * @param {Number} coin1Amount Base coin amount. Provide either coin1Amount or coin2Amount.
     * @param {Number} limit StakeCube supports only limit orders
     * @param {Number} coin2Amount Quote coin amount. Provide either coin1Amount or coin2Amount.
     * @returns {Promise<{orderId: string|boolean, message: string}>|string}
     *   In case of pre-request error, returns error message string.
     *   After request, returns an object with orderId and message. Cast orderId to string.
     *   In case if order was not placed, orderId is false, and message contains error info.
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
        // eslint-disable-next-line no-unused-vars
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
        let scData;
        let filledNote = '';

        try {
          scData = await stakeCubeApiClient.addOrder(marketInfo.pairPlain, coin1Amount, price, side);
          const response = scData.result;

          orderId = response?.orderId;
          errorMessage = scData?.errorMessage;
          const fills = response?.fills;

          if (!orderId && !errorMessage && fills?.length) {
            // When an order executes just after it placed, StakeCube returns no orderId
            // To correspond with the bot's order structure, we'll generate a random 12-digit orderId
            // Real orderId sample: 5413353. Fake orderId sample: 59039834250 (greater)
            orderId = Math.floor(Math.random() * 10 ** 12);
            filledNote = ` Note: API haven't returned orderId, generated a random one. The order is fully executed with ${fills.length} ${utils.incline(fills.length, 'fill', 'fills')}.`;
          }
        } catch (err) {
          message = `API request addOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}.`;
          log.warn(message);
          order.orderId = false;
          order.message = message;

          return order;
        }

        if (orderId) {
          message = `Order placed to ${output} Order Id: ${orderId}.${filledNote}`;
          log.info(message);
          order.orderId = String(orderId);
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

      let scData;
      try {
        scData = await stakeCubeApiClient.getUserData();
      } catch (err) {
        log.warn(`API request getDepositAddress(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      const userData = scData.result;

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
      } catch (e) {
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

      let scTickerData;

      try {
        scTickerData = await stakeCubeApiClient.ticker(pair_.pair);
      } catch (err) {
        log.warn(`API request getRates-ticker(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      let ticker = scTickerData.result;

      let scOrderBookData;
      try {
        scOrderBookData = await stakeCubeApiClient.orderBook(pair_.pair);
      } catch (err) {
        log.warn(`API request getRates-orderBook(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      const orderBook = scOrderBookData.result;

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

      let scData;
      try {
        scData = await stakeCubeApiClient.orderBook(pair_.pair);
      } catch (err) {
        log.warn(`API request getOrderBook(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      const book = scData.result;

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

      let scData = [];
      try {
        scData = await stakeCubeApiClient.getTradesHistory(pair_.pairPlain, limit);
      } catch (err) {
        log.warn(`API request getTradesHistory(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${err}`);
        return undefined;
      }

      const trades = scData.result;

      try {
        const result = [];

        trades.forEach((trade) => {
          result.push({
            coin1Amount: +trade.amount, // amount in coin1
            price: +trade.price, // trade price
            coin2Amount: +trade.amount * +trade.price, // quote in coin2
            date: Date.parse(trade.timeConverted + '+00:00'), // e.g. StakeCube timestamp (trade.timeConverted) 2023-04-10 10:17:03, converting to 1681111023000
            type: trade.direction.toLowerCase(), // 'buy' or 'sell'
            tradeId: null,
          });
        });

        // We need ascending sort order
        result.sort((a, b) => {
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
