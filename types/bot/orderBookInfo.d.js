/**
 * types/bot/orderBookInfo.d.js
 */

/**
 * Reuse existing types from:
 * @typedef {import('types/depth.d').DepthResult} DepthResult
 * @typedef {import('types/bot/liquidity.d.js').LiquidityMap} LiquidityMap
 * @typedef {import('types/bot/liquidity.d.js').LiquidityLevel} LiquidityLevel
 * @typedef {import('types/bot/liquidity.d.js').LiquidityKey} LiquidityKey
 */

/**
 * One cumulative entry (running totals) for a side (bid/ask) of the book
 * @typedef {Object} CumulativeEntry
 * @property {number} amount Cumulative base amount up to this level
 * @property {number} quote Cumulative quote notional up to this level
 */

/**
 * Cumulative totals for bids and asks
 * @typedef {Object} Cumulative
 * @property {CumulativeEntry[]} bids
 * @property {CumulativeEntry[]} asks
 */

/**
 * Price interval between neighboring bids/asks
 * @typedef {Object} PriceInterval
 * @property {number} previousPrice Price of the previous bid/ask
 * @property {number} priceInterval Distance between prices (nextPrice - previousPrice)
 * @property {number} nextPrice Price of the next bid/ask
 */

/**
 * Side for target price logic.
 * Can be 'inSpread' when the target price is between highest bid and lowest ask.
 * @typedef {'buy' | 'sell' | 'inSpread'} SideTargetPrice
 */

/**
 * Quote Hunter row structure used to pick optimal bid
 * @typedef {Object} QuoteHunterRow
 * @property {number} index
 * @property {number} bidPrice
 * @property {number} bidAmount
 * @property {number} bidAmountAcc
 * @property {number} bidQuote
 * @property {number} bidQuoteAcc
 * @property {number} bidPriceDumpPercent
 * @property {number} bidTakerKoef
 */

/**
 * Per-level order-book breakdown used by Trader/Nice Chart to separate own and third-party liquidity.
 * @typedef {Object} QuoteHunterBookSideRow
 * @property {number} index
 * @property {number} price
 * @property {number} amount
 * @property {number} amountAcc
 * @property {number} quote
 * @property {number} quoteAcc
 * @property {number} ownAmount
 * @property {number} ownAmountAcc
 * @property {number} ownQuote
 * @property {number} ownQuoteAcc
 * @property {number} thirdPartyAmount
 * @property {number} thirdPartyAmountAcc
 * @property {number} thirdPartyQuote
 * @property {number} thirdPartyQuoteAcc
 * @property {boolean} startsWithOurOrders
 * @property {boolean} startsWithThirdPartyOrders
 * @property {'bids' | 'asks'} side
 */

/**
 * Quote Hunter own-vs-third-party breakdown for both sides of the book.
 * @typedef {Object} QuoteHunterTable
 * @property {QuoteHunterBookSideRow[]} bids
 * @property {QuoteHunterBookSideRow[]} asks
 */

/**
 * One visible price level consumed by a proposed taker order.
 *
 * @typedef {Object} QuoteHunterMatchLevel
 * @property {number} price Visible order-book price
 * @property {number} ownMatchedAmount Base amount matched against the bot's own orders at this level
 * @property {number} ownMatchedQuote Quote amount matched against the bot's own orders at this level
 * @property {number} thirdPartyMatchedAmount Base amount matched against third-party orders at this level
 * @property {number} thirdPartyMatchedQuote Quote amount matched against third-party orders at this level
 */

/**
 * Sequential own-vs-third-party match summary for a proposed taker amount.
 *
 * @typedef {Object} QuoteHunterMatchSummary
 * @property {number} requestedAmount Sanitized requested base amount
 * @property {number} matchedAmount Visible base amount covered by the returned levels
 * @property {number} ownMatchedAmount Total base amount matched against the bot's own orders
 * @property {number} ownMatchedQuote Total quote amount matched against the bot's own orders
 * @property {number} thirdPartyMatchedAmount Total base amount matched against third-party orders
 * @property {number} thirdPartyMatchedQuote Total quote amount matched against third-party orders
 * @property {QuoteHunterMatchLevel[]} matchedLevels Sequential visible execution plan
 * @property {number} amountUntilThirdParty Base amount executable before the first third-party slice
 * @property {boolean} topStartsWithOurOrders Whether the first visible row contains the bot's own orders
 * @property {boolean} topStartsWithThirdPartyOrders Whether the first visible row starts exclusively with third-party orders
 */

