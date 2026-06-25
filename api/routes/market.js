'use strict';

/**
 * @module api/routes/market
 * Authenticated market-data routes backed by `api/services/market.js`.
 */

const { parseOrThrow } = require('../lib/validate');
const {
  orderBookQuerySchema,
  ohlcQuerySchema,
  pairQuerySchema,
  tradesQuerySchema,
} = require('../schemas/market');
const marketService = require('../services/market');

/**
 * Registers `/api/v1/market/*` routes (all require JWT).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function marketRoutes(fastify) {
  fastify.get('/market/ticker', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const query = parseOrThrow(pairQuerySchema, request.query);
    return marketService.getTicker(query.pair);
  });

  fastify.get('/market/orderbook', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const query = parseOrThrow(orderBookQuerySchema, request.query);
    return marketService.getOrderBook(query.pair, query.limit);
  });

  fastify.get('/market/trades', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const query = parseOrThrow(tradesQuerySchema, request.query);
    return marketService.getTrades(query.pair, query.limit);
  });

  fastify.get('/market/ohlc', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const query = parseOrThrow(ohlcQuerySchema, request.query);
    return marketService.getOhlc({
      pair: query.pair,
      timeframe: query.timeframe,
      since: query.since,
      limit: query.limit,
      excludePartial: query.excludePartial,
    });
  });
}

module.exports = marketRoutes;
