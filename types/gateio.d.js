'use strict';

/**
 * GET https://api.gateio.ws/api/v4/spot/currency_pairs
 * @see https://www.gate.io/docs/developers/apiv4/#list-all-currency-pairs-supported
 * @typedef {Object} MarketsItem
 * @prop {string} id "BTC_USDT"
 * @prop {string} base "BTC"
 * @prop {string} quote "USDT"
 * prop {string} fee "0.2"
 * @prop {string} [min_base_amount] "0.01"
 * @prop {string} [max_base_amount] undefined
 * @prop {string} [min_quote_amount] "3"
 * @prop {string} [max_quote_amount] "5000000"
 * @prop {0 | 1 | 2} amount_precision 2
 * @prop {4 | 5 | 6 | 7 | 8 | 9} precision 4
 * @prop {string} trade_status "tradable"
 * prop {number} sell_start 1607313600
 * prop {number} buy_start 1622433600
 * @typedef {Array<MarketsItem>} Markets
 */

module.exports = {};
