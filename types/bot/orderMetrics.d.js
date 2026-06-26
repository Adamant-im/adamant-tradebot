/**
 * types/bot/orderMetrics.d.js
 *
 * Order-related metrics typedefs (post-trade / execution analytics).
 * All metrics derived from orders / fills should be defined here.
 */

/**
 * Side of an order or fill.
 * @typedef {'buy'|'sell'} OrderSide
 */

/**
 * Result of order fill verification.
 *
 * - confirmed = true  → order is considered filled (either confirmed by API or cannot be disproved)
 * - confirmed = false → order is explicitly NOT filled according to API
 * - undefined         → verification failed (API error), caller should retry later
 *
 * @typedef {Object} VerifyFillResult
 * @property {boolean} confirmed Whether the order is treated as filled
 * @property {string} [orderStatus] Status returned by exchange API ('filled' | 'new' | 'part_filled' | 'cancelled' | 'unknown')
 * @property {any} [orderDetails] Raw order details returned by exchange API
 */

/**
 * =================================
 * VWAP (order-level metrics)
 * =================================
 */

/**
 * Side-specific VWAP metrics calculated from a list of orders.
 *
 * IMPORTANT:
 *  - Orders MUST be pre-filtered by `side`
 *  - Mixing buy and sell orders breaks the economic meaning of VWAP
 *
 * @typedef {Object} VwapMetrics
 * @property {number} vwap Volume-Weighted Average Price for the provided order set (side-specific)
 * @property {number} totalOrders Total orders in the input array (including skipped)
 * @property {number} filledOrders Fully filled orders count
 * @property {number} partFilledOrders Partially filled orders count
 * @property {number} filledAndPartFilledOrders Sum of filled and partially filled orders
 * @property {number} skippedOrders Orders ignored in VWAP
 * @property {number} uncertainOrders Orders marked as "probablyFilled"
 * @property {number} totalAmount Sum of filled base amounts
 * @property {number} totalQuote Sum of filled quote amounts
 */

/**
 * =================================
 * Fill-level primitives
 * =================================
 */

/**
 * A single filled order fragment stored inside fillsDb (partlyFilledOrders / filledOrders).
 *
 * @typedef {Object} FillOrder
 * @property {string|number} orderId Exchange order id
 * @property {OrderSide} side Order side
 * @property {number} coin1AmountFilled Filled base amount
 * @property {number} coin2AmountFilled Filled quote amount
 * @property {number} price Price used for quote calculation
 * @property {string} pair Trading pair in classic format, e.g., BTC/USDT
 * @property {string} purpose Order purpose (e.g., 'liq')
 * @property {string} [subPurpose] Optional sub-purpose (e.g., 'depth')
 * @property {string} [subPurposeString] Human-readable sub-purpose, e.g., ' (spread support)'
 * @property {string} [subTypeString] Human-readable sub-purpose and sub-type, e.g., ' (ss, mirrored)'
 *
 * @property {boolean} [isChecked] Whether the fill has been applied to epoch stats (and a verification/check attempt via exchange API has been performed)
 * @property {boolean} [isFillConfirmed] Result of verification/check:
 *   - true  → order is confirmed as filled (verified by fillsEngine or previously set by a specific module; partly filled orders are considered as confirmed without verification)
 *   - false → order is confirmed as NOT filled
 *   - undefined → verification/check not performed yet or failed
 * @property {string} [orderStatus] Raw order status returned by exchange API (e.g., 'filled', 'new', 'part_filled', 'cancelled', 'unknown')
 * @property {number} [checkedAt] Timestamp (ms) when the verification/check attempt was made
 */

/**
 * =================================
 * fillsDb aggregation (pre-verification)
 * =================================
 */

