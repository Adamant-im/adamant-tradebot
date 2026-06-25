/**
 * GET https://openapi.fameex.net/sapi/v1/openOrders
 * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#current-open-orders
 * @typedef {object} _item
 * @prop {string} avgPrice The average price of executed orders
 * @prop {string} executedQty The number of orders already executed
 * @prop {number} orderId Order ID (system generated)
 * @prop {string} origQty Order volume
 * @prop {string} price Order price
 * @prop {string} side Best bid price
 * @prop {'PENDING_CANCEL' | 'NEW' | 'REJECTED' | 'Canceled' | 'Cancelled' | 'Filled' | 'New Order' |
 *   'Partially Canceled' | 'Partially Cancelled' | 'Partially Filled' | 'To be Canceled' | 'To be Cancelled' |
 *   'Partially Filled/Cancelled'} status Order status. 'Partially Filled/Cancelled' when 'MARKET' order is filled.
 * @prop {string} symbol Uppercase symbol name
 * @prop {number} [time] Timestamp in getOpenOrders()
 * @prop {number} [transactTime] Timestamp in getOrderDetails()
 * @prop {'LIMIT' | 'MARKET'} type Order type
 * @typedef {Array<_item>} default
 */

module.exports = {};
