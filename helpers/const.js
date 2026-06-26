'use strict';

/**
 * Global bot constants: time intervals, precision, MM policies, regexes, and time-unit helpers.
 *
 * @module helpers/const
 */

/**
 * @typedef {import('types/bot/helpers.d.js').MmPolicy} MmPolicy
 * @typedef {import('types/bot/helpers.d.js').LadderState} LadderState
 * @typedef {import('types/bot/helpers.d.js').TimeUnitKey} TimeUnitKey
 */

module.exports = {
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  SAT: 100000000, // 1 ADM = 100000000
  ADM_EXPLORER_URL: 'https://explorer.adamant.im',
  EPOCH: Date.UTC(2017, 8, 2, 17, 0, 0, 0), // ADAMANT epoch time
  ADM_TX_CHECKER_INTERVAL: 4 * 1000, // Poll for new ADM txs every 4 seconds; the bot also receives txs instantly via socket
  UPDATE_CRYPTO_RATES_INTERVAL: 60 * 1000, // Update crypto rates every minute
  PRECISION_DECIMALS: 8, // Decimal places for crypto amount conversion, e.g. 9.12345678 ETH
  PRINT_DECIMALS: 8, // Decimal places for pretty-printed amounts, e.g. 9.12345678 ETH
  DEFAULT_WITHDRAWAL_PRECISION: 8, // Fallback when exchange currency info does not provide coin decimals
  MAX_ADM_MESSAGE_LENGTH: 10000,
  MAX_TELEGRAM_MESSAGE_LENGTH: 4095,
  EXECUTE_IN_ORDER_BOOK_MAX_PRICE_CHANGE_PERCENT: 0.15, // In-orderbook trading: do not change price by more than 0.15%
  EXECUTE_IN_ORDER_BOOK_MAX_SPREAD_PERCENT: 0.15 / 1.25, // In-orderbook trading: maintain spread percent
  LIQUIDITY_SS_MAX_SPREAD_PERCENT: 0.3, // Liquidity spread-support orders: maintain spread percent
  AVERAGE_SPREAD_DEVIATION: 0.15,
  DEFAULT_ORDERBOOK_ORDERS_COUNT: 15,
  DEFAULT_PW_DEVIATION_PERCENT_FOR_DEPTH_PM: 1,
  SOCKET_DATA_VALIDITY_MS: 2000,
  SOCKET_DATA_MAX_HEARTBEAT_INTERVAL_MS: 25000,
  /** @type {MmPolicy[]} */
  MM_POLICIES: ['optimal', 'spread', 'orderbook', 'depth', 'wash'],
  /** @type {MmPolicy[]} */
  MM_POLICIES_VOLUME: ['optimal', 'spread', 'orderbook', 'wash'],
  /** @type {MmPolicy[]} */
  MM_POLICIES_REGULAR: ['optimal', 'spread', 'orderbook', 'depth'],
  /** @type {MmPolicy[]} */
  MM_POLICIES_REGULAR_VOLUME: ['optimal', 'spread', 'orderbook'],
  /** @type {MmPolicy[]} */
  MM_POLICIES_IN_SPREAD_TRADING: ['optimal', 'spread', 'wash'],
  /** @type {MmPolicy[]} */
  MM_POLICIES_IN_ORDERBOOK_TRADING: ['optimal', 'orderbook', 'depth'],
  /** @type {LadderState[]} */
  LADDER_STATES: ['Not placed', 'Open', 'Filled', 'Partly filled', 'Cancelled', 'Missed', 'To be removed', 'Removed'],
  /** @type {LadderState[]} */
  LADDER_OPENED_STATES: ['Open', 'Partly filled'],
  /** @type {(LadderState | undefined)[]} */
  LADDER_PREVIOUS_FILLED_ORDER_STATES: [undefined, 'Not placed', 'Filled', 'Cancelled', 'To be removed', 'Removed'],
  /** @type {LadderState[]} */
  LADDER_FOR_REMOVING_STATES: ['Missed', 'To be removed'],
  REGEXP_WHOLE_NUMBER: /^[0-9]+$/,
  REGEXP_UUID: /^[a-f\d]{4}(?:[a-f\d]{4}-){4}[a-f\d]{12}$/,
  DEFAULT_API_PROCESSING_DELAY_MS: 100,
  DEFAULT_MIN_ORDER_AMOUNT_USD: 0.1,
  DEFAULT_MIN_ORDER_AMOUNT_UPPER_BOUND_USD: 2,
  OVER_LIQUIDITY_SPREAD_PERCENT: 0.7,
  PEM_REGEXP: /-----BEGIN (PUBLIC|PRIVATE) KEY-----[\s\S]+?-----END (PUBLIC|PRIVATE) KEY-----/,
  REST_DATA_CACHE_MS: 1000, // Cache duration (ms) for REST data: open orders, order book, and balances
  REGEXP_ADM_ADDRESS: /^U([0-9]{6,21})$/,
  REGEXP_TIME: /(ms|msec|msecs|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hour|hours?|d|day|days?|w|week|weeks?|mon|month|months?|y|yr|yrs|year|years?)/i,
  COINS_BY_PRIORITY: ['BTC', 'USDT', 'ETH', 'XRP', 'BNB', 'SOL', 'USDC', 'TRX', 'DOGE', 'ADA', 'LINK', 'SUI', 'LTC', 'ZEC', 'DAI', 'UNI', 'POL', 'HUI'],
  PRICE_CHANGE_SIGNIFICANCE_PERCENT: 5, // 5% price change is considered significant for showing 🟢 or 🔴 in balance change output
  BALANCE_CHANGE_SIGNIFICANCE_PERCENT: 0.1, // 0.1% balance change is considered significant for showing reference balance changes
  ORDER_PRICE_EXTREME_DEVIATION_PERCENT: 1000, // Require confirmation when order price differs from market by 10x (1000%) or more
  NICE_CHART_BASE_TIMEFRAME: /** @type {'5m'} */ ('5m'),
  NICE_CHART_BASE_TIMEFRAME_MS: 5 * 60 * 1000,
  NICE_CHART_15M_TIMEFRAME_MS: 15 * 60 * 1000,
  NICE_CHART_CLOSE_TRADE_WINDOW_MIN_MS: 7 * 1000,
  NICE_CHART_CLOSE_TRADE_WINDOW_MAX_MS: 15 * 1000,
};