/**
 * General data shape stored in fillsDb (plain document fields).
 *
 * @typedef {Object} FillsDbGeneralData
 * @property {string} purpose Purpose (e.g., 'liq', 'tw', etc.)
 * @property {number} date Timestamp (ms)
 * @property {string} exchange Exchange name
 * @property {string} pair Trading pair (e.g., `BTC/USDT`)
 * @property {boolean} isProcessed Whether this doc was fully processed
 * @property {string} callerModuleName Producer module name
 * @property {boolean} noCache Whether caching was disabled for this record
 * @property {boolean} apiIsPerpetual Whether API is perpetual
 * @property {boolean} apiIsSecondAccount Whether API is second account
 * @property {number} dbOrdersCount Orders in DB at capture time
 * @property {number} exchangeOrdersCount Orders on exchange at capture time
 */

/**
 * Aggregated fills collected during orderUtils.updateOrders() before verification/check.
 *
 * One object per `purpose`.
 *
 * @typedef {Object} FillsByPurpose
 * @property {FillOrder[]} partlyFilledOrders Orders partially filled (confirmed by open-order state)
 * @property {FillOrder[]} filledOrders Orders treated as fully filled (require verification/check)
 * @property {number} buyFilledAmount Total filled base amount for buy side
 * @property {number} sellFilledAmount Total filled base amount for sell side
 * @property {number} buyFilledQuote Total filled quote amount for buy side
 * @property {number} sellFilledQuote Total filled quote amount for sell side
 */

/**
 * Represents a single record inserted into fillsDb, including aggregated fills by purpose.
 *
 * @typedef {FillsDbGeneralData & FillsByPurpose & {
 *   _id: Object,
 *   save: () => Promise<any>
 * }} FillsDbRecord
 *
 */

/**
 * Dictionary of fills grouped by purpose.
 *
 * Example keys:
 *  - 'liq', 'ld', 'tw', 'ag', 'ob', 'cl', 'all'
 *
 * @typedef {Object.<string, FillsByPurpose>} FillsByPurposeMap
 */

/**
 * Accumulator for one side (buy or sell), stored persistently.
 * VWAP is derived as sumQuote / sumAmount.
 *
 * @typedef {Object} VwapSideAccumulator
 * @property {number} sumAmount Sum of filled base amounts
 * @property {number} sumQuote Sum of filled quote amounts
 * @property {number} filledCount Fully filled orders count
 * @property {number} partlyFilledCount Partially filled orders count
 * @property {number} notFoundCount Orders treated as filled due to "not found" state
 * @property {number} rejectedCount Orders rejected after verification
 */

/**
 * =================================
 * Filled statistics (persistent)
 * =================================
 */

/**
 * Persistent cumulative fill statistics since a reset moment.
 * Stored in filledStatsDb to survive restarts.
 * One document = one accumulation epoch: exchange + pair + purpose + startTs.
 *
 * @typedef {Object} FilledStats
 * @property {string} _id Unique identifier (e.g., `${exchange}:${pair}:${purpose}[:${subPurpose}]:${startTs}`)
 * @property {string} exchange Exchange name
 * @property {string} pair Trading pair (e.g., BTC/USDT)
 * @property {string} purpose Order purpose (liq, tw, ag, ob, cl, etc.)
 * @property {number} startTs Epoch start timestamp (reset moment)
 * @property {number} updatedAt Last update timestamp
 * @property {VwapSideAccumulator} buy Accumulated buy-side statistics
 * @property {VwapSideAccumulator} sell Accumulated sell-side statistics
 */

/**
 * Filled stats DB record (model instance).
 * This is NOT a pure data object — it has .save(), .update(), etc.
 *
 * @typedef {FilledStats & {
 *   _id: Object,
 *   save: () => Promise<any>
 * }} FilledStatsRecord
 */

/**
 * =================================
 * fillsEngine results
 * =================================
 */

