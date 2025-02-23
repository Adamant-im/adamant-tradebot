'use strict';

/**
 * POST https://api.bybit.com/v5/order/create
 * @see https://bybit-exchange.github.io/docs/v5/order/create-order#response-parameters
 * @typedef {Object} OrderPlaceData
 * @prop {string} orderId "0123456789012345678" Order ID.
 * @typedef {Object} OrderPlace
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {OrderPlaceData} result { orderId }
 */

module.exports = {};
