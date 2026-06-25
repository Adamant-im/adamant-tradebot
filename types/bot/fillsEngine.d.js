'use strict';

/**
 * Type definitions for `helpers/fillsEngine.js`.
 *
 * @module types/bot/fillsEngine.d
 */

/**
 * @typedef {import('types/bot/orderMetrics.d.js').VerifyFillResult} VerifyFillResult
 * @typedef {import('types/bot/orderMetrics.d.js').FillOrder} FillOrder
 * @typedef {import('types/bot/orderMetrics.d.js').FillsByPurpose} FillsByPurpose
 * @typedef {import('types/bot/orderMetrics.d.js').FillsDbGeneralData} FillsDbGeneralData
 * @typedef {import('types/bot/orderMetrics.d.js').FillsDbRecord} FillsDbRecord
 * @typedef {import('types/bot/orderMetrics.d.js').FilledStatsRecord} FilledStatsRecord
 * @typedef {import('types/bot/orderMetrics.d.js').FillsEngineKey} FillsEngineKey
 * @typedef {import('types/bot/orderMetrics.d.js').FillsEngineProcessParams} FillsEngineProcessParams
 * @typedef {import('types/bot/orderMetrics.d.js').FillsEngineProcessResult} FillsEngineProcessResult
 * @typedef {import('types/bot/orderMetrics.d.js').FillsEngineStatsResult} FillsEngineStatsResult
 * @typedef {import('types/bot/ordersDb.d.js').BotOrderDbRecord} BotOrderDbRecord
 */

/**
 * Minimal exchange API surface required by fill verification.
 *
 * @typedef {Object} FillsEngineTraderApi
 * @property {boolean} [isPerpetual] Whether the API instance targets a perpetual account
 * @property {boolean} [isSecondAccount] Whether the API instance targets the second trade account
 * @property {(orderId: string | number, pair: string) => Promise<{ status?: string, amountExecuted?: number, volumeExecuted?: number } | undefined>} [getOrderDetails] Optional order-status lookup
 */

/**
 * Public export of `helpers/fillsEngine.js`.
 *
 * @typedef {Object} FillsEngineModule
 * @property {(order: FillOrder | BotOrderDbRecord, api: FillsEngineTraderApi, callerName: string) => Promise<VerifyFillResult | undefined>} verifyOrderFilled Verifies a fill via exchange API
 * @property {(stats: FillsEngineStatsResult) => string} composeEpochStatsInfo Formats epoch stats for logs and notifications
 * @property {() => FillsByPurpose} emptyFill Returns a zeroed fills accumulator
 * @property {(fills: FillsByPurpose, dbOrder: BotOrderDbRecord, orderArrayType: 'partlyFilledOrders' | 'filledOrders', coin1AmountFilled: number, coin2AmountFilled?: number, isFillConfirmed?: boolean, takerOrderFilled?: boolean) => void} addFill Appends one fill fragment to an accumulator
 * @property {(generalData: FillsDbGeneralData | Record<string, unknown>, fills: FillsByPurpose, api: FillsEngineTraderApi) => Promise<void>} addFillsDbRecord Persists a fillsDb record when non-empty
 * @property {(statsKey: FillsEngineKey) => Promise<FilledStatsRecord>} ensureStatsRecord Ensures a filledStatsDb epoch record exists
 * @property {(params: FillsEngineProcessParams) => Promise<FillsEngineProcessResult | undefined>} processFills Verifies and aggregates unprocessed fillsDb records
 * @property {(statsKey: FillsEngineKey) => Promise<FillsEngineStatsResult>} getStats Returns cumulative epoch stats with derived metrics
 */

module.exports = {};
