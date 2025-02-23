'use strict';

/**
 * Withdraw object definition.
 * @typedef {Object} ResultEntries
 * @prop {string} address Wallet address, and make sure you add address in the address book first.
 * @prop {number} amount Withdraw amount.
 * @prop {string} currency Coin, uppercase only.
 * @prop {number} date Current timestamp (ms). Used for preventing from withdraw replay.
 * @prop {number} id Withdrawal ID.
 * @prop {string} network Chain name.
 * @prop {number} status Withdraw status.
 * @prop {number} target Withdraw target.
 * @prop {number} withdrawalFee Withdrawal fee.
 * @typedef {Object} Result
 * @prop {string} [error] Error message.
 * @prop {ResultEntries} [result] { address, amount, ... }
 * @prop {boolean} success Is the withdrawal successful or not.
 */

module.exports = {};
