'use strict';

/**
 * Qutrade v2 wire contracts. Monetary values are decimal strings; timestamps are seconds except tonce (milliseconds).
 * @typedef {{log: (message: string) => void, info: (message: string) => void,
 *   warn: (message: string) => void, error: (message: string) => void}} QutradeLogger
 * @typedef {'buy'|'sell'} QutradeSide
 * @typedef {'limit'|'market'|'stop_limit'|'stop_market'} QutradeOrderType
 * @typedef {'opened'|'filling'|'filled'|'canceled'|'already_canceled'|'pending'} QutradeOrderState
 * @typedef {Record<string, string|number|boolean|undefined>} QutradeParameters
 */

/**
 * @template T
 * @typedef {Object} QutradeResponse
 * @property {'success'|'error'} result Exchange outcome
 * @property {T} [payload] Present on successful responses; shape depends on endpoint
 * @property {number} [code] HTTP-style exchange error code
 * @property {string} [message] Error category
 * @property {string} [details] Error explanation
 * @example
 * { result: 'error', code: 429, message: 'Too Many Requests' }
 */

/**
 * /spot_markets map entry; the key is an uppercase BASE_QUOTE symbol
 * @typedef {Object} QutradeMarket
 * @property {string} last Last execution price
 * @property {string} ask Best ask, zero when absent
 * @property {string} bid Best bid, zero when absent
 * @property {string} trend Rolling 24h price change percentage
 * @property {string} spread Spread percentage
 * @property {string} base_volume Rolling 24h base volume
 * @property {string} quote_volume Rolling 24h quote volume
 * @property {string} volume_usd Rolling 24h USD volume
 * @property {number} traders Active traders over 24h
 * @property {number} trades Trades over 24h
 * @property {string} step_price Actual price grid
 * @property {number} decimal_price Price decimals
 * @property {string} min_price_buy Lower buy-price bound
 * @property {string} max_price_buy Upper buy-price bound
 * @property {string} min_price_sell Lower sell-price bound
 * @property {string} max_price_sell Upper sell-price bound
 * @property {string} base_step_amount Actual base quantity grid
 * @property {number} base_decimal_amount Base quantity decimals
 * @property {string} base_min_amount Minimum base quantity
 * @property {string} quote_step_amount Quote quantity grid
 * @property {number} quote_decimal_amount Quote quantity decimals
 * @property {string} quote_min_amount Minimum quote quantity
 * @property {string} base_liquidity Base liquidity including pools
 * @property {string} base_liquidity_usd USD base liquidity
 * @property {string} quote_liquidity Quote liquidity including pools
 * @property {string} quote_liquidity_usd USD quote liquidity
 * @property {number} timestamp Snapshot timestamp in seconds
 * @example
 * { last: '0.06114', ask: '0.06115', bid: '0.06113', step_price: '0.00001', decimal_price: 5,
 *   base_step_amount: '0.001', base_decimal_amount: 3, base_min_amount: '2', quote_min_amount: '0.1' }
 */

/**
 * Common full order shape returned by create, open, pending, history and cancellation endpoints
 * @typedef {Object} QutradeOrder
 * @property {number|string} order_id Integer identifier; large JSON integers must be parsed losslessly
 * @property {string|null} label Caller label, not an idempotency key
 * @property {QutradeOrderState} status opened=new, filling=partial, canceled=cancelled; already_canceled is cancellation-only
 * @property {string} pair BASE_QUOTE symbol
 * @property {QutradeOrderType} type Order type
 * @property {QutradeSide} side Direction
 * @property {string|null} stop_price Stop trigger, null for ordinary orders
 * @property {string|null} requested_price Limit price, null for market orders
 * @property {string|null} average_price Execution VWAP, null before any fill
 * @property {string|null} requested_base_amount Base target; null for quote-sized market orders
 * @property {string} filled_base_amount Executed base quantity
 * @property {string|null} unfilled_base_amount Remaining base target; null when quote-sized
 * @property {string|null} requested_quote_amount Quote target; may be calculated for limits
 * @property {string} filled_quote_amount Executed quote quantity
 * @property {string|null} unfilled_quote_amount Remaining quote target
 * @property {string} filled_percent Executed percentage
 * @property {number} trades_count Number of fills
 * @property {number} timestamp_create Creation timestamp in seconds
 * @property {number} timestamp_update Last change timestamp in seconds
 * @example
 * { order_id: 3707202, label: null, status: 'filled', pair: 'CHESS_USDT', type: 'limit', side: 'buy',
 *   stop_price: null, requested_price: '0.06114', average_price: '0.06114', requested_base_amount: '6.594',
 *   filled_base_amount: '6.594', unfilled_base_amount: '0', requested_quote_amount: '0.40315716',
 *   filled_quote_amount: '0.40315716', unfilled_quote_amount: '0', filled_percent: '100', trades_count: 1,
 *   timestamp_create: 1794374626, timestamp_update: 1794374626 }
 */

