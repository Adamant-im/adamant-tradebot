// @ts-check
'use strict';

/**
 * @typedef {import('../../types/qutrade/api.d.js').QutradeMarket} QutradeMarket
 * @typedef {import('../../types/qutrade/api.d.js').QutradeOrder} QutradeOrder
 */

/** @type {QutradeMarket} */
const market = {
  last: '0.06114',
  ask: '0.06115',
  bid: '0.06113',
  trend: '-0.6',
  spread: '0.03',
  base_volume: '422.103',
  quote_volume: '25.87266335',
  volume_usd: '25.87',
  traders: 5,
  trades: 62,
  step_price: '0.00001',
  decimal_price: 5,
  min_price_buy: '0.00001',
  max_price_buy: '0.09171',
  min_price_sell: '0.03057',
  max_price_sell: '10',
  base_step_amount: '0.001',
  base_decimal_amount: 3,
  base_min_amount: '2',
  quote_step_amount: '0.00000001',
  quote_decimal_amount: 8,
  quote_min_amount: '0.1',
  base_liquidity: '1000',
  base_liquidity_usd: '61.14',
  quote_liquidity: '61.14',
  quote_liquidity_usd: '61.14',
  timestamp: 1794385426,
};

/** @param {Partial<QutradeOrder>} [overrides] Scenario fields @returns {QutradeOrder} Complete order fixture */
function order(overrides = {}) {
  return {
    order_id: 3708000,
    label: null,
    status: 'opened',
    pair: 'CHESS_USDT',
    type: 'limit',
    side: 'sell',
    stop_price: null,
    requested_price: '0.06114',
    average_price: null,
    requested_base_amount: '4',
    filled_base_amount: '0',
    unfilled_base_amount: '4',
    requested_quote_amount: '0.24456',
    filled_quote_amount: '0',
    unfilled_quote_amount: '0.24456',
    filled_percent: '0',
    trades_count: 0,
    timestamp_create: 1794385426,
    timestamp_update: 1794385426,
    ...overrides,
  };
}

/** @param {unknown} payload Endpoint data @returns Success envelope */
const success = (payload) => ({ result: 'success', payload });

module.exports = { market, order, success };
