'use strict';

/**
 * Normalized OHLCV candle used across tradebot modules and exchange connectors.
 *
 * `tsOpen` is the inclusive left interval boundary.
 * `tsClose` is the exclusive right interval boundary.
 *
 * Example for a `5m` candle:
 * - `tsOpen = 2023-01-10T14:00:00.000Z`
 * - `tsClose = 2023-01-10T14:05:00.000Z`
 * - the candle includes trades with timestamps `>= tsOpen` and `< tsClose`
 * - the last included millisecond is `2023-01-10T14:04:59.999Z`, that is `tsClose - 1`
 *
 * @typedef {Object} Candle
 * @property {number} tsOpen Candle open timestamp in milliseconds, inclusive left boundary
 * @property {number} tsClose Candle close timestamp in milliseconds, exclusive right boundary; for a 5m candle opened at `12:00:00.000`, use `tsClose = 12:05:00.000`, not `12:04:59.999`
 * @property {string} date Candle open time in ISO 8601 format
 * @property {number} open Open price
 * @property {number} high Highest price within the candle
 * @property {number} low Lowest price within the candle
 * @property {number} close Close price
 * @property {number} baseVolume Base asset volume
 * @property {number} [quoteVolumeCalc] Quote asset volume reported by exchange or calculated locally
 * @property {number|null} [trades] Number of trades when known; use `null` when the source is candle-based and trade count is unavailable
 * @property {number} [vwp] Volume-weighted price
 * @property {'native' | 'exchange_trades'} [source] Candle provenance:
 *   `native` — OHLCV candle fetched directly from the exchange REST API via `getCandlesHistory`; always persisted to DB;
 *   `exchange_trades` — candle built from trades fetched via `getTradesHistory`; persisted to DB only when `getCandlesHistory` is unavailable for the exchange; kept in memory only when `getCandlesHistory` is the primary source.
 *   Persistence to DB must not rewrite this field
 * @property {string} [exchange] Exchange name in lowercase
 * @property {string} [pair] Trading pair in readable format, for example PENGUIN/USDT
 * @property {string} [timeframe] Timeframe such as 1m, 5m, 15m, 30m, 1h, 4h, 12h, or 1d
 * @property {Date} [createdAt] Record creation time for persisted candles
 * @property {Date} [updatedAt] Last update time for persisted candles
 * @example
 * {
 *   tsOpen: 1673359200000,
 *   tsClose: 1673359500000,
 *   date: '2023-01-10T14:00:00.000Z',
 *   open: 10.5,
 *   high: 11.2,
 *   low: 10.3,
 *   close: 10.8,
 *   baseVolume: 152.3,
 *   quoteVolumeCalc: 1624.5,
 *   vwp: 10.66,
 *   trades: 47,
 *   source: 'native',
 *   exchange: 'bifinance',
 *   pair: 'PENGUIN/USDT',
 *   timeframe: '5m',
 *   createdAt: new Date('2023-01-10T14:05:10.000Z'),
 *   updatedAt: new Date('2023-01-10T14:05:10.000Z')
 * }
 */

/**
 * Array of normalized candles.
 * @typedef {Array<Candle>} CandlesResult
 */

/**
 * Document stored in the MongoDB chartCandles collection.
 *
 * All persisted candle metadata belongs to `Candle` itself. `CandleDbRecord` only adds the model
 * identity field and the helper save method.
 *
 * @typedef {Candle & {
 *   _id: string | Object,
 *   save: () => Promise<any>
 * }} CandleDbRecord
 * @example
 * {
 *   _id: 'bifinance:PENGUIN/USDT:5m:1673359200000',
 *   exchange: 'bifinance',
 *   pair: 'PENGUIN/USDT',
 *   timeframe: '5m',
 *   tsOpen: 1673359200000,
 *   tsClose: 1673359500000,
 *   date: '2023-01-10T14:00:00.000Z',
 *   open: 10.5,
 *   high: 11.2,
 *   low: 10.3,
 *   close: 10.8,
 *   baseVolume: 152.3,
 *   quoteVolumeCalc: 1624.5,
 *   vwp: 10.66,
 *   trades: null,
 *   source: 'native',
 *   createdAt: new Date('2023-01-10T14:05:10.000Z'),
 *   updatedAt: new Date('2023-01-10T14:05:10.000Z'),
 *   save: async () => 'bifinance:PENGUIN/USDT:5m:1673359200000'
 * }
 */

/**
 * @typedef {Object} CandleMetrics
 * Calculated metrics for a candle set in the analysis window.
 * @property {number} candleCount - Total candle count in the window
 * @property {number} avgTailRatio - Legacy average wick/body ratio
 * @property {number} longTailCandles - Candles where either wick is at least 50% of the total candle range
 * @property {number} longTailSharePercent - Share of long-tail candles in percent
 * @property {number} closeTrendStdDev - Standard deviation of close-to-close percent moves
 * @property {number} discontinuities - Number of candles with jumps above 1%
 * @property {number} discontinuitySharePercent - Share of jump candles in percent
 * @property {number} maxJump - Largest single jump
 * @property {number} avgSpreadUtil - Average spread utilization in the 0..1 range
 * @property {number} avgOBaggression - Average order book aggression in the 0..1 range
 */

/**
 * @typedef {Object} TimeframeQuality
 * Quality and availability assessment for a timeframe.
 * @property {string} timeframe - Timeframe such as 1m or 5m
 * @property {'native'|'exchange_trades'|'local'|'degraded'|'unavailable'} quality
 * @property {'native'|'exchange_trades'|'local'|'unavailable'|'uninitialized'} dataSource - Primary diagnostics source label used by Nice Chart (`local` means persisted DB history, not candle provenance)
 * @property {string[]} degradationReasons - Reasons for degraded quality
 * @property {number} candlesCount - Number of available candles
 * @property {boolean} hasHistoryGap - Whether history contains gaps
 * @property {number} [historyGapTimeSec] - Duration of the gap in seconds
 */

/**
 * @typedef {Object} Diagnostics
 * Diagnostic information describing Nice Chart state.
 * @property {'normal'|'degraded'|'fallback'} mode - Current operating mode
 * @property {'native'|'exchange_trades'|'local'|'unavailable'|'uninitialized'} dataSource - Primary diagnostics data source (`local` means persisted DB history, not candle provenance)
 * @property {string} baseTimeframe - Base storage timeframe
 * @property {TimeframeQuality[]} timeframeQualities - Per-timeframe quality state
 * @property {string} pair - Trading pair
 * @property {string} exchange - Exchange name
 * @property {string[]} degradationReasons - Global degradation reasons
 */

module.exports = {};
