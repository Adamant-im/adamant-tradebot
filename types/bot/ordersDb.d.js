/**
 * types/bot/ordersDb.d.js
 *
 * Type definitions for records stored in the ordersDb MongoDB collection.
 * Used by all market-making modules that place orders.
 */

/**
 * Order purpose identifier.
 * @typedef {'t'|'ob'|'obs'|'liq'|'sm'|'ag'|'cl'|'pw'|'pm'|'qh'|'ld'|'tw'|'be'|'fs'|'tb'|'man'} OrderPurpose
 */

/**
 * Ladder state machine values.
 * @typedef {undefined|'Not placed'|'Open'|'Filled'|'Partly filled'|'Cancelled'|'Missed'|'To be removed'|'Removed'} LadderState
 */

/**
 * Plain data shape of an order stored in ordersDb.
 * All fields except core identity/classification are optional to accommodate the different
 * subsets of fields each module uses when creating orders.
 *
 * @typedef {Object} BotOrder
 *
 * @property {string|number} _id Exchange-assigned order id
 * @property {Object} [db] I don't remember if it even exists somewhere, but trade/mm_ladder.js deletes it
 * @property {number} date Order creation timestamp (ms)
 * @property {OrderPurpose} purpose Order purpose identifier
 * @property {'buy'|'sell'} side Order side
 * @property {string} exchange Exchange name (e.g., `'binance'`)
 * @property {string} pair Trading pair (e.g., `'ADM/USDT'`)
 * @property {string} coin1 Base asset (e.g., `'ADM'`)
 * @property {string} coin2 Quote asset (e.g., `'USDT'`)
 * @property {number} price Order limit price
 * @property {number} coin1Amount Placed base amount
 * @property {number} coin2Amount Placed (or estimated) quote amount
 *
 * @property {number|undefined} [coin1AmountFilled] Filled base amount; undefined until a fill is detected
 * @property {number|undefined} [coin2AmountFilled] Filled quote amount; undefined until a fill is detected
 * @property {number} [coin1AmountLeft] Remaining base amount
 * @property {number} [coin2AmountLeft] Remaining quote amount
 *
 * @property {0|1} [LimitOrMarket] 1 for limit order, 0 for market order
 *
 * @property {boolean|undefined} [isProcessed] True when the order lifecycle is complete (filled, cancelled, or disappeared)
 * @property {boolean|undefined} [isExecuted] True when the order has any filled amount
 * @property {boolean|undefined} [isCancelled] True when the bot explicitly cancelled the order
 * @property {boolean|undefined} [isClosed] True when the order is no longer active
 * @property {boolean|undefined} [probablyFilled] True when the bot could not verify the order state and treats it as likely filled
 * @property {boolean|undefined} [isNotFound] True when the order disappeared from the exchange open orders list
 * @property {boolean|undefined} [isExpired] True when the order lifetime exceeded dateTill
 * @property {boolean|undefined} [isSecondAccountOrder] True when the order was placed on the second exchange account
 * @property {boolean|undefined} [isVirtual] True for ladder draft orders that exist only in DB, not yet on the exchange
 *
 * @property {number} [dateTill] Expiry timestamp (ms); order is cancelled when Date.now() > dateTill
 * @property {'buy'|'sell'} [targetSide] Intended market side (may differ from `side` for maker/taker pairs)
 * @property {string} [apikey] API key used (stored by ladder for multi-instance reference)
 *
 * @property {number} [priceFilled] Actual executed price (may differ from `price` for market orders)
 * @property {boolean} [priceCorrected] True when price was adjusted by Price Watcher or VWAP range
 * @property {number} [prevPrice] Reference price at placement (used by Quote Hunter for dump-% tracking)
 *
 * @property {string} [subPurpose] Sub-bucket tag within a purpose (e.g., `'depth'`, `'ss'`)
 * @property {string} [subPurposeString] Human-readable sub-purpose label (e.g., `' (spread support)'`)
 * @property {string} [subType] Sub-type tag (e.g., `'mirrored'`)
 * @property {string} [subTypeString] Human-readable sub-type label (e.g., `' (ss, mirrored)'`)
 * @property {string} [mmOrderAction] Trader action hint: `'executeInSpread'` or `'executeInOrderBook'`
 * @property {boolean} [isExecutedWithNiceChart] True when Trader accepted Nice Chart corridor for the step
 * @property {{ isValid?: boolean }} [niceChartRange] Nice Chart range marker; `isValid=true` means Trader used a valid Nice Chart corridor for the step
 *
 * @property {string|null} [crossOrderId] Paired order id in two-account wash-trade scenarios
 * @property {'first'|''} [orderMakerAccount] Which account placed the maker side (`'first'` or empty)
 * @property {'second'|''} [orderTakerAccount] Which account placed the taker side
 *
 * @property {number} [coin1AmountFull] Full base amount before percentage reduction (Quote Hunter)
 * @property {number} [coin2AmountFull] Full quote amount before percentage reduction (Quote Hunter)
 *
 * @property {number} [qhOrdersMatched] Number of bid levels consumed by the qh taker order
 * @property {number} [qhCoin1Amount] Accumulated base amount across matched bid levels
 * @property {number} [qhCoin2Amount] Accumulated quote amount across matched bid levels
 * @property {number} [qhPriceDumpPercent] % price drop from best bid to the target price
 * @property {number} [qhTakerKoef] Profitability coefficient for the taker order
 *
 * @property {string} [twapId] TWAP session identifier
 * @property {number} [twapIteration] TWAP slice iteration number (1-based)
 * @property {string|undefined} [twapSkippedReason] Reason why this TWAP slice was skipped, if any
 *
 * @property {number} [moduleIndex] Module instance index for multi-instance modules (e.g., ladder: 1 or 2)
 * @property {number} [ladderIndex] Position of this order within the ladder on its side
 * @property {string|number} [ladderPreviousOrderId] DB id of the draft order this order replaces
 * @property {string|number} [ladderReplacedByOrderId] DB id of the new order that replaced this order
 * @property {number} [ladderPreviousIndex] Index before the ladder shifted
 * @property {LadderState} [ladderState] Current ladder state machine value
 * @property {LadderState} [ladderPreviousState] Previous ladder state machine value used for logging transitions
 * @property {LadderState} [ladderBeforeFilledState] State to restore if a "filled" detection turns out to be wrong
 * @property {string} [ladderNotPlacedReason] Human-readable reason why the order was not placed (e.g., `'Not enough balances'`)
 * @property {string} [ladderPreviousNotPlacedReason] Previous not-placed reason used for logging transitions
 * @property {number} [ladderUpdateDate] Timestamp (ms) of the last ladder state update
 * @property {number} [ladderFlaggedFilledTs] Timestamp (ms) when the order was first flagged as filled
 *
 * @property {number} [gainIndex] Amount gain tier index (ladder gain system)
 * @property {number} [gainInCoin1] Extra base amount added on top of the standard ladder order amount
 * @property {number} [gainInCoin2] Extra quote amount added on top of the standard ladder order amount
 * @property {number} [amountAdjPercent] Amount adjustment percentage applied to this ladder slot
 * @property {number} [aaPercent] Balance-delta-driven adjustment percentage
 * @property {string} [gainString] Human-readable gain/adjustment summary (e.g., `' with +0.5 ADM gain'`)
 */

/**
 * ordersDb model instance — a `BotOrder` record that also carries the ORM `.save()` / `.update()` methods.
 * This is NOT a pure data object.
 *
 * @typedef {BotOrder & {
 *   save: () => Promise<any>,
 *   update: (obj: Partial<BotOrder>, shouldSave?: boolean) => Promise<any>
 * }} BotOrderDbRecord
 */

module.exports = {};
