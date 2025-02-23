'use strict';

/**
 * POST https://api.bybit.com/v5/asset/withdraw/create
 * @see https://bybit-exchange.github.io/docs/v5/asset/withdraw#response-parameters
 * @typedef {Object} WithdrawEntries
 * @prop {number} id "12345678" Withdrawal ID.
 * @typedef {Object} Withdraw
 * @prop {WithdrawEntries} result { id }
 * @prop {string} retMsg "success" Request status message.
 * @prop {number} time 1234566789012 Request unix timestamp.
 * @prop {string} [bybitErrorInfo] E.g., '[131002] Withdraw address chain or destination tag are not equal'
 */

module.exports = {};
