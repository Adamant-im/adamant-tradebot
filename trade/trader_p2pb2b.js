/**
 * Connector to the P2B2B API.
 * Intended for use by other bot modules.
 *
 * @typedef {import('types/markets.d').ResultItem} MarketsResultItem
 * @typedef {import('types/markets.d').MarketsResult} MarketsResult
 * @typedef {import('types/address.d').Result} AddressResult
 * @typedef {import('types/assets.d').Result} AssetsResult
 * @typedef {import('types/depth.d').DepthResult} DepthResult
 * @typedef {import('types/orders.d').Result} OrdersResult
 * @typedef {import('types/order-cancel.d')} OrderCancelResult
 * @typedef {import('types/order-info.d').Result} OrderInfoResult
 * @typedef {import('types/order-place.d').Result} OrderPlaceResult
 * @typedef {import('types/rates.d').RatesResult} RatesResult
 * @typedef {import('types/trades.d').TradesResult} TradesResult
 * @typedef {import('types/transfer.d').TransferEntries} TransferEntries
 * @typedef {import('types/transfer.d').Result} TransferResult
 */

const P2PB2B = require('./api/p2pb2b_api');
const utils = require('../helpers/utils');
const constants = require('../helpers/const');
const config = require('./../modules/configReader');

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

// API endpoints:
// Base URL for requests is https://api.p2pb2b.com
const apiServer = 'https://api.p2pb2b.com';
const exchangeName = 'P2PB2B';

/**
 * P2PB2B exchange connector factory.
 */
