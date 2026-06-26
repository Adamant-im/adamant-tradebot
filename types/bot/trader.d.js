/**
 * types/bot/trader.d.js
 *
 * Type definitions specific to trade/mm_trader.js runtime orchestration.
 */

/**
 * Reuse existing types from:
 * @typedef {import('types/bot/general.d.js').NotifyFunction} NotifyFunction
 * @typedef {import('types/bot/general.d.js').RandomValueFunction} RandomValueFunction
 * @typedef {import('types/bot/general.d.js').RandomDeviationFunction} RandomDeviationFunction
 * @typedef {import('types/depth.d').DepthResult} DepthResult
 * @typedef {import('types/bot/orderBookInfo.d.js').OrderBookInfo} OrderBookInfo
 * @typedef {import('types/bot/candlestickChart.d').NiceChartDiagnostics} NiceChartDiagnostics
 * @typedef {import('types/bot/candlestickChart.d').NiceChartCloseCorrection} NiceChartCloseCorrection
 * @typedef {import('types/bot/candlestickChart.d').NiceChartCloseWindowPlan} NiceChartCloseWindowPlan
 * @typedef {import('types/bot/candlestickChart.d').NiceChartPriceRequestOptions} NiceChartPriceRequestOptions
 * @typedef {import('types/bot/candlestickChart.d').NiceChartPriceResult} NiceChartPriceResult
 * @typedef {import('types/bot/liquidity.d.js').LiqLimits} LiqLimits
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/priceReq.d').MmCurrentAction} MmCurrentAction
 * @typedef {import('types/bot/priceReq.d').TraderPriceRequest} TraderPriceRequest
 * @typedef {import('types/bot/orderBookInfo.d.js').QuoteHunterMatchLevel} QuoteHunterMatchLevel
 */

/**
 * Trader side used across runtime state and step inputs.
 * @typedef {'buy'|'sell'} TraderSide
 */

/**
 * Mutable state stored inside one trader runtime instance.
 *
 * @typedef {Object} TraderRuntimeState
 * @property {number} lastNotifyBalancesTimestamp Timestamp of the last insufficient-balance notification
 * @property {number} lastNotifyPriceTimestamp Timestamp of the last price-related notification
 * @property {boolean} isPreviousIterationFinished Prevents overlapping iteration runs
 * @property {TraderSide} lastOrderSide Last successfully attempted MM side
 * @property {number | undefined} [lastClosingTradeBucketTs] Last candle bucket where Trader already executed an explicit Nice Chart closing trade
 * @property {number} niceChartConsecutiveFailures Consecutive Nice Chart failures used to decide skip vs local fallback
 * @property {number} sbwCheckCount Number of in-spread checks since the last Sniper Bot Watcher reset
 * @property {number[]} sbwActivityCounters Sniper Bot Watcher counters: [unused, scenario1, scenario2]
 */

/**
 * Minimal shape of Price Watcher used by mm_trader.
 *
 * @typedef {Object} TraderPriceWatcher
 * @property {() => boolean} [getIsPriceWatcherEnabled] Whether the module is enabled
 * @property {() => boolean} [getIsPriceAnomaly] Whether the current market is anomalous
 * @property {() => boolean} [getIsPriceActual] Whether the stored range is current
 * @property {() => boolean} [getIgnorePriceNotActual] Whether stale ranges should be ignored
 * @property {() => number} [getLowPrice] Lower allowed price bound
 * @property {() => number} [getHighPrice] Upper allowed price bound
 * @property {() => string} [getPwRangeString] Human-readable range string for logs
 */

/**
 * Nice Chart service contract used by mm_trader.
 *
 * @typedef {Object} TraderNiceChartService
 * @property {(options?: NiceChartPriceRequestOptions) => Promise<NiceChartPriceResult>} getNextPrice Calculates the next allowed in-spread corridor and fetches spot runtime trades when needed
 * @property {(options?: TraderPickTradeActionOptions) => Promise<MmCurrentAction>} [pickTradeAction] Chooses Trader execution mode using Nice Chart execution context
 * @property {(options?: TraderLimitInOrderBookAmountOptions) => Promise<TraderLimitInOrderBookAmountResult>} [limitInOrderBookAmount] Limits in-order-book size using Nice Chart own-vs-third-party and VWAP rules
 * @property {(options?: object) => { coin1AmountFilled: number, coin2AmountFilled: number }} [attributeThirdPartyFillFromMatchPlan] Attributes executeInOrderBook fills to third-party liquidity using Nice Chart match data
 * @property {(runtime: TraderRuntime, now: number, regularInterval: number) => NiceChartCloseWindowPlan} [planClosingTradeIteration] Plans an explicit candle-closing trade iteration
 */

