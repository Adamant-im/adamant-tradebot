/**
 * Connector to the FameEx.net API.
 * Intended for use by other bot modules.
 *
 * @module trade/trader_bybit.js
 * @typedef {import('types/accounts-bybit.d').AccountsResult} AccountsResult
 * @typedef {import('types/address.d').Result} AddressResult
 * @typedef {import('types/assets.d').Result} AssetsResult
 * @typedef {import('types/currencies.d').CurrenciesResult} CurrenciesResult
 * @typedef {import('types/currencies.d').ResultItem} CurrenciesResultItem
 * @typedef {import('types/deposit-history.d').Result} DepositHistoryResult
 * @typedef {import('types/depth.d').DepthResult} DepthResult
 * @typedef {import('types/feerates.d').Result} FeeRatesResult
 * @typedef {import('types/fills.d').FillsResult} FillsResult
 * @typedef {import('types/markets.d').MarketsResult} MarketsResult
 * @typedef {import('types/markets.d').ResultItem} MarketsResultItem
 * @typedef {import('types/order-cancel.d')} OrderCancelResult
 * @typedef {import('types/order-info.d').Result} OrderInfoResult
 * @typedef {import('types/order-place.d').Result} OrderPlaceResult
 * @typedef {import('types/orders.d').Result} OrdersResult
 * @typedef {import('types/orders-cancel.d')} OrdersCancelResult
 * @typedef {import('types/rates.d').RatesResult} RatesResult
 * @typedef {import('types/trades.d').TradesResult} TradesResult
 * @typedef {import('types/transfer.d').Result} TransferResult
 * @typedef {import('types/withdraw.d').Result} WithdrawResult
 * @typedef {import('types/withdraw-history.d').Result} WithdrawHistoryResult
 * @typedef {import('types/withdraw-id.d').Result} WithdrawIdResult
 */

'use strict';

/**
 * @typedef {import('types/fameexnet.d').Response} Response
 * @typedef {import('types/fameexnet/balances.d').default} Balances
 * @typedef {import('types/fameexnet/currencies.d').default} Currencies
 * @typedef {import('types/fameexnet/market-tickers.d').default} Markets
 * @typedef {import('types/fameexnet/order-all.d').default} OrderAll
 * @typedef {import('types/fameexnet/order-book.d').default} OrderBook
 * @typedef {import('types/fameexnet/order-place.d').default} OrderPlace
 * @typedef {import('types/fameexnet/order-cancel-few.d').default} OrderCancelFew
 * @typedef {import('types/fameexnet/order-cancel-one.d').default} OrderCancelOne
 * @typedef {import('types/fameexnet/trade-history.d').default} TradeHistory
 */

const FameexApi = require('./api/fameexnet_api');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');

const apiServer = 'https://openapi.fameex.net';
const exchangeName = 'FameEX';
const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

const orderStatuses = { // Krivorukiye mudaki
  NEW: 'new',
  PENDING_CANCEL: 'cancelled',
  REJECTED: 'cancelled',
  CANCELED: 'cancelled',
  CANCELLED: 'cancelled',
  FILLED: 'filled',
  PARTIALLY_FILLED: 'part_filled',
  PARTIALLY_FILLED_CANCEL: 'cancelled',
  'NEW ORDER': 'new',
  'PARTIALLY CANCELLED': 'cancelled',
  'PARTIALLY CANCELED': 'cancelled',
  'PARTIALLY FILLED': 'part_filled',
  'TO BE CANCELED': 'cancelled',
  'TO BE CANCELLED': 'cancelled',
  'PARTIALLY FILLED/CANCELLED': 'filled', // When 'MARKET' order is filled
  'PARTIALLY FILLED/CANCELED': 'filled',
};

const fameexOrderSides = {
  buy: 'BUY',
  sell: 'SELL',
};

