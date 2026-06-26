/**
 * types/bot/startupWarmup.d.js
 *
 * Type definitions for exchange connector warmup during bootstrap (`modules/startupWarmup.js`).
 */

/**
 * Outcome of `warmUpConnectorData()` after polling market/instrument metadata.
 *
 * @typedef {Object} ConnectorWarmupResult
 * @property {boolean} attempted `true` when warmup polling started; `false` when no connector was available
 * @property {boolean} warmedUp `true` when precision metadata became available before timeout
 * @property {number} elapsedMs Time spent polling until success or timeout
 * @property {number} timeoutMs Effective timeout budget (may exceed the base value for slow connectors)
 * @property {'timeout'} [reason] Present when metadata was still unavailable after `timeoutMs`
 */

/**
 * Options for `warmUpConnectorData()`.
 *
 * @typedef {Object} ConnectorWarmupOptions
 * @property {number} [timeoutMs] Minimum total time budget for warmup polling (default 15000 ms)
 * @property {number} [pollMs] Delay between readiness checks (default 250 ms)
 */

/**
 * Spot or perpetual connector instance used only for metadata warmup.
 *
 * @typedef {Object} WarmupConnectorApi
 * @property {(pair?: string) => Object | Promise<Object>} [marketInfo] Spot pair metadata
 * @property {(pair?: string) => Object | Promise<Object>} [instrumentInfo] Perpetual instrument metadata
 * @property {(pair?: string) => Object} [features] Connector flags, including `apiProcessingDelayMs`
 */

module.exports = {};
