'use strict';

/**
 * GET https://api.bybit.com/v5/order/realtime?category=spot
 * @see https://bybit-exchange.github.io/docs/v5/order/open-order#response-parameters
 * @typedef {Object} OrdersItem
 * @prop {string} orderId "0123456789012345678" Order ID.
 * @prop {string} price "10000" Order price.
 * @prop {string} qty "0.001" Amount (base currency for limit and market-sell order; quote currency for market-buy order).
 * @prop {"Limit" | "Market"} orderType "limit" Order type.
 * @prop {"Buy" | "Sell"} side "Buy" Trade direction.
 * @prop {"Cancelled" | "Deactivated" | "Filled" | "New" | "PartiallyFilled" | "PartiallyFilledCanceled" | "Rejected" | "Untriggered" | "Triggered"} orderStatus "New" Order status.
 * @prop {string} cumExecQty "0" Filled volume in base currency.
 * @prop {string} createdTime "1716037044487" Creation date, unix timestamp.
 * @prop {string} takeProfit Take profit price
 * @prop {string} stopLoss Stop loss price
 * @prop {0 | 1 | 2} positionIdx 0: one-way mode, 1: Buy side of hedge-mode, 2: Sell side of hedge-mode
 * @prop {boolean} reduceOnly Reduce-only mode for an open position
 * @typedef {Object} OrdersList
 * @prop {Array<OrdersItem>} list [OrdersItem, ...]
 * @prop {string} nextPageCursor Refer to the cursor request parameter.
 * @typedef {Object} Orders
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {OrdersList} result { list: [OrdersItem, ...] }
 */

module.exports = {};
