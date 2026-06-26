'use strict';

/**
 * @typedef {import('../rates.d.js').RatesResult} RatesResult
 * @typedef {import('../depth.d.js').DepthResult} DepthResult
 * @typedef {import('../trades.d.js').TradesResult} TradesResult
 * @typedef {import('../candles.d.js').Candle} Candle
 */

/**
 * `GET /api/v1/market/ticker` response.
 *
 * @typedef {Object} WebUiTickerResponse
 * @property {string} pair Trading pair in `BASE/QUOTE` format
 * @property {RatesResult} ticker Normalized 24h ticker from the exchange connector
 */

/**
 * `GET /api/v1/market/orderbook` response.
 *
 * @typedef {DepthResult & { pair: string }} WebUiOrderBookResponse
 */

/**
 * `GET /api/v1/market/trades` response.
 *
 * @typedef {Object} WebUiTradesResponse
 * @property {string} pair Trading pair in `BASE/QUOTE` format
 * @property {TradesResult} trades Recent public trades, ascending by time
 */

/**
 * `GET /api/v1/market/ohlc` response.
 *
 * @typedef {Object} WebUiOhlcResponse
 * @property {string} pair Trading pair in `BASE/QUOTE` format
 * @property {string} timeframe Requested candle timeframe (exchange-specific string)
 * @property {Candle[]} candles Normalized OHLCV candles from `getCandlesHistory()`
 */

/**
 * Query parameters for OHLC requests.
 *
 * @typedef {Object} WebUiOhlcQuery
 * @property {string} [pair] Defaults to the bot's configured pair
 * @property {string} timeframe Required candle size (e.g. `1m`, `5m`, `1h`)
 * @property {number} [since] Start timestamp in milliseconds
 * @property {number} [limit] Maximum number of candles
 * @property {boolean} [excludePartial] When `true`, drops the last unclosed candle
 */

module.exports = {};
