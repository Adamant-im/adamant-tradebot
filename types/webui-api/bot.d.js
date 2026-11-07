'use strict';

/**
 * @typedef {import('./transport.d.js').WebUiTransport} WebUiTransport
 */

/**
 * Descriptor of an installed market-making module (`trade/features/mm_*.js`).
 *
 * @typedef {Object} WebUiModuleCapability
 * @property {string} id Stable capability id for WebUI blocks (e.g. `orderbook_builder`)
 * @property {string} file Module filename without extension (e.g. `mm_orderbook_builder`)
 * @property {string} [featureKey] Primary `/enable` feature key when mapped (`ob`, `liq`, …)
 * @property {string} label Human-readable module title
 * @property {boolean} installed Whether `trade/<file>.js` exists on disk in this build
 * @property {boolean} moduleAvailable Whether the module file exists on disk in this build
 * @property {boolean | null} active Runtime active flag from trade params; `null` when not tracked
 * @property {boolean} [perpetual] When `true`, feature stays enabled until explicitly disabled
 */

/**
 * Descriptor of a `/enable` / `/disable` feature code from {@link botFeatures}.
 *
 * @typedef {Object} WebUiFeatureCapability
 * @property {string} featureKey Short command key (`t`, `ob`, `pw`, …)
 * @property {string} description Human-readable label (same as bot chat `/features`)
 * @property {string} [file] Backing `trade/features/mm_*.js` basename when the feature has a module file
 * @property {boolean} moduleAvailable Whether the backing module file exists on disk in this build
 * @property {boolean | null} active Runtime active flag from trade params; `null` when param absent
 * @property {boolean} perpetual Whether the feature is allowed on perpetual contract mode
 * @property {string} [requires] Another `tradeParamActiveName` that must be active first
 */

/**
 * Capabilities payload: installed MM modules, command features, and raw exchange connector flags.
 *
 * @typedef {Object} WebUiCapabilities
 * @property {WebUiModuleCapability[]} modules Installed `mm_*.js` files with active state
 * @property {WebUiFeatureCapability[]} features All `/enable` feature codes with module availability
 * @property {Record<string, unknown>} exchangeFeatures Opaque `trader.features(pair)` object, plus `convert` / `transfer` method flags
 * @property {{ assets: boolean, twap: boolean, make: boolean }} commandModules Presence of optional `modules/commands/*.js` packs
 * @property {Array<{ key: string, label: string }>} orderPurposes Order-purpose catalog from `orderCollector` (plus `ld2`, `unk`)
 */

/**
 * `GET /api/v1/bot` bootstrap payload.
 *
 * @typedef {Object} WebUiBotInfo
 * @property {WebUiTransport} transport Current transport mode (`directHttp` in scenario A)
 * @property {string} botId Stable bot identifier from `config.bot_id` (pair@exchange[-account] project)
 * @property {string} version Bot package version
 * @property {string} branch Git branch name (best effort)
 * @property {string} exchange Human-readable exchange name
 * @property {string[]} [exchanges] Supported exchange names from `config.exchanges`
 * @property {string} pair Active trading pair (`BASE/QUOTE`)
 * @property {string} base Base currency code
 * @property {string} quote Quote currency code
 * @property {number} coin1Decimals Base currency decimal places from the exchange market info (fallback 8)
 * @property {number} coin2Decimals Quote currency decimal places from the exchange market info (fallback 8)
 * @property {number} [coin2DecimalsForStable] Quote decimals capped for stablecoin amounts (typically 4 for USDT)
 * @property {{ min: number, minFixed?: string, minCoin2?: number, minCoin2Fixed?: string }} [minOrderAmount] Exchange min order from `orderUtils.getMinOrderAmount`
 * @property {boolean} perpetual Whether perpetual contract mode is active
 * @property {boolean} secondAccountEnabled Whether a second API key is configured
 * @property {WebUiCapabilities} capabilities Module, feature, and exchange capability metadata
 */

/**
 * `GET /api/v1/health` response. Process liveness only; no JWT.
 *
 * @typedef {Object} WebUiHealthResponse
 * @property {'ok'} status
 * @property {WebUiTransport} transport
 */

/**
 * What triggered an emergency stop: bot offline longer than `pauseAfterInactivity`, a suspicious empty order list
 * from the exchange, account balance loss over the Balance Watcher thresholds, Sniper Bot Watcher, or another module.
 *
 * @typedef {'inactivity' | 'emptyOrderList' | 'balanceLoss' | 'sniperBot' | 'other'} WebUiEmergencyStopSource
 */

/**
 * Emergency stop that is still in force: market-making is off and was not started after it.
 *
 * @typedef {Object} WebUiEmergencyStop
 * @property {number} ts Epoch ms of the stop
 * @property {WebUiEmergencyStopSource} source What triggered the stop
 * @property {string} reason Short operator-safe summary without balances, amounts, or order details
 */

/**
 * Ladder that the bot paused itself as a safety measure. Pauses made with `/disable ld pause` are not listed.
 *
 * @typedef {Object} WebUiLadderSafetyPause
 * @property {1 | 2} ladder Ladder instance
 * @property {number} ts Epoch ms of the pause; `0` when unknown
 * @property {string} reason Short reason, e.g. how many ladder1 orders filled
 */

/**
 * Safety events for monitoring, shown to every role. Use it for emergency banners instead of parsing
 * `GET /messages`, which needs `manager`.
 *
 * @typedef {Object} WebUiSafetyState
 * @property {WebUiEmergencyStop | null} emergencyStop Emergency stop in force, or `null`
 * @property {WebUiLadderSafetyPause[]} ladderPauses Ladders in a bot-initiated safety pause
 */

/**
 * `GET /api/v1/status` response. Market-making quality for WebUI status dots; JWT required.
 *
 * @typedef {Object} WebUiStatusResponse
 * @property {boolean} mmActive Whether `mm_isActive` is on
 * @property {'working' | 'degraded' | 'stopped'} mmState
 * @property {number} [mmGeneralInitTs] Epoch ms when MM last started (`mm_generalInitTs`)
 * @property {number} [mmGeneralRestartTs] Epoch ms of last process start while MM was on (`mm_generalRestartTs`)
 * @property {boolean} [mmInGrace] True during the first 10 minutes after `mmGeneralRestartTs` (or init)
 * @property {number} [mmWindowMs] Observation window used for degraded checks
 * @property {Array<'no_open_orders' | 'empty_base' | 'empty_quote' | 'frozen_ticker'>} [mmDegradedReasons]
 * @property {{ last: { n: number, min?: number, max?: number }, bid: { n: number, min?: number, max?: number }, ask: { n: number, min?: number, max?: number } }} [mmTicker]
 * @property {WebUiSafetyState} safety Emergency stop and ladder safety pauses
 */

module.exports = {};