/**
 * @typedef {Object} FillsEngineKey
 * @property {string} exchange Exchange code (e.g., `binance`)
 * @property {string} pair Trading pair (e.g., `BTC/USDT`)
 * @property {string} purpose Order purpose to process (e.g., `liq`)
 * @property {number} startTs Epoch start timestamp (ms). All fills with `date > startTs` belong to this epoch.
 * @property {string} [subPurpose] Optional sub-bucket tag:
 *   - In `filledStatsDb`: isolates the bucket keyed as `exchange:pair:purpose:subPurpose:startTs`
 *     so that, for example, `'ss'` and `'depth'` stats never mix.
 *   - In `processFills` (read from each processed order, not from params): every order whose own
 *     `subPurpose` is set is accumulated into both the general bucket and its matching sub-bucket.
 *   - In `getStats`: selects the sub-bucket to read from when supplied.
 */

/**
 * @typedef {FillsEngineKey & {
 *   api: any,
 *   filterOrder?: (order: FillOrder) => boolean
 * }} FillsEngineProcessParams
 *
 * `filterOrder` is an optional independent filter applied during order processing.
 */

/**
 * Result of getStats(): cumulative filled statistics + derived VWAPs
 * for a specific epoch (exchange + pair + purpose + startTs).
 *
 * @typedef {Object} FillsEngineStatsResult
 * @property {string} statsId Stats record identifier (e.g. `${exchange}:${pair}:${purpose}[:${subPurpose}]:${startTs}`)
 * @property {string} pair Trading pair (e.g., `BTC/USDT`)
 * @property {number} boughtVwap Current cumulative buy-side VWAP
 * @property {number} soldVwap Current cumulative sell-side VWAP
 * @property {VwapSideAccumulator} buy Accumulated buy-side statistics
 * @property {VwapSideAccumulator} sell Accumulated sell-side statistics
 * @property {number} updatedAt Timestamp (ms) of the last stats update, or 0 if stats record does not exist yet
 *
 * @property {boolean} hasBothSides True when both buy and sell have non-zero filled amount
 * @property {number} vwapSpread soldVwap - boughtVwap (0 if hasBothSides=false)
 * @property {number} vwapSpreadPercent (vwapSpread / boughtVwap) * 100 (0 if hasBothSides=false)
 *
 * @property {number} pnlQuoteCashflow SellQuote - BuyQuote (quote currency, coin2)
 * @property {number} pnlUsdCashflow Cashflow PnL converted to USD
 * @property {number} inventoryBase BuyAmount - SellAmount (base currency, coin1)
 * @property {number} [markPrice] coin1 price in coin2 (if available)
 * @property {number} [pnlQuoteMtm] Mark-to-market PnL: pnlQuoteCashflow + inventoryBase * markPrice (if markPrice available)
 * @property {number} [pnlUsdMtm] Mark-to-market PnL converted to USD (if pnlQuoteMtm available)
 */

/**
 * Result returned by fillsEngine.processFills().
 *
 * Combines:
 *  - per-run counters (THIS execution only)
 *  - cumulative epoch statistics (same as getStats())
 *
 * @typedef {FillsEngineStatsResult & {
 *   newFills: number,
 *   processedFills: number,
 *   confirmedFills: number,
 *   rejectedFills: number
 * }} FillsEngineProcessResult
 */

/**
 * =================================
 * SS VWAP (in-module state)
 * =================================
 */

/**
 * Accumulated VWAP for one side of SS orders.
 * @typedef {Object} SsVwapSide
 * @property {number} vwap Volume-weighted average price (0 if no fills yet)
 * @property {number} sumAmount Cumulative base amount filled
 * @property {number} sumQuote Cumulative quote amount filled
 */

/**
 * Per-side SS VWAP state. Persisted to systemDb as 'ssVwap'. Reset on epoch change.
 * @typedef {Object} SsVwapState
 * @property {SsVwapSide} buy Buy-side fills VWAP (upper bound for new buy SS orders)
 * @property {SsVwapSide} sell Sell-side fills VWAP (lower bound for new sell SS orders)
 */

module.exports = {};
