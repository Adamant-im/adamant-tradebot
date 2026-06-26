/**
 * Raw vendor payload from POST /createorder
 * The API client returns this payload as-is; mapping to bot-internal shape is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Account%20(Private)/post_createorder
 * @typedef {object} NonkycCreateOrder
 * @prop {string} id Created order identifier
 * @prop {"buy" | "sell"} [side] Order side
 * @prop {"limit" | "market"} [type] Order type
 * @prop {string | number} [price] Order price
 * @prop {string | number} [quantity] Order quantity
 * @prop {string} [status] Initial order status
 * @prop {number} [createdAt] Creation timestamp in milliseconds
 *
 * NOTE: `trade/api/nonkyc_api.js` returns this raw object directly. Processing happens in `trader_nonkyc.js`.
 * On error, the object will contain a `nonkycErrorInfo` field instead of `id`.
 *
 * @example
 * {
 *   "id": "655f28a1f6849a420b2e913d",
 *   "side": "buy",
 *   "type": "limit",
 *   "price": "0.01230",
 *   "quantity": "1000",
 *   "status": "Active",
 *   "createdAt": 1700000100000
 * }
 */

module.exports = {};
