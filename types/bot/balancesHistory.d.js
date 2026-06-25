'use strict';

/**
 * Type definitions for `helpers/balancesHistory.js`.
 *
 * @module types/bot/balancesHistory.d
 */

/**
 * @typedef {import('types/assets.d').Result} AssetsResult
 * @typedef {import('types/assets.d').BalancesAndTimestamp} BalancesAndTimestamp
 * @typedef {import('types/assets.d').CoinComparisonData} CoinComparisonData
 * @typedef {import('types/assets.d').BalanceComparisonInfo} BalanceComparisonInfo
 */

/**
 * Balance-total category prefix used when composing synthetic total codes.
 *
 * @typedef {'total' | 'totalNonCoin1' | 'totalTrading'} BalanceTotalType
 */

/**
 * Reference currency used when aggregating portfolio totals.
 *
 * @typedef {Object} BalanceTotalCoin
 * @property {'USD' | 'BTC' | 'COIN2'} key Suffix used in total keys such as `totalUSD`
 * @property {string} target Currency code passed to the exchanger for conversion
 */

/**
 * Scope for `addBalanceTotals()` output and synthetic total rows.
 *
 * - `pair` — include only the trading-pair total (`totalTrading*`)
 * - `priority` — include all totals in the human-readable summary
 * - `allcoins` — same totals as `priority`, but intended for full-balance snapshots
 *
 * @typedef {'pair' | 'priority' | 'allcoins'} BalanceTotalsScope
 */

/**
 * Parsed mapping from a full total key to its type and currency suffix.
 *
 * @typedef {Object} BalanceTotalKeyParts
 * @property {BalanceTotalType} type Total category
 * @property {'USD' | 'BTC' | 'COIN2'} key Currency suffix
 */

/**
 * Result of `addBalanceTotals()`.
 *
 * @typedef {Object} AddBalanceTotalsResult
 * @property {AssetsResult} balancesWithTotals Input balances mutated with synthetic total rows
 * @property {string} output Human-readable totals summary ending with a newline
 */

/**
 * Parameters for `saveSnapshotIfChanged()`.
 *
 * @typedef {Object} SaveSnapshotParams
 * @property {number} accountNo Bot account number
 * @property {string} [walletType] Wallet type label, if applicable
 * @property {string} [userId] User id for multi-user snapshots
 * @property {AssetsResult} balances Balances to persist
 * @property {'getBalancesCached' | 'userRequest' | string} [source] Snapshot origin label
 * @property {string} [callerName] Caller identifier for logs
 * @property {number} [timestamp] Snapshot timestamp in milliseconds
 */

/**
 * Parameters for `saveUserSnapshot()`.
 *
 * @typedef {Object} SaveUserSnapshotParams
 * @property {string} userId User id tied to the snapshot
 * @property {number} accountNo Bot account number
 * @property {string} [accountType] Logical account type, if applicable
 * @property {AssetsResult} balances Balances to persist
 * @property {string} [callerName] Caller identifier for logs
 * @property {number} [timestamp] Snapshot timestamp in milliseconds
 */

/**
 * Parameters for `getSnapshotByTimestamp()` and `compareLastWithTimestamp()`.
 *
 * @typedef {Object} BalanceSnapshotQuery
 * @property {string} [userId] User id filter; omit to ignore user id
 * @property {number} accountNo Bot account number
 * @property {string} [accountType] Account type filter; omit to ignore account type
 * @property {string} [walletType] Wallet type filter; omit to ignore wallet type
 * @property {number} [timestamp] Upper bound timestamp in milliseconds for historical lookup
 */

/**
 * MongoDB document stored in the `balancesHistory` collection.
 *
 * @typedef {Object} BalanceSnapshotDocument
 * @property {import('mongodb').ObjectId} [_id] Document id
 * @property {string} exchange Exchange name
 * @property {number} accountNo Bot account number
 * @property {string | null} walletType Wallet type label
 * @property {string | null} [userId] User id for user-triggered snapshots
 * @property {string | null} [accountType] Logical account type for user-triggered snapshots
 * @property {number} timestamp Snapshot timestamp in milliseconds
 * @property {AssetsResult} balances Stored balances, including synthetic totals when present
 * @property {string} hash Hash of non-total balances used for change detection
 * @property {string} tradingHash Hash of trading-coin balances only
 * @property {string} source Snapshot origin label
 * @property {string} [callerName] Caller identifier for logs
 */

/**
 * Public export of `helpers/balancesHistory.js`.
 *
 * @typedef {Object} BalancesHistoryModule
 * @property {BalanceTotalCoin[]} BALANCE_TOTAL_COINS Reference currencies used for totals
 * @property {BalanceTotalType[]} BALANCE_TOTAL_TYPES Total category prefixes
 * @property {string[]} balanceTotalsFull Full list of synthetic total codes
 * @property {Record<string, BalanceTotalKeyParts>} totalsKeyToTypeCoin Parsed total-key lookup map
 * @property {(balances: AssetsResult, scope?: BalanceTotalsScope) => AddBalanceTotalsResult | undefined} addBalanceTotals Adds synthetic totals and summary text
 * @property {(balances: AssetsResult) => AssetsResult} removeTotals Removes synthetic total rows
 * @property {(balances: AssetsResult) => AssetsResult} filterTradingCoins Keeps only configured trading coins
 * @property {(balances: AssetsResult) => string} buildBalancesHash Builds a stable hash for change detection
 * @property {(params: SaveSnapshotParams) => Promise<void>} saveSnapshotIfChanged Persists a snapshot when balances changed
 * @property {(params: SaveUserSnapshotParams) => Promise<void>} saveUserSnapshot Persists a user-triggered snapshot
 * @property {(userId: string, accountNo: number, accountType?: string) => Promise<BalancesAndTimestamp | undefined>} getLastUserSnapshot Returns the latest user snapshot
 * @property {(params: BalanceSnapshotQuery & { timestamp: number }) => Promise<BalancesAndTimestamp | undefined>} getSnapshotByTimestamp Returns the latest snapshot at or before a timestamp
 * @property {(params: BalanceSnapshotQuery & { timestamp: number }) => Promise<BalanceComparisonInfo | undefined>} compareLastWithTimestamp Compares the latest snapshot with a historical one
 */

module.exports = {};