/**
 * Nice Chart amount-limiting input for an executeInOrderBook step.
 *
 * Nice Chart evaluates the original requested `coin1Amount`; local Trader and
 * Liquidity Provider limits are intentionally not inputs to this policy.
 *
 * @typedef {Object} TraderLimitInOrderBookAmountOptions
 * @property {TraderRuntime} [runtime] Active Trader runtime
 * @property {TraderSide} [side] Intended taker side
 * @property {number} [coin1Amount] Original requested base amount
 * @property {DepthResult} [orderBook] Current order-book snapshot
 * @property {OrderBookInfo} [orderBookInfo] Current own-vs-third-party order-book metrics
 * @property {boolean} [isProbe] When true, the log is assembled but not emitted; logText is populated on the result
 */

/**
 * Nice Chart amount limit and expected visible match metadata.
 *
 * @typedef {Object} TraderLimitInOrderBookAmountResult
 * @property {number} amountLimited Base amount allowed by Nice Chart
 * @property {string} limitedByString Human-readable limiting reason
 * @property {number} expectedOwnMatchAmount Expected base amount matched against own orders
 * @property {number} expectedOwnMatchQuote Expected quote amount matched against own orders
 * @property {number} expectedThirdPartyAmount Expected base amount matched against third-party orders
 * @property {number} expectedThirdPartyQuote Expected quote amount matched against third-party orders
 * @property {QuoteHunterMatchLevel[]} [expectedMatchPlan] Sequential visible match plan
 * @property {number} amountUntilThirdParty Base amount executable before third-party liquidity starts
 * @property {boolean} topStartsWithOurOrders Whether the visible target side starts with own orders
 * @property {boolean} topStartsWithThirdPartyOrders Whether the visible target side starts with third-party orders
 * @property {boolean} matchingThirdPartyAllowed Whether the VWAP policy permits the expected external slice
 * @property {boolean} matchingThirdPartyRestricted Whether Nice Chart restricted the expected external slice
 * @property {string} [matchingThirdPartyRestriction] Machine-readable restriction reason
 * @property {object} [diagnostics] Policy inputs and matched conditions
 * @property {boolean} isAmountLimited Whether Nice Chart reduced the original requested amount
 * @property {string} [logText] Full assembled decision log text; populated on probe calls (isProbe=true)
 */

/**
 * Nice Chart action-selection input.
 *
 * @typedef {TraderLimitInOrderBookAmountOptions & {
 *   mmPolicy?: 'optimal'|'spread'|'wash'|'orderbook'|'depth',
 *   canExecuteInOrderBook?: boolean
 * }} TraderPickTradeActionOptions
 */

/**
 * Liquidity Provider contract used by mm_trader.
 *
 * @typedef {Object} TraderLiquidityProvider
 * @property {() => LiqLimits} getLiqLimits Returns current amount limits for order-book execution
 */

/**
 * Optional Sniper Bot Watcher helper contract used by mm_trader.
 *
 * @typedef {Object} TraderSbwService
 * @property {(overrides?: Partial<TraderRuntimeState>) => { sbwCheckCount: number, sbwActivityCounters: number[] }} getInitialState Builds the SBW-specific runtime state fragment
 * @property {(runtime: TraderRuntime) => void} sniperBotCheck Increments the SBW check counter and resets stale counters
 * @property {(runtime: TraderRuntime, scenario: number, orderDetails: object, coin1Amount: number) => void} sniperBotActivity Records an SBW activity scenario and may trigger Safe mode
 * @property {(runtime: TraderRuntime, doLog?: boolean) => void} resetSniperBotCounters Resets SBW counters
 */

/**
 * Lazy or eager dependency override accepted by the runtime.
 *
 * @typedef {TraderPriceWatcher|TraderNiceChartService|TraderLiquidityProvider|TraderSbwService|(() => any)} TraderDependencySource
 */

