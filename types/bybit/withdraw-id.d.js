'use strict';

/**
 * GET https://api.bybit.com/v5/asset/withdraw/query-record?txID=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
 * @see https://bybit-exchange.github.io/docs/v5/asset/withdraw/withdraw-record#response-parameters
 * @typedef {Object} WithdrawIdItem
 * @prop {string} amount "1.99" Withdraw amount.
 * @prop {string} chain "CAVAX" Withdraw chain.
 * @prop {string} createTime "1234567890123" Withdraw create timestamp.
 * @prop {string} coin "USDC" Withdrawal currency coin.
 * @prop {"BlockchainConfirmed" | "CancelByUser" | "Fail" | "MoreInformationRequired" |
 *   "Pending" | "Reject" | "SecurityCheck" | "Unknown" | "success"} status "success" Withdraw status.
 * @prop {string} tag "" Withdraw address tag.
 * @prop {string} toAddress "0x0123456789abcdef0123456789abcdef01234567" Withdrawal address or Bybit UID for internal transfers.
 * @prop {string} txID "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" Transaction id. "" if withdrawal failed or cancelled.
 * @prop {string} updateTime "1234567890123" Withdraw update timestamp.
 * @prop {string} withdrawFee "1" Withdraw fee.
 * @prop {string} withdrawId "12345678" Withdrawal id.
 * @prop {0 | 1} withdrawType 0 Withdraw type. 0: on chain. 1: off chain.
 * @typedef {Object} WithdrawIdArray
 * @prop {Array<WithdrawIdItem>} rows [{ amount, chain, ... }]
 * @typedef {Object} WithdrawId
 * @prop {WithdrawIdArray} result { rows: [{ amount, chain, ... }] }
 * @prop {string} retMsg "OK" Response status message.
 * @prop {string} [bybitErrorInfo] E.g., '[10001] Request parameter error (Request parameter error)'
 */

module.exports = {};
