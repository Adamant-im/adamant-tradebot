/**
 * types/bot/perpetualApi.d.js
 *
 * Type definitions for the perpetual API singleton factory (`modules/perpetualApi.js`).
 */

/**
 * Minimal perpetual connector surface used by warmup and trading modules.
 * Concrete implementations extend `trade/api/contract/perpetualApi.js`.
 *
 * @typedef {Object} PerpetualApiConnector
 * @property {boolean} [isPerpetual] Always `true` on perpetual connectors
 * @property {() => void | Promise<void>} [getInstruments] Preloads instrument metadata from the exchange
 * @property {(pair: string) => Object | Promise<Object>} [instrumentInfo] Returns precision/limits for one instrument
 * @property {(pair?: string) => Object} [features] Connector capability flags
 */

/**
 * Returns a cached perpetual API instance for the given exchange, or `null`/`undefined` on failure.
 *
 * @typedef {(exchangeName?: string, publicOnly?: boolean) => PerpetualApiConnector | null | undefined} GetPerpetualApi
 */

module.exports = {};
