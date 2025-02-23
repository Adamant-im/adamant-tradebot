'use strict';

/**
 * Accounts object definition for Bybit API.
 * @typedef {Object} AccountsResult
 * @prop {"FUND" | "SPOT" | "UNIFIED"} accountType Account type, SPOT (Classic) or UNIFIED (Updated). Also determines the default trading wallet.
 * @prop {Array<"CONTRACT" | "FUND" | "OPTION" | "SPOT" | "UNIFIED">} accountTypeAll All accounts type array.
 * @prop {boolean} isMasterAccount Whether this api key belongs to a master account or sub account.
 * @prop {string} uid "012345678" Master/Sub user id.
 */

module.exports = {};
