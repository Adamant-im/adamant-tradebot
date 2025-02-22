'use strict';

/**
 * GET https://api.bybit.com/v5/account/fee-rate
 * @see https://bybit-exchange.github.io/docs/v5/account/fee-rate#response-parameters
 * @typedef {Object} FeeRatesItem
 * prop {string} baseCoin "" Base coin. Derivatives does not have this field. Keeps "" for Spot.
 * @prop {string} symbol "BTCUSDT" Symbol name. Keeps "" for Options.
 * @prop {string} makerFeeRate "0.001" Maker fee rate.
 * @prop {string} takerFeeRate "0.0018" Taker fee rate.
 * @typedef {Object} FeeRatesList
 * @prop {Array<FeeRatesItem>} list [{ makerFeeRate, symbol, takerFeeRate }]
 * @typedef {Object} FeeRates
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {FeeRatesList} result { list: [{ makerFeeRate, symbol, takerFeeRate }] }
 */

module.exports = {};
