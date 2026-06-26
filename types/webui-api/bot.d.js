'use strict';

/**
 * @typedef {import('./transport.d.js').WebUiTransport} WebUiTransport
 */

/**
 * Descriptor of an installed market-making module (`trade/mm_*.js`).
 *
 * @typedef {Object} WebUiModuleCapability
 * @property {string} id Stable capability id for WebUI blocks (e.g. `orderbook_builder`)
 * @property {string} file Module filename without extension (e.g. `mm_orderbook_builder`)
 * @property {string} [featureKey] Short command/feature key when mapped (`ob`, `liq`, …)
 * @property {string} label Human-readable module title
 * @property {boolean} installed Whether the module file exists in `trade/` (always `true` in API responses)
 * @property {boolean | null} active Runtime active flag from trade params; `null` when not tracked
 * @property {boolean} [perpetual] When `true`, feature stays enabled until explicitly disabled
 */

/**
 * Capabilities payload: installed MM modules plus raw exchange connector flags.
 *
 * @typedef {Object} WebUiCapabilities
 * @property {WebUiModuleCapability[]} modules Installed `mm_*.js` modules with active state
 * @property {Record<string, unknown>} exchangeFeatures Opaque `trader.features(pair)` object
 */

/**
 * `GET /api/v1/bot` bootstrap payload.
 *
 * @typedef {Object} WebUiBotInfo
 * @property {WebUiTransport} transport Current transport mode (`directHttp` in scenario A)
 * @property {string} version Bot package version
 * @property {string} branch Git branch name (best effort)
 * @property {string} exchange Human-readable exchange name
 * @property {string} pair Active trading pair (`BASE/QUOTE`)
 * @property {string} base Base currency code
 * @property {string} quote Quote currency code
 * @property {boolean} perpetual Whether perpetual contract mode is active
 * @property {boolean} secondAccountEnabled Whether a second API key is configured
 * @property {WebUiCapabilities} capabilities Module and exchange capability metadata
 */

/**
 * `GET /api/v1/health` response.
 *
 * @typedef {Object} WebUiHealthResponse
 * @property {'ok'} status
 * @property {WebUiTransport} transport
 */

module.exports = {};