/**
 * @typedef {Object} QutradeBalance
 * @property {string} total Total owned assets including reserved assets
 * @property {string} available Spendable assets
 * @property {string} [in_orders] Documented but omitted live; not required for normalization
 * @property {string} [in_pools] Documented but omitted live
 * @example
 * { total: '17.741281', available: '17.741281' }
 */

/**
 * @typedef {Object} QutradeChain
 * @property {string} chain Raw network name
 * @property {boolean} deposit_can Deposits enabled
 * @property {string} deposit_min Minimum deposit
 * @property {string} deposit_fee Deposit fee
 * @property {number} deposit_confirmations Required confirmations
 * @property {boolean} withdraw_can Withdrawals enabled
 * @property {string} withdraw_min Minimum withdrawal
 * @property {string} withdraw_fee Withdrawal fee in the asset
 * @property {string} withdraw_fee_in_S11 Fee when paid in S11
 * @property {string} explorer Explorer URL
 * @property {string} fast_withdrawal_reserve Immediately available withdrawal reserve
 * @property {string} full_withdrawal_reserve Total withdrawal reserve
 * @property {string} type coin or token
 * @property {string} address_regex Exchange address validation pattern
 * @example
 * { chain: 'ETH', deposit_can: true, deposit_min: '1', deposit_fee: '0', deposit_confirmations: 12,
 *   withdraw_can: true, withdraw_min: '10', withdraw_fee: '3' }
 */

/**
 * @typedef {Object} QutradeCurrency
 * @property {string} name Full asset name
 * @property {boolean} deposits_can Any enabled deposit network
 * @property {boolean} withdrawals_can Any enabled withdrawal network
 * @property {string} site Project URL
 * @property {string} price_usd USD rate
 * @property {string} status active or exchange maintenance status
 * @property {QutradeChain[]} chains Supported networks
 * @example
 * { name: 'Tether', deposits_can: true, withdrawals_can: true, site: 'https://tether.to',
 *   price_usd: '1', status: 'active', chains: [] }
 */

/**
 * @typedef {{asks: [string,string][], bids: [string,string][], timestamp: number}} QutradeDepth
 * @example
 * { asks: [['0.06115', '6.592']], bids: [['0.06113', '6.592']], timestamp: 1794385426 }
 */

/**
 * Public trade from /trading_history (not private /trades_history)
 * @typedef {Object} QutradeTrade
 * @property {number|string} id Execution ID
 * @property {string} price Execution price
 * @property {string} base_amount Base quantity
 * @property {string} quote_amount Quote quantity
 * @property {string} volume_usd USD value
 * @property {QutradeSide} side Aggressor side
 * @property {number} timestamp Execution timestamp in seconds
 * @example
 * { id: 123, price: '0.06114', base_amount: '2', quote_amount: '0.12228', side: 'buy', timestamp: 1794374626 }
 */

/**
 * @typedef {Object} QutradeCandle
 * @property {string} open Opening price
 * @property {string} high Highest price
 * @property {string} low Lowest price
 * @property {string} close Closing price
 * @property {string} base_volume Executed base quantity
 * @property {string} quote_volume Executed quote quantity
 * @property {string} volume_usd USD volume
 * @property {number} timestamp Inclusive opening timestamp in seconds
 * @example
 * { open: '0.06114', high: '0.06115', low: '0.06113', close: '0.06114',
 *   base_volume: '2', quote_volume: '0.12228', volume_usd: '0.12', timestamp: 1794374100 }
 */

/**
 * Existing wallet address from /deposit_addresses; generation is not part of this endpoint
 * @typedef {Object} QutradeDepositAddress
 * @property {string} chain Raw network identifier
 * @property {string} address Deposit address for this network
 * @property {string|null} [memo] Destination memo or tag when returned
 * @example
 * { chain: 'TRX', address: 'TA1M9YPEBNFv1Ww62kXgYgAaqMr7HCWsws' }
 */

module.exports = {};
