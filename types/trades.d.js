'use strict';

/**
 * Recent market trades object definition.
 * @typedef {Object} ResultItem
 * @prop {number} coin1Amount Filled amount of base currency.
 * @prop {number} coin2Amount Filled amount of quote currency.
 * @prop {number} date Transaction time, unix timestamp.
 * @prop {number} price Fill price.
 * @prop {number | string} tradeId Filled order id.
 * @prop {"buy" | "sell"} type Fill direction.
 * @typedef {Array<ResultItem>} TradesResult [ResultItem, ...]
 */

module.exports = {};
