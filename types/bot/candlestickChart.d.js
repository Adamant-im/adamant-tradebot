/**
 * @fileoverview Types shared by Nice Chart runtime logic and the Nice Chart test report.
 *
 * The file complements generic candle/trade/depth typedefs with structures that are
 * specific to the candlestick helper, the mm_nice_chart service, and the browser report.
 *
 * @module types/bot/candlestickChart.d
 */

/**
 * @typedef {import('types/candles.d').Candle} Candle
 * @typedef {import('types/candles.d').CandlesResult} CandlesResult
 * @typedef {import('types/trades.d').ResultItem} ResultItem
 * @typedef {import('types/trades.d').TradesResult} TradesResult
 * @typedef {import('types/depth.d').DepthItem} DepthItem
 * @typedef {import('types/depth.d').DepthResult} DepthResult
 * @typedef {import('types/bot/orderBookInfo.d.js').OrderBookInfo} OrderBookInfo
 * @typedef {import('types/bot/orderBookInfo.d.js').QuoteHunterBookSideRow} QuoteHunterBookSideRow
 * @typedef {import('types/bot/orderBookInfo.d.js').QuoteHunterMatchSummary} QuoteHunterMatchSummary
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/priceReq.d.js').MmCurrentAction} MmCurrentAction
 * @typedef {import('types/bot/trader.d.js').TraderRuntime} TraderRuntime
 * @typedef {import('types/bot/trader.d.js').TraderLimitInOrderBookAmountOptions} TraderLimitInOrderBookAmountOptions
 * @typedef {import('types/bot/trader.d.js').TraderLimitInOrderBookAmountResult} TraderLimitInOrderBookAmountResult
 * @typedef {import('types/bot/trader.d.js').TraderPickTradeActionOptions} TraderPickTradeActionOptions
 */

/**
 * Third-party matching policy under Nice Chart executeInOrderBook mode.
 *
 * @typedef {Object} NiceChartMatchingThirdPartyConfig
 * @property {boolean} enabled Whether matching visible third-party liquidity is enabled
 * @property {boolean} ignoreVwap Whether third-party matching bypasses VWAP checks
 * @property {boolean} whenVwapZeroYet Whether an empty same-side VWAP permits the first external trade
 * @property {boolean} whenImprovesVwap Whether improving the same-side VWAP permits the trade
 * @property {boolean} whenVwapSpreadAllows Whether a non-negative projected sell-minus-buy VWAP spread permits the trade
 * @property {number} vwapSpreadAllowThresholdPercent Allow projected spread to go negative up to this percent of the reference price (0 = disabled)
 * @property {number} vwapSpreadAllowThresholdUsd Allow matching while projected MTM PnL stays above -threshold in USD (0 = disabled)
 * @property {'tradeMinAmount'|'cancelTrade'} ifTradeRestricted Action when no configured permission condition matches
 */

/**
 * Normalized Nice Chart executeInOrderBook configuration.
 *
 * @typedef {Object} NiceChartExecuteInOrderBookConfig
 * @property {number} maxPriceChangePercent Maximum allowed price change for order-book execution
 * @property {number} executeInOrderBookPercent Probability (0–100) to choose executeInOrderBook under optimal policy when Nice Chart allows it
 * @property {NiceChartExecuteInOrderBookAmountManagingConfig} amountManaging Pre-third-party amount caps for executeInOrderBook
 * @property {NiceChartMatchingThirdPartyConfig} matchingThirdPartyOrders Third-party matching policy
 */

/**
 * Normalized Nice Chart executeInOrderBook amount-managing policy.
 *
 * @typedef {Object} NiceChartExecuteInOrderBookAmountManagingConfig
 * @property {boolean} limitByLiquidity Whether to cap by visible custom-spread order-book liquidity
 * @property {number} limitPercent Default cap as percent of the requested amount (overridable via tradeParams.mm_traderObLimitPercent)
 * @property {number} limitValueUsd Cap converted to base coin at the current price
 * @property {boolean} keepFullWhenImprovesVwapSpread Skip amount caps when the external slice improves VWAP spread
 */

/**
 * Result of Nice Chart third-party matching policy evaluation for one step.
 *
 * @typedef {Object} NiceChartThirdPartyMatchingDecision
 * @property {boolean} [allowed] Whether matching visible third-party liquidity is allowed
 * @property {string} [reason] Machine-readable decision reason
 * @property {object} [diagnostics] Policy inputs, matched conditions, and projected VWAPs
 */

