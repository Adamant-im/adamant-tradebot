'use strict';

/**
 * GET https://api.bybit.com/v5/order/history?category=spot&orderId=0123456789012345678
 * GET https://api.bybit.com/v5/order/realtime?category=spot&orderId=0123456789012345678
 * @see https://bybit-exchange.github.io/docs/v5/order/open-order#response-parameters
 * @see https://bybit-exchange.github.io/docs/v5/order/order-list#response-parameters
 * @typedef {Object} OrderInfoItem
 * @prop {string} symbol "BTCUSDT" Trading pair name.
 * @prop {string} orderId "0123456789012345678" Order ID.
 * @prop {string} avgPrice "7.653" Average filled price. For orders without avg price: UTA returns ""; Classic account returns "0" and also for orders partilly filled but cancelled at the end.
 * @prop {string} basePrice "7.653" Order base price (same as lastPriceOnCreated).
 * @prop {string} lastPriceOnCreated "7.653" Last order price on created (same as basePrice).
 * @prop {string} price "10000" Order price.
 * @prop {string} qty "0.001" Amount (base currency for limit and market-sell order; quote currency for market-buy order).
 * @prop {string} smpType "None" SMP execution type.
 * @prop {"Limit" | "Market"} orderType "limit" Order type.
 * @prop {"Buy" | "Sell"} side "Buy" Trade direction.
 * @prop {"Cancelled" | "Deactivated" | "Filled" | "New" | "PartiallyFilled" | "PartiallyFilledCanceled" | "Rejected" | "Untriggered" | "Triggered"} orderStatus "New" Order status.
 * @prop {string} cancelType "UNKNOWN" Cancel type.
 * @prop {string} rejectReason "EC_CancelForNoFullFill" Reject reason. Classic spot is not supported.
 * @prop {string} cumExecQty "0" Filled volume in base currency.
 * @prop {string} cumExecValue "0.994890" Cumulative executed order value. Classic spot is not supported.
 * @prop {number} positionIdx 0 Position index. Used to identify positions in different position modes.
 * @prop {boolean} reduceOnly false Reduce only. true means reduce position size.
 * @prop {string} timeInForce "GTC" Time in force.
 * @prop {string} createdTime "1716037044487" Creation date, unix timestamp.
 * @prop {string} updatedTime "1716037044487" Update date, unix timestamp.
 * @prop {string} takeProfit "75000" Take profit price.
 * @prop {string} stopLoss "35000" Stop loss price.
 * @prop {"baseCoin" | "quoteCoin" | ""} marketUnit "baseCoin" The unit for qty when create Spot market orders for UTA account. baseCoin, quoteCoin.
 * @typedef {Object} OrdersList
 * @prop {Array<OrderInfoItem>} list [OrderInfoItem, ...]
 * @typedef {Object} OrderInfo
 * @prop {number} retCode 0 Response status code.
 * @prop {string} retMsg "OK" Response status message.
 * @prop {OrdersList} result { list: [OrderInfoItem, ...] }
 */

module.exports = {};
