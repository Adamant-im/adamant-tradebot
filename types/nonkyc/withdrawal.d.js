/**
 * Raw vendor payload from POST /createwithdrawal
 * The API client returns this payload as-is; mapping is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Account%20(Private)/create-withdrawal
 * @typedef {object} NonkycWithdrawal
 * @prop {string} id Withdrawal identifier
 * @prop {string} ticker Currency ticker including network suffix, e.g. "USDT-ERC20"
 * @prop {string | number} quantity Withdrawal amount
 * @prop {string} address Destination address
 * @prop {string | number} fee Withdrawal fee amount
 * @prop {string} feecurrency Fee currency ticker
 * @prop {string} status Withdrawal status, e.g. "Pending", "Completed"
 * @prop {number | string | null} [sentat] Unix timestamp when withdrawal was sent
 * @prop {number | string | null} [requestedat] Unix timestamp when withdrawal was requested
 * @prop {string} [paymentid] Optional payment memo or destination tag
 *
 * NOTE: `trade/api/nonkyc_api.js` may attach `nonkycErrorInfo: string` to this object on API errors.
 *
 * @example
 * {
 *   "id": "64a3f1b2c3d4e5f6a7b8c9d0",
 *   "ticker": "USDT-ERC20",
 *   "quantity": "10.5",
 *   "address": "0xABCDEF1234567890abcdef1234567890ABCDEF12",
 *   "fee": "1.0",
 *   "feecurrency": "USDT-ERC20",
 *   "status": "Pending",
 *   "requestedat": 1720000000000,
 *   "sentat": null
 * }
 */

module.exports = {};