/**
 * Input for the verbose limitInOrderBookAmount() decision log.
 *
 * @typedef {Object} NiceChartLimitInOrderBookAmountLogOptions
 * @property {TraderRuntime} [runtime] Active Trader runtime
 * @property {'buy' | 'sell'} [side] Intended taker side
 * @property {OrderBookInfo} [orderBookInfo] Current own-vs-third-party order-book metrics
 * @property {QuoteHunterBookSideRow[]} [qhRows] Visible target-side QH breakdown rows
 * @property {number} [originalAmount] Original requested base amount
 * @property {number} [amountLimited] Base amount allowed after Nice Chart restrictions
 * @property {string} [limitedByString] Human-readable limiting reason
 * @property {string} [amountManagingLimitedByString] Human-readable amount-managing cap reason, when applied before third-party checks
 * @property {boolean} [amountManagingSkippedBecauseImprovesVwapSpread] Whether amount caps were skipped because the trade improves VWAP spread
 * @property {number} [amountAfterManaging] Base amount after amount-managing caps and before third-party restrictions
 * @property {QuoteHunterMatchSummary | null} [matchSummary] Predicted own/third-party match summary
 * @property {NiceChartThirdPartyMatchingDecision | null} [thirdPartyDecision] Third-party matching policy outcome
 * @property {boolean} [traderStatsAvailable] Whether Trader epoch fill stats were available
 * @property {boolean} [skipLog] When true, the log text is assembled but not emitted to the logger
 */

/**
 * Trader VWAP projection after adding one external fill fragment.
 *
 * @typedef {Object} NiceChartProjectedTraderStats
 * @property {number} boughtVwap Projected cumulative buy VWAP
 * @property {number} soldVwap Projected cumulative sell VWAP
 * @property {boolean} hasBothSides Whether both projected sides have positive filled amount
 * @property {number} vwapSpread Projected soldVwap minus boughtVwap, or zero without both sides
 * @property {number} pnlQuoteCashflow Projected quote cashflow (sellQuote - buyQuote)
 * @property {number} pnlUsdCashflow Projected cashflow converted to USD
 * @property {number} inventoryBase Projected base inventory (buyAmount - sellAmount)
 * @property {number} [markPrice] Mark price used for MTM projection, when available
 * @property {number} [pnlQuoteMtm] Projected mark-to-market PnL in quote currency, when mark price is available
 * @property {number} [pnlUsdMtm] Projected mark-to-market PnL converted to USD
 */

/**
 * Base timeframe supported by Nice Chart persistence.
 * @typedef {'5m'} NiceChartBaseTimeframe
 */

/**
 * Supported Nice Chart timeframes.
 * @typedef {'1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '12h' | '1d'} NiceChartTimeframe
 */

/**
 * Candle provenance labels used by Nice Chart persistence and reports.
 * `native` candles are always persisted. `exchange_trades` candles are persisted only when
 * the exchange does not provide `getCandlesHistory`; otherwise they are kept in memory only
 * as a live tail after the last native candle.
 * DB persistence must preserve the original candle provenance instead of rewriting it.
 * @typedef {'native' | 'exchange_trades'} NiceChartCandleSource
 */

/**
 * Candle quality labels exposed to the report UI.
 * `sim` marks synthetic datasets produced by the manual trader-mode comparison harness.
 * @typedef {'native' | 'exchange_trades' | 'reconstructed' | 'local' | 'sim' | 'degraded' | 'unavailable'} NiceChartQuality
 */

/**
 * Current operating mode of Nice Chart.
 *
 * - `normal` — fully operational: warmed history (≥ 12 candles) is available and fresh
 *   runtime trades are arriving.
 * - `degraded` — partially operational: history exists but something is missing —
 *   too few candles, history built from trades instead of native candles, no fresh trades
 *   in the current window, etc. Bid/ask limits are still computed but with caveats.
 * - `fallback` — cannot produce a reliable result: history is unavailable, perpetual
 *   contract (not supported), service error, etc. Logged at `warn` level.
 * @typedef {'normal' | 'degraded' | 'fallback'} NiceChartMode
 */

/**
 * Main diagnostics data source currently used by Nice Chart.
 *
 * - `native` — history was fetched directly from the exchange's candles endpoint.
 * - `exchange_trades` — the exchange has no `getCandlesHistory`; candles are built from
 *   trade history. The warm base may come from persisted DB candles (local+exchange_trades).
 * - `local` — the warm base came entirely from persisted DB candles that were originally
 *   seeded from `native` or `exchange_trades`; effectively `local+native` or
 *   `local+exchange_trades` — there is no purely independent `local` origin.
 * - `unavailable` — no usable history available yet.
 * - `uninitialized` — service has not been initialized.
 * @typedef {'native' | 'exchange_trades' | 'local' | 'unavailable' | 'uninitialized'} NiceChartDataSource
 */

