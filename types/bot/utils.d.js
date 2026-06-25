'use strict';

/**
 * Type definitions for `helpers/utils.js`.
 *
 * @module types/bot/utils.d
 */

/**
 * @typedef {import('types/bot/general.d.js').RandomValueFunction} RandomValueFunction
 * @typedef {import('types/bot/general.d.js').RandomDeviationFunction} RandomDeviationFunction
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/paramVerifyResult.d').VerificationTypes} VerificationTypes
 * @typedef {import('types/bot/paramVerifyResult.d').ParsedPositiveSmartNumber} ParsedPositiveSmartNumber
 * @typedef {import('types/bot/paramVerifyResult.d').ParsedSmartTime} ParsedSmartTime
 * @typedef {import('types/bot/paramVerifyResult.d').ParamVerifyResult} ParamVerifyResult
 * @typedef {import('types/assets.d').ResultItem} AssetsResultItem
 * @typedef {import('types/assets.d').Result} AssetsResult
 * @typedef {import('types/depth.d').DepthItem} DepthItem
 * @typedef {import('types/depth.d').DepthResult} DepthResult
 * @typedef {import('types/bot/liquidity.d.js').LiquidityMap} LiquidityMap
 * @typedef {import('types/bot/liquidity.d.js').LiquidityLevel} LiquidityLevel
 * @typedef {import('types/bot/liquidity.d.js').LiquidityKey} LiquidityKey
 * @typedef {import('types/bot/orderBookInfo.d.js').SideTargetPrice} SideTargetPrice
 * @typedef {import('types/bot/orderBookInfo.d.js').OrderBookInfo} OrderBookInfo
 * @typedef {import('types/bot/orderBookInfo.d.js').QuoteHunterBookSideRow} QuoteHunterBookSideRow
 * @typedef {import('types/bot/orderBookInfo.d.js').QuoteHunterMatchSummary} QuoteHunterMatchSummary
 * @typedef {import('types/bot/orderMetrics.d.js').VwapMetrics} VwapMetrics
 * @typedef {import('types/bot/balancesHistory.d.js').BalanceTotalsScope} BalanceTotalsScope
 */

/**
 * Decimal places used by debug logging helpers (`setDebugDecimals()`).
 *
 * @typedef {Object} DebugDecimals
 * @property {number} ad Amount decimal places
 * @property {number} qd Quote decimal places
 * @property {number} pd Price decimal places
 */

/**
 * Trade-history metrics returned by `getHistoryTradesInfo()`.
 *
 * @typedef {Object} HistoryTradesInfo
 * @property {number} tradesCount Number of trades inside the interval
 * @property {number} intervalMs Interval length in milliseconds
 * @property {number} minPrice Lowest trade price in the interval
 * @property {number} maxPrice Highest trade price in the interval
 * @property {number} priceDelta Absolute price range inside the interval
 * @property {number} priceDeltaPercent Symmetric percent difference between min and max price
 * @property {number} coin1Volume Sum of base-coin amounts
 * @property {number} coin2Volume Sum of quote-coin amounts
 */

/**
 * Result of `parsePercent()`.
 *
 * @typedef {Object} ParsePercentResult
 * @property {boolean} parsed Whether the input was a valid percent string
 * @property {number} [percent] Parsed numeric percent without the `%` suffix
 */

/**
 * Result of `parseRangeOrValue()`.
 *
 * @typedef {Object} ParseRangeOrValueResult
 * @property {boolean} isRange Whether the input is a valid positive range
 * @property {boolean} isValue Whether the input is a single positive number
 * @property {number} [value] Parsed scalar value when `isValue` is true
 * @property {number} [from] Range lower bound when `isRange` is true
 * @property {number} [to] Range upper bound when `isRange` is true
 * @property {string} [fromStr] Original lower-bound token, e.g. `500k`
 * @property {string} [toStr] Original upper-bound token, e.g. `2m`
 */

/**
 * One balance delta row returned by `differenceInBalances()`.
 *
 * @typedef {Object} BalanceDifferenceItem
 * @property {string} code Asset ticker
 * @property {number} prev Previous total balance
 * @property {number} now Current total balance
 */

