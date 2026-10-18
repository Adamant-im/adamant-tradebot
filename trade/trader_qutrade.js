'use strict';

const QutradeAPI = require('./api/qutrade_api');
const utils = require('../helpers/utils');
const config = require('../modules/configReader');

const apiServer = 'https://qutrade.io/api/v2';
const exchangeName = 'Qutrade';
const moduleName = utils.getModuleName(module.id);

/**
 * Creates a trader adapter for Qutrade's spot API.
 * @param {string} apiKey Qutrade public API key
 * @param {string} secretKey Qutrade Ed25519 secret API key
 * @param {string} pwd Unused compatibility parameter
 * @param {import('../helpers/log')} log Bot logger
 * @param {boolean} [publicOnly=false] Skip private API credentials
 * @param {boolean} [loadMarket=true] Preload market metadata
 * @param {boolean} [useSocket=false] Unused compatibility parameter; Qutrade uses REST
 * @param {boolean} [useSocketPull=false] Unused compatibility parameter; Qutrade uses REST
 * @param {number} [accountNo=0] Unused compatibility parameter
 * @param {string} [coin1=config.coin1] Default base currency
 * @param {string} [coin2=config.coin2] Default quote currency
 * @returns {Object} Bot-compatible spot trader adapter
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
  const api = QutradeAPI();
  api.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  let exchangeMarkets;
  let rawMarkets;
  let marketsPromise;

  if (loadMarket) getMarkets();

  /**
   * Loads Qutrade market metadata and normalizes pairs and trading limits.
   * @param {string} [pair] Optional pair in bot format, such as FBC/USDT
   * @returns {Promise<Object|undefined>|Object|undefined} Full market map or one market
   */
  function getMarkets(pair) {
    const pairNames = pair ? formatPairName(pair) : undefined;
    if (exchangeMarkets) return pair ? exchangeMarkets[pairNames.pairReadable] : exchangeMarkets;
    if (!marketsPromise) {
      marketsPromise = api.markets().then((response) => {
        const markets = response?.payload;
        if (!markets || typeof markets !== 'object' || Array.isArray(markets)) {
          throw new Error('Qutrade returned an invalid spot_markets payload.');
        }

        const normalized = {};
        const original = {};
        for (const [symbol, market] of Object.entries(markets)) {
          const pairInfo = formatPairName(symbol);
          original[pairInfo.pairReadable] = market;
          normalized[pairInfo.pairReadable] = {
            pairReadable: pairInfo.pairReadable,
            pairPlain: pairInfo.pairPlain,
            coin1: pairInfo.coin1,
            coin2: pairInfo.coin2,
            coin1Decimals: Number(market.base_decimal_amount),
            coin2Decimals: Number(market.decimal_price),
            coin1Precision: utils.getPrecision(Number(market.base_decimal_amount)),
            coin2Precision: utils.getPrecision(Number(market.decimal_price)),
            coin1MinAmount: Number(market.base_min_amount),
            coin1MaxAmount: null,
            coin2MinAmount: Number(market.quote_min_amount),
            coin2MaxAmount: null,
            coin2MinPrice: null,
            coin2MaxPrice: null,
            minTrade: Number(market.quote_min_amount),
            amountStep: Number(market.base_step_amount),
            priceStep: Number(market.step_price),
            quoteAmountStep: Number(market.quote_step_amount),
            quoteAmountDecimals: Number(market.quote_decimal_amount),
            minPriceBuy: Number(market.min_price_buy),
            maxPriceBuy: Number(market.max_price_buy),
            minPriceSell: Number(market.min_price_sell),
            maxPriceSell: Number(market.max_price_sell),
            status: 'ONLINE',
          };
        }

        exchangeMarkets = normalized;
        rawMarkets = original;
        log?.log?.(`Received info about ${Object.keys(normalized).length} markets on ${exchangeName} exchange.`);
        return normalized;
      }).catch((error) => {
        log?.warn?.(`API request getMarkets(${pair || 'all'}) of ${moduleName} module failed. ${error}`);
        return undefined;
      }).finally(() => {
        marketsPromise = undefined;
      });
    }

    return marketsPromise.then((markets) => pair ? markets?.[pairNames.pairReadable] : markets);
  }

  /**
   * Floors an amount or adjusts a price to the exchange's decimal and step limits.
   * @param {number} value Input amount or price
   * @param {number} step Exchange step size
   * @param {number} decimals Allowed decimal places
   * @param {'down'|'up'} direction Rounding direction
   * @returns {string} Fixed-decimal value aligned to the exchange step
   */
  function quantize(value, step, decimals, direction = 'down') {
    if (
      !Number.isFinite(value) || !Number.isFinite(step) || step <= 0 ||
      !Number.isInteger(decimals) || decimals < 0 || decimals > 15
    ) {
      throw new Error('Invalid amount or precision received from Qutrade market metadata.');
    }
    const scale = 10 ** decimals;
    const stepUnits = Math.max(1, Math.round(step * scale));
    const units = value * scale / stepUnits;
    const roundedUnits = direction === 'up' ? Math.ceil(units - 1e-10) : Math.floor(units + 1e-10);
    return (roundedUnits * stepUnits / scale).toFixed(decimals);
  }

  /**
   * Returns the response payload as a list for endpoints that may return one or many records.
   * @param {*} payload Qutrade response payload
   * @returns {Array<Object>} Payload records
   */
  function payloadItems(payload) {
    if (Array.isArray(payload)) return payload;
    return payload && typeof payload === 'object' ? [payload] : [];
  }

  /**
   * Checks whether a Qutrade cancellation response confirms at least one canceled order.
   * @param {*} payload Qutrade response payload
   * @returns {boolean} True if a returned order has canceled status
   */
  function containsCanceledOrder(payload) {
    return payloadItems(payload).some((order) =>
      ['canceled', 'cancelled', 'already_canceled'].includes(String(order.status).toLowerCase()));
  }

  return {
    getMarkets,

    get markets() {
      return exchangeMarkets;
    },

    /** @param {string} pair Pair in bot format, such as FBC/USDT */
    marketInfo(pair) {
      if (!exchangeMarkets) {
        getMarkets().catch((error) => {
          log?.warn?.(`Unable to preload Qutrade markets: ${error}`);
        });
        return undefined;
      }

      const pairInfo = formatPairName(pair);
      const market = exchangeMarkets[pairInfo.pairReadable];

      if (!market ||
          !Number.isInteger(market.coin1Decimals) ||
          !Number.isInteger(market.coin2Decimals) ||
          market.coin1Decimals < 0 ||
          market.coin2Decimals < 0) {
        return undefined;
      }

      return market;
    },

    /** @returns {Object} Capabilities implemented by this Qutrade adapter */
    features() {
      return {
        getMarkets: true,
        getCurrencies: false,
        getRates: true,
        getOrderBook: true,
        getTradesHistory: false,
        placeMarketOrder: true,
        getDepositAddress: false,
        getTradingFees: false,
        getAccountTradeVolume: false,
        createDepositAddressWithWebsiteOnly: false,
        getFundHistory: false,
        getFundHistoryImplemented: false,
        supportCoinNetworks: false,
        allowAmountForMarketBuy: true,
        amountForMarketOrderNecessary: true,
      };
    },

    /**
     * Gets account balances in the bot's normalized balance shape.
     * @param {boolean} [nonzero=true] Return only currencies with funds
     * @returns {Promise<Array<Object>|undefined>} Normalized balances or undefined on API failure
     */
    async getBalances(nonzero = true) {
      let response;
      try {
        response = await api.balances(nonzero);
      } catch (error) {
        log?.warn?.(`API request getBalances of ${moduleName} module failed. ${error}`);
        return undefined;
      }

      const payload = response.payload;
      const entries = Array.isArray(payload) ?
        payload.map((item) => [item.currency || item.code, item]) :
        Object.entries(payload || {});
      const balances = entries.map(([code, item]) => {
        const free = Number(item.available || 0);
        const freezed = Number(item.in_orders || 0);
        return { code, free, freezed, total: Number(item.total ?? (free + freezed)) };
      });
      return nonzero ? balances.filter((balance) => balance.free || balance.freezed || balance.total) : balances;
    },

    /**
     * Gets open orders and maps Qutrade statuses and amounts to the bot's order shape.
     * @param {string} pair Pair in bot format
     * @returns {Promise<Array<Object>|undefined>} Normalized orders or undefined on API failure
     */
    async getOpenOrders(pair) {
      let response;
      try {
        response = await api.openOrders(pair ? formatPairName(pair).pairPlain : undefined);
      } catch (error) {
        log?.warn?.(`API request getOpenOrders(${pair}) of ${moduleName} module failed. ${error}`);
        return undefined;
      }

      try {
        if (!Array.isArray(response.payload)) throw new Error('Qutrade returned an invalid open-orders list.');
        return response.payload.map((order) => {
          if (!order || !/^\d+$/.test(String(order.order_id)) || !order.pair || !['buy', 'sell'].includes(order.side)) {
            throw new Error('Qutrade returned an invalid open-order record.');
          }
          const orderPair = formatPairName(order.pair);
          if (pair && orderPair.pairPlain !== formatPairName(pair).pairPlain) {
            throw new Error('Qutrade returned an open order for a different pair.');
          }
          const status = String(order.status).toLowerCase();
          if (!['opened', 'filling'].includes(status)) throw new Error('Qutrade returned an unexpected open-order status.');
          const amount = Number(order.requested_base_amount || 0);
          const amountExecuted = Number(order.filled_base_amount || 0);
          const amountLeft = Number(order.unfilled_base_amount ?? Math.max(0, amount - amountExecuted));
          const statusMap = { opened: 'new', filling: 'part_filled', filled: 'filled', canceled: 'cancelled', cancelled: 'cancelled' };
          return {
            orderId: String(order.order_id),
            symbol: orderPair.pairReadable,
            price: Number(order.requested_price || order.average_price || 0),
            side: String(order.side).toLowerCase(),
            type: String(order.type || 'limit').toLowerCase(),
            timestamp: Number(order.timestamp_create) * 1000,
            amount,
            amountExecuted,
            amountLeft,
            status: statusMap[status] || status,
          };
        });
      } catch (error) {
        log?.warn?.(`Error while processing getOpenOrders(${pair}) response: ${error}`);
        return undefined;
      }
    },

    /**
     * Retrieves verified order details from Qutrade.
     * @param {string|number} orderId Exchange order ID
     * @param {string} pair Trading pair in bot format
     * @returns {Promise<Object|undefined>} Normalized details or undefined on failure
     */
    async getOrderDetails(orderId, pair) {
      const requestedId = String(orderId);
      const pairInfo = formatPairName(pair);

      if (!/^[0-9]+$/.test(requestedId)) {
        log?.warn?.('Invalid Qutrade order ID.');
        return undefined;
      }

      let open;
      let history;

      try {
        open = await api.openOrders(pairInfo.pairPlain);
        history = await api.orderHistory(pairInfo.pairPlain, 1);
      } catch (error) {
        log?.warn?.(`Unable to retrieve Qutrade order ${requestedId}: ${error}`);
        return undefined;
      }

      try {
        if (!Array.isArray(open.payload) ||
          !Array.isArray(history.payload)) {
          throw new Error('Invalid Qutrade order list.');
        }

        const matches = [...open.payload, ...history.payload].filter((item) =>
          item && String(item.order_id) === requestedId &&
          formatPairName(item.pair).pairPlain === pairInfo.pairPlain);

        if (matches.length === 0) {
          return { orderId: requestedId, status: 'unknown' };
        }

        const active = matches.filter((item) =>
          ['opened', 'filling'].includes(item.status));
        const terminal = matches.filter((item) =>
          ['filled', 'canceled', 'cancelled'].includes(item.status));

        if (active.length && terminal.length) {
          log?.warn?.(`Conflicting Qutrade order states for ${requestedId}.`);
          return { orderId: requestedId, status: 'unknown' };
        }

        if (matches.some((item) =>
          !['opened', 'filling', 'filled', 'canceled', 'cancelled'].includes(item.status))) {
          return { orderId: requestedId, status: 'unknown' };
        }

        const record = terminal[0] || active[0];

        const statusMap = {
          opened: 'new',
          filling: 'part_filled',
          filled: 'filled',
          canceled: 'cancelled',
          cancelled: 'cancelled',
        };

        const status = statusMap[record.status] || 'unknown';
        const amount = Number(record.requested_base_amount);
        const amountExecuted = Number(record.filled_base_amount);
        const price = Number(record.requested_price);
        const volumeExecuted = Number(record.filled_quote_amount);

        if (![amount, amountExecuted, price, volumeExecuted].every(Number.isFinite) ||
          amount <= 0 || amountExecuted < 0 || amountExecuted > amount || price < 0) {
          throw new Error('Invalid Qutrade order quantities.');
        }

        return {
          orderId: requestedId,
          tradesCount: Number(record.trades_count || 0),
          price,
          side: record.side,
          type: record.type,
          amount,
          volume: amount * price,
          pairPlain: pairInfo.pairPlain,
          pairReadable: pairInfo.pairReadable,
          totalFeeInCoin2: undefined,
          amountExecuted,
          volumeExecuted,
          timestamp: Number(record.timestamp_create) * 1000,
          updateTimestamp: Number(record.timestamp_update) * 1000,
          status,
        };
      } catch (error) {
        log?.warn?.(`Invalid Qutrade order details for ${requestedId}: ${error}`);
        return undefined;
      }
    },

    /**
     * Cancels one order. The return values match the bot adapter contract.
     * @param {string|number} orderId Qutrade order identifier
     * @param {string} [side] Unused; Qutrade cancels by order ID
     * @param {string} [pair] Pair used for diagnostics
     * @returns {Promise<boolean|undefined>} True if canceled, false if not canceled, undefined on request failure
     */
    async cancelOrder(orderId, side, pair) {
      const requestedId = String(orderId);

      if (!/^[0-9]+$/.test(requestedId) || !pair) {
        log?.warn?.('Invalid Qutrade cancellation parameters.');
        return undefined;
      }

      const pairPlain = formatPairName(pair).pairPlain;

      try {
        const response = await api.cancelOrders([requestedId]);
        const matching = payloadItems(response.payload).find((item) =>
          String(item.order_id) === requestedId &&
          (!item.pair || formatPairName(item.pair).pairPlain === pairPlain));

        if (matching && containsCanceledOrder(matching)) {
          return true;
        }
      } catch (error) {
        log?.warn?.(`Qutrade cancellation response uncertain for ${requestedId}: ${error}`);
      }

      try {
        const open = await api.openOrders(pairPlain);

        if (!Array.isArray(open.payload)) {
          throw new Error('Invalid open-order response.');
        }

        if (open.payload.some((item) =>
          String(item.order_id) === requestedId)) {
          return undefined;
        }

        const history = await api.orderHistory(pairPlain, 1);

        if (!Array.isArray(history.payload)) {
          throw new Error('Invalid order-history response.');
        }

        const record = history.payload.find((item) =>
          String(item.order_id) === requestedId &&
          item.pair &&
          formatPairName(item.pair).pairPlain === pairPlain &&
          item.side === side);

        if (!record) return undefined;

        if (['canceled', 'cancelled', 'already_canceled'].includes(record.status)) {
          log?.log?.(`Qutrade history confirmed cancellation of ${requestedId}.`);
          return true;
        }

        if (record.status === 'filled') {
          log?.warn?.(`Order ${requestedId} filled instead of being canceled.`);
          return false;
        }

        return undefined;
      } catch (error) {
        log?.warn?.(`Unable to verify cancellation of ${requestedId}: ${error}`);
        return undefined;
      }
    },

    /**
     * Cancels open orders for a pair using Qutrade's batch cancel endpoint.
     * @param {string} pair Pair in bot format
     * @param {string} [side] Optional side filter
     * @returns {Promise<boolean|undefined>} True if at least one order was canceled, false if none, undefined on failure
     */
    async cancelAllOrders(pair, side = '') {
      const orders = await this.getOpenOrders(pair);
      if (!orders) return undefined;
      const sideFilter = String(side || '').toLowerCase();
      const toCancel = orders.filter((order) => !sideFilter || order.side === sideFilter);
      if (!toCancel.length) return false;

      try {
        const response = await api.cancelOrders(toCancel.map((order) => order.orderId));
        const canceledIds = new Set(payloadItems(response.payload)
            .filter((item) => containsCanceledOrder(item)).map((item) => String(item.order_id)));
        return toCancel.every((order) => canceledIds.has(String(order.orderId))) ? true : undefined;
      } catch (error) {
        log?.warn?.(`API request cancelAllOrders(${pair}, ${side}) of ${moduleName} module failed. ${error}`);
        return undefined;
      }
    },

    /**
     * Places a limit or market order after validating Qutrade precision and minimums.
     * @param {string} side Order side, buy or sell
     * @param {string} pair Pair in bot format
     * @param {number} price Limit price; unused for market orders
     * @param {number} coin1Amount Base-asset amount
     * @param {number|string} [limit=1] Truthy for limit, falsy for market
     * @param {number} [coin2Amount] Quote-asset amount, used for market orders or limit amount conversion
     * @returns {Promise<Object>} `{ orderId, message }` with false orderId on placement failure
     */
    async placeOrder(side, pair, price, coin1Amount, limit = 1, coin2Amount) {
      const order = { orderId: false, message: '' };
      const sideName = String(side || '').toLowerCase();
      if (!['buy', 'sell'].includes(sideName)) {
        order.message = `Unable to place order on ${exchangeName}: side must be buy or sell.`;
        log?.warn?.(order.message);
        return order;
      }

      let marketInfo;
      try {
        marketInfo = await getMarkets(pair);
      } catch (error) {
        order.message = `Unable to load ${exchangeName} market ${pair}: ${error}`;
        log?.warn?.(order.message);
        return order;
      }
      if (!marketInfo) {
        order.message = `Unable to place an order on ${exchangeName}. Market ${pair} was not found.`;
        log?.warn?.(order.message);
        return order;
      }

      const isLimit = Boolean(limit);
      const numericPrice = Number(price);
      let baseAmount = Number(coin1Amount);
      const quoteAmount = Number(coin2Amount);
      if (isLimit) {
        if (!(numericPrice > 0)) {
          order.message = `Unable to place a limit order on ${exchangeName}: price must be positive.`;
          log?.warn?.(order.message);
          return order;
        }
        if (!(baseAmount > 0) && quoteAmount > 0) baseAmount = quoteAmount / numericPrice;
        if (!(baseAmount > 0)) {
          order.message = `Unable to place a limit order on ${exchangeName}: provide a positive base amount.`;
          log?.warn?.(order.message);
          return order;
        }
      } else if (!(baseAmount > 0) && !(quoteAmount > 0)) {
        order.message = `Unable to place a market order on ${exchangeName}: provide a positive base or quote amount.`;
        log?.warn?.(order.message);
        return order;
      }

      let roundedPrice;
      let roundedBase;
      let roundedQuote;
      try {
        roundedPrice = isLimit ?
          quantize(
              numericPrice,
              marketInfo.priceStep,
              marketInfo.coin2Decimals,
              // Qutrade tick rounding:
              // Default: SELL rounds UP and BUY rounds DOWN.
              // Example: price 0.0002325487, step 0.0000001:
              //   SELL -> 0.0002326
              //   BUY  -> 0.0002325
              //
              // Offline test alternative: 'sell' ? 'down' : 'down'
              // Both sides round DOWN:
              //   SELL -> 0.0002325
              //   BUY  -> 0.0002325
              // This alternative is for isolated rounding tests only.
              // Do not use it to self-match live orders.
              sideName === 'sell' ? 'up' : 'down',
          ) :
          undefined;
        roundedBase = baseAmount > 0 ? quantize(baseAmount, marketInfo.amountStep, marketInfo.coin1Decimals) : undefined;
        roundedQuote = quoteAmount > 0 ?
          quantize(quoteAmount, marketInfo.quoteAmountStep, marketInfo.quoteAmountDecimals) :
          undefined;
      } catch (error) {
        order.message = `Unable to place an order on ${exchangeName}: invalid market precision metadata. ${error}`;
        log?.warn?.(order.message);
        return order;
      }
      if (isLimit) {
        const minPrice = sideName === 'buy' ? marketInfo.minPriceBuy : marketInfo.minPriceSell;
        const maxPrice = sideName === 'buy' ? marketInfo.maxPriceBuy : marketInfo.maxPriceSell;
        if ((minPrice > 0 && Number(roundedPrice) < minPrice) || (maxPrice > 0 && Number(roundedPrice) > maxPrice)) {
          order.message = `Unable to place ${sideName} order on ${exchangeName}: price ${roundedPrice} is outside the market's allowed range.`;
          log?.warn?.(order.message);
          return order;
        }
      }

      const tickerPrice = Number(rawMarkets?.[marketInfo.pairReadable]?.[sideName === 'buy' ? 'ask' : 'bid']);
      const usesQuoteAmount = !isLimit && quoteAmount > 0 && (!baseAmount || sideName === 'buy');
      const estimatedQuote = isLimit ? Number(roundedBase) * Number(roundedPrice) :
        usesQuoteAmount ? Number(roundedQuote) : Number(roundedBase) * tickerPrice;

      if (roundedBase && Number(roundedBase) < marketInfo.coin1MinAmount) {
        order.message = `Unable to place order on ${exchangeName}: amount ${roundedBase} ${marketInfo.coin1} is below the minimum ${marketInfo.coin1MinAmount}.`;
        log?.warn?.(order.message);
        return order;
      }
      if (marketInfo.coin2MinAmount > 0 && estimatedQuote > 0 && estimatedQuote < marketInfo.coin2MinAmount) {
        order.message = `Unable to place order on ${exchangeName}: quote value ${estimatedQuote} ${marketInfo.coin2} is below the minimum ${marketInfo.coin2MinAmount}.`;
        log?.warn?.(order.message);
        return order;
      }
      if (!isLimit && !usesQuoteAmount && marketInfo.coin2MinAmount > 0 && !Number.isFinite(estimatedQuote)) {
        order.message = `Unable to place a market order on ${exchangeName}: Qutrade ticker price is unavailable to check the minimum quote amount.`;
        log?.warn?.(order.message);
        return order;
      }

      const parameters = {
        pair: marketInfo.pairPlain,
        type: isLimit ? 'limit' : 'market',
        side: sideName,
      };
      if (isLimit) {
        parameters.requested_price = roundedPrice;
        parameters.requested_base_amount = roundedBase;
      } else if (usesQuoteAmount) {
        parameters.requested_quote_amount = roundedQuote;
      } else {
        parameters.requested_base_amount = roundedBase;
      }

      try {
        const response = await api.createOrder(parameters);
        const placedOrder = response.payload;
        if (!placedOrder?.order_id) {
          order.message = `Unable to place order on ${exchangeName}: the API response did not include an order ID.`;
          log?.warn?.(order.message);
          return order;
        }
        order.orderId = String(placedOrder.order_id);
        order.message = `Order placed on ${marketInfo.pairReadable}: ${sideName} ${placedOrder.requested_base_amount || placedOrder.requested_quote_amount} at ${placedOrder.requested_price || 'market'}. Order ID: ${order.orderId}.`;
        log?.info?.(order.message);
        return order;
      } catch (error) {
        order.message = `API request create_order on ${moduleName} module failed. ${error}`;
        log?.warn?.(order.message);
        return order;
      }
    },

    /**
     * Gets ticker/rate data from the normalized Qutrade market response.
     * @param {string} pair Pair in bot format
     * @returns {Promise<Object|undefined>} Normalized rate values
     */
    async getRates(pair) {
      const market = await getMarkets(pair);
      if (!market) return undefined;
      const ticker = rawMarkets?.[market.pairReadable];
      if (!ticker) return undefined;
      return {
        ask: Number(ticker.ask),
        bid: Number(ticker.bid),
        last: Number(ticker.last),
        high: undefined,
        low: undefined,
        volume: Number(ticker.base_volume),
        volumeInCoin2: Number(ticker.quote_volume),
      };
    },

    /**
     * Gets and normalizes the public Qutrade order book.
     * @param {string} pair Pair in bot format
     * @returns {Promise<Object|undefined>} Normalized bids and asks
     */
    async getOrderBook(pair) {
      let response;
      try {
        response = await api.orderBook(formatPairName(pair).pairPlain);
      } catch (error) {
        log?.warn?.(`API request getOrderBook(${pair}) of ${moduleName} module failed. ${error}`);
        return undefined;
      }

      try {
        const books = response.payload;
        const pairInfo = formatPairName(pair);
        const book = books?.[pairInfo.pairPlain];
        if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) {
          throw new Error(`Qutrade returned no order depth for ${pairInfo.pairPlain}.`);
        }
        const normalizeSide = (levels, side) => (levels || []).map((level) => ({
          price: Number(Array.isArray(level) ? level[0] : level.price),
          amount: Number(Array.isArray(level) ? level[1] : level.amount),
          count: 1,
          side,
        }));
        const result = {
          bids: normalizeSide(book.bids, 'buy').sort((a, b) => b.price - a.price),
          asks: normalizeSide(book.asks, 'sell').sort((a, b) => a.price - b.price),
        };
        return result;
      } catch (error) {
        log?.warn?.(`Error while processing getOrderBook(${pair}) response: ${error}`);
        return undefined;
      }
    },
  };
};

/**
 * Normalizes a pair into Qutrade's underscore format and the bot's slash format.
 * @param {string} pair Pair in slash, underscore, or hyphen format
 * @returns {{pairPlain: string, pairReadable: string, coin1: string, coin2: string}} Normalized pair names
 */
function formatPairName(pair) {
  const parts = String(pair || '').trim().toUpperCase().split(/[/_-]/);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid market pair: ${pair}`);
  }
  const [coin1, coin2] = parts;
  return {
    pairPlain: `${coin1}_${coin2}`,
    pairReadable: `${coin1}/${coin2}`,
    coin1,
    coin2,
  };
}
