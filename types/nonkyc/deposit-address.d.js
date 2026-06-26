/**
 * Raw vendor payload from GET /getdepositaddress/{ticker}
 * The API client returns this payload as-is; mapping is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Account%20(Private)/get_getdepositaddress__ticker_
 * @typedef {object} NonkycDepositAddress
 * @prop {string} address Deposit address for the requested ticker
 * @prop {string} [paymentid] Optional payment memo or destination tag (e.g. for ADM, XMR)
 *
 * NOTE: `trade/api/nonkyc_api.js` may attach `nonkycErrorInfo: string` to this object on API errors.
 *
 * @example
 * // ADM (has paymentid):
 * {
 *   "address": "U9541055514606945664",
 *   "paymentid": ""
 * }
 * @example
 * // ERC20 token (no paymentid):
 * {
 *   "address": "0xABCDEF1234567890abcdef1234567890ABCDEF12"
 * }
 */

module.exports = {};