const fameexOrderTypes = {
  limit: 'LIMIT',
  market: 'MARKET',
};

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
  const apiClient = FameexApi();

  apiClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  /** Fulfill markets and currencies on initialization. */
  if (loadMarket) {
    getMarkets();
  }

  /**
   * Get info on all markets.
   * @param {string} [pair] In classic format as BTC/USDT. If markets are already cached, get info for the pair.
   * @returns {Promise<MarketsResult | undefined> | MarketsResultItem | undefined}
   */
  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair ? formatPairName(pair).pairPlain : pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve) => {
      apiClient.markets().then((response) => {
        try {
          /** @type {MarketsResult} */
          const result = {};

          response.symbols.forEach((market) => {
            const pairNames = formatPairName(`${market.baseAsset}-${market.quoteAsset}`);

            result[pairNames.pairPlain] = {
              pairPlain: pairNames.pairPlain,
              pairReadable: pairNames.pairReadable,
              coin1: pairNames.coin1,
              coin2: pairNames.coin2,

              coin1Decimals: Number(market.quantityPrecision),
              coin1Precision: utils.getPrecision(Number(market.quantityPrecision)),
              coin1MinAmount: Number(market.limitVolumeMin),
              coin1MaxAmount: null,

              coin2Decimals: Number(market.pricePrecision),
              coin2Precision: utils.getPrecision(Number(market.pricePrecision)),
              coin2MinAmount: null,
              coin2MaxAmount: null,

              // Also, the exchanges provides min and max order size for market orders
              // Number(market.marketBuyMin) in coin2 and Number(market.marketSellMin) in coin1
              // Regularly, marketSellMin === limitVolumeMin

              coin2MinPrice: Number(market.limitPriceMin),
              coin2MaxPrice: null,

              minTrade: null, // Legacy
              status: 'ONLINE',
            };
          });

          if (Object.keys(result).length > 0) {
            module.exports.exchangeMarkets = result;
            log.log(`Received info about ${Object.keys(result).length} markets on ${exchangeName} exchange.`);
          }

          module.exports.gettingMarkets = false;
          resolve(result);
        } catch (error) {
          log.warn(`Error while processing getMarkets(${paramString}) request: ${error}`);
          resolve(undefined);
        }
      }).catch((error) => {
        log.warn(`API request getMarkets() of ${moduleName} module failed. ${error}`);
        resolve(undefined);
      }).finally(() => {
        module.exports.gettingMarkets = false;
      });
    });
  }

  return {
    getMarkets,

    /**
     * Getter for stored markets information.
     * @return {MarketsResult}
     */
    get markets() {
      return module.exports.exchangeMarkets;
    },


    /**
     * Get information for a specific market.
     * @param pair In readable format as 'BTC/USDT'
     * @returns {Promise<MarketsResult> | MarketsResultItem}
     */
    marketInfo(pair) {
      return getMarkets(pair);
    },

    /**
     * Features available on FameEx.net exchange.
     * @returns {{}}
     */
    features() {
      return {
        allowAmountForMarketBuy: false,
        amountForMarketOrderNecessary: false,
        getDepositAddress: false,
        getMarkets: true,
        getCurrencies: false,
        getFundHistory: false,
        getFundHistoryImplemented: false,
        getTradingFees: false,
        getAccountTradeVolume: false,
        placeMarketOrder: true,
        selfTradeProhibited: false,
        supportCoinNetworks: true,
      };
    },

    /**
     * Get user balances.
     * @param {boolean} nonzero Return only non-zero balances
     * @returns {Promise<AssetsResult>}
     */
    async getBalances(nonzero = true) {
      const paramString = `nonzero: ${nonzero}`;

      /** @type {Balances} */
      let response;

      try {
        // The new endpoint requires a list of coins to fetch balances for
        // Duplicate coins → duplicate response records
        // Max 20 coins
        const coins = ['BTC', 'USDT', 'ETH', 'XRP', 'BNB', 'SOL', 'USDC', 'TRX',
          'DOGE', 'ADA', 'LINK', 'SUI', 'LTC', 'ZEC', 'DAI', 'UNI', 'POL', 'HUI',
        ];
        if (!coins.includes(coin1)) coins.push(coin1);
        if (!coins.includes(coin2)) coins.push(coin2);

        response = await apiClient.getBalances(coins.join(','));
      } catch (error) {
        log.warn(`API request getBalances(${paramString}) of ${moduleName} module failed. ${error}`);

        return;
      }

      try {
        /** @type {AssetsResult} */
        let result = [];

        response.balances.forEach((crypto) => {
          result.push({
            code: crypto.asset,
            free: Number(crypto.free),
            freezed: Number(crypto.locked),
            total: Number(crypto.free) + Number(crypto.locked),
          });
        });

        if (nonzero) {
          result = result.filter((crypto) => crypto.free || crypto.freezed);
        }

        return result;
      } catch (error) {
        log.warn(`Error while processing getBalances(${paramString}) request results: ${JSON.stringify(response)}. ${error}`);

        return;
      }
    },

    /**
     * List of all account open orders.
     * @param {string} pair In classic format as 'BTC/USDT'
     * @returns {Promise<OrdersResult["result"] | OrderAll | undefined>}
     */
    async getOpenOrders(pair) {
      const pairNames = formatPairName(pair);
      const paramString = `pair: ${pairNames.pairReadable}`;

      /** @type {OrderAll} */
      let response;

      try {
        response = await apiClient.getOrders(pairNames.pairPlain);
      } catch (error) {
        log.warn(`API request getOpenOrders(${paramString}) of ${moduleName} module failed. ${error}`);

        return;
      }

      try {
        /** @type {OrdersResult["result"]} */
        const result = [];

        response.forEach((order) => {
          result.push({
            amount: Number(order.origQty),
            amountExecuted: Number(order.executedQty),
            amountLeft: Number(order.origQty) - Number(order.executedQty),
            orderId: String(order.orderId),
            price: Number(order.price),
            side: order.side === fameexOrderSides.buy ? 'buy' : 'sell',
            symbol: pairNames.pairReadable,
            symbolPlain: pairNames.pairPlain,
            status: formatOrderStatus(order.status),
            timestamp: order.time,
            type: order.type === fameexOrderTypes.limit ? 'limit' : 'market',
          });
        });

        return result;
      } catch (error) {
        log.warn(`Error while processing getOpenOrders(${paramString}) request results: ${JSON.stringify(response)}. ${error}`);

        return;
      }
    },

    /**
     * Get specific order details.
     * @param {string} orderId Example: '10918742125338689536'
     * @param {string} pair In classic format as 'BTC/USDT'
     * @returns {Promise<OrderInfoResult | undefined>}
     */
    async getOrderDetails(orderId, pair) {
      const paramString = `orderId: ${orderId}, pair: ${pair}`;
      const { pairPlain, pairReadable } = formatPairName(pair);

      /** @type {OrderAll[number] & Response} */
      let response;

      try {
        response = await apiClient.getOrder(pairPlain, orderId);
      } catch (error) {
        // Orders with wrong orderId format are rejecting with '200 OK, [1] fail' and return undefined
        log.warn(`API request getOrder(${paramString}) of ${moduleName} module failed. ${error}`);

        return;
      }

      try {
        /** @type {OrderInfoResult} */
        let result;

        if (response.orderId) {
          let amount;
          let amountExecuted;
          let price;
          let volume;
          let volumeExecuted;

          const side = response.side === fameexOrderSides.buy ? 'buy' : 'sell';
          const type = response.type === fameexOrderTypes.limit ? 'limit' : 'market';

          if (type === 'limit') {
            // Limit order
            amount = Number(response.origQty);
            amountExecuted = Number(response.executedQty);
            price = Number(response.price);

            volume = amount * price; // Approx, calculated
            volumeExecuted = amountExecuted * price; // Approx, calculated
          } else {
            // Market buy or sell order
            price = Number(response.avgPrice);

            if (side === 'buy') {
              amount = Number(response.executedQty); // Exact filled amount in coin1
              amountExecuted = Number(response.executedQty); // Exact filled amount in coin1
              volume = Number(response.origQty); // Exact, set by order in coin2
              volumeExecuted = amountExecuted * price; // Approx, calculated
            } else {
              amount = Number(response.origQty); // Exact, set by order in coin1
              amountExecuted = Number(response.executedQty); // Exact filled amount in coin1
              volume = amount * price; // Approx, calculated
              volumeExecuted = amountExecuted * price; // Approx, calculated
            }
          }

          result = {
            orderId: String(response.orderId),
            pairPlain,
            pairReadable,

            amount,
            amountExecuted,
            price,

            volume,
            volumeExecuted,

            side,
            type,

            status: formatOrderStatus(response.status),

            timestamp: Number(response.transactTime),
            totalFeeInCoin2: null,
            tradesCount: null,
            updateTimestamp: null,
          };
        } else {
          const errorMessage = response.fameexErrorInfo ?? 'No details';

          log.log(`Unable to get order ${orderId} details: ${JSON.stringify(errorMessage)}. Returning unknown order status.`);

          result = {
            orderId,
            status: 'unknown',
          };
        }

        return result;
      } catch (error) {
        log.warn(`Error while processing getOrder(${paramString}) request results: ${JSON.stringify(response)}. ${error}`);

        return {
          orderId,
          status: 'unknown',
        };
      }
    },

    /**
     * Place an order.
     * FameEx.net API supports both limit and market orders.
     * @param {'buy' | 'sell'} side Order side
     * @param {string} pair In classic format like "BTC/USDT"
     * @param {null | number | string} [price] Order price
     * @param {null | number | string} [coin1Amount] Base coin amount. Provide `coin1Amount` only for market sell or limit buy/sell.
     * @param {0 | 1} [limit] 0: market order; 1: limit order (default)
     * @param {null | number | string} [coin2Amount] Quote coin amount. Provide `coin2Amount` only for market buy.
     * @returns {Promise<OrderPlaceResult>}
     */
    async placeOrder(side, pair, price, coin1Amount, limit = 1, coin2Amount) {
      const paramString = `side: ${side}, pair: ${pair}, price: ${price}, coin1Amount: ${coin1Amount}, limit: ${limit}, coin2Amount: ${coin2Amount}`;
      const pairNames = formatPairName(pair);
      const marketInfo = /** @type {MarketsResultItem} */ (this.marketInfo(pair));

      let message;

      if (!marketInfo) {
        message = `Unable to place an order on ${exchangeName} exchange. I don't have info about market ${pair}.`;
        log.warn(message);

        return { message };
      }

      /** For Limit orders, calculate `coin1Amount` if only `coin2Amount` is provided. */
      if (!coin1Amount && coin2Amount && price) {
        coin1Amount = Number(coin2Amount) / Number(price);
      }

      /** For Limit orders, calculate `coin2Amount` if only `coin1Amount` is provided. */
      let coin2AmountCalculated;

      if (!coin2Amount && coin1Amount && price) {
        coin2AmountCalculated = Number(coin1Amount) * Number(price);
      }

      /**
       * Round `coin1Amount`, `coin2Amount` and `price` to a certain number of decimal places, and check if they are correct.
       */
      if (coin1Amount) {
        coin1Amount = Number(coin1Amount).toFixed(marketInfo.coin1Decimals);
        if (!Number(coin1Amount)) {
          message = `Unable to place an order on ${exchangeName} exchange. After rounding to ${marketInfo.coin1Decimals} decimal places, the order amount is wrong: ${coin1Amount}.`;
          log.warn(message);

          return { message };
        }
      }
      if (coin2Amount) {
        coin2Amount = (+coin2Amount).toFixed(marketInfo.coin2Decimals);
        if (!+coin2Amount) {
          message = `Unable to place an order on ${exchangeName} exchange. After rounding to ${marketInfo.coin2Decimals} decimal places, the order volume is wrong: ${coin2Amount}.`;
          log.warn(message);

          return { message };
        }
      }
      if (price) {
        price = (+price).toFixed(marketInfo.coin2Decimals);
        if (!+price) {
          message = `Unable to place an order on ${exchangeName} exchange. After rounding to ${marketInfo.coin2Decimals} decimal places, the order price is wrong: ${price}.`;
          log.warn(message);

          return { message };
        }
      }
      if (+coin1Amount < marketInfo.coin1MinAmount) {
        message = `Unable to place an order on ${exchangeName} exchange. Order amount ${coin1Amount} ${marketInfo.coin1} is less minimum ${marketInfo.coin1MinAmount} ${marketInfo.coin1} on ${marketInfo.pairReadable} pair.`;
        log.warn(message);

        return { message };
      }
      if (coin2Amount && +coin2Amount < marketInfo.coin2MinAmount) { // coin2Amount may be null or undefined
        message = `Unable to place an order on ${exchangeName} exchange. Order volume ${coin2Amount} ${marketInfo.coin2} is less minimum ${marketInfo.coin2MinAmount} ${marketInfo.coin2} on ${pair} pair.`;
        log.warn(message);

        return { message };
      }

      let errorMessage;
      let orderId;
      let output = '';

      if (limit) {
        if (coin2Amount) {
          output = `${side} ${coin1Amount} ${pairNames.coin1} for ${coin2Amount} ${pairNames.coin2} at ${price} ${pairNames.coin2}.`;
        } else {
          output = `${side} ${coin1Amount} ${pairNames.coin1} for ${coin2AmountCalculated} ${pairNames.coin2} at ${price} ${pairNames.coin2}.`;
        }
      } else {
        if (coin2Amount) {
          output = `${side} ${pairNames.coin1} for ${coin2Amount} ${pairNames.coin2} at Market Price on ${pair} pair.`;
        } else {
          output = `${side} ${coin1Amount} ${pairNames.coin1} at Market Price on ${pair} pair.`;
        }
      }

      /** @type {OrderPlaceResult} */
      const order = {};

      try {
        /** @type {OrderPlace & Response} */
        const response = await apiClient.addOrder(
            pairNames.pairPlain,
            coin1Amount ? String(coin1Amount) : '',
            coin2Amount ? String(coin2Amount) : '',
            price ? String(price) : '',
            /** @type {'BUY' | 'SELL'} */ (fameexOrderSides[side]),
            /** @type {'LIMIT' | 'MARKET'} */ (limit ? fameexOrderTypes.limit : fameexOrderTypes.market),
        );

        errorMessage = response?.msg;
        orderId = response?.orderId;
      } catch (error) {
        message = `API request addOrder(${paramString}) of ${moduleName} module failed. ${error}.`;
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
     * Cancel an order.
     * @param {string} orderId Example: '10918742125338689536'
     * @param {'buy' | 'sell' | null} side Not used for FameEx.net
     * @param {string} pair In classic format as "BTC/USDT"
     * @returns {Promise<boolean | undefined>}
     */
    async cancelOrder(orderId, side, pair) {
      const paramString = `orderId: ${orderId}, side: ${side}, pair: ${pair}`;
      const pairNames = formatPairName(pair);

      /** @type {OrderCancelOne & Response} */
      let response;

      try {
        response = await apiClient.cancelOrder(pairNames.pairPlain, orderId);
      } catch (error) {
        // Cancelling orders with wrong orderId format are rejecting with '200 OK, [1] fail' and return undefined
        log.warn(`API request cancelOrder(${paramString}) of ${moduleName} module failed. ${error}`);

        return;
      }

      try {
        if (response.status === 'PENDING_CANCEL') {
          // Note: Already cancelled orders also receive 'PENDING_CANCEL' status (in fact, order status is 'cancelled')
          log.log(`Cancelling order ${orderId} on ${pair} pair…`);

          return true;
        } else {
          /** Filled orders */
          const errorMessage = response.fameexErrorInfo ?? 'No details';

          log.log(`Unable to cancel order ${orderId} on ${pair} pair: ${errorMessage}.`);
          return false;
        }
      } catch (error) {
        log.warn(`Error while processing cancelOrder(${paramString}) request results: ${JSON.stringify(response)}. ${error}`);

        return;
      }
    },

    /**
     * Cancel all orders on a specific pair.
     * @param pair In classic format as 'BTC/USDT'
     * @param {'buy' | 'sell'} [side] Order side
     * @returns {Promise<boolean | undefined>}
     */
    async cancelAllOrders(pair, side) {
      const paramString = `pair: ${pair}`;
      const pairNames = formatPairName(pair);

      /** @type {OrderAll & Response} */
      let responseOrders;
      /** @type {OrderCancelFew} */
      let responseCancel;
      /** @type {Array<OrderAll[number]["orderId"]>} */
      let orders;

      try {
        responseOrders = await apiClient.getOrders(pairNames.pairPlain);
        orders = responseOrders.map((order) => order.orderId);
      } catch (error) {
        log.warn(`API request getOrders/cancelAllOrders(${paramString}) of ${utils.getModuleName(/** @type {NodeJS.Module} */ (module).id)} module failed. ${error}`);

        return;
      }

      try {
        if (orders.length) {
          // Note: Max 10 orders at a time. @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#is-there-a-limit-on-the-number-of-orders-or-cancellations-that-can-be-processed-in-bulk
          responseCancel = await apiClient.cancelAllOrders(pairNames.pairPlain, orders);
        } else {
          log.log(`No active orders to cancel on ${pairNames.pairReadable} pair.`);

          return true;
        }
      } catch (error) {
        log.warn(`API request cancelAllOrders(${paramString}) of ${moduleName} module failed. ${error}`);

        return;
      }

      try {
        if (responseCancel.success.length) {
          log.log(`Cancelling ${responseCancel.success.length} of ${orders.length} orders on ${pairNames.pairReadable} pair…`);

          return true;
        } else {
          const errorMessage = responseOrders.fameexErrorInfo ?? 'No details';

          log.log(`Unable to cancel all ${orders.length} orders on ${pairNames.pairReadable} pair: ${errorMessage}.`);

          return false;
        }
      } catch (error) {
        log.warn(`Error while processing cancelAllOrders(${paramString}) request result: ${JSON.stringify(responseOrders)}. ${error}`);

        return;
      }
    },

    /**
     * Get information on a trade pair.
     * @param pair In classic format as 'BTC/USDT'
     * @returns {Promise<RatesResult | undefined>}
     */
    async getRates(pair) {
      const paramString = `pair: ${pair}`;
      const pairNames = formatPairName(pair);

      /** @type {Markets} */
      let response;

      try {
        response = await apiClient.ticker(pairNames.pairPlain);
      } catch (error) {
        log.warn(`API request getRates(${paramString}) of ${moduleName} module failed. ${error}`);

        return;
      }

      try {
        let result;

        if (response.sell) {
          result = {
            ask: Number(response.sell),
            bid: Number(response.buy),
            high: Number(response.high),
            last: Number(response.last),
            low: Number(response.low),
            volume: Number(response.amount),
            volumeInCoin2: Number(response.vol),
          };
        }

        return result;
      } catch (error) {
        log.warn(`Error while processing getRates(${paramString}) request result: ${JSON.stringify(response)}. ${error}`);

        return;
      }
    },

    /**
     * Get orderbook on a specific pair
     * @param pair In classic format as BTC/USDT
     * @returns {Promise<DepthResult | undefined>}
     */
    async getOrderBook(pair) {
      const paramString = `pair: ${pair}`;
      const pairNames = formatPairName(pair);

      /** @type {OrderBook} */
      let response;

      try {
        response = await apiClient.orderBook(pairNames.pairPlain);
      } catch (error) {
        log.warn(`API request getOrderBook(${paramString}) of ${moduleName} module failed. ${error}`);

        return;
      }

      try {
        /** @type {DepthResult} */
        const result = {};

        result.asks = response.asks.map((ask) => ({
          amount: Number(ask[1]),
          count: 1,
          price: Number(ask[0]),
          side: 'sell',
        }));
        result.asks.sort((a, b) => a.price - b.price);

        result.bids = response.bids.map((bid) => ({
          amount: Number(bid[1]),
          count: 1,
          price: Number(bid[0]),
          side: 'buy',
        }));
        result.bids.sort((a, b) => b.price - a.price);

        return result;
      } catch (error) {
        log.warn(`Error while processing getOrderBook(${paramString}) request result: ${JSON.stringify(response)}. ${error}`);

        return;
      }
    },

    /**
     * Get history of trades
     * @param {string} pair In classic format as BTC/USDT
     * @returns {Promise<TradesResult | undefined>}
     */
    async getTradesHistory(pair) {
      const paramString = `pair: ${pair}`;
      const pairNames = formatPairName(pair);

      /** @type {TradeHistory} */
      let response;

      try {
        response = await apiClient.getTradesHistory(pairNames.pairPlain);

        if (response?.length === 0) {
          throw String('Trade history is empty, probably API error.');
        }
      } catch (error) {
        log.warn(`API request getTradesHistory(${paramString}) of ${moduleName} module failed. ${error}`);

        return;
      }

      try {
        const result = [];

        response.forEach((trade) => {
          result.push({
            coin1Amount: Number(trade.qty),
            coin2Amount: Number(trade.qty) * Number(trade.price),
            date: Number(trade.time),
            price: Number(trade.price),
            side: trade.side,
            tradeId: String(trade.time),
          });
        });

        /** Ascending sort order. */
        result.sort((a, b) => Number.parseFloat(a.date) - Number.parseFloat(b.date));

        return result;
      } catch (error) {
        log.warn(`Error while processing getTradesHistory(${paramString}) request result: ${JSON.stringify(response)}. ${error}`);

        return;
      }
    },
  };
};

/**
 * Returns pair in classic format 'BTC/USDT'.
 * @param {string} pair Pair in FameEx.net format like 'BTCUSDT'
 * @return {object} pairReadable, pairPlain, coin1, coin2
 */
function formatPairName(pair) {
  pair = pair?.toUpperCase();

  const [coin1, coin2] = pair.split(/[-_/]/);

  return {
    pairReadable: `${coin1}/${coin2}`,
    /**
     * The API accepts both uppercase (BTCUSDT) and lowercase (btcusdt), despite the documentation using lowercase.
     */
    pairPlain: `${coin1}${coin2}`,
    coin1,
    coin2,
  };
}

/**
 * Returns system order status.
 * @param {string} orderStatus State in FameEx.net format
 * @return {"cancelled" | "filled" | "new" | "part_filled" | "unknown"}
 */
function formatOrderStatus(orderStatus) {
  return orderStatuses[orderStatus?.toUpperCase()] ?? 'unknown';
}