/**
 * Reason label for close-price correction decisions.
 * @typedef {'invalid_limits' | 'outside_close_window' | 'no_active_candle' | 'best_effort' | 'invalid_corridor'} NiceChartCloseCorrectionReason
 */

/**
 * Trade phase resolved by Nice Chart for the current request.
 * @typedef {'opening-trade' | 'regular-trade' | 'closing-trade'} NiceChartTradePhase
 */

/**
 * Shared prefix context attached to Nice Chart trade-phase logs.
 * @typedef {Object} NiceChartTradeLogContext
 * @property {NiceChartTradePhase} phase Resolved trade phase label
 * @property {number} tradeTimestamp Current trade timestamp in milliseconds
 * @property {string} tradeTime Current trade clock time in `HH:mm:ss` format
 * @property {number} tradeIndex 1-based trade number in the current base candle
 */

/**
 * Candle context around the active Nice Chart base bucket.
 * @typedef {Object} NiceChartCandleContext
 * @property {CandlesResult} candles Stored candles with the active runtime bucket overlaid when available
 * @property {Candle | undefined} currentCandle Candle for the active base bucket
 * @property {Candle | undefined} previousCandle Closest candle before the active base bucket
 * @property {number} currentBucketTs Active base bucket open timestamp in milliseconds
 */

/**
 * Trader loop plan for an explicit Nice Chart closing trade.
 * @typedef {Object} NiceChartCloseWindowPlan
 * @property {number} interval Next trader loop interval in milliseconds
 * @property {boolean} isClosingTrade Whether the next iteration should be marked as a closing trade
 * @property {number} [remainingMs] Remaining milliseconds until the active candle closes
 * @property {number} [closeTimestamp] Active candle close timestamp in milliseconds
 * @property {number} [plannedClosingTs] Planned timestamp for the next closing-trade attempt
 */

/**
 * Close correction decision returned by Nice Chart near candle close.
 * @typedef {Object} NiceChartCloseCorrection
 * @property {boolean} applied Whether the correction was applied to the price corridor
 * @property {NiceChartCloseCorrectionReason} reason Why the correction was or was not applied
 * @property {number} [remainingMs] Remaining milliseconds until candle close
 * @property {number} [targetClose] Target close price inside the allowed spread corridor
 * @property {number} [correctedBid] Bid-side boundary after correction
 * @property {number} [correctedAsk] Ask-side boundary after correction
 * @property {number} [closeTimestamp] Active candle close timestamp in milliseconds
 */

/**
 * One detected history gap in persisted candles.
 * @typedef {Object} NiceChartHistoryGap
 * @property {number} gapStart Gap start timestamp in milliseconds
 * @property {number} gapEnd Gap end timestamp in milliseconds
 * @property {number} gapDurationMs Gap duration in milliseconds
 * @property {number} gapDurationSec Gap duration in seconds
 */

/**
 * Result of checking persisted history for missing candle intervals.
 * @typedef {Object} NiceChartHistoryIntegrityResult
 * @property {boolean} hasHistoryGap Whether any gap was detected
 * @property {number} historyGapTimeSec Sum of all gap durations in seconds
 * @property {NiceChartHistoryGap[]} gaps Individual gaps sorted by time
 * @property {number} [totalCandlesChecked] Number of candles checked during the scan
 * @property {string} [error] Error description when the integrity check itself failed
 */

/**
 * Summary of the contiguous base-candle tail ending at the newest stored candle.
 * @typedef {Object} NiceChartBaseHistoryContinuitySummary
 * @property {number} storedBaseCandles Total stored base candles in memory
 * @property {number} contiguousBaseCandlesFromLatestStored Gapless tail ending at the newest stored base candle, regardless of freshness
 * @property {number} contiguousBaseCandlesFromNowtime Fresh gapless tail ending at the expected latest closed base bucket, or 0 when the newest stored candle is stale
 * @property {boolean} isContiguousBaseCandlesFromLatestStoredFresh Whether the newest stored candle reaches the expected latest closed base bucket for `now`
 * @property {number} [expectedNowtimeBaseTo] Expected close timestamp for the latest closed base bucket
 * @property {number} [contiguousFrom] Open timestamp of the oldest candle in the gapless tail
 * @property {number} [contiguousTo] Close timestamp of the newest candle in the gapless tail
 */

