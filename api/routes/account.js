'use strict';

/**
 * @module api/routes/account
 * Structured account endpoints (balances, open orders) without commandTxs markdown.
 */

const { parseOrThrow } = require('../lib/validate');
const { pairQuerySchema } = require('../schemas/market');
const accountService = require('../services/account');

/**
 * Registers `/api/v1/account/*` routes (all require JWT).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function accountRoutes(fastify) {
  fastify.get('/account/balances', {
    preHandler: [fastify.authenticate],
  }, async () => {
    return accountService.getBalances();
  });

  fastify.get('/account/orders', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const query = parseOrThrow(pairQuerySchema, request.query);
    return accountService.getOpenOrders(query.pair);
  });
}

module.exports = accountRoutes;
