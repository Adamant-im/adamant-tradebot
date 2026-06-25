/**
 * POST https://openapi.fameex.net/sapi/v1/cancel
 * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#cancel-order
 * @typedef {number} _orderId Order id.
 * @typedef {object} default
 * @prop {Array<_orderId>} orderId Order ids successfully cancelled
 * @prop {'PENDING_CANCEL' | 'To be Canceled'} status Order status
 * @prop {string} symbol Lowercase symbol name
 */

module.exports = {};