/**
 * Common dependency fields shared by resolved trader runtime deps and factory overrides.
 *
 * Most fields are typed as generic objects because they are existing CommonJS modules
 * with large dynamic surfaces; this typedef documents the subset that mm_trader wires together.
 *
 * @typedef {Object} TraderRuntimeDepsBase
 * @property {object} constants Shared constants helper
 * @property {object} utils Generic utility helper module
 * @property {object} config Loaded immutable config
 * @property {object} log Logger module
 * @property {NotifyFunction} notify Notification helper
 * @property {object} tradeParams Mutable runtime trade params
 * @property {object} db DB module with model constructors
 * @property {object} orderCollector Order cancellation helper
 * @property {object} orderUtils Order utility helper
 * @property {object} fillsEngine Fill accounting helper
 * @property {object} traderapi Primary exchange API instance
 * @property {object|null|undefined} traderapi2 Secondary exchange API instance, when configured
 * @property {boolean} isPerpetual Whether the runtime uses perpetual/futures mode
 * @property {boolean} useSecondAccount Whether the secondary account is active for spot MM
 * @property {() => number} random Random source returning [0, 1). In production this is effectively `Math.random`, while tests may inject a seeded generator so the same input follows the same branches every time.
 * @property {RandomValueFunction} randomValue Random range helper bound to the runtime's `random` source. Keeping it in deps prevents helper calls from silently falling back to the global RNG and makes simulations reproducible.
 * @property {RandomDeviationFunction} randomDeviation Symmetric deviation helper bound to the same runtime RNG. It is kept alongside `randomValue` so all stochastic decisions inside one runtime share one deterministic sequence when tests inject a seeded generator.
 * @property {TraderPriceWatcher|(() => TraderPriceWatcher)} [priceWatcher] Optional Price Watcher override
 * @property {TraderNiceChartService|(() => TraderNiceChartService)|undefined} [niceChart] Optional Nice Chart override
 * @property {TraderLiquidityProvider|(() => TraderLiquidityProvider)} [liquidityProvider] Optional Liquidity Provider override
 * @property {TraderSbwService|(() => TraderSbwService)} [traderSbw] Optional Sniper Bot Watcher override
 */

/**
 * Dependencies captured by one trader runtime instance after all defaults are resolved.
 *
 * @typedef {TraderRuntimeDepsBase & {
 *   useSecondAccount: boolean
 * }} TraderRuntimeDeps
 */

/**
 * Optional state/dependency overrides accepted by createTraderRuntime().
 *
 * Reuses the common dependency surface from `TraderRuntimeDepsBase`, but every shared
 * field becomes optional because the factory can fall back to module-level defaults.
 *
 * @typedef {Partial<TraderRuntimeDepsBase> & {
 *   isPerpetual?: boolean,
 *   formattedPair?: ParsedMarket,
 *   state?: Partial<TraderRuntimeState>
 * }} TraderRuntimeOverrides
 */

/**
 * Shared market snapshot fields reused by trader step state and step input.
 *
 * @typedef {Object} TraderStepMarketFields
 * @property {TraderSide} [side] Forced trade side
 * @property {number} [coin1Amount] Forced amount in base coin
 * @property {number} [precision] Forced quote precision step
 * @property {number} [now] Synthetic timestamp in ms
 * @property {DepthResult} [orderBook] Pre-fetched order book snapshot
 * @property {OrderBookInfo} [orderBookInfo] Precomputed order book metrics
 * @property {'optimal'|'spread'|'wash'|'orderbook'|'depth'} [mmPolicy] Forced trader policy for the step
 * @property {boolean} [isClosingTrade] Whether the current step is an explicit Nice Chart candle-closing trade
 */

/**
 * Market snapshot fields that may be injected into one trader evaluation step.
 *
 * @typedef {TraderStepMarketFields} TraderStepMarketState
 */

/**
 * Input payload accepted by evaluateTradeStep(), executeMmOrder(), and setPrice().
 *
 * @typedef {TraderStepMarketFields & {
 *   marketState?: TraderStepMarketState,
 *   priceWatcher?: TraderPriceWatcher|(() => TraderPriceWatcher),
 *   niceChart?: TraderNiceChartService|(() => TraderNiceChartService)|undefined,
 *   liquidityProvider?: TraderLiquidityProvider|(() => TraderLiquidityProvider),
 *   __niceChartDiagnostics?: NiceChartDiagnostics,
 *   __niceChartCloseCorrection?: NiceChartCloseCorrection
 * }} TraderStepInput
 */

/**
 * Result of evaluateTradeStep().
 *
 * @typedef {TraderPriceRequest & {
 *   side: TraderSide,
 *   coin1Amount: number,
 *   isClosingTrade?: boolean,
 *   skipReason?: string
 * }} TraderTradeStepResult
 */

/**
 * Public runtime surface returned by createTraderRuntime().
 *
 * @typedef {Object} TraderRuntime
 * @property {TraderRuntimeDeps} deps Bound runtime dependencies
 * @property {TraderRuntimeState} state Mutable runtime state
 * @property {ParsedMarket} formattedPair Parsed market metadata for the current pair
 * @property {string} moduleName Machine-readable module name
 * @property {string} readableModuleName Human-readable module name for logs/notifications
 * @property {() => TraderRuntimeState} getState Returns the current mutable state object
 * @property {() => void} run Starts the trader iteration loop
 * @property {() => Promise<void>} iteration Executes one loop iteration and schedules the next one
 * @property {(stepInput?: TraderStepInput) => Promise<TraderTradeStepResult>} evaluateTradeStep Evaluates one potential MM action without placing orders
 * @property {(stepInput?: TraderStepInput) => Promise<void>} executeMmOrder Evaluates and attempts to place the chosen MM order(s)
 */

module.exports = {};
