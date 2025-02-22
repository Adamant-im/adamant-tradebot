'use strict';

/**
 * User account asset balances object definition.
 * @typedef {Object} ResultItem
 * @prop {"FUND" | "SPOT" | "UNIFIED"} [accountType] Account type.
 * @prop {string} code Account asset name.
 * @prop {number} [equity] Equity of current coin (unified accounts).
 * @prop {number} free Available assets.
 * @prop {number} freezed Amount of frozen assets.
 * @prop {number} [freezedInLock] Locked balance due to the Spot open order.
 * @prop {number} [realisedPnl] Cumulative realised P&L.
 * @prop {number} total Available and locked assets amount.
 * @prop {number} [totalPositionIM] Available and locked assets amount.
 * @prop {number} [unrealisedPnl] Unrealised P&L.
 * @prop {number} [usdValue] USD value of current coin.
 * @typedef {Array<ResultItem>} Result
 */

module.exports = {};