/**
 * Previous balance snapshot wrapper used by `differenceInBalancesString()`.
 *
 * @typedef {Object} BalanceSnapshotWithTimestamp
 * @property {number} [timestamp] Snapshot timestamp in milliseconds
 * @property {AssetsResult} [balances] Previous balances array
 */

/**
 * Parsed balance view for a trading pair returned by `balanceHelper()`.
 *
 * @typedef {Object} BalanceHelperResult
 * @property {AssetsResultItem} coin1Data Raw coin1 balance row
 * @property {AssetsResultItem} coin2Data Raw coin2 balance row
 * @property {number} free1 Available coin1 balance
 * @property {number} free2 Available coin2 balance
 * @property {number} freezed1 Frozen coin1 balance
 * @property {number} freezed2 Frozen coin2 balance
 * @property {number} total1 Total coin1 balance
 * @property {number} total2 Total coin2 balance
 * @property {string} free1s Fixed-point free coin1 string
 * @property {string} free2s Fixed-point free coin2 string
 * @property {string} freezed1s Fixed-point frozen coin1 string
 * @property {string} freezed2s Fixed-point frozen coin2 string
 * @property {string} total1s Fixed-point total coin1 string
 * @property {string} total2s Fixed-point total coin2 string
 * @property {string} coin1s Plain total/free/frozen string for coin1
 * @property {string} coin2s Plain total/free/frozen string for coin2
 * @property {string} coin1sf Markdown-formatted coin1 balance string
 * @property {string} coin2sf Markdown-formatted coin2 balance string
 * @property {string} coin1s2 Free/frozen-only string for coin1
 * @property {string} coin2s2 Free/frozen-only string for coin2
 */

/**
 * Spread-range diagnostics returned by `isOrderOutOfSpread()`.
 *
 * @typedef {Object} OrderOutOfSpreadInfo
 * @property {boolean} isOrderOutOfSpread Whether the order is outside the allowed spread band
 * @property {boolean} isOrderOutOfMinMaxSpread Whether the order is outside the outer min/max spread
 * @property {boolean} isOrderOutOfInnerSpread Whether the order sits inside the forbidden inner spread
 * @property {boolean} isSsOrder Whether the order belongs to spread-support logic
 * @property {number} orderPrice Order price under test
 * @property {number} [minPrice] Lower allowed price bound
 * @property {number} [maxPrice] Upper allowed price bound
 * @property {number} [innerLowPrice] Inner spread lower bound
 * @property {number} [innerHighPrice] Inner spread upper bound
 * @property {number} spreadPercent Active spread percent for the check
 * @property {number} [spreadPercentMin] Minimum inner spread percent, if configured
 */

/**
 * Aggregated open-order stats returned by `calculateOrderStats()`.
 *
 * @typedef {Object} CalculateOrderStatsResult
 * @property {number} bidsTotalAmount Remaining base amount on buy orders
 * @property {number} asksTotalAmount Remaining base amount on sell orders
 * @property {number} bidsTotalQuoteAmount Remaining quote amount on buy orders
 * @property {number} asksTotalQuoteAmount Remaining quote amount on sell orders
 * @property {number} totalAmount Total remaining base amount
 * @property {number} totalQuoteAmount Total remaining quote amount
 * @property {number} asksCount Number of sell orders
 * @property {number} bidsCount Number of buy orders
 * @property {number} totalCount Total number of orders
 */

/**
 * One unrecognized token captured in `parseCommandParams().more`.
 *
 * @typedef {Object} ParsedCommandMoreParam
 * @property {string} param Lower-cased token
 * @property {string} paramPlain Original token
 * @property {string} paramUc Upper-cased token
 * @property {number} paramNumber `Number(param)` result
 * @property {ParsedPositiveSmartNumber} paramSmartNumber Smart-number parse result
 * @property {number} index Position in the original params array
 * @property {boolean} isFirst Whether this is the first param
 * @property {boolean} isLast Whether this is the last param
 * @property {boolean} isInteger Whether `paramNumber` is a safe integer
 * @property {boolean} isNumeric Whether the token is numeric text
 * @property {boolean} isInterval Whether the token looks like a numeric range
 * @property {boolean} isTimeUnit Whether the token is a standalone time unit
 */

