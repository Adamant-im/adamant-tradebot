/**
 * User account asset balances object definition.
 * @typedef {Object} ResultItem
 * @prop {string} [accountType] Account type. E.g., `main`, `trade`, `margin`. The actual list depends on `features().accountTypes`.
 * @prop {string} code Account asset name
 * @prop {number} [free] Available assets. Not included for totals (codes `balanceTotals`).
 * @prop {number} [freezed] Amount of frozen assets. Also not included for totals.
 * @prop {number} total Available and locked assets amount
 * @prop {number} [equity] Equity of current coin (unified accounts)
 * @prop {number} [freezedInLock] Locked balance due to the Spot open order
 * @prop {number} [realisedPnl] Cumulative realised P&L
 * @prop {number} [totalPositionIM] Available and locked assets amount
 * @prop {number} [unrealisedPnl] Unrealised P&L
 * @prop {number} [usdValue] USD value of current coin
 * @typedef {Array<ResultItem>} Result
 */

/**
 * Extended array of balances with a timestamp of when balances were fetched.
 * This is used internally in getBalancesCached() logic.
 *
 * @typedef {Result & { _timestamp?: number }} ResultWithTimestamp
 */

/**
 * Object containing balances and the timestamp when they were fetched.
 * Used in balancesHistory.
 *
 * @typedef {Object} BalancesAndTimestamp
 * @prop {Result} balances Account balances
 * @prop {number} timestamp Unix timestamp (ms) when balances were fetched
 */

/**
 * Balance comparison data for a single coin.
 *
 * @typedef {Object} CoinComparisonData
 * @prop {string} code Coin code (e.g., `BTC`, `USDT`)
 * @prop {number} from Balance value at the start point
 * @prop {number} to Balance value at the end point
 * @prop {number} deltaAbs Absolute balance change (`to - from`)
 * @prop {number} deltaPercent Absolute percent change (always positive)
 * @prop {number} deltaPercentSigned Signed percent change (can be negative)
 * @prop {number} deltaPercentDirect Direct percent change relative to `from`
 */

/**
 * Balance comparison information between two balance snapshots.
 *
 * @typedef {Object} BalanceComparisonInfo
 * @prop {BalancesAndTimestamp} [from] Initial balances snapshot
 * @prop {BalancesAndTimestamp} [to] Final balances snapshot
 * @prop {CoinComparisonData} [coin1] Comparison data for the first coin
 * @prop {CoinComparisonData} [coin2] Comparison data for the second coin
 * @prop {CoinComparisonData} [expectedTradingValueCOIN2] Comparison data for the expected trading coins (coin1 + coin2) value in coin2
 * @prop {Object.<string, CoinComparisonData>} [totals] Comparison per totals code (e.g. `totalUSD`, `totalNonCoin1BTC`, `totalTradingCOIN2`)
 */

module.exports = {};
