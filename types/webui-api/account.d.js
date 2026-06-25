'use strict';

/**
 * @typedef {import('../assets.d.js').Result} AssetsResult
 * @typedef {import('../orders.d.js').Result} OpenOrdersResult
 */

/**
 * `GET /api/v1/account/balances` response.
 *
 * @typedef {Object} WebUiBalancesResponse
 * @property {AssetsResult} balances Non-zero balances from the exchange connector
 */

/**
 * `GET /api/v1/account/orders` response.
 *
 * @typedef {Object} WebUiOpenOrdersResponse
 * @property {string} pair Trading pair filter
 * @property {OpenOrdersResult} orders Open orders for the pair
 */

module.exports = {};