/**
 * Price condition parsed from `<`/`>` CLI tokens.
 *
 * @typedef {Object} ParsedCommandCondition
 * @property {string} string Original condition token
 * @property {string} operator `<` or `>`
 * @property {number} value Numeric threshold
 * @property {string} [valueCoin] Optional coin ticker after the value
 * @property {boolean} [isValid] Whether the condition parsed successfully
 * @property {string} [error] Validation error message
 * @property {Object} [mongoFilter] MongoDB filter fragment
 */

/**
 * Parsed CLI command parameters returned by `parseCommandParams()`.
 *
 * The object also receives helper methods (`is`, `moreByName`, `getInterval`, etc.)
 * at runtime; only the data fields are listed here.
 *
 * @typedef {Object} ParsedCommandParams
 * @property {ParsedCommandMoreParam[]} more Unrecognized or extra params
 * @property {string} [pair] Trading pair or perpetual symbol
 * @property {boolean} [perpetual] Whether `pair` is a perpetual contract
 * @property {string} [possibleCoin] First bare coin ticker candidate
 * @property {string} [orderSide] `buy` or `sell`
 * @property {number} [moduleIndex] Module index from `orderCollector.parsePurpose()`
 * @property {string} [moduleIndexString] Module suffix string, e.g. `''` or `'2'`
 * @property {string} [purpose] Order purpose key, e.g. `ld` or `man`
 * @property {string} [purposeString] Human-readable purpose label
 * @property {string} [priority] Raw `priority=` value
 * @property {ParsedCommandCondition} [condition] Price condition from `<`/`>` params
 * @property {number} [percent] Parsed percent value
 * @property {string} [percentString] Original percent token
 * @property {boolean} [isConfirmed] Whether `-y` was passed
 * @property {boolean} [useSecondAccount] Whether `-2` was passed
 * @property {number} paramCount Raw param count
 * @property {number} paramCountWoMarkers Param count excluding `-y` and `-2`
 * @property {number} paramCountUnknown Count of params stored in `more`
 * @property {boolean} exactParamsCount Whether the marker-adjusted count equals `min`
 * @property {boolean} pairErrored Params exist but no pair/perpetual was parsed
 * @property {boolean} pairOrCoinErrored Params exist but no pair/perpetual/coin was parsed
 * @property {boolean} [xorAmounts] Whether exactly one of `amount` or `quote` is set
 * @property {'amount' | 'quote'} [amountType] Which quantity field is active
 * @property {number} [qty] Numeric quantity from `amount` or `quote`
 * @property {number} [lowParsed] Verified `low=` value
 * @property {number} [highParsed] Verified `high=` value
 * @property {number} [countParsed] Verified `count=` value
 * @property {ParsedPositiveSmartNumber} [amountParsed] Verified amount
 * @property {'buy' | 'sell'} [orderSideParsed] Verified order side
 * @property {ParsedSmartTime} [timeParsed] Verified execution time
 * @property {ParsedSmartTime} [intervalParsed] Verified order interval
 * @property {string} [strategyParsed] Verified strategy
 * @property {number} [maxpriceParsed] Verified max price
 * @property {number} [minpriceParsed] Verified min price
 * @property {ParamVerifyResult} [leverageParsed] Full verify result for `leverage=`
 * @property {ParamVerifyResult} [mmodeParsed] Full verify result for `mmode=`
 * @property {string} paramString Original space-joined command string
 * @property {(paramName: string) => boolean} is Whether `more` contains a token
 * @property {(paramName: string) => ParsedCommandMoreParam | undefined} moreByName Lookup in `more` by name
 * @property {(index: number) => ParsedCommandMoreParam | undefined} moreByIndex Lookup in `more` by index
 * @property {() => ParsedCommandMoreParam | undefined} getFirst First `more` entry
 * @property {() => ParsedCommandMoreParam | undefined} getLast Last `more` entry
 * @property {(paramName: string) => number | undefined} indexOf Plain index of a named param
 * @property {(paramName: string) => ParsedCommandMoreParam | undefined} nextTo Entry after a named param
 * @property {(paramName: string) => ParsedCommandMoreParam | undefined} prevTo Entry before a named param
 * @property {() => ParsedCommandMoreParam | undefined} getInterval First interval-like token
 * @property {() => ParsedCommandMoreParam | undefined} getTimeInterval Interval followed by a time unit
 * @property {() => ParsedCommandMoreParam | undefined} getOtherInterval Interval that is not a time interval
 * @property {(namesArray: string[]) => ParsedCommandMoreParam | undefined} getWhereIncluded First `more` token in the list
 */

