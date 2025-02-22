'use strict';

/**
 * POST https://api.bybit.com/v5/order/cancel-all
 * @see https://bybit-exchange.github.io/docs/v5/order/cancel-all#response-parameters
 * @typedef {Object} OrdersCancelData
 * @prop {Array<Object>} list [OrdersItem, ...] Array of cancelled orders' orderId and orderLinkId
 * @prop {string} success "1" Removal status (fail or success).
 * @typedef {Object} OrdersCancel
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {OrdersCancelData} result { success }
 */

module.exports = {};
