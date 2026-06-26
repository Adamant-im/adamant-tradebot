/**
 * POST https://openapi.fameex.net/sapi/v1/order
 * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#create-new-order
 * @typedef {string} _orderId
 * @typedef {object} default
 * @prop {string} symbol Uppercase symbol name
 * @prop {'BUY' | 'SELL'} side Side of the order
 * @prop {number} executedQty The number of orders already executed
 * @prop {_orderId} orderId Order id (system generated)
 * @prop {number} price Order price
 * @prop {number} origQty Order volume
 * @prop {string} clientOrderId Order id (user generated)
 * @prop {number} transactTime The time of order placed
 * @prop {'LIMIT' | 'MARKET'} type Type of the order
 * @prop {'PENDING_CANCEL' | 'NEW' | 'REJECTED' | ' Canceled' | 'Filled' | 'New Order' | 'Partially Canceled' | 'Partially Filled' |
 *   'To be Canceled'} status Order status.
 */

module.exports = {};