//
// Time helpers: unit aliases and divisors (ms)
//

/**
 * Maps supported time-unit aliases to normalized unit keys.
 * Used with `TIME_DIVISORS` to parse duration strings like `5m` or `2 hours`.
 *
 * @type {Record<string, TimeUnitKey>}
 */
module.exports.TIME_UNITS = {
  // milliseconds
  ms: 'msecs',
  msec: 'msecs',
  msecs: 'msecs',
  millisecond: 'msecs',
  milliseconds: 'msecs',

  // seconds
  s: 'secs',
  sec: 'secs',
  secs: 'secs',
  second: 'secs',
  seconds: 'secs',

  // minutes
  m: 'mins',
  min: 'mins',
  mins: 'mins',
  minute: 'mins',
  minutes: 'mins',

  // hours
  h: 'hours',
  hr: 'hours',
  hrs: 'hours',
  hour: 'hours',
  hours: 'hours',

  // days
  d: 'days',
  day: 'days',
  days: 'days',

  // weeks
  w: 'weeks',
  week: 'weeks',
  weeks: 'weeks',

  // months (≈30.44 days)
  mon: 'months',
  month: 'months',
  months: 'months',

  // years (≈365.25 days)
  y: 'years',
  yr: 'years',
  yrs: 'years',
  year: 'years',
  years: 'years',
};

/**
 * Divisors to convert a numeric value to milliseconds: `ms = num * TIME_DIVISORS[unit]`.
 *
 * @type {Record<TimeUnitKey, number>}
 */
module.exports.TIME_DIVISORS = {
  msecs: 1,
  secs: 1000,
  mins: 60000,
  hours: 3600000,
  days: 86400000,
  weeks: 604800000,
  months: 2629800000, // Approximate (30.44 days)
  years: 31557600000, // Approximate (365.25 days)
};
