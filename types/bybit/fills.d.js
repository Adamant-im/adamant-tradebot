'use strict';

/**
 * GET https://api.bybit.com/v5/market/recent-trade?category=spot
 * @see https://bybit-exchange.github.io/docs/v5/market/recent-trade#response-parameters
 * @typedef {Object} FillsItem
 * prop {string} symbol "BTCUSDT" Trading pair.
 * @prop {string} execId "0123456789012345678" Filled order id (execution id).
 * @prop {"Buy" | "Sell"} side Fill direction.
 * @prop {string} price "61608.19" Fill price in quote currency.
 * @prop {string} size "0.00589" Filled quantity in base currency.
 * @prop {string} time "1715680628784" Transaction time, unix timestamp.
 * @typedef {Object} FillsData
 * @prop {Array<FillsItem>} list [FillsItem, ...]
 * @typedef {Object} Fills
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {FillsData} result { list: [FillsItem, ...] }
 */

module.exports = {};
