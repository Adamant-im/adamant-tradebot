'use strict';

/**
 * Withdraw by id object definition.
 * @typedef {Object} WithdrawIdItem
 * @prop {string} accountId Account id.
 * @prop {string} chain Network chain name.
 * @prop {string} chainPlain Network chain name in an exchange format.
 * @prop {number | null} confirmations Amount of chain confirmations.
 * @prop {number} createdAt Withdraw create timestamp.
 * @prop {string} cryptoAddress Withdraw address.
 * @prop {string} cryptoAddressTag Withdraw address tag.
 * @prop {string} currencySymbol Withdrawal currency coin.
 * @prop {string} [errorCode] Error code.
 * @prop {string} [errorDetail] Error detail.
 * @prop {string} [errorObject] Error object.
 * @prop {number} fee Withdraw fee.
 * @prop {number} fundsTransferMethodId Transfer method id.
 * @prop {string} id Withdrawal id.
 * @prop {number} quantity Withdraw amount.
 * @prop {string | null} source Withdraw source.
 * @prop {string} status Withdrawal status.
 * @prop {string} [target] Target.
 * @prop {string} txId Transaction id.
 * @prop {number} updatedAt Withdraw update timestamp.
 * @typedef {Object} Result { result: [{ accountId, chain, ... }] }
 * @prop {string} [error] Error message.
 * @prop {Array<WithdrawIdItem>} [result] { accountId, chain, ... }
 * @prop {boolean} success Is the withdrawal successful or not.
 */

module.exports = {};
