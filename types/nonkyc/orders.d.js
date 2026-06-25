/**
 * Raw vendor payload from GET /getorders
 * The API client returns this payload as-is; mapping to bot-internal shape is done in `trader_nonkyc.js`.
 *
 * @see https://api.nonkyc.io/#/Account%20(Private)/get-orders
 * @typedef {object} NonkycOrderMarket
 * @prop {string} symbol Market symbol in readable format, for example ADM/USDT
 *
 * @typedef {object} NonkycOrder
 * @prop {string} id Order identifier
 * @prop {"buy" | "sell"} side Order side
 * @prop {"limit" | "market"} type Order type
 * @prop {string | number} price Order price
 * @prop {string | number} quantity Original order quantity in base currency
 * @prop {string | number} executedQuantity Executed quantity in base currency
 * @prop {string | number} remainQuantity Remaining quantity in base currency
 * @prop {"Active" | "New" | "Cancelled" | "Filled" | "Partly Filled"} status Raw exchange order status
 * @prop {number} createdAt Order creation timestamp in milliseconds
 * @prop {number} [updatedAt] Last update timestamp in milliseconds
 * @prop {NonkycOrderMarket} market Market info object
 *
 * NOTE: `trade/api/nonkyc_api.js` returns this raw array directly. Processing happens in `trader_nonkyc.js`.
 *
 * @typedef {NonkycOrder[]} NonkycOrders
 *
 * @example
 * [
 *   {
 *     "id": "655f28a1f6849a420b2e913d",
 *     "side": "buy",
 *     "type": "limit",
 *     "price": "0.01230",
 *     "quantity": "1000",
 *     "executedQuantity": "0",
 *     "remainQuantity": "1000",
 *     "status": "Active",
 *     "createdAt": 1700000000000,
 *     "market": { "symbol": "ADM/USDT" }
 *   }
 * ]
 */

module.exports = {};
