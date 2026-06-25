/**
 * Raw vendor payload from GET /orderbook
 * The API client returns this payload as-is; mapping to bot-internal shape is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Supplementary%20Endpoints/get_orderbook
 *
 * Each level is a two-element tuple: [price, amount], both as strings.
 * @typedef {[string, string]} NonkycDepthLevel
 *
 * @typedef {object} NonkycDepth
 * @prop {string} ticker_id Trading pair, for example ADM_USDT
 * @prop {number} [timestamp] Snapshot timestamp in milliseconds
 * @prop {NonkycDepthLevel[]} asks Ask (sell) price levels, ascending by price
 * @prop {NonkycDepthLevel[]} bids Bid (buy) price levels, descending by price
 *
 * NOTE: `trade/api/nonkyc_api.js` returns this raw object directly. Processing happens in `trader_nonkyc.js`.
 *
 * @example
 * {
 *   "ticker_id": "ADM_USDT",
 *   "timestamp": 1700000000000,
 *   "asks": [
 *     ["0.01240", "15000"],
 *     ["0.01250", "22000"]
 *   ],
 *   "bids": [
 *     ["0.01230", "18000"],
 *     ["0.01220", "30000"]
 *   ]
 * }
 */

module.exports = {};
