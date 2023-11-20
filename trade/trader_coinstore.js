const CoinstoreApi = require('./api/coinstore_api');
const utils = require('../helpers/utils');

/**
 * API endpoints:
 * https://api.coinstore.com/api
 */
const apiServer = 'https://api.coinstore.com';
const exchangeName = 'Coinstore';

module.exports = (
    apiKey,
    secretKey,
    pwd,
    log,
    publicOnly = false,
    loadMarket = true,
) => {
  const coinstoreApiClient = CoinstoreApi();

  coinstoreApiClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets on initialization
  if (loadMarket) {
    getCurrencies();
    getMarkets();
  }

  /**
   * Get info on all currencies
   * @param {String} coin
   * @param {Boolean} forceUpdate Update currencies to refresh parameters
   * @returns {Promise<unknown>|*}
   */
  function getCurrencies(coin, forceUpdate = false) {
    if (module.exports.gettingCurrencies) return;
    if (module.exports.exchangeCurrencies && !forceUpdate) return module.exports.exchangeCurrencies[coin];

    module.exports.gettingCurrencies = true;

    return new Promise((resolve) => {
      coinstoreApiClient.currencies().then((currencies) => {
        try {
          const result = {};

          for (const coin in currencies) {
            // Returned data is not full and doesn't include decimals, precision, min amounts, etc
            const currency = currencies[coin];

            result[currency.name.toUpperCase()] = {
              symbol: currency.name.toUpperCase(),
              name: currency.name.toUpperCase(),
              status: undefined,
              comment: undefined,
              confirmations: undefined,
              withdrawalFee: undefined,
              minWithdraw: +currency.min_withdraw,
              maxWithdraw: +currency.max_withdraw,
              logoUrl: undefined,
              exchangeAddress: undefined,
              decimals: undefined,
              precision: undefined,
              networks: undefined,
              defaultNetwork: undefined,
              withdrawEnabled: currency.can_withdraw === 'true',
              depositEnabled: currency.can_deposit === 'true',
              id: currency.unified_cryptoasset_id,
            };
          }

          if (Object.keys(result).length > 0) {
            module.exports.exchangeCurrencies = result;
            log.log(`${forceUpdate ? 'Updated' : 'Received'} info about ${Object.keys(result).length} currencies on ${exchangeName} exchange.`);
          }

          module.exports.gettingCurrencies = false;
          resolve(result);
        } catch (error) {
          log.warn(`Error while processing getCurrencies() request: ${error}`);
          resolve(undefined);
        }
      }).catch((error) => {
        log.warn(`API request getCurrencies() of ${utils.getModuleName(module.id)} module failed. ${error}`);
        resolve(undefined);
      }).finally(() => {
        module.exports.gettingCurrencies = false;
      });
    });
  }

  /**
   * Get info on all markets and store in module.exports.exchangeMarkets
   * It's an internal function, not called outside of this module
   * @param {String} pair In classic format as BTC/USDT. If markets are already cached, get info for the pair.
   * @returns {Promise<unknown>|*}
   */
  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair ? formatPairName(pair).pairPlain : pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve) => {
      coinstoreApiClient.ticker().then((markets) => {
        try {
          const result = {};

          markets.forEach((market) => {
            const maxCoin1Decimals = Math.max(
                utils.getDecimalsFromNumber(market.bidSize),
                utils.getDecimalsFromNumber(market.askSize),
                utils.getDecimalsFromNumber(market.volume),
            );
            const maxCoin2Decimals = Math.max(
                utils.getDecimalsFromNumber(market.close),
                utils.getDecimalsFromNumber(market.open),
                utils.getDecimalsFromNumber(market.high),
                utils.getDecimalsFromNumber(market.low),
                utils.getDecimalsFromNumber(market.bid),
                utils.getDecimalsFromNumber(market.ask),
            );
            /**
             * Coinstore doesn't provide pair coin names or readable pair name
             * It uses symbols like 'BTCUSDT'
             * Thus, it's impossible to extract coin names or readable pair name
             */
            result[market.symbol] = {
              pairReadable: undefined,
              pairPlain: market.symbol,
              coin1: undefined,
              coin2: undefined,
              coin1Decimals: maxCoin1Decimals,
              coin2Decimals: maxCoin2Decimals,
              coin1Precision: utils.getPrecision(maxCoin1Decimals),
              coin2Precision: utils.getPrecision(maxCoin2Decimals),
              coin1MinAmount: null,
              coin1MaxAmount: null,
              coin2MinPrice: null,
              coin2MaxPrice: null,
              minTrade: null,
              status: null,
            };
          });

          if (Object.keys(result).length > 0) {
            module.exports.exchangeMarkets = result;
            log.log(`Received info about ${Object.keys(result).length} markets on ${exchangeName} exchange.`);
          }

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
    getCurrencies,

    /**
     * Getter for stored markets info
     * @return {Object}
     */
    get markets() {
      return module.exports.exchangeMarkets;
    },

    /**
     * Getter for stored currencies info
     * @return {Object}
     */
    get currencies() {
      return module.exports.exchangeCurrencies;
    },

    /**
     * Get info for a specific market
     * @param pair In readable format as BTC/USDT or in Coinstore format as BTCUSDT
     * @returns {Promise<*>|*}
     */
    marketInfo(pair) {
      return getMarkets(pair);
    },

    /**
     * Get info for a specific currency
     * @param coin As BTC
     * @returns {Promise<*>|*}
     */
    currencyInfo(coin) {
      return getCurrencies(coin);
    },

    /**
     * Features available on Coinstore exchange
     * @returns {Object}
     */
    features() {
      return {
        getMarkets: true,
        getCurrencies: true,
        placeMarketOrder: true,
        allowAmountForMarketBuy: false,
        getDepositAddress: false,
        createDepositAddressWithWebsiteOnly: true,
        getTradingFees: true,
        getAccountTradeVolume: false,
        getFundHistory: false,
        getFundHistoryImplemented: false,
      };
    },

    /**
     * Get user balances
     * @param {Boolean} nonzero Return only non-zero balances
     * @returns {Promise<Array|undefined>}
     */
    async getBalances(nonzero = true) {
      const paramString = `nonzero: ${nonzero}`;

      let balances;

      try {
        balances = await coinstoreApiClient.getBalances();
      } catch (error) {
        log.warn(`API request getBalances(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        let result = [];

        const available = balances.filter((crypto) => crypto.typeName === 'AVAILABLE');
        const frozen = balances.filter((crypto) => crypto.typeName !== 'AVAILABLE');

        for (const availableCrypto of available) {
          const frozenCrypto = frozen.find((crypto) => crypto.currency === availableCrypto.currency);
          availableCrypto.freezed = frozenCrypto?.balance;
        }

        available.forEach((crypto) => {
          result.push({
            code: crypto.currency.toUpperCase(),
            free: +crypto.balance,
            freezed: +crypto.freezed,
            total: +crypto.balance + +crypto.freezed,
          });
        });

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
        orders = await coinstoreApiClient.getOrders(coinPair.pairPlain);
      } catch (error) {
        log.warn(`API request getOpenOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const result = [];

        orders.forEach((order) => {
          let orderStatus;

          // https://coinstore-openapi.github.io/en/index.html#dictionary
          if (['SUBMITTED', 'SUBMITTING'].includes(order.ordStatus)) {
            orderStatus = 'new';
          } else if (order.ordStatus === 'PARTIAL_FILLED') {
            orderStatus = 'part_filled';
          } else if (order.ordStatus === 'FILLED') {
            orderStatus = 'filled';
          } else if (['CANCELED', 'CANCELING', 'REJECTED', 'EXPIRED', 'STOPPED'].includes(order.ordStatus)) {
            orderStatus = 'cancelled';
          }

          result.push({
            orderId: order.ordId.toString(),
            symbol: `${order.baseCurrency}/${order.quoteCurrency}`,
            symbolPlain: order.symbol,
            price: +order.ordPrice, // limit price
            side: order.side.toLowerCase(), // 'buy' or 'sell'
            type: order.ordType.toLowerCase(), // 'limit', 'market', 'post_only'
            timestamp: +order.timestamp,
            amount: +order.ordQty,
            amountExecuted: +order.cumQty, // quantity filled in base currency
            amountLeft: +order.leavesQty, // quantity left in base currency
            status: orderStatus,
          });
        });

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
     * @param {String} orderId Example: '1771215607820588'
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Object|undefined>}
     */
    async getOrderDetails(orderId, pair) {
      const paramString = `orderId: ${orderId}, pair: ${pair}`;

      let order;

      try {
        order = await coinstoreApiClient.getOrder(orderId);
      } catch (error) {
        log.warn(`API request getOrderDetails(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (!order.coinstoreErrorInfo) {
          let orderStatus;

          // https://coinstore-openapi.github.io/en/index.html#dictionary
          if (['SUBMITTED', 'SUBMITTING'].includes(order.ordStatus)) {
            orderStatus = 'new';
          } else if (order.ordStatus === 'PARTIAL_FILLED') {
            orderStatus = 'part_filled';
          } else if (order.ordStatus === 'FILLED') {
            orderStatus = 'filled';
          } else if (['CANCELED', 'CANCELING', 'REJECTED', 'EXPIRED', 'STOPPED'].includes(order.ordStatus)) {
            orderStatus = 'cancelled';
          } else {
            orderStatus = 'unknown';
          }

          const result = {
            orderId: order.ordId?.toString(), // According to docs, an order can have status 'NOT_FOUND'
            tradesCount: undefined, // Coinstore doesn't provide trades
            price: +order.ordPrice, // limit price
            side: order.side?.toLowerCase(), // 'buy' or 'sell'
            type: order.ordType?.toLowerCase(), // 'limit', 'market', 'post_only'
            amount: +order.ordQty, // In coin1
            volume: +order.ordQty * +order.ordPrice,
            pairPlain: order.symbol,
            pairReadable: `${order.baseCurrency}/${order.quoteCurrency}`,
            totalFeeInCoin2: undefined, // Coinstore doesn't provide fee info
            amountExecuted: +order.cumQty, // In coin1
            volumeExecuted: +order.cumAmt, // In coin2
            timestamp: +order.timestamp, // in milliseconds
            // when order.orderUpdateTime = order.timestamp, they are in milliseconds
            // else, order.orderUpdateTime is in seconds, need to multiply by 1000 to get milliseconds
            updateTimestamp: +order.orderUpdateTime === +order.timestamp ? +order.orderUpdateTime : +order.orderUpdateTime * 1000,
            status: orderStatus,
          };

          return result;
        } else {
          const errorMessage = order.coinstoreErrorInfo || 'No details.';
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
     * Places an order
     * Coinstore supports both limit and market orders
     * Market Buy is only possible with quote coin amount specified
     * Market Sell is only possible with base coin amount specified
     * @param {String} side 'buy' or 'sell'
     * @param {String} pair In classic format like BTC/USD
     * @param {Number} price Order price
     * @param {Number} coin1Amount Base coin amount. Provide either coin1Amount or coin2Amount.
     * @param {Number} limit 1 if order is limit (default), 0 in case of market order
     * @param {Number} coin2Amount Quote coin amount. Provide either coin1Amount or coin2Amount.
     * @returns {Promise<Object>|undefined}
     */
    async placeOrder(side, pair, price, coin1Amount, limit = 1, coin2Amount) {
      const paramString = `side: ${side}, pair: ${pair}, price: ${price}, coin1Amount: ${coin1Amount}, limit: ${limit}, coin2Amount: ${coin2Amount}`;

      const coinPair = formatPairName(pair);

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
        coin1Amount = (+coin1Amount).toFixed(this.marketInfo(pair).coin1Decimals);
      }
      if (coin2Amount) {
        coin2Amount = (+coin2Amount).toFixed(this.marketInfo(pair).coin2Decimals);
      }
      if (price) {
        price = (+price).toFixed(this.marketInfo(pair).coin2Decimals);
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
          output = `${side} ${coin1Amount} ${coinPair.coin1} for ${coin2Amount} ${coinPair.coin2} at ${price} ${coinPair.coin2}.`;
        } else {
          output = `${side} ${coin1Amount} ${coinPair.coin1} for ${coin2AmountCalculated} ${coinPair.coin2} at ${price} ${coinPair.coin2}.`;
        }
      } else {
        orderType = 'market';
        if (coin2Amount) {
          output = `${side} ${coinPair.coin1} for ${coin2Amount} ${coinPair.coin2} at Market Price on ${pair} pair.`;
        } else {
          output = `${side} ${coin1Amount} ${coinPair.coin1} at Market Price on ${pair} pair.`;
        }
      }

      const order = {};
      let response;
      let orderId;
      let errorMessage;

      try {
        // eslint-disable-next-line max-len
        response = await coinstoreApiClient.addOrder(coinPair.pairPlain, coin1Amount, coin2Amount, price, side, orderType);

        errorMessage = response?.coinstoreErrorInfo;
        orderId = response?.ordId;
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
     * Cancel an order
     * @param {String} orderId Example: '1771215607820588'
     * @param {String} side Not used for Coinstore
     * @param {String} pair In classic format as BTC/USDT
     * @returns {Promise<Boolean|undefined>}
     */
    async cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, side: ${side}, pair: ${pair}`;
      const coinPair = formatPairName(pair);

      let order;

      try {
        order = await coinstoreApiClient.cancelOrder(orderId, coinPair.pairPlain);
      } catch (error) {
        log.warn(`API request cancelOrder(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (order.state === 'CANCELED') {
          if (order.clientOrderId) {
            log.log(`Cancelling order ${orderId} on ${pair} pair…`);
            return true;
          } else {
            log.log(`Order ${orderId} on ${pair} pair is already cancelled.`);
            return false;
          }
        } else {
          const errorMessage = order?.state ?? order?.coinstoreErrorInfo ?? 'No details';
          log.log(`Unable to cancel order ${orderId} on ${pair} pair: ${errorMessage}.`);
          return false;
        }
      } catch (error) {
        log.warn(`Error while processing cancelOrder(${paramString}) request results: ${JSON.stringify(order)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Cancel all order on specific pair
     * @param pair In classic format as BTC/USDT
     * @returns {Promise<Boolean|undefined>}
     */
    async cancelAllOrders(pair) {
      const paramString = `pair: ${pair}`;
      const coinPair = formatPairName(pair);

      let orders;

      try {
        orders = await coinstoreApiClient.cancelAllOrders(coinPair.pairPlain);
      } catch (error) {
        log.warn(`API request cancelAllOrders(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        if (orders === undefined) {
          // Returns undefined if no orders cancelled
          log.log(`No active orders on ${coinPair.pairReadable} pair.`);
          return false;
        } else if (orders.canceling) {
          log.log(`Cancelled ${orders.canceling.length} orders on ${coinPair.pairReadable} pair…`);
          return true;
        } else {
          const errorMessage = orders?.state ?? orders?.coinstoreErrorInfo ?? 'No details';
          log.log(`Unable to cancel orders on ${coinPair.pairReadable} pair: ${errorMessage}.`);
          return false;
        }
      } catch (error) {
        log.warn(`Error while processing cancelAllOrders(${paramString}) request result: ${JSON.stringify(orders)}. ${error}`);
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

      try {
        ticker = await coinstoreApiClient.ticker();
      } catch (error) {
        log.warn(`API request getRates(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        ticker = ticker.find((t) => t.symbol === coinPair.pairPlain);

        return {
          ask: +ticker.ask,
          bid: +ticker.bid,
          last: +ticker.close,
          volume: +ticker.volume,
          volumeInCoin2: +ticker.amount,
          high: +ticker.high,
          low: +ticker.low,
        };
      } catch (error) {
        log.warn(`Error while processing getRates(${paramString}) request result: ${JSON.stringify(ticker)}. ${error}`);
        return undefined;
      }
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
        book = await coinstoreApiClient.orderBook(coinPair.pairPlain);
      } catch (error) {
        log.warn(`API request getOrderBook(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const result = {
          bids: [],
          asks: [],
        };

        book.a.forEach((crypto) => {
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

        book.b.forEach((crypto) => {
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
        trades = await coinstoreApiClient.getTradesHistory(coinPair.pairPlain);
      } catch (error) {
        log.warn(`API request getTradesHistory(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        const result = [];

        trades.forEach((trade) => {
          result.push({
            coin1Amount: +trade.volume, // amount in coin1
            price: +trade.price, // trade price
            coin2Amount: +trade.volume * +trade.price, // quote in coin2
            date: +trade.ts, // must be as utils.unixTimeStampMs(): 1641121688194 - 1 641 121 688 194
            type: trade.takerSide?.toLowerCase(), // 'buy' or 'sell'
            tradeId: trade.tradeId?.toString(),
          });
        });

        // We need ascending sort order
        result.sort((a, b) => {
          return parseFloat(a.date) - parseFloat(b.date);
        });

        return result;
      } catch (error) {
        log.warn(`Error while processing getTradesHistory(${paramString}) request result: ${JSON.stringify(trades)}. ${error}`);
        return undefined;
      }
    },

    /**
     * Get trading fees for account
     * @param coinOrPair e.g., 'ETH' or 'ETH/USDT'. If not set, get info for all trade pairs
     * @return {Promise<Array|undefined>}
     */
    async getFees(coinOrPair) {
      const paramString = `coinOrPair: ${coinOrPair}`;

      let coinPair;
      let coin;
      if (coinOrPair?.includes('/')) {
        coinPair = formatPairName(coinOrPair);
      } else {
        coin = coinOrPair?.toUpperCase();
      }

      let data;

      try {
        data = await coinstoreApiClient.currencies();
      } catch (error) {
        log.warn(`API request getFees(${paramString}) of ${utils.getModuleName(module.id)} module failed. ${error}`);
        return undefined;
      }

      try {
        let result = [];
        for (const coin in data) {
          const currency = data[coin];
          result.push({
            pair: coin,
            makerRate: +currency.maker_fee,
            takerRate: +currency.taker_fee,
          });
        }

        if (coinPair) {
          result = result.filter((pair) => pair.pair === coinPair.coin1);
        } else if (coin) {
          result = result.filter((pair) => pair.pair === coin);
        }

        return result;
      } catch (error) {
        log.warn(`Error while processing getFees(${paramString}) request result: ${JSON.stringify(data)}. ${error}`);
        return undefined;
      }
    },
  };
};

/**
 * Returns pair in Coinstore format like 'BTCUSDT'
 * @param pair Pair in any format
 * @returns {Object|Boolean} pair, pairReadable, pairPlain, coin1, coin2
*/
function formatPairName(pair) {
  pair = pair.toUpperCase();

  if (pair.indexOf('-') > -1) {
    pair = pair.replace('-', '/').toUpperCase();
  } else if (pair.indexOf('_') !== -1) {
    pair = pair.replace('_', '/').toUpperCase();
  }

  const [coin1, coin2] = pair.split('/');

  return {
    coin1,
    coin2,
    pair: `${coin1}${coin2}`,
    pairReadable: `${coin1}/${coin2}`,
    pairPlain: `${coin1}${coin2}`,
  };
}