/**
 * Result of utils.getOrderBookInfo()
 *
 * @typedef {Object} OrderBookInfo
 * @property {number} bids Number of bids in the order book
 * @property {number} asks Number of asks in the order book
 *
 * @property {number} highestBid Highest bid price
 * @property {number} lowestAsk Lowest ask price
 * @property {number} highestBidAggregatedAmount Total amount at the highest bid price
 * @property {number} highestBidAggregatedQuote Total quote at the highest bid price
 * @property {number} lowestAskAggregatedAmount Total amount at the lowest ask price
 * @property {number} lowestAskAggregatedQuote Total quote at the lowest ask price
 *
 * @property {number} spread Absolute spread (lowestAsk - highestBid)
 * @property {number} spreadPercent Spread percent relative to average price
 * @property {number} averagePrice Average price between highest bid and lowest ask
 *
 * @property {number} downtrendAveragePrice Average price shifted towards bid (used as a scenario by Liquidity)
 * @property {number} uptrendAveragePrice Average price shifted towards ask
 * @property {number} middleAveragePrice Average price shifted around the mid
 *
 * @property {Cumulative} cumulative Cumulative totals for bids/asks (used for statistics)
 *
 * @property {number} smartBid Smart bid price (amount-aware) (used by Price watcher)
 * @property {number} smartAsk Smart ask price (amount-aware)
 * @property {number} cleanBid Clean bid price (cheater-filtered) (used by Cleaner)
 * @property {number} cleanAsk Clean ask price (cheater-filtered)
 *
 * @property {LiquidityMap} liquidity Liquidity buckets computed for multiple ±spread% ranges
 *
 * @property {SideTargetPrice} [sideTargetPrice] Side inferred for target price logic
 *
 * @property {number} [amountTargetPrice] Amount (base coin) needed to reach target price (used by many modules)
 * @property {number} [amountTargetPriceQuote] Notional (quote coin) needed to reach target price
 * @property {number} [targetPriceOrdersCount] Orders count counted for target price
 *
 * @property {number} [targetPriceExcluded] Price level treated as excluded (last excluded level)
 * @property {number} [amountTargetPriceExcluded] Amount excluded while reaching target price
 * @property {number} [amountTargetPriceQuoteExcluded] Notional excluded while reaching target price
 * @property {number} [targetPriceOrdersCountExcluded] Orders count excluded while reaching target price
 *
 * @property {PriceInterval[]} bidIntervals Neighboring bid intervals (unique price levels) (used by Antigap)
 * @property {PriceInterval[]} askIntervals Neighboring ask intervals (unique price levels)
 *
 * @property {number | false} avgBidInterval Avg bid interval (first N levels to understand typical spacing between levels near the top)
 * @property {number | false} avgAskInterval Avg ask interval (first N levels)
 * @property {number | false} rmsBidInterval RMS bid interval (first N levels)
 * @property {number | false} rmsAskInterval RMS ask interval (first N levels)
 * @property {number | false} medianBidInterval Median bid interval (first N levels)
 * @property {number | false} medianAskInterval Median ask interval (first N levels)
 *
 * @property {number} placedAmountCountBid Levels required to sell placedAmount into bids (used by Trader when 'executeInOrderBook')
 * @property {number} placedAmountSumBid Accumulated base amount when selling into bids
 * @property {number} placedAmountPriceBid Price at which selling placedAmount is reached
 * @property {boolean} placedAmountReachedBid Whether placedAmount is fully reached on bids side
 *
 * @property {number} placedAmountCountAsk Levels required to buy placedAmount from asks
 * @property {number} placedAmountSumAsk Accumulated base amount when buying from asks
 * @property {number} placedAmountPriceAsk Price at which buying placedAmount is reached
 * @property {boolean} placedAmountReachedAsk Whether placedAmount is fully reached on asks side
 *
 * @property {QuoteHunterRow[]} qhTable Legacy Quote Hunter third-party bid table used to choose optimalQhBid
 * @property {QuoteHunterTable} qhOwnThirdPartyTable Own-vs-third-party breakdown for both sides of the visible order book
 * @property {QuoteHunterRow} [optimalQhBid] Chosen Quote Hunter bid row (if built)
 */

module.exports = {};
