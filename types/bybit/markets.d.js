'use strict';

/**
 * GET https://api.bybit.com/v5/market/instruments-info?category=spot
 * @see https://bybit-exchange.github.io/docs/v5/market/instrument
 * @typedef {Object} MarketsFilterPrice
 * @prop {string} [maxPrice] "0.01" Maximum order price.
 * @prop {string} [minPrice] "0.01" Minimum order price.
 * @prop {string} tickSize "0.01" The step to increase/reduce order price.
 * @typedef {Object} MarketsFilterSize
 * @prop {string} basePrecision "0.000001" Base currency precision?
 * @prop {string} [maxMktOrderQty] "71.73956243" Maximum quantity for Market order.
 * @prop {string} maxOrderAmt "4000000" Maximum amount for Limit and PostOnly order?
 * @prop {string} maxOrderQty "71.73956243" Maximum quantity for Limit and PostOnly order.
 * @prop {string} minOrderAmt "1" Minimum order amount?
 * @prop {string} minOrderQty "0.000048" Minimum order quantity.
 * @prop {string} quotePrecision "0.00000001" Quote currency precision?
 * @typedef {Object} MarketsItem
 * @prop {string} baseCoin "BTC" Base currency, e.g. "BTC" in the pair "BTCUSDT".
 * @prop {MarketsFilterSize} lotSizeFilter
 * @prop {MarketsFilterPrice} priceFilter
 * @prop {"USDT"} quoteCoin "USDT" Quoting currency, e.g. "USDT" in the trading pair "BTCUSDT".
 * @prop {'Closed' | 'Delivering' | 'PreLaunch' | 'Trading'} status "Trading" Symbol status filter. Spot has "Trading" only. "PreLaunch": when `category=linear&status=PreLaunch`, It returns pre-market perpetual contract.
 * @prop {string} symbol "BTCUSDT" Trading pair.
 * @typedef {Object} MarketsResult
 * @prop {Array<MarketsItem>} list [MarketsItem, ...]
 * @typedef {Object} Markets
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * prop {number} time 1719619515694 Response unix timestamp.
 * @prop {MarketsResult} result Object
 */

module.exports = {};
