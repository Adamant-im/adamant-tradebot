'use strict';

/**
 * @typedef { import('./withdraw-id.d').WithdrawIdItem } WithdrawIdItem
 */

/**
 * Withdraw history object definition.
 * @typedef {Object} Result
 * @prop {string} [error] Error message.
 * @prop {Array<WithdrawIdItem>} [result] [{ accountId, chain, ... }]
 * @prop {boolean} success Is the withdrawal successful or not.
 */

module.exports = {};
