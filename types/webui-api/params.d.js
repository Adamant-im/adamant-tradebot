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
 * `GET /api/v1/params` and `PUT /api/v1/params` body (camelCase).
 *
 * @typedef {Object} WebUiTradeParams
 * @property {{ isActive: boolean, strategy: string }} mm Global MM switch and policy
 * @property {{ from: number, to: number }} amount Trade amount range
 * @property {{ type: WebUiIntervalUnit, from: number, to: number }} interval Trade interval range
 * @property {number} buyPercent Buy-side share in percent (0–100)
 * @property {{ enabled: boolean, maxOrders: number }} orderbookBuilding Dynamic order book settings
 * @property {{
 *   enabled: boolean,
 *   spread: number,
 *   baseAmount: number,
 *   quoteAmount: number,
 *   trend: WebUiLiquidityTrend
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
 *   highPrice?: number
 * }} priceWatching Price watcher configuration
 * @property {{ enabled: boolean, initiator: string }} priceMaker Price maker module settings
 * @property {{ enabled: boolean, policy: WebUiCleanerPolicy }} cleaner Order book cleaner
 * @property {{ enabled: boolean }} fundBalancer Two-key fund balancer (requires second API key)
 * @property {{ enabled: boolean }} orderbookAntiGap Anti-gap module switch
 */

/**
 * `PUT /api/v1/params/strategy` body.
 *
 * @typedef {Object} WebUiStrategyBody
 * @property {string} strategy One of `helpers/const.MM_POLICIES`
 */

module.exports = {};