/**
 * Runtime diagnostics snapshot for the Nice Chart service.
 * @typedef {Object} NiceChartDiagnostics
 * @property {NiceChartMode} mode Current service mode
 * @property {NiceChartDataSource} dataSource Active data source
 * @property {'native' | 'exchange_trades' | undefined} [seedSource] Original source behind local cached candles
 * @property {string[]} degradationReasons Reasons why the service entered degraded or fallback mode
 * @property {number} baseCandleCount Number of stored base candles in memory
 * @property {number} [contiguousBaseCandlesFromNowtime] Number of fresh contiguous stored base candles
 * @property {number} [contiguousBaseCandlesFromLatestStored] Gapless tail ending at the newest stored base candle
 * @property {boolean} [isContiguousBaseCandlesFromNowtimeFresh] Whether stored base history reaches the latest closed base bucket
 * @property {number} runtimeTradeCount Number of runtime trades kept in the rolling window
 * @property {NiceChartBaseTimeframe} baseTimeframe Base storage timeframe used by the service
 * @property {number | undefined} lastWarmupTs Last successful warmup timestamp in milliseconds
 * @property {number | undefined} lastPersistTs Last persisted closed candle timestamp in milliseconds
 * @property {number | undefined} lastCleanupTs Last cleanup timestamp in milliseconds
 * @property {NiceChartCloseCorrection | undefined} closeCorrection Last close-correction decision
 * @property {NiceChartHistoryIntegrityResult | undefined} [integrity] Optional history integrity check result
 */

/**
 * Result of building a candle series for a requested timeframe.
 * @typedef {Object} NiceChartBuildResult
 * @property {CandlesResult} candles Result candles in ascending order
 * @property {NiceChartQuality} quality Reported quality for the result set
 * @property {NiceChartBaseTimeframe} baseTimeframe Current base timeframe of the service
 * @property {NiceChartMode} mode Mode at the time the result was produced
 */

/**
 * Build-candles request accepted by the Nice Chart service.
 * @typedef {Object} NiceChartBuildOptions
 * @property {NiceChartTimeframe} [timeframe] Target timeframe to build
 * @property {number} [limit] Optional tail length for the returned series
 * @property {boolean} [includeActive] Whether to merge the active runtime bucket into the result
 * @property {number} [now] Reference timestamp in milliseconds
 */

/**
 * Price-corridor request passed to Nice Chart.
 * @typedef {Object} NiceChartPriceRequest
 * @property {object} traderapi Exchange adapter instance
 * @property {string} pair Trading pair
 * @property {'buy' | 'sell'} side Intended trade side
 * @property {string} [coin2] Quote currency code used in logs
 * @property {number} bidLimit Left edge of the allowed spread corridor
 * @property {number} askLimit Right edge of the allowed spread corridor
 * @property {number} spread Absolute spread in quote units
 * @property {number} spreadUnits Spread expressed in precision units
 * @property {number} precision Minimum allowed price step
 * @property {number} [coin2Decimals] Optional quote precision for logging or formatting
 * @property {TradesResult} [trades] Optional fresh trades to ingest before calculating the next price. When omitted, mm_nice_chart may fetch recent spot trades itself.
 * @property {DepthResult} [orderBook] Optional order book snapshot reused by trader decision flow
 * @property {OrderBookInfo} [orderBookInfo] Optional derived order book metrics reused by trader decision flow
 * @property {'optimal'|'spread'|'wash'|'orderbook'|'depth'} [mmPolicy] Trader policy for the current step
 * @property {boolean} [isPerpetual] Whether the pair is perpetual/futures and therefore unsupported
 * @property {boolean} [isClosingTrade] Whether Trader marked this step as an explicit candle-closing trade
 * @property {number} [now] Explicit evaluation timestamp in milliseconds
 */

/**
 * Partial price request used by internal helper functions before the full request is available.
 * @typedef {Partial<NiceChartPriceRequest>} NiceChartPriceRequestOptions
 */

/**
 * Init options accepted by the Nice Chart service.
 * @typedef {Object} NiceChartInitOptions
 * @property {object} [traderapi] Exchange adapter instance
 * @property {string} [pair] Trading pair
 * @property {string} [exchange] Exchange name
 * @property {boolean} [isPerpetual] Whether the pair is perpetual/futures
 * @property {number} [now] Explicit initialization timestamp
 */

