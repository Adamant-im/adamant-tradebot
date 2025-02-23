'use strict';

/**
 * Open orders object definition.
 * @typedef {Object} ResultItem
 * @prop {number} amount Amount (base currency for limit and market-sell order; quote currency for market-buy order).
 * @prop {number} amountExecuted Filled volume in base currency.
 * @prop {number} amountLeft Difference between amount and filled volume.
 * @prop {string} orderId Order ID.
 * @prop {number} price Order price.
 * @prop {string} side Trade direction (buy or sell).
 * @prop {string} status Order status.
 * @prop {string} symbol Trading pair in human-readable format, e.g. "BTC/USDT".
 * @prop {string} symbolPlain Trading pair in plain format, e.g. "BTCUSDT".
 * @prop {number} timestamp Creation date, unix timestamp.
 * @prop {string} type Order type (limit or market).
 * @prop {number} [takeProfit] Take profit price
 * @prop {number} [stopLoss] Stop loss price
 * @prop {0 | 1 | 2} [positionIdx] 0: one-way mode, 1: Buy side of hedge-mode, 2: Sell side of hedge-mode
 * @prop {boolean} [reduceOnly] Reduce-only mode for an open position
 * @typedef {object} Result
 * @prop {string} pageToken Refer to the cursor request parameter.
 * @prop {Array<ResultItem>} result
 */

module.exports = {};
