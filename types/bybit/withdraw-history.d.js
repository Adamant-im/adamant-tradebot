'use strict';

/**
 * @typedef { import('./withdraw-id.d').WithdrawIdItem } WithdrawIdItem
 */

/**
 * GET https://api.bybit.com/v5/asset/withdraw/query-record
 * @see https://bybit-exchange.github.io/docs/v5/asset/withdraw/withdraw-record#response-parameters
 * @typedef {Object} WithdrawHistoryArray
 * @prop {string} nextPageCursor Refer to the cursor request parameter. Used for pagination.
 * @prop {Array<WithdrawIdItem>} rows [{ amount, chain, ... }]
 * @typedef {Object} WithdrawHistory
 * @prop {WithdrawHistoryArray} result { rows }
 */

module.exports = {};