/**
 * Warmup options accepted by the Nice Chart service.
 * @typedef {Object} NiceChartWarmupOptions
 * @property {number} [now] Explicit warmup timestamp
 * @property {boolean} [logCandles] Whether runtime trade ingestion should emit a candle-refresh log
 * @property {string} [candleSourceLabel] Diagnostic source label for candles built from ingested trades
 * @property {boolean} [persistCandles] Whether closed candles built from ingested trades may be persisted
 */

/**
 * Next-price decision returned by Nice Chart.
 * @typedef {Object} NiceChartPriceResult
 * @property {boolean} isValid Whether a fully validated corridor was produced; when true, bidLimit and askLimit are finite positive numbers and bidLimit < askLimit
 * @property {number} [bidLimit] Adjusted bid-side boundary
 * @property {number} [askLimit] Adjusted ask-side boundary
 * @property {boolean} [niceChartAllowsExecuteInOrderBook] Whether execution inside the visible order book is still allowed
 * @property {string} [reason] Failure or degradation reason when `isValid` is false
 * @property {NiceChartDiagnostics} diagnostics Diagnostics snapshot captured with the decision
 * @property {NiceChartCloseCorrection | undefined} [closeCorrection] Last close-correction decision
 */

/**
 * Derived price corridor returned by the Nice Chart spread-shaping helper.
 * @typedef {Object} NiceChartDerivedPriceRange
 * @property {number} bidLimit Adjusted bid-side boundary
 * @property {number} askLimit Adjusted ask-side boundary
 * @property {number} baseBidLimit Bid-side boundary before the final phase-specific correction log edge
 * @property {number} baseAskLimit Ask-side boundary before the final phase-specific correction log edge
 * @property {boolean} niceChartAllowsExecuteInOrderBook Whether execution inside the book is still allowed
 * @property {boolean} isTradeStepInBar Whether a strong intra-bar step was detected
 * @property {number} minPriceInBar Minimum recent trade price in the analyzed bar fragment
 * @property {number} maxPriceInBar Maximum recent trade price in the analyzed bar fragment
 * @property {NiceChartTradePhase} tradePhase Trade phase resolved for this corridor request
 * @property {NiceChartTradeLogContext} tradeContext Shared log prefix context for this corridor request
 * @property {string} corridorReason Log reason for the primary corridor adjustment
 * @property {NiceChartCloseCorrection | undefined} closeCorrection Phase-specific close-correction metadata
 */

/**
 * Result of fetching best-effort history from exchange candles or trades.
 * @typedef {Object} NiceChartFetchHistoryResult
 * @property {CandlesResult} candles Loaded candle history
 * @property {'native' | 'exchange_trades' | 'unavailable'} sourceQuality Quality of the fetched history
 * @property {NiceChartBaseTimeframe} baseTimeframe Base timeframe inferred from the fetched history
 * @property {string[]} degradationReasons Degradation reasons attached to the fetched history
 */

/**
 * In-memory state bag kept by one Nice Chart service instance.
 * @typedef {Object} NiceChartState
 * @property {boolean} initialized Whether the service has already been initialized for the current pair
 * @property {string | undefined} exchange Current exchange name
 * @property {string | undefined} pair Current trading pair
 * @property {object | undefined} traderapi Exchange adapter instance
 * @property {boolean} isPerpetual Whether the current market is perpetual/futures
 * @property {NiceChartBaseTimeframe} baseTimeframe Base timeframe used for storage and aggregation
 * @property {number} baseTimeframeMs Base timeframe length in milliseconds
 * @property {Map<number, Candle>} candlesByKey Base candles indexed by `tsOpen`
 * @property {TradesResult} runtimeTrades Rolling runtime trade buffer
 * @property {NiceChartDataSource} sourceQuality Quality/source label of the current history
 * @property {'native' | 'exchange_trades' | undefined} seedSource Original exchange source that seeded the persisted candle history; restored from DB across restarts
 * @property {number | undefined} lastWarmupTs Last successful warmup timestamp
 * @property {number | undefined} lastPersistTs Last successfully persisted closed candle timestamp
 * @property {number | undefined} lastCleanupTs Last cleanup timestamp
 * @property {NiceChartCloseCorrection | undefined} lastCloseCorrection Last close-correction decision
 * @property {number | undefined} lastRegularTarget Last regular-trade visual target used for smoothing
 * @property {number | undefined} lastRegularTargetTs Timestamp of the last regular-trade visual target
 * @property {number | undefined} lastRegularTrendBias Smoothed regular-trade trend bias
 * @property {number | undefined} lastRegularTrendTs Timestamp of the last smoothed regular-trade trend bias
 * @property {number | undefined} lastRegularRandomDriftBias Last quiet-market random drift bias
 * @property {number | undefined} lastRegularRandomDriftTs Timestamp of the last quiet-market random drift bias
 * @property {'drift' | 'stale' | 'edge' | undefined} lastRegularRegime Current regular-trade behavior regime
 * @property {number | undefined} lastRegularRegimeUntilTs Timestamp when the current regular-trade regime expires
 * @property {'bid' | 'ask' | undefined} lastRegularEdgeSide Edge side used by the current regular-trade edge regime
 * @property {string | undefined} lastLoggedModeKey Last deduplicated mode-log key
 * @property {NiceChartDiagnostics} diagnostics Last diagnostics snapshot
 */

