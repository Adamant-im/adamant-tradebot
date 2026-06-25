/**
 * Raw vendor payload from POST /cancelallorders
 * The API client returns this payload as-is; mapping to bot-internal shape is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Account%20(Private)/post_cancelallorders
 * @typedef {object} NonkycCancelAllOrders
 * @prop {boolean} success Whether the bulk cancellation succeeded
 * @prop {string[]} ids Array of cancelled order identifiers
 *
 * NOTE: `trade/api/nonkyc_api.js` returns this raw object directly. Processing happens in `trader_nonkyc.js`.
 * On error, the object will contain a `nonkycErrorInfo` field.
 *
 * @example
 * {
 *   "success": true,
 *   "ids": ["655f28a1f6849a420b2e913d", "655f28a1f6849a420b2e913e"]
 * }
 */

module.exports = {};
