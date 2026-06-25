'use strict';

/**
 * @module api/schemas/market
 * Zod schemas for market-data query parameters.
 */

const { z } = require('zod');

/** Optional `pair` override; defaults to bot `config.pair` in the service layer. */
const pairQuerySchema = z.object({
  pair: z.string().optional(),
});

/** `GET /api/v1/market/orderbook` query schema. */
const orderBookQuerySchema = pairQuerySchema.extend({
  limit: z.coerce.number().int().positive().optional(),
});

/** `GET /api/v1/market/trades` query schema. */
const tradesQuerySchema = pairQuerySchema.extend({
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

/** `GET /api/v1/market/ohlc` query schema (`timeframe` is required). */
const ohlcQuerySchema = pairQuerySchema.extend({
  timeframe: z.string().min(1),
  since: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  excludePartial: z.coerce.boolean().optional(),
});

module.exports = {
  pairQuerySchema,
  orderBookQuerySchema,
  tradesQuerySchema,
  ohlcQuerySchema,
};
