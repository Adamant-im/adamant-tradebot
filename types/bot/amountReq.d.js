/**
 * @fileoverview Types for amount calculation results.
 * Used by spread maintainer, trader and related modules
 * to determine whether an order can be placed and with what size.
 *
 * @module types/bot/amountReq.d
 */

/**
 * Result of amount calculation.
 *
 * Used by helpers like `setAmount()` to indicate whether an order
 * can be placed and with what size.
 *
 * @typedef {Object} AmountRequest
 * @property {boolean} result Indicates whether the amount calculation was successful
 * @property {number} [coin1Amount] Calculated amount in base currency (coin1)
 * @property {string} [message] Optional error or informational message
 */

/**
 * Promise result of amount calculation.
 *
 * @typedef {Promise<AmountRequest>} AmountRequestPromise
 */

module.exports = {};
