'use strict';

/**
 * GET https://api.bybit.com/v5/user/get-member-type
 * @see https://bybit-exchange.github.io/docs/v5/user/wallet-type#response-parameters
 * @typedef {Object} AccountsItem
 * @prop {Array<"CONTRACT" | "FUND" | "OPTION" | "SPOT" | "UNIFIED">} accountType ["CONTRACT", "FUND", "OPTION", "SPOT"] Wallets array.
 * @prop {string} uid "012345678" Master/Sub user id.
 * @typedef {Object} AccountsData
 * @prop {Array<AccountsItem>} accounts [{ accountType, uid }]
 * @typedef {Object} Accounts
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {AccountsData} result { accounts: [{ accountType, uid }] }
 */

module.exports = {};
