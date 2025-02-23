'use strict';

/**
 * Deposit history object definition.
 * @typedef {Object} DepositHistoryItem
 * @prop {string} accountId Account id.
 * @prop {string} chain Network chain name.
 * @prop {string} chainPlain Network chain name in an exchange format.
 * @prop {number} confirmations Amount of chain confirmations.
 * @prop {number} createdAt Deposit create timestamp.
 * @prop {string} cryptoAddress Deposit address.
 * @prop {string} cryptoAddressTag Deposit address tag.
 * @prop {string} currencySymbol Deposital currency coin.
 * @prop {number} fundsTransferMethodId Transfer method id.
 * @prop {string} [id] Deposital id.
 * @prop {number} quantity Deposit amount.
 * @prop {string | null} source Deposit source.
 * @prop {string} status Deposital status.
 * @prop {string} txId Transaction id.
 * @prop {number} updatedAt Deposit update timestamp.
 * @typedef {Object} Result [{ accountId, chain, ... }]
 * @prop {string} [error] Error message.
 * @prop {Array<DepositHistoryItem>} [result] { accountId, chain, ... }
 * @prop {boolean} success Is the withdrawal successful or not.
 */

module.exports = {};
