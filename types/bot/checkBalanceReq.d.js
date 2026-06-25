/**
 * @fileoverview Types for balance check results.
 * Used by modules to determine whether sufficient balance exists
 * for placing an order.
 *
 * @module types/bot/checkBalanceReq.d
 */

/**
 * Result of balance check.
 *
 * Used by helpers like `isEnoughCoins()` to indicate whether sufficient
 * balance exists for placing an order.
 *
 * @typedef {Object} CheckBalanceRequest
 * @property {boolean} result Indicates whether the balance check was successful
 * @property {string} [message] Optional error or informational message
 */

/**
 * Promise result of balance check.
 *
 * @typedef {Promise<CheckBalanceRequest>} CheckBalanceRequestPromise
 */

module.exports = {};
