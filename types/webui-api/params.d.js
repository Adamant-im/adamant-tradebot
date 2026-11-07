'use strict';

/**
 * Market-making interval unit as exposed to WebUI.
 *
 * @typedef {'sec' | 'min' | 'hour'} WebUiIntervalUnit
 */

/**
 * Liquidity trend direction for spread maintenance UI.
 *
 * @typedef {'uptrend' | 'downtrend' | 'middle'} WebUiLiquidityTrend
 */

/**
 * Order book cleaner policy.
 *
 * @typedef {'minimumSpread' | 'smallSpread' | 'preventCheating' | 'takeAll'} WebUiCleanerPolicy
 */

/**
 * Price watching mode: fixed price range vs external source with deviation.
 *
 * @typedef {'price' | 'source'} WebUiPriceWatchingType
 */

/**
 * Price watcher action when the market price leaves the watched range.
 *
 * @typedef {'fill' | 'prevent'} WebUiPriceWatcherAction
 */

/**
 * Quote hunter post-fill policy.
 *
 * @typedef {'dump' | 'keep' | 'none'} WebUiQuoteHunterPolicy
 */

/**
 * Volatility chart rate.
 *
 * @typedef {'modest' | 'normal' | 'dynamic'} WebUiVolatilityRate
 */

/**
 * Balance equalizer strategy.
 *
 * @typedef {'bp' | 'market'} WebUiBalanceEqualizerStrategy
 */

/**
 * Ladder/grid instance (`/enable ld` or `/enable ld2`).
 *
 * @typedef {Object} WebUiLadderParams
 * @property {boolean} enabled
 * @property {number} amount
 * @property {string} amountCoin
 * @property {number} count
 * @property {number} stepPercent
 * @property {number} midPrice
 * @property {'auto' | 'manual'} midPriceType
 * @property {number} amountGain
 * @property {number} sellAmountAdjPercent
 * @property {number} buyAmountAdjPercent
 * @property {number} sellPriceAdjPercent
 * @property {number} buyPriceAdjPercent
 * @property {boolean} autoAmountAdj
 * @property {string} [recheckInterval] Recheck interval, TWAP-style (`15sec`, `2min`)
 * @property {number} [stopLd2Trigger] Stop-ld2 fill percent (ladder 1 only)
 * @property {boolean} [paused] Runtime pause flag
 * @property {string} [pauseReason] `mm_ladderPauseReason` / `mm_ladderPauseReason2`
 * @property {number} [pauseTs] `mm_ladderPauseTs` / `mm_ladderPauseTs2` (epoch ms)
 */

/**
 * `GET /api/v1/params` and `PUT /api/v1/params` body (camelCase).
 *
 * @typedef {Object} WebUiTradeParams
 * @property {{ isActive: boolean, strategy: string }} mm Global MM switch and policy
 * @property {{ from: number, to: number }} amount Trade amount range
 * @property {{ type: WebUiIntervalUnit, from: number, to: number }} interval Trade interval range
 * @property {number} buyPercent Buy-side share in percent (0–100)
 * @property {{ enabled: boolean, obLimitPercent: number }} trader Volume trader (`/enable t`) settings
 * @property {{ enabled: boolean, maxOrders: number, maxOrderPercent: number }} orderbookBuilding Dynamic order book settings
 * @property {{
 *   enabled: boolean,
 *   spread: number,
 *   spreadMin: number,
 *   baseAmount: number,
 *   quoteAmount: number,
 *   trend: WebUiLiquidityTrend,
 *   support: boolean
 * }} liquiditySpread Liquidity / spread module settings
 * @property {{
 *   type: WebUiPriceWatchingType,
 *   enabled: boolean,
 *   source?: string,
 *   priceFrom?: number | null,
 *   priceTo?: number | null,
 *   currency?: string | null,
 *   deviation?: number,
 *   policy?: 'strict' | 'smart' | null,
 *   lowPrice?: number,
 *   highPrice?: number,
 *   action: WebUiPriceWatcherAction
 * }} priceWatching Price watcher: range uses `currency`; source-follow uses `PAIR@Exchange` in `source`
 * @property {{ enabled: boolean, initiator: string }} priceMaker Price maker (legacy; not edited in WebUI Parameters)
 * @property {{ enabled: boolean, policy: WebUiCleanerPolicy }} cleaner Order book cleaner
 * @property {{ enabled: boolean }} fundBalancer Two-key fund balancer (requires second API key)
 * @property {{ enabled: boolean, maxOrderPercent: number }} orderbookAntiGap Anti-gap module
 * @property {{ enabled: boolean, price: number }} supportPrice Support price (`/enable sp`)
 * @property {{ enabled: boolean }} balanceWatcher Balance watcher (`/enable bw`)
 * @property {WebUiLadderParams} ladder Ladder/grid 1 (`/enable ld`)
 * @property {WebUiLadderParams} [ladder2] Ladder/grid 2 (`/enable ld2`); optional on older clients
 * @property {{
 *   enabled: boolean,
 *   policy: WebUiQuoteHunterPolicy,
 *   maxOrderDumpPercent: number,
 *   max1hDumpPercent: number,
 *   max24hDumpPercent: number
 * }} quoteHunter Quote hunter (`/enable qh`)
 * @property {{ enabled: boolean, rate: WebUiVolatilityRate }} volatilityChart Volatility chart (`/enable vc`)
 * @property {{ enabled: boolean }} volumeVolatility Volume volatility (`/enable vv`)
 * @property {{ enabled: boolean }} priceMakerVolume Price maker volume (`/enable pmv`)
 * @property {{
 *   enabled: boolean,
 *   strategy: WebUiBalanceEqualizerStrategy,
 *   maxSlippagePercent: number
 * }} balanceEqualizer Balance equalizer (`/enable be`)
 * @property {{ enabled: boolean }} spreadMaintainer Spread maintainer (`/enable sm`)
 * @property {{ enabled: boolean, amount: number, amountPriority: number, amountCoin?: string }} orderNotifier Order notifier (`/enable on`)
 * @property {{ enabled: boolean, failedRequestsBeforeFallback: number }} niceChart Nice Chart (config)
 * @property {{
 *   enabled: boolean,
 *   safeModeThreshold: number,
 *   resetThreshold: number
 * }} sniperBotWatcher Sniper Bot Watcher (config)
 * @property {{ enabled: boolean }} twap TWAP runtime state (`t_isTwapActive`; not edited in Parameters)
 */

/**
 * `PUT /api/v1/params/strategy` body.
 *
 * @typedef {Object} WebUiStrategyBody
 * @property {string} strategy One of `helpers/const.MM_POLICIES`
 */

/**
 * Envelope for `PUT /api/v1/params` response and WS `params:updated`.
 *
 * @typedef {Object} WebUiParamsUpdatePayload
 * @property {WebUiTradeParams} params Current snapshot
 * @property {number} revision Monotonic revision for echo attribution
 * @property {'webui' | 'bot'} origin Who caused the change
 * @property {string | null} requestId Client `X-Request-Id` when origin is webui
 */

module.exports = {};
