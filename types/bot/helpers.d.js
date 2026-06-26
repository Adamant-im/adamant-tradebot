'use strict';

/**
 * Shared type definitions for `helpers/*` modules.
 */

/**
 * Bot logging verbosity levels, from least to most verbose.
 *
 * @typedef {'none' | 'error' | 'warn' | 'info' | 'log' | 'debug' | 'trace'} LogLevel
 */

/**
 * Notification severity used by `helpers/notify.js` and command replies.
 *
 * @typedef {'error' | 'warn' | 'info' | 'log'} NotifyLevel
 */

/**
 * Market-making policy identifiers from `helpers/const.MM_POLICIES`.
 *
 * @typedef {'optimal' | 'spread' | 'orderbook' | 'depth' | 'wash'} MmPolicy
 */

/**
 * Ladder order lifecycle state from `helpers/const.LADDER_STATES`.
 *
 * @typedef {'Not placed' | 'Open' | 'Filled' | 'Partly filled' | 'Cancelled' | 'Missed' | 'To be removed' | 'Removed'} LadderState
 */

/**
 * Normalized time-unit keys used by `helpers/const.TIME_DIVISORS`.
 *
 * @typedef {'msecs' | 'secs' | 'mins' | 'hours' | 'days' | 'weeks' | 'months' | 'years'} TimeUnitKey
 */

/**
 * Parts of a formatted local date/time produced by `helpers/dateTime.formatDate`.
 *
 * @typedef {Object} FormattedDate
 * @property {number} year Four-digit year
 * @property {string} month Two-digit month (`01`–`12`)
 * @property {string} date Two-digit day of month (`01`–`31`)
 * @property {string} hours Two-digit hour (`00`–`23`)
 * @property {string} minutes Two-digit minute (`00`–`59`)
 * @property {string} seconds Two-digit second (`00`–`59`)
 * @property {string} YYYY_MM_DD Date only, e.g. `2026-06-22`
 * @property {string} YYYY_MM_DD_hh_mm Date and time without seconds
 * @property {string} hh_mm_ss Time only, e.g. `14:30:05`
 */

/**
 * Result of `helpers/dex.composePair` and `helpers/dex.decomposePair`.
 *
 * @typedef {Object} PairNames
 * @property {string} pair Base/quote pair, e.g. `ETH/USDT`
 * @property {string} pairReversed Quote/base pair, e.g. `USDT/ETH`
 * @property {string} coin1 Base currency symbol
 * @property {string} coin2 Quote currency symbol
 */

/**
 * Trading-pair document with swappable coin1/coin2 fields (DEX market info).
 * Used as input/output of `helpers/dex.reversePair`.
 *
 * @typedef {import('types/bot/parsedMarket.d.js').ParsedMarket & Record<string, unknown>} ReversiblePairData
 */

/**
 * AES-256-CTR encrypted payload returned by `helpers/encryption.encrypt`.
 *
 * @typedef {Object} EncryptedPayload
 * @property {string} iv Initialization vector as a hex string
 * @property {string} content Ciphertext as a hex string
 */

/**
 * Blockchain network metadata entry from `helpers/networks.js`.
 *
 * @typedef {Object} NetworkInfo
 * @property {string} code Canonical network code, e.g. `ERC20`
 * @property {string} name Human-readable network name
 * @property {string} sampleAddress Example address for validation hints
 * @property {string} [altcode] Alternate code used by some exchanges
 */

/**
 * Map of network codes to metadata (`helpers/networks.js` export).
 *
 * @typedef {Record<string, NetworkInfo>} NetworksMap
 */

/**
 * Logger module export (`helpers/log.js`).
 *
 * @typedef {Object} LogModule
 * @property {(str: string) => void} error
 * @property {(str: string) => void} warn
 * @property {(str: string) => void} info
 * @property {(str: string) => void} log
 * @property {(str: string) => void} debug
 * @property {(str: string) => void} trace
 * @property {string} HEARTBEAT_FILE_PATH Path to the heartbeat file updated every minute
 */

module.exports = {};