/**
 * Dependency injection object for creating isolated Nice Chart services.
 * @typedef {Object} NiceChartServiceDeps
 * @property {() => object} getConfig Runtime config provider
 * @property {() => object} getDb DB provider
 * @property {() => object} getLog Logger provider
 * @property {() => object} getUtils Utils provider
 * @property {() => object} getTradeParams Trade params provider
 * @property {() => number} random Random generator returning values in the `[0, 1)` range
 * @property {number} runtimeTradeWindowMs Rolling runtime trade retention window in milliseconds
 * @property {number} closeCorrectionWindowMs Tail window near candle close in milliseconds
 * @property {number} minWarmupCandles Minimum candle count required before warmup stops
 * @property {boolean} [disableRuntimeExchangeRefresh] Test/simulation mode flag that keeps per-request refresh local
 * @property {(payload: { reason: string, initialBid: number, initialAsk: number, nextBid: number, nextAsk: number, precision: number }) => void} [onCorridorAdjustment] Optional callback fired whenever Nice Chart narrows a corridor
 */

/**
 * Compact chart metric snapshot reused by server-side tests and the browser UI.
 * @typedef {Object} CandlestickChartMetricSnapshot
 * @property {number} candleCount Number of candles in the dataset
 * @property {number} avgTailRatio Legacy average wick/body ratio across the dataset
 * @property {number} longTailCandles Candles where either wick is at least 50% of the total candle range
 * @property {number} longTailSharePercent Share of long-tail candles in percent
 * @property {number} avgCloseMovePercent Average close-to-close percent move
 * @property {number} closeTrendStdDev Standard deviation of close-to-close percent moves
 * @property {number} discontinuities Number of close jumps above 1%
 * @property {number} discontinuitySharePercent Share of jump candles in percent
 * @property {number} maxCloseMovePercent Largest close-to-close percent move
 * @property {number} priceGaps Number of candles whose open is outside the previous candle low-high range
 * @property {number} priceGapSharePercent Share of open-outside-previous-range candles in percent
 * @property {number} fenceCandles Number of candles whose high and low are within 0.005% of the previous candle
 * @property {number} fenceSharePercent Share of fence candles in percent
 * @property {number} railCandles Number of candles whose high-low height is larger than 50% of the supplied spread
 * @property {number} railSharePercent Share of rail candles in percent
 */

/**
 * Lightweight-charts candle point sent to the browser report.
 * @typedef {Object} CandlestickChartPoint
 * @property {number} time Candle open time in unix seconds
 * @property {number} open Open price
 * @property {number} high Highest price
 * @property {number} low Lowest price
 * @property {number} close Close price
 * @property {number} volume Base volume
 * @property {number} quoteVolume Quote volume or locally calculated notional
 * @property {number | null | undefined} trades Number of trades when known
 * @property {NiceChartCandleSource | undefined} source Candle source label
 */

/**
 * Simulated trade used by the trader comparison report.
 * @typedef {ResultItem & {
 *   bid: number,
 *   ask: number,
 *   mid: number,
 *   spread: number,
 *   isClosingTrade?: boolean,
 *   mmCurrentAction?: string,
 *   skipReason?: string,
 *   diagnostics?: Object
 * }} NiceChartSimulatedTrade
 */

/**
 * Chart dataset rendered by the browser report for one timeframe and one series.
 * @typedef {Object} CandlestickChartDataset
 * @property {NiceChartQuality} quality Dataset quality label
 * @property {CandlestickChartMetricSnapshot} metrics Precomputed metrics for the dataset
 * @property {CandlestickChartPoint[]} candles Lightweight-charts candle points
 * @property {number} [simStartIndex] Index in `candles` where simulation candles begin; absent when there is no sim/history split
 */