module.exports = (
    apiKey,
    secretKey,
    pwd,
    log,
    publicOnly = false,
    loadMarket = true,
    useSocket = false,
    useSocketPull = false,
    accountNo = 0,
    coin1 = config.coin1,
    coin2 = config.coin2,
) => {
  const P2PB2BClient = P2PB2B();

  P2PB2BClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets on initialization (fire-and-forget)
  if (loadMarket) {
    getMarkets();
  }

  /**
   * Loads markets information from the exchange and caches it.
   * If markets are already cached, optionally returns info for a specific pair.
   *
   * @param {string} [pair] Optional classic pair, e.g. `ETH/USDT`, for convenience
   * @returns {Promise<MarketsResult | undefined> | MarketsResultItem | undefined}
   *   - During initial call: Promise resolving to full markets map `{ 'ETH/USDT': {...}, ... }`
   *   - After cache is filled:
   *       - if `pair` is provided: single market info object
   *       - without `pair`: full markets map
   */
  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair ? formatPairName(pair).pairPlain : pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve) => {
      P2PB2BClient.markets()
          .then((data) => {
            try {
              if (!data.success) {
                throw String(`Request failed with data ${JSON.stringify(data)}`);
              }

              const markets = data.result;
              /** @type {MarketsResult} */
              const result = {};

              Object.keys(markets).forEach((marketName) => {
                const market = markets[marketName];
                const pairInfo = formatPairName(market.name);

                result[pairInfo.pairPlain] = {
                  // stock — coin1, money — coin2
                  pairPlain: pairInfo.pairPlain, // e.g. ETH_USDT
                  pairReadable: pairInfo.pairReadable, // e.g. ETH/USDT
                  coin1: pairInfo.coin1,
                  coin2: pairInfo.coin2,
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
                  status: 'ONLINE',
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
          })
          .catch((err) => {
            log.warn(`API request getMarkets(${paramString}) of ${moduleName} module failed. ${err}.`);
            resolve(undefined);
          })
          .finally(() => {
            module.exports.gettingMarkets = false;
          });
    });
  }

  return {
    /**
     * Cached markets map.
     * @type {Object<string, Object>|undefined}
     */
    get markets() {
      return module.exports.exchangeMarkets;
    },

    /**
     * Returns cached market info for a pair, if available.
     * Does NOT wait for network call, only uses already loaded markets.
     *
     * @param {string} pair Trading pair in classic format, e.g. `ETH/USDT`
     * @returns {Object|undefined} Market info or undefined if not cached yet
     */
    marketInfo(pair) {
      return getMarkets(pair?.toUpperCase());
    },

    /**
     * Returns exchange feature flags and limits.
     *
     * @returns {Object}
     */
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
        apiProcessingDelayMs: 1000, // Override DEFAULT_API_PROCESSING_DELAY_MS const
        openOrdersCacheSec: 180, // P2PB2B exchange say cache time is ~5 sec, but it's not true. Real cache time is unknown.
        partiallyFilledIsFilled: true, // Unable to determine if an order is filled or partially filled
      };
    },

    /**
     * Returns balances for the account.
     *
     * @param {boolean} [nonzero=true] If true, filter out zero balances
     * @returns {Promise<AssetsResult | undefined>} Balances list or undefined on failure
     */
    async getBalances(nonzero = true) {
      const paramString = `nonzero: ${nonzero}`;
      let data;

      try {
        data = await P2PB2BClient.getBalances();
        if (!data.success) {
          throw String(`Request failed with data ${JSON.stringify(data)}`);
        }
      } catch (err) {
        log.warn(`API request getBalances(${paramString}) of ${moduleName} module failed. ${err}.`);
        return undefined;
      }

      try {
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

        return result;
      } catch (e) {
        log.warn(`Error while processing getBalances(${paramString}) request: ${e}`);
        return undefined;
      }
    },

    /**
     * Get one page of account open orders.
     *
     * @param {string} pair Trading pair in classic format, e.g. `BTC/USDT`
     * @param {number} [offset=0] Pagination offset
     * @param {number} [limit=100] Page size
     * @returns {Promise<OrdersResult["result"] | undefined>} List of open orders or undefined on failure
     */
    async getOpenOrdersPage(pair, offset = 0, limit = 100) {
      const paramString = `pair: ${pair}, offset: ${offset}, limit: ${limit}`;
      const pair_ = formatPairName(pair);

      let data;

      try {
        data = await P2PB2BClient.getOrders(pair_.pairPlain, offset, limit);
        if (!data.success) {
          throw String(`Request failed with data ${JSON.stringify(data)}`);
        }
      } catch (err) {
        log.warn(`API request getOpenOrdersPage(${paramString}) of ${moduleName} module failed. ${err}.`);
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
            symbol: formatPairName(order.market).pairReadable, // In readable format as ETH/USDT
            symbolPlain: order.market, // In P2PB2B format as ETH_USDT
            price: +order.price,
            side: order.side, // 'buy' or 'sell'
            type: order.type, // 'limit' or 'market'
            timestamp: Math.round(order.timestamp * 1000), // 1676576771.061857
            amount: +order.amount,
            amountExecuted: +order.dealStock,
            amountLeft: +order.left,
            status: orderStatus,
            // Additionally: dealMoney, takerFee, makerFee, dealFee
          });
        });

        return result;
      } catch (e) {
        log.warn(`Error while processing getOpenOrdersPage(${paramString}) request results: ${JSON.stringify(data)}. ${e}`);
        return undefined;
      }
    },

    /**
     * Returns the full list of all open orders for an account.
     *
     * @param {string} pair Trading pair in classic format, e.g. `BTC/USDT`
     * @returns {Promise<OrdersResult["result"] | undefined>} A full list of open orders or undefined on failure
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
     * Retrieves details for a specific order.
     * Important for determining whether the order was filled.
     * P2B doesn't allow to query `cancelled` orders. For `new` and `part_filled`, using `getOpenOrders()`.
     * [Tested 2025-12-13]
     *
     * Possible statuses:
     *   - `unknown`
     *   - `new`
     *   - `part_filled`
     *   - `filled`
     *   - `cancelled` (not working, fallback to `unknown`)
     *
     * @param {string} orderId Example: '120531775560'
     * @param {string} pair Trading pair in classic format, e.g. `BTC/USDT` (used for logging)
     * @returns {Promise<OrderInfoResult | undefined>} Order details, or undefined on failure or incorrect orderId
     */
    async getOrderDetails(orderId, pair) {
      const paramString = `orderId: ${orderId}, pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let dataDeals;
      let dataFinished;
      let dataOpened;

      // First, try to find the orderId in the `finishedOrders` list

      try {
        const endTime = Date.now();
        const startTime = endTime - constants.DAY;
        dataFinished = await P2PB2BClient.getFinishedOrders(pair_.pairPlain, startTime, endTime);
        if (!dataFinished.success) {
          throw String(`Request failed with data ${JSON.stringify(dataFinished)}`);
        }
      } catch (err) {
        log.warn(`API request getOrderDetails-getOrderDeals(${paramString}) of ${moduleName} module failed. ${err}.`);
        return undefined;
      }

      try {
        let result;

        const finishedOrders = dataFinished.result.orders;

        /** @type {"cancelled" | "filled" | "new" | "part_filled" | "unknown"} */
        let status;

        const finished = finishedOrders.find((order) => String(order.id) === orderId);
        if (finished) {
          status = 'filled';

          result = {
            orderId: String(finished.id),

            price: Number(finished.price),
            side: finished.side, // 'buy' or 'sell'
            type: finished.type, // 'limit' or 'market'

            amount: Number(finished.amount),
            volume: Number(finished.dealMoney),

            amountExecuted: Number(finished.dealStock),
            volumeExecuted: Number(finished.dealMoney),

            pairPlain: finished.market,
            pairReadable: pair_.pairReadable,

            tradesCount: undefined, // We don't fetch trades to save requests
            totalFeeInCoin2: Number(finished.dealFee),

            timestamp: Math.floor(finished.ctime * 1000),
            updateTimestamp: Math.floor((finished.ftime) * 1000),

            status,
          };

          return result;
        }
      } catch (e) {
        log.warn(`Error while processing getOrderDetails-getOrderDeals(${paramString}) request results: ${JSON.stringify(dataFinished)}. ${e}`);
        return undefined;
      }

      // Next, try to request deals by orderId

      try {
        dataDeals = await P2PB2BClient.getOrderDeals(orderId);
        if (!dataDeals.success) {
          throw String(`Request failed with data ${JSON.stringify(dataDeals)}`);
        }
      } catch (err) {
        log.warn(`API request getOrderDetails-dataDeals(${paramString}) of ${moduleName} module failed. ${err}.`);
        return undefined;
      }

      try {
        let result;

        const orderTrades = dataDeals.result.records;

        /** @type {"cancelled" | "filled" | "new" | "part_filled" | "unknown"} */
        let status;

        if (orderTrades.length) {
          status = 'part_filled';

          result = {
            orderId,
            tradesCount: 0,

            side: undefined, // P2PB2B doesn't provide initial order side and type for deals
            type: undefined,

            price: +orderTrades[0].price,
            amount: undefined, // P2PB2B doesn't provide initial order amount for deals
            volume: undefined,

            pairPlain: pair_.pairPlain,
            pairReadable: pair_.pairReadable,

            totalFeeInCoin2: 0,
            amountExecuted: 0, // In coin1
            volumeExecuted: 0, // In coin2

            timestamp: undefined,
            updateTimestamp: Math.floor(orderTrades[0].time * 1000),

            status,

            // Additionally: dealOrderId - order matched
          };

          orderTrades.forEach((trade) => {
            result.tradesCount += 1;
            result.totalFeeInCoin2 += +trade.fee;
            result.amountExecuted += +trade.amount;
            result.volumeExecuted += +trade.deal;
          });

          return result;
        }
      } catch (e) {
        log.warn(`Error while processing getOrderDetails-dataDeals(${paramString}) request results: ${JSON.stringify(dataDeals)}. ${e}`);
        return undefined;
      }

      // Next, request open orders

      try {
        dataOpened = await this.getOpenOrders(pair_.pairReadable);
      } catch (err) {
        log.warn(`API request getOrderDetails-getOpenOrders(${paramString}) of ${moduleName} module failed. ${err}.`);
        return undefined;
      }

      try {
        let result;

        const openOrders = dataOpened;

        const open = openOrders.find((order) => order.orderId === orderId);
        if (open) {
          result = {
            orderId,

            price: open.price,
            side: open.side,
            type: open.type,

            amount: open.amount,
            volume: open.amount * open.price,

            amountExecuted: open.amountExecuted,
            volumeExecuted: undefined,

            pairPlain: open.symbolPlain,
            pairReadable: open.symbol,

            tradesCount: undefined,
            totalFeeInCoin2: undefined,

            timestamp: open.timestamp,
            updateTimestamp: undefined,

            status: /** @type {"cancelled" | "filled" | "new" | "part_filled" | "unknown"} */ (open.status),
          };

          return result;
        }
      } catch (e) {
        log.warn(`Error while processing getOrderDetails-getOrderDeals(${paramString}) request results: ${JSON.stringify(dataFinished)}. ${e}`);
        return undefined;
      }

      // Cancelled order: unable to verify

      return {
        orderId,
        status: 'unknown',
      };
    },

    /**
     * Cancels an order.
     *
     * @param {string} orderId Order identifier
     * @param {string} side Not used for P2PB2B
     * @param {string} pair Trading pair in classic format, e.g. `BTC/USDT`
     * @returns {Promise<boolean|undefined>}
     *   - true on success
     *   - false on logical failure (e.g. rejected by exchange)
     *   - undefined on request/processing error
     */
    async cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, side: ${side}, pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let data;

      try {
        data = await P2PB2BClient.cancelOrder(orderId, pair_.pairPlain);
      } catch (err) {
        log.warn(`API request cancelOrder(${paramString}) of ${moduleName} module failed. ${err}.`);
        return undefined;
      }

      try {
        if (data?.success && data?.result?.orderId) {
          log.log(`Cancelling order ${data.result.orderId} on ${pair_.pairReadable} pair…`);
          return true;
        }

        const errorMessage = data?.p2bErrorInfo || 'No details';
        log.log(`Unable to cancel ${orderId} on ${pair_.pairReadable}: ${errorMessage}.`);
        return false;
      } catch (e) {
        log.warn(`Error while processing cancelOrder(${paramString}) request results: ${JSON.stringify(data)}. ${e}`);
        return undefined;
      }
    },

    /**
     * Returns ticker (best bid/ask and OHLC-like fields).
     *
     * @param {string} pair Trading pair in classic format, e.g. `BTC/USDT`
     * @returns {Promise<RatesResult | undefined>} Ticker info or undefined on failure
     */
    async getRates(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let data;

      try {
        data = await P2PB2BClient.ticker(pair_.pairPlain);
        if (!data.success) {
          throw String(`Request failed with data ${JSON.stringify(data)}`);
        }
      } catch (err) {
        log.warn(`API request getRates(${paramString}) of ${moduleName} module failed. ${err}`);
        return undefined;
      }

      try {
        const ticker = data.result;

        return {
          ask: +ticker.ask,
          bid: +ticker.bid,
          volume: +ticker.volume,
          volumeInCoin2: +ticker.deal,
          high: +ticker.high,
          low: +ticker.low,
          last: +ticker.last,
        };
      } catch (e) {
        log.warn(`Error while processing getRates(${paramString}) request: ${e}`);
        return undefined;
      }
    },

    /**
     * Places an order on the exchange.
     * P2PB2B supports only limit orders in this adapter.
     *
     * @param {'buy'|'sell'} orderSide Order side
     * @param {string} pair Trading pair in classic format, e.g. `BTC/USDT`
     * @param {number|string} price Limit price
     * @param {number|string} coin1Amount Amount in base currency
     * @param {number} [limit=1] If truthy → limit order; falsy → market (not supported)
     * @param {number|string} [coin2Amount] Amount in quote currency
     * @returns {Promise<OrderPlaceResult>}
     *   Order placement result or undefined on request/processing error
     */
    async placeOrder(orderSide, pair, price, coin1Amount, limit = 1, coin2Amount) {
      const paramString = `orderSide: ${orderSide}, pair: ${pair}, price: ${price}, coin1Amount: ${coin1Amount}, limit: ${limit}, coin2Amount: ${coin2Amount}`;

      const marketInfo = this.marketInfo(pair);
      let message;

      if (!marketInfo) {
        message = `Unable to place an order on ${exchangeName} exchange. I don't have info about market ${pair}.`;
        log.warn(message);
        return {
          message,
        };
      }

      // For Limit orders, calculate coin1Amount if only coin2Amount is provided
      if (!coin1Amount && coin2Amount && price) {
        coin1Amount = +coin2Amount / +price;
      }

      // For Limit orders, calculate coin2Amount if only coin1Amount is provided
      if (!coin2Amount && coin1Amount && price) {
        coin2Amount = +coin1Amount * +price;
      }

      // Round coin1Amount, coin2Amount and price to a certain number of decimal places, and check if they are correct.
      // Note: any value may be small, e.g., 0.000000033. In this case, its number representation will be 3.3e-8.
      // That's why we store values as strings. If an exchange doesn't support string type for values, cast them to numbers.

      if (coin1Amount) {
        coin1Amount = (+coin1Amount).toFixed(marketInfo.coin1Decimals);
        if (!+coin1Amount) {
          message = `Unable to place an order on ${exchangeName} exchange. After rounding to ${marketInfo.coin1Decimals} decimal places, the order amount is wrong: ${coin1Amount}.`;
          log.warn(message);
          return {
            message,
          };
        }
      }

      if (coin2Amount) {
        coin2Amount = (+coin2Amount).toFixed(marketInfo.coin2Decimals);
        if (!+coin2Amount) {
          message = `Unable to place an order on ${exchangeName} exchange. After rounding to ${marketInfo.coin2Decimals} decimal places, the order volume is wrong: ${coin2Amount}.`;
          log.warn(message);
          return {
            message,
          };
        }
      }

      if (price) {
        price = (+price).toFixed(marketInfo.coin2Decimals);
        if (!+price) {
          message = `Unable to place an order on ${exchangeName} exchange. After rounding to ${marketInfo.coin2Decimals} decimal places, the order price is wrong: ${price}.`;
          log.warn(message);
          return {
            message,
          };
        }
      }

      if (+coin1Amount < marketInfo.coin1MinAmount) {
        message = `Unable to place an order on ${exchangeName} exchange. Order amount ${coin1Amount} ${marketInfo.coin1} is less minimum ${marketInfo.coin1MinAmount} ${marketInfo.coin1} on ${marketInfo.pairReadable} pair.`;
        log.warn(message);
        return {
          message,
        };
      }

      if (coin2Amount && +coin2Amount < marketInfo.coin2MinAmount) { // coin2Amount may be null or undefined
        message = `Unable to place an order on ${exchangeName} exchange. Order volume ${coin2Amount} ${marketInfo.coin2} is less minimum ${marketInfo.coin2MinAmount} ${marketInfo.coin2} on ${pair} pair.`;
        log.warn(message);
        return {
          message,
        };
      }

      const order = {};

      if (limit) { // Limit order
        const output = `${orderSide} ${coin1Amount} ${marketInfo.coin1} at ${price} ${marketInfo.coin2}.`;

        let data;

        try {
          data = await P2PB2BClient.addOrder(marketInfo.pairPlain, String(coin1Amount), String(price), orderSide);
          if (!data.success) {
            throw String(`Request failed with data ${JSON.stringify(data)}`);
          }
        } catch (err) {
          log.warn(`API request addOrder(${paramString}) of ${moduleName} module failed. ${err}.`);
          return undefined;
        }

        try {
          const result = data.result;

          if (data.success && result?.orderId) {
            message = `Order placed to ${output} Order Id: ${result.orderId}.`;
            log.info(message);
            order.orderId = result.orderId.toString();
            order.message = message;
            return order;
          }

          const details = data?.p2bErrorInfo || 'No details';
          message = `Unable to place order to ${output} Check parameters and balances. Details: ${details}.`;
          log.warn(message);
          order.orderId = false;
          order.message = message;
          return order;
        } catch (e) {
          message = `Error while processing placeOrder(${paramString}) request: ${e}`;
          log.warn(message);
          order.orderId = false;
          order.message = message;
          return order;
        }
      }

      // Market order (not supported)
      message = `Unable to place Market order on ${exchangeName} exchange: Market orders are not supported.`;
      log.warn(message);
      order.orderId = false;
      order.message = message;
      return order;
    },

    /**
     * Returns order book (depth) for the given pair.
     *
     * @param {string} pair Trading pair in classic format, e.g. `BTC/USDT`
     * @returns {Promise<DepthResult | undefined>} Order book or undefined on failure
     */
    async getOrderBook(pair) {
      const paramString = `pair: ${pair}`;
      const pair_ = formatPairName(pair);

      let data;

      try {
        data = await P2PB2BClient.orderBook(pair_.pairPlain);
        if (!data.success) {
          throw String(`Request failed with data ${JSON.stringify(data)}`);
        }
      } catch (err) {
        log.warn(`API request getOrderBook(${paramString}) of ${moduleName} module failed. ${err}`);
        return undefined;
      }

      try {
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
            side: 'sell',
          });
        });
        result.asks.sort((a, b) => a.price - b.price);

        book.bids.forEach((crypto) => {
          result.bids.push({
            amount: +crypto[1],
            price: +crypto[0],
            count: 1,
            side: 'buy',
          });
        });
        result.bids.sort((a, b) => b.price - a.price);

        return result;
      } catch (e) {
        log.warn(`Error while processing orderBook(${paramString}) request: ${e}`);
        return undefined;
      }
    },

    /**
     * Returns recent trades history for a pair.
     *
     * @param {string} pair Trading pair in classic format, e.g. `BTC/USDT`
     * @param {number} [limit] Maximum number of trades
     * @returns {Promise<TradesResult | undefined>} List of trades sorted by ascending time, or undefined on failure
     */
    async getTradesHistory(pair, limit) {
      const paramString = `pair: ${pair}, limit: ${limit}`;
      const pair_ = formatPairName(pair);

      let data;

      try {
        data = await P2PB2BClient.getTradesHistory(pair_.pairPlain, undefined, limit);
        if (!data.success) {
          throw String(`Request failed with data ${JSON.stringify(data)}`);
        }
      } catch (err) {
        log.log(`API request getTradesHistory(${paramString}) of ${moduleName} module failed. ${err}.`);
        return undefined;
      }

      try {
        const trades = data.result;
        const result = [];

        trades.forEach((trade) => {
          result.push({
            coin1Amount: +trade.amount, // amount in coin1
            price: +trade.price, // trade price
            coin2Amount: +trade.amount * +trade.price, // quote in coin2
            date: Math.round(trade.time * 1000), // 1546505899.001003
            side: trade.type, // 'buy' or 'sell'
            tradeId: trade.id?.toString(),
          });
        });

        // We need ascending sort order
        result.sort((a, b) => a.date - b.date);

        return result;
      } catch (e) {
        log.warn(`Error while processing getTradesHistory(${paramString}) request: ${e}`);
        return undefined;
      }
    },

    /**
     * Not available for P2PB2B in this adapter.
     *
     * @param {string} coin Coin symbol
     */
    getDepositAddress(coin) {
      // Not implemented for P2PB2B
      return undefined;
    },
  };
};

/**
 * Normalizes a trading pair to P2PB2B format.
 *
 * Accepts any of the following and returns structured info:
 *   - `ETH/USDT`
 *   - `ETH-USDT`
 *   - `ETH_USDT`
 *
 * @param {string} pair Pair in any common format
 * @returns {{
 *   pairReadable: string, // e.g. 'ETH/USDT'
 *   pairPlain: string,    // e.g. 'ETH_USDT'
 *   coin1: string,
 *   coin2: string
 * }}
 */
function formatPairName(pair) {
  pair = pair?.toUpperCase();

  if (pair.indexOf('-') > -1) {
    pair = pair.replace('-', '_').toUpperCase();
  } else {
    pair = pair.replace('/', '_').toUpperCase();
  }

  const [coin1, coin2] = pair.split('_');
  const pairPlain = `${coin1}_${coin2}`;

  return {
    pairReadable: `${coin1}/${coin2}`,
    pairPlain,
    coin1,
    coin2,
  };
}
