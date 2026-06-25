/**
 * Raw vendor payload from POST /cancelorder
 * The API client returns this payload as-is; mapping to bot-internal shape is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Account%20(Private)/cancel-order
 * @typedef {object} NonkycCancelOrder
 * @prop {boolean} success Whether the cancellation succeeded
 *
 * NOTE: `trade/api/nonkyc_api.js` returns this raw object directly. Processing happens in `trader_nonkyc.js`.
 * On error, the object will contain a `nonkycErrorInfo` field.
 *
 * @example
 * { "success": true }
 */

module.exports = {};
