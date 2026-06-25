/**
 * Raw vendor payload from GET /ticker/{symbol}
 * The API client returns this payload as-is; mapping to bot-internal shape is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Supplementary%20Endpoints/get_ticker__symbol_
 * @typedef {object} NonkycTicker
 * @prop {string} ticker_id Trading pair identifier, for example ADM_USDT
 * @prop {string} base_currency Base currency symbol, for example ADM
 * @prop {string} target_currency Quote currency symbol, for example USDT
 * @prop {string | number} last_price Last traded price
 * @prop {string | number} base_volume 24h volume in base currency
 * @prop {string | number} target_volume 24h volume in quote currency
 * @prop {string | number} bid Best bid price
 * @prop {string | number} ask Best ask price
 * @prop {string | number} high 24h highest price
 * @prop {string | number} low 24h lowest price
 *
 * NOTE: `trade/api/nonkyc_api.js` returns this raw object directly. Processing happens in `trader_nonkyc.js`.
 *
 * @example
 * {
 *   "ticker_id": "ADM_USDT",
 *   "base_currency": "ADM",
 *   "target_currency": "USDT",
 *   "last_price": "0.01235",
 *   "base_volume": "123456.00",
 *   "target_volume": "1525.53",
 *   "bid": "0.01230",
 *   "ask": "0.01240",
 *   "high": "0.01260",
 *   "low": "0.01200"
 * }
 */

module.exports = {};
