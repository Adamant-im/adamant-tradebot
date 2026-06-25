'use strict';

/**
 * @module api/schemas/params
 * Zod schemas for `PUT /api/v1/params` and `PUT /api/v1/params/strategy`.
 */

const { z } = require('zod');
const constants = require('../../helpers/const');

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
  orderbookBuilding: z.object({
    enabled: z.boolean(),
    maxOrders: z.coerce.number().int(),
  }),
  liquiditySpread: z.object({
    enabled: z.boolean(),
    spread: z.coerce.number(),
    baseAmount: z.coerce.number(),
    quoteAmount: z.coerce.number(),
    trend: z.enum(['uptrend', 'downtrend', 'middle']),
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
  }),
});

const strategyBodySchema = z.object({
  strategy: z.string().refine((value) => constants.MM_POLICIES.includes(value), {
    message: 'Invalid strategy',
  }),
});

module.exports = {
  paramsBodySchema,
  strategyBodySchema,
};
