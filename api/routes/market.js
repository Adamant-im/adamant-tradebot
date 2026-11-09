'use strict';

/**
 * @module api/routes/market
 * Authenticated market-data routes backed by `api/services/market.js`.
 */

const { routeAccess } = require('../lib/auth');
const { parseOrThrow } = require('../lib/validate');
const {
  orderBookQuerySchema,
  ohlcQuerySchema,
  pairQuerySchema,
  tradesQuerySchema,
} = require('../schemas/market');
const marketService = require('../services/market');

/**
 * Registers `/api/v1/market/*` routes (all require JWT; any role).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function marketRoutes(fastify) {
  const readAccess = routeAccess(fastify, 'read-only');

  fastify.get('/market/ticker', readAccess, async (request) => {
    const query = parseOrThrow(pairQuerySchema, request.query);
    return marketService.getTicker(query.pair, { noCache: query.noCache });
  });

  fastify.get('/market/orderbook', readAccess, async (request) => {
    const query = parseOrThrow(orderBookQuerySchema, request.query);
    return marketService.getOrderBook(query.pair, query.limit, { noCache: query.noCache });
  });

  fastify.get('/market/trades', readAccess, async (request) => {
    const query = parseOrThrow(tradesQuerySchema, request.query);
    return marketService.getTrades(query.pair, query.limit, { noCache: query.noCache });
  });

  fastify.get('/market/ohlc', readAccess, async (request) => {
    const query = parseOrThrow(ohlcQuerySchema, request.query);
    return marketService.getOhlc({
      pair: query.pair,
      timeframe: query.timeframe,
      since: query.since,
      limit: query.limit,
      excludePartial: query.excludePartial,
    }, { noCache: query.noCache });
  });
}

module.exports = marketRoutes;