/**
 * Public export of `helpers/utils.js`.
 *
 * The module exposes many helpers; this typedef documents the most common entry points.
 * Additional properties remain available at runtime.
 *
 * @typedef {Object} UtilsModule
 * @property {string} moduleName Short module filename derived from `module.id`
 * @property {(amountDecimals?: number, quoteDecimals?: number, priceDecimals?: number) => void} setDebugDecimals Overrides debug decimal places
 * @property {() => string} readTradeConfig Reads the trade config file as a JSON string
 * @property {() => void} watchConfig Watches the trade config file for external edits
 * @property {(isWebApi?: boolean, callerName?: string) => void} saveConfig Persists in-memory trade params when changed
 * @property {(object: unknown) => string} getFullObjectString `util.inspect` wrapper for logs
 * @property {(data: unknown, length?: number, multiLineObjects?: boolean) => string} getLogString Truncates values for logs
 * @property {() => number} unixTimeStampMs Current Unix timestamp in milliseconds
 * @property {(time?: number) => number} epochTime Converts a Unix ms timestamp to ADAMANT epoch seconds
 * @property {(epochTime: number) => number} toTimestamp Converts ADAMANT epoch seconds to Unix ms
 * @property {(num: number) => string} padTo2Digits Left-pads a number to two digits
 * @property {(date: Date) => string} formatDate Formats a date as `yyyy-mm-dd hh:mm:ss`
 * @property {(timestamp: number) => string} formatTradeLogTime Formats a trade timestamp as `HH:mm:ss`
 * @property {(value: number, decimals: number) => string} formatDiagnosticQuoteValue Truncates a quote for diagnostic logs
 * @property {(num: number | string, makeBold?: boolean, maxPrecision?: number, meaningful?: number) => string} formatNumber Human-readable number formatter
 * @property {(orderBookInput: DepthResult, customSpreadPercent?: number, targetPrice?: number, placedAmount?: number, openOrders?: object[], moduleName?: string) => OrderBookInfo | false} getOrderBookInfo Order-book analytics
 * @property {(rows: QuoteHunterBookSideRow[], requestedAmount: number) => QuoteHunterMatchSummary} summarizeQhTableMatch Own-vs-third-party taker match summary
 * @property {(bc?: AssetsResult, bp?: AssetsResult) => BalanceDifferenceItem[] | undefined} differenceInBalances Balance delta rows
 * @property {(bc: AssetsResult, bpt?: BalanceSnapshotWithTimestamp, scope?: BalanceTotalsScope) => string} differenceInBalancesString Human-readable balance diff
 * @property {(balances: AssetsResult, pair: string | ParsedMarket) => BalanceHelperResult | undefined} balanceHelper Pair balance formatter inputs
 * @property {(params: string[], min?: number) => ParsedCommandParams | undefined} parseCommandParams CLI param parser
 * @property {(name: string, param: string, verificationType: VerificationTypes, isOptional?: boolean) => ParamVerifyResult} verifyParam CLI param validator
 * @property {(orders: object[]) => VwapMetrics} calculateVWAP Side-specific VWAP metrics
 * @property {(moduleName: string, fromFile?: string) => any | undefined} softRequire Optional `require()` wrapper; relative paths resolve from caller file
 */

module.exports = {};
