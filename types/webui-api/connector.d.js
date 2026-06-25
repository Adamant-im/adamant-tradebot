'use strict';

/**
 * @typedef {import('../rates.d.js').RatesResult} RatesResult
 * @typedef {import('../depth.d.js').DepthResult} DepthResult
 * @typedef {import('../trades.d.js').TradesResult} TradesResult
 * @typedef {import('../candles.d.js').CandlesResult} CandlesResult
 * @typedef {import('../assets.d.js').Result} AssetsResult
 * @typedef {import('../orders.d.js').Result} OpenOrdersResult
 */

/**
 * Minimal exchange connector surface used by the WebUI API layer.
 * Matches the object returned by `trade/trader_*.js` factories and perpetual API.
 *
 * @typedef {Object} TraderConnector
 * @property {(pair?: string) => Record<string, unknown>} [features] Exchange capability flags per pair
 * @property {(pair: string) => Promise<RatesResult | undefined>} [getRates] Twenty-four hour ticker
 * @property {(pair: string, limit?: number) => Promise<DepthResult | undefined>} [getOrderBook] Order book depth
 * @property {(pair: string, limit?: number) => Promise<TradesResult | undefined>} [getTradesHistory] Recent trades
 * @property {(
 *   pair: string,
 *   timeframe: string,
 *   since?: number,
 *   limit?: number,
 *   excludeLastPartialCandle?: boolean
 * ) => Promise<CandlesResult | undefined>} [getCandlesHistory] OHLCV candles
 * @property {(nonzero?: boolean) => Promise<AssetsResult | undefined>} [getBalances] Account balances
 * @property {(pair: string) => Promise<OpenOrdersResult | undefined>} [getOpenOrders] Open orders
 */

module.exports = {};