/**
 * Compact order level used for price overlays in the browser report.
 * @typedef {Object} CandlestickChartOrderLevel
 * @property {number} price Price level
 * @property {number} amount Base amount at the level
 * @property {'buy' | 'sell'} side Side of the level
 */

/**
 * Best bid/best ask pair used by the chart overlay.
 * @typedef {Object} CandlestickChartSpreadLevels
 * @property {CandlestickChartOrderLevel | null} minAsk Best ask level or `null`
 * @property {CandlestickChartOrderLevel | null} maxBid Best bid level or `null`
 */

/**
 * Order lines shown on the browser charts.
 * @typedef {Object} CandlestickChartOrderLines
 * @property {CandlestickChartSpreadLevels} spread Best bid and ask overlays
 * @property {DepthItem[]} asks Visible ask levels
 * @property {DepthItem[]} bids Visible bid levels
 */

/**
 * MongoDB record shape used by the chart candle collection.
 *
 * @typedef {Candle & {
 *   _id: string,
 *   exchange: string,
 *   pair: string,
 *   timeframe: NiceChartTimeframe
 * }} ChartCandleDocument
 */

/**
 * Public Nice Chart service interface.
 * @typedef {Object} NiceChartService
 * @property {(options?: NiceChartInitOptions) => Promise<NiceChartDiagnostics>} init Initializes the service state
 * @property {(options?: NiceChartWarmupOptions) => Promise<NiceChartDiagnostics>} warmupHistory Warmups persisted/exchange history
 * @property {(trades: TradesResult, options?: NiceChartWarmupOptions) => Promise<number>} ingestTrades Ingests runtime trades into the rolling buffer
 * @property {(options?: NiceChartBuildOptions) => NiceChartBuildResult} buildCandles Builds candles for the requested timeframe
 * @property {(options?: NiceChartPriceRequestOptions) => Promise<NiceChartPriceResult>} getNextPrice Builds the next in-spread corridor
 * @property {(options?: TraderPickTradeActionOptions) => Promise<MmCurrentAction>} [pickTradeAction] Chooses Trader execution mode using Nice Chart execution context
 * @property {(options?: TraderLimitInOrderBookAmountOptions) => Promise<TraderLimitInOrderBookAmountResult>} [limitInOrderBookAmount] Limits in-order-book size using Nice Chart own-vs-third-party and VWAP rules
 * @property {(options?: object) => { coin1AmountFilled: number, coin2AmountFilled: number }} [attributeThirdPartyFillFromMatchPlan] Attributes executeInOrderBook fills to the third-party portion of the expected match path
 * @property {(runtime: import('types/bot/trader.d.js').TraderRuntime) => number} getNiceChartCloseTradeLeadMs Resolves the preferred explicit candle-closing trade lead time
 * @property {(runtime: import('types/bot/trader.d.js').TraderRuntime, now: number, regularInterval: number) => NiceChartCloseWindowPlan} planClosingTradeIteration Plans an explicit candle-closing trade iteration
 * @property {() => NiceChartDiagnostics} getDiagnostics Returns the latest diagnostics snapshot
 * @property {(timeframeMs?: number) => Promise<NiceChartHistoryIntegrityResult>} checkHistoryIntegrity Validates persisted history continuity
 * @property {(now?: number) => NiceChartBaseHistoryContinuitySummary} [getBaseHistoryContinuitySummary] Summarizes the latest gapless base-candle tail
 */

/**
 * Metrics for one side of the trader-vs-nice comparison report.
 * @typedef {Object} NiceChartTraderMetrics
 * @property {number} avgTailRatio Average wick/body ratio for the generated candles
 * @property {number} stepVolatility Average close-to-close move in percent
 * @property {number} discontinuities Number of jumps above 1%
 * @property {number} spreadUtilization Average spread utilization in the 0..1 range
 * @property {number} orderBookAggression Average order-book aggression in the 0..1 range
 * @property {Record<string, number>} [skipReasons] Skip/correction reason counts for Nice Chart decisions
 * @property {Record<string, number>} [actions] Action counts by trader decision type
 * @property {Record<string, number>} [niceChartModes] Nice Chart mode counts observed during the simulation
 * @property {number} [orderBookBidLevelsMatched] Total visible bid rows fully or partially consumed by simulated order-book sells
 * @property {number} [orderBookAskLevelsMatched] Total visible ask rows fully or partially consumed by simulated order-book buys
 * @property {number} [orderBookBidQuoteMatched] Total quote volume matched against bid levels
 * @property {number} [orderBookAskBaseMatched] Total base volume matched against ask levels
 * @property {number} [orderBookBidExtensionPercent] Maximum outward bid-side boundary extension percent
 * @property {number} [orderBookAskExtensionPercent] Maximum outward ask-side boundary extension percent
 * @property {number} [spreadCorridorChecks] Number of decision-level spread corridor checks
 * @property {number} [spreadCorridorViolations] Number of decision-level spread corridor violations
 * @property {number} [spreadTradeCorridorChecks] Number of actual simulated trade price checks against the corridor
 * @property {number} [spreadTradeCorridorViolations] Number of actual simulated trade prices outside the corridor
 * @property {Array<Object>} [spreadTradeViolationSamples] Sample of actual simulated trades that violated the corridor
 */

