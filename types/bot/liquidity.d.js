/**
 * types/bot/liquidity.d.js
 */

/**
 * Allowed keys for liquidity buckets.
 *
 * - `percentSpreadSupport` — max spread for Spread Support logic (based on config / constants)
 * - `percent2`              — ±2% around the average price
 * - `percent5`              — ±5% around the average price
 * - `percent10`             — ±10% around the average price
 * - `percent50`             — ±50% around the average price
 * - `percentCustom`         — ±customSpreadPercent (runtime-defined)
 * - `full`                  — full book (spreadPercent = 0 means "no limit")
 *
 * @typedef {'percentSpreadSupport'
 * | 'percent2'
 * | 'percent5'
 * | 'percent10'
 * | 'percent50'
 * | 'percentCustom'
 * | 'full'} LiquidityKey
 */

/**
 * Aggregated liquidity metrics for a specific spread bucket.
 * All amounts are in base asset units, and "Quote" fields are in quote asset units.
 *
 * @typedef {Object} LiquidityLevel
 * @property {number} spreadPercent      - Spread percent for this bucket (0 = full book)
 * @property {number} bidsCount          - Number of bid orders inside this bucket
 * @property {number} amountBids         - Sum of bid amounts (base asset)
 * @property {number} amountBidsQuote    - Sum of bid notional values (amount * price, quote asset)
 * @property {number} asksCount          - Number of ask orders inside this bucket
 * @property {number} amountAsks         - Sum of ask amounts (base asset)
 * @property {number} amountAsksQuote    - Sum of ask notional values (amount * price, quote asset)
 * @property {number} totalCount         - Total number of orders inside this bucket (bids + asks)
 * @property {number} amountTotal        - Total amount (base asset) for all orders in the bucket
 * @property {number} amountTotalQuote   - Total notional value (quote asset) for all orders in the bucket
 * @property {number} lowPrice           - Lower price boundary for this spread bucket
 * @property {number} highPrice          - Upper price boundary for this spread bucket
 * @property {number} spread             - Absolute spread in price units (highPrice - lowPrice)
 */

/**
 * Map of liquidity buckets by key.
 *
 * Example keys:
 * - `percentSpreadSupport`
 * - `percent2`
 * - `percent5`
 * - `percent10`
 * - `percent50`
 * - `percentCustom`
 * - `full`
 *
 * @typedef {Record<LiquidityKey, LiquidityLevel>} LiquidityMap
 */

/**
 * Safe Liquidity limits: bid/ask capacity, VWAP bounds, and epoch fill accounting.
 * Created via `mm_liquidity_provider.createDefaultLiqLimits()`.
 * Stored in systemDb as `'liqLimits'` and updated each iteration by `mm_liquidity_safe`.
 *
 * @typedef {Object} LiqLimits
 * @property {number} bidLimit - Max quote amount available for buy (depth) liq-orders in the current epoch
 * @property {number} askLimit - Max base amount available for sell (depth) liq-orders in the current epoch
 * @property {number} bidLimitPercent - bidLimit as a percentage of mm_liquidityBuyQuoteAmount
 * @property {number} askLimitPercent - askLimit as a percentage of mm_liquiditySellAmount
 * @property {number} totalBidFilledAmount - Cumulative base amount bought since epoch start
 * @property {number} totalAskFilledAmount - Cumulative base amount sold since epoch start
 * @property {number} totalBidFilledQuote - Cumulative quote amount spent on buys since epoch start
 * @property {number} totalAskFilledQuote - Cumulative quote amount received from sells since epoch start
 * @property {number} boughtVwap - Volume-weighted avg buy price since epoch start (upper VWAP bound for sell-orders)
 * @property {number} soldVwap - Volume-weighted avg sell price since epoch start (lower VWAP bound for buy-orders)
 */

/**
 * Module-level SS VWAP cache for mm_liquidity_ss.js.
 * Updated once per iteration by updateSsVwap(); read synchronously by getSsPrice().
 *
 * @typedef {Object} SsVwapCache
 * @property {number} boughtVwap Cumulative buy-side VWAP since epoch start (0 = no data yet)
 * @property {number} soldVwap Cumulative sell-side VWAP since epoch start (0 = no data yet)
 */

module.exports = {};
