'use strict';

/**
 * GET https://api.bybit.com/v5/asset/deposit/query-record
 * @see https://bybit-exchange.github.io/docs/v5/asset/deposit/deposit-record#response-parameters
 * @typedef {Object} DepositHistoryItem
 * @prop {string} amount "1.99" Deposit amount.
 * @prop {string} blockHash "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" Hash number on the chain.
 * @prop {string} chain "CAVAX" Deposit chain.
 * @prop {string} confirmations "120" Number of confirmation blocks.
 * @prop {string} createTime "1234567890123" Deposit create timestamp.
 * @prop {string} coin "USDC" Deposit currency coin.
 * @prop {string} depositFee "" Deposit fee.
 * @prop {0 | 1 | 2 | 3 | 4 | 10011 | 10012} status 3 Deposit status.
 * @prop {string} successAt "1234567890123" Last updated time.
 * @prop {string} tag "" Tag of deposit target address.
 * @prop {string} toAddress "0x0123456789abcdef0123456789abcdef01234567" Deposit target address.
 * @prop {string} txID "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" Transaction id.
 * @prop {string} withdrawFee "1" Deposit fee.
 * prop {string} withdrawId "12345678" Deposital id.
 * @prop {"0" | "1" | "10" | "20"} depositType "0" 0: normal deposit. 10: the deposit reaches daily deposit limit. 20: abnormal deposit.
 * @typedef {Object} DepositHistoryArray
 * @prop {string} nextPageCursor Refer to the cursor request parameter. Used for pagination.
 * @prop {Array<DepositHistoryItem>} rows [{ amount, blockHash, ... }]
 * @typedef {Object} DepositHistory
 * @prop {DepositHistoryArray} result { rows }
 */

module.exports = {};
