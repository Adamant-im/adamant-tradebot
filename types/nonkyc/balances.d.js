/**
 * Raw vendor payload from GET /balances
 * The API client returns this payload as-is; mapping to bot-internal shape is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Account%20(Private)/get_balances
 * @typedef {object} NonkycBalance
 * @prop {string} asset Asset/currency ticker, for example ADM
 * @prop {string | number} available Available (free) balance
 * @prop {string | number} held Balance on hold (in open orders)
 * @prop {string | number} pending Pending balance (e.g., from deposits)
 *
 * NOTE: `trade/api/nonkyc_api.js` returns this raw array directly. Processing happens in `trader_nonkyc.js`.
 *
 * @typedef {NonkycBalance[]} NonkycBalances
 *
 * @example
 * [
 *   {
 *     "asset": "ADM",
 *     "available": "50000.00000000",
 *     "held": "0.00000000",
 *     "pending": "0.00000000"
 *   },
 *   {
 *     "asset": "USDT",
 *     "available": "10.000000",
 *     "held": "0.000000",
 *     "pending": "0.000000"
 *   }
 * ]
 */

module.exports = {};
