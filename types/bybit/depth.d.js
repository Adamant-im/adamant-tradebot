'use strict';

/**
 * GET https://api.bybit.com/v5/market/orderbook?category=spot&symbol=BTCUSDT
 * @see https://bybit-exchange.github.io/docs/v5/market/orderbook#response-parameters
 * @typedef {number} baseVolume 61.944924 Base currency volume (ask or bid size).
 * @typedef {number} orderPrice 61650.0 Order price.
 * @typedef {Object} DepthData
 * @prop {Array<[orderPrice,baseVolume]>} a Asks depth.
 * @prop {Array<[orderPrice,baseVolume]>} b Bids depth.
 * @typedef {Object} Depth
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {DepthData} result { a: [[orderPrice,baseVolume], ...], b: [[orderPrice,baseVolume], ...], }
 */

module.exports = {};
