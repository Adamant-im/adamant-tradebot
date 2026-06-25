/**
 * @fileoverview Types for Trader price request result.
 * Used by mm_trader (and related modules) to pass full context about the chosen trade price
 * and the decision whether to execute inside the spread or in the order book.
 *
 * @module types/bot/priceReq.d
 */

/**
 * Trading action decided by the trader logic.
 *
 * `doNotExecute` is used when the trader explicitly decides to skip the step.
 * In that case the result usually also carries:
 *   - price: false
 *   - message: reason
 *
 * @typedef {'doNotExecute'|'executeInSpread'|'executeInOrderBook'} MmCurrentAction
 */

/**
 * One expected executeInOrderBook match level split into own and third-party parts.
 *
 * Trader consumes this plan sequentially when it needs to attribute a partial
 * exchange execution only to the external part of the book.
 *
 * @typedef {Object} TraderExpectedMatchLevel
 * @property {number} price Expected execution price for this visible level
 * @property {number} ownMatchedAmount Expected self-matched base amount at this level
 * @property {number} ownMatchedQuote Expected self-matched quote at this level
 * @property {number} thirdPartyMatchedAmount Expected third-party matched base amount at this level
 * @property {number} thirdPartyMatchedQuote Expected third-party matched quote at this level
 */

/**
 * Result of a "price request" for mm_trader.
 *
 * @typedef {Object} TraderPriceRequest
 * @property {number|false} price Price to trade; false means "do not execute"
 * @property {string} [message] Error or skip reason (usually present when price=false)
 * @property {string} [skipReason] Machine-readable skip reason for simulations and diagnostics
 * @property {'buy'|'sell'} [side] Side selected for the price request
 * @property {number} [coin1Amount] Updated amount to trade (typically for 'executeInOrderBook')
 * @property {MmCurrentAction} [mmCurrentAction] Selected action. For skipped steps this may be `doNotExecute`.
 * @property {number} [bidPrice] Left edge of the active allowed price corridor
 * @property {number} [askPrice] Right edge of the active allowed price corridor
 * @property {number} [spread] Absolute spread width used for the decision
 * @property {number} [spreadUnits] Spread width expressed in precision units
 * @property {number} [precision] Quote-price precision step
 * @property {object} [diagnostics] Decision diagnostics propagated to simulations/reports
 * @property {boolean} [isClosingTrade] Whether Trader marked this step as an explicit Nice Chart candle-closing trade
 * @property {boolean} [niceChartAllowsExecuteInOrderBook] Whether Nice Chart still allows order-book execution for this corridor
 * @property {boolean} [isExecutedWithNiceChart] Whether this step was explicitly accepted by Nice Chart
 * @property {{ isValid?: boolean }} [niceChartRange] Nice Chart range payload attached to the step
 * @property {object} [closeCorrection] Last Nice Chart close-correction metadata attached to the corridor
 *
 * Extra fields for 'executeInOrderBook':
 * @property {number} [startPrice] Best price snapshot before placing the order
 * @property {number} [expectedPrice] Expected price after placing the order (or reference price used for spread calc)
 * @property {number} [newSpread] Absolute spread value in quote currency units
 * @property {number} [newSpreadNumber] Spread in "price units" (based on pair precision)
 * @property {number} [newSpreadPercent] Spread in percent of expectedPrice
 * @property {number} [expectedOwnMatchAmount] Expected self-match amount on the visible target side of the book
 * @property {number} [expectedOwnMatchQuote] Expected self-match quote on the visible target side of the book
 * @property {number} [expectedThirdPartyAmount] Expected third-party matched amount on the visible target side of the book
 * @property {number} [expectedThirdPartyQuote] Expected third-party matched quote on the visible target side of the book
 * @property {TraderExpectedMatchLevel[]} [expectedMatchPlan] Expected sequential own/third-party execution path across visible levels
 * @property {boolean} [matchingThirdPartyAllowed] Whether Nice Chart allowed matching third-party liquidity for this order-book step
 * @property {boolean} [matchingThirdPartyRestricted] Whether Nice Chart restricted third-party matching for this order-book step
 * @property {string} [matchingThirdPartyRestriction] Machine-readable Nice Chart restriction reason for third-party matching
 * @property {number} [amountUntilThirdParty] Base amount available before the first visible third-party level starts
 * @property {boolean} [topStartsWithOurOrders] Whether the visible target side starts with our own resting orders
 * @property {boolean} [topStartsWithThirdPartyOrders] Whether the visible target side starts with third-party orders
 * @property {boolean} [isOrderFilled] Whether executeInOrderBook planning expects the taker order to fully fill after matching visible book liquidity; when false, executeMmOrder treats new/part_filled as planned (SBW counters are unaffected)
 */

/**
 * Promise result type returned by the trader's price-calculation routine.
 *
 * @typedef {Promise<TraderPriceRequest>} TraderPriceRequestPromise
 */

module.exports = {};