/**
 * Market formatting metadata passed to the browser report.
 * @typedef {Object} NiceChartPairInfo
 * @property {string} pair Trading pair
 * @property {string} coin1 Base coin
 * @property {string} coin2 Quote coin
 * @property {number} coin1Decimals Base amount precision
 * @property {number} coin2Decimals Price precision
 * @property {number} coin2DecimalsForStable Stable-quote precision used for notional formatting
 */

/**
 * Connector feature flags surfaced in the browser report.
 * @typedef {Object} NiceChartConnectorFeatures
 * @property {string | undefined} [marketDataSource] Connector-declared preferred market data source (`candles`, `trades`, etc.)
 * @property {boolean | undefined} [marketDataSourceDegraded] Whether the connector-declared source has known limitations
 * @property {boolean | undefined} [candlesHistoryNoSince] Whether `getCandlesHistory()` rejects/ignores the `since` parameter
 */

/**
 * Report payload for pure candle inspection mode.
 * @typedef {Object} NiceChartCandlesReport
 * @property {'candles'} layout Layout id expected by the browser UI
 * @property {Record<string, CandlestickChartDataset>} charts One dataset per timeframe
 * @property {Object} metrics High-level summary metrics for the report header
 */

/**
 * Report payload for trader baseline vs Nice Chart comparison mode.
 * @typedef {Object} NiceChartTraderReport
 * @property {'trader'} layout Layout id expected by the browser UI
 * @property {Record<string, { baseline: CandlestickChartDataset, nice: CandlestickChartDataset }>} charts Paired datasets per timeframe
 * @property {{ baseline: NiceChartTraderMetrics, nice: NiceChartTraderMetrics, baseTimeframe: '5m', simulationStartTs: number, simulationDurationMs: number, simulationSpeedPerSecond: number, niceChartCorridorAdjustments: number, baseTimeframeSec: number, simGranularitySec: number, simCandlesCount: number }} metrics Comparison summary
 * @property {{ baselineTrades: NiceChartSimulatedTrade[], niceTrades: NiceChartSimulatedTrade[], baselineOrderBookInfo?: OrderBookInfo, niceOrderBookInfo?: OrderBookInfo, baselineOrderLines?: CandlestickChartOrderLines, niceOrderLines?: CandlestickChartOrderLines }} [simulation] Simulated trades and final order-book snapshots exposed for debugging trader-mode pricing
 */

/**
 * Top-level payload returned by `tests/features/nice_chart.test.js` and consumed by the browser UI.
 * @typedef {Object} NiceChartTestReport
 * @property {'candles' | 'trader'} mode Selected report mode
 * @property {'snapshot' | 'db'} seedMode How the report was seeded
 * @property {string} exchange Exchange display name
 * @property {string} pair Trading pair
 * @property {NiceChartPairInfo} pairInfo Market formatting metadata for the browser UI
 * @property {NiceChartConnectorFeatures} connectorFeatures Connector feature flags relevant to the report
 * @property {CandlestickChartOrderLines} orderLines Order book overlays for the charts
 * @property {OrderBookInfo | undefined} orderBookInfo Extended order-book metrics for side panels
 * @property {NiceChartDiagnostics} diagnostics Nice Chart diagnostics snapshot
 * @property {'native' | 'exchange_trades' | null} dbFreshSource Fresh candle source type if new candles were saved during `db` seed prefetch, null otherwise
 * @property {Object} params Selected runtime parameters included in the side panel
 * @property {NiceChartCandlesReport | NiceChartTraderReport} report Report body for the active mode
 */

module.exports = {};
