/**
 * types/bot/store.d.js
 *
 * Type definitions for the in-process ADM blockchain cursor (`modules/Store.js`).
 */

/**
 * MongoDB `systems` collection document fields used by `Store.js`.
 *
 * @typedef {Object} SystemDbRecord
 * @property {number} [lastProcessedBlockHeight] Highest ADM block height fully processed by the bot
 */

/**
 * In-process store for ADM blockchain sync state and mirrored `systems` fields.
 *
 * @typedef {Object} StoreModule
 * @property {number | undefined} lastProcessedBlockHeight Cached last processed block height
 * @property {() => Promise<number | undefined>} getLastProcessedBlockHeight Returns the last processed height, bootstrapping from chain on first run
 * @property {(field: string) => Promise<any>} getSystemDbField Reads one field from `systems`
 * @property {(field: string, data: any) => Promise<void>} updateSystemDbField Persists a field to `systems` and mirrors it in memory
 * @property {(height: number) => Promise<void>} updateLastProcessedBlockHeight Advances the cursor when a higher block height is seen
 */

module.exports = {};
