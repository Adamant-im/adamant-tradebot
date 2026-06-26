/**
 * Raw vendor payload from GET /historical_trades
 * The API client returns this payload as-is; mapping to bot-internal shape is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Supplementary%20Endpoints/get_historical_trades
 * @typedef {object} NonkycTrade
 * @prop {string | number} trade_id Unique trade identifier
 * @prop {string | number} price Trade execution price
 * @prop {string | number} base_volume Traded amount in base currency
 * @prop {string | number} target_volume Traded amount in quote currency
 * @prop {number} trade_timestamp Trade execution timestamp in milliseconds
 * @prop {"buy" | "sell"} type Trade direction
 *
 * NOTE: `trade/api/nonkyc_api.js` returns this raw array directly. Processing happens in `trader_nonkyc.js`.
 *
 * @typedef {NonkycTrade[]} NonkycTrades
 *
 * @example
 * [
 *   {
 *     "trade_id": "7842671",
 *     "price": "0.01235",
 *     "base_volume": "1000",
 *     "target_volume": "12.35",
 *     "trade_timestamp": 1700000000000,
 *     "type": "buy"
 *   }
 * ]
 */

module.exports = {};
