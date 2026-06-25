/**
 * Order status definition.
 * @typedef {"cancelled" | "filled" | "new" | "part_filled" | "unknown"} OrderStatus
 */

/**
 * Order info object definition.
 * @typedef {Object} Result
 * @prop {string} orderId Order ID
 * @prop {OrderStatus} status Order status, 'unknown' is for not existing order
 * @prop {number} [amount] Amount of base currency
 * @prop {number} [amountExecuted] Filled volume in base currency
 * @prop {string} [cancelType] Cancel type
 * @prop {string} [pairPlain] Pair in format "BTCUSDT"
 * @prop {string} [pairReadable] Pair in format "BTC/USDT"
 * @prop {number} [positionIdx] Position index. Used to identify positions in different position modes.
 * @prop {number} [price] Order price
 * @prop {boolean} [reduceOnly] Reduce only. true means reduce position size
 * @prop {string} [rejectReason] Reject reason
 * @prop {string} [side] Trade direction (buy or sell)
 * @prop {string} [smpType] SMP execution type
 * @prop {string} [timeInForce] Time in force
 * @prop {number} [timestamp] Creation date, unix timestamp
 * @prop {number | null} [totalFeeInCoin2] To be described
 * @prop {number | null} [tradesCount] To be described
 * @prop {string} [type] Order type, may include specific types, e.g, 'stop_market'
 * @prop {string} [typeReduced] Reduced to 'limit' or 'market' order type
 * @prop {number} [updateTimestamp] Update date, unix timestamp
 * @prop {number} [volume] Amount of quote currency
 * @prop {number} [volumeExecuted] Filled volume in quote currency
 * @prop {number} [takeProfit] Take profit price
 * @prop {number} [stopLoss] Stop loss price
 * @prop {number} [stopPrice] Stop loss or Take profit price (Binance doesn't have attached TP/SL orders)
 * @prop {number} [closePosition] Whether the order closes full position
 */

module.exports = {};
