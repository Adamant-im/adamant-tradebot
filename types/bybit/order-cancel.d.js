'use strict';

/**
 * POST https://api.bybit.com/v5/order/cancel
 * @see https://bybit-exchange.github.io/docs/v5/order/cancel-order#response-parameters
 * @typedef {Object} OrderCancelData
 * @prop {string} orderId "0123456789012345678" Order ID.
 * @typedef {Object} OrderCancel
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {OrderCancelData} result { orderId }
 */

module.exports = {};
