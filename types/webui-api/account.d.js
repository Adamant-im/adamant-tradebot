'use strict';

/**
 * @typedef {import('../assets.d.js').Result} AssetsResult
 * @typedef {import('../orders.d.js').ResultItem} OpenOrderItem
 */

/**
 * `GET /api/v1/account/balances` response.
 *
 * @typedef {Object} WebUiBalancesResponse
 * @property {AssetsResult} balances Non-zero balances from the exchange connector
 */

/**
 * Open order as returned by `GET /api/v1/account/orders`.
 * Exchange fields come from `trader_*.getOpenOrders`; `purpose` is joined from dbOrders.
 *
 * @typedef {OpenOrderItem & {
 *   purpose?: string,
 *   purposeLabel?: string,
 *   moduleIndex?: number,
 *   subPurpose?: string,
 *   subType?: string,
 *   subtype?: string,
 *   quoteAmount?: number,
 * }} WebUiOpenOrderItem
 */

/**
 * `GET /api/v1/account/orders` response.
 *
 * Open orders are a flat array from `trader_*.getOpenOrders` /
 * `orderUtils.getOpenOrdersCached` (not the paginated `{ result }` wrapper),
 * with bot purpose attached when the order exists in dbOrders.
 *
 * @typedef {Object} WebUiOpenOrdersResponse
 * @property {string} pair Trading pair filter
 * @property {WebUiOpenOrderItem[]} orders Open orders for the pair
 */

module.exports = {};
