'use strict';

/**
 * @module api/schemas/params
 * Zod schemas for `PUT /api/v1/params` and `PUT /api/v1/params/strategy`.
 */

const { z } = require('zod');
const constants = require('../../helpers/const');

const ladderSchema = z.object({
  enabled: z.boolean(),
  amount: z.coerce.number(),
  amountCoin: z.string(),
  count: z.coerce.number().int(),
  stepPercent: z.coerce.number(),
  midPrice: z.coerce.number(),
  midPriceType: z.enum(['auto', 'manual']),
  amountGain: z.coerce.number(),
  sellAmountAdjPercent: z.coerce.number(),
  buyAmountAdjPercent: z.coerce.number(),
  sellPriceAdjPercent: z.coerce.number(),
  buyPriceAdjPercent: z.coerce.number(),
  autoAmountAdj: z.boolean(),
  recheckInterval: z.union([z.string(), z.coerce.number()]).optional(),
  stopLd2Trigger: z.coerce.number().optional(),
  paused: z.boolean().optional(),
  pauseReason: z.string().optional(),
  pauseTs: z.coerce.number().optional(),
});

const paramsBodySchema = z.object({
  mm: z.object({
    isActive: z.boolean(),
    strategy: z.string(),
  }),
  amount: z.object({
    from: z.coerce.number(),
    to: z.coerce.number(),
  }),
  interval: z.object({
    type: z.enum(['sec', 'min', 'hour']),
    from: z.coerce.number().int(),
    to: z.coerce.number().int(),
  }),
  buyPercent: z.coerce.number(),
  trader: z.object({
    enabled: z.boolean(),
    obLimitPercent: z.coerce.number(),
  }),
  orderbookBuilding: z.object({
    enabled: z.boolean(),
    maxOrders: z.coerce.number().int(),
    maxOrderPercent: z.coerce.number(),
  }),
  liquiditySpread: z.object({
    enabled: z.boolean(),
    spread: z.coerce.number(),
    spreadMin: z.coerce.number(),
    baseAmount: z.coerce.number(),
    quoteAmount: z.coerce.number(),
    trend: z.enum(['uptrend', 'downtrend', 'middle']),
    support: z.boolean(),
  }),
  priceWatching: z.object({
    enabled: z.boolean(),
    type: z.enum(['price', 'source']),
    source: z.string().optional(),
    priceFrom: z.coerce.number().nullable().optional(),
    priceTo: z.coerce.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    deviation: z.coerce.number().optional(),
    policy: z.enum(['strict', 'smart']).nullable().optional(),
    lowPrice: z.coerce.number().optional(),
    highPrice: z.coerce.number().optional(),
    action: z.enum(['fill', 'prevent']),
  }),
  priceMaker: z.object({
    enabled: z.boolean(),
    initiator: z.string(),
  }),
  cleaner: z.object({
    enabled: z.boolean(),
    policy: z.enum(['minimumSpread', 'smallSpread', 'preventCheating', 'takeAll']),
  }),
  fundBalancer: z.object({
    enabled: z.boolean(),
  }),
  orderbookAntiGap: z.object({
    enabled: z.boolean(),
    maxOrderPercent: z.coerce.number(),
  }),
  supportPrice: z.object({
    enabled: z.boolean(),
    price: z.coerce.number(),
  }),
  balanceWatcher: z.object({
    enabled: z.boolean(),
  }),
  ladder: ladderSchema,
  ladder2: ladderSchema.optional(),
  quoteHunter: z.object({
    enabled: z.boolean(),
    policy: z.enum(['dump', 'keep', 'none']),
    maxOrderDumpPercent: z.coerce.number(),
    max1hDumpPercent: z.coerce.number(),
    max24hDumpPercent: z.coerce.number(),
  }),
  volatilityChart: z.object({
    enabled: z.boolean(),
    rate: z.enum(['modest', 'normal', 'dynamic']),
  }),
  volumeVolatility: z.object({
    enabled: z.boolean(),
  }),
  priceMakerVolume: z.object({
    enabled: z.boolean(),
  }),
  balanceEqualizer: z.object({
    enabled: z.boolean(),
    strategy: z.enum(['bp', 'market']),
    maxSlippagePercent: z.coerce.number(),
  }),
  spreadMaintainer: z.object({
    enabled: z.boolean(),
  }),
  orderNotifier: z.object({
    enabled: z.boolean(),
    amount: z.coerce.number(),
    amountPriority: z.coerce.number(),
    amountCoin: z.string().optional(),
  }),
  niceChart: z.object({
    enabled: z.boolean(),
    failedRequestsBeforeFallback: z.coerce.number().int(),
  }),
  sniperBotWatcher: z.object({
    enabled: z.boolean(),
    safeModeThreshold: z.coerce.number().int(),
    resetThreshold: z.coerce.number().int(),
  }),
  twap: z.object({
    enabled: z.boolean(),
  }).optional(),
});

const strategyBodySchema = z.object({
  strategy: z.string().refine((value) => constants.MM_POLICIES.includes(/** @type {never} */ (value)), {
    message: 'Invalid strategy',
  }),
});

module.exports = {
  paramsBodySchema,
  strategyBodySchema,
};
