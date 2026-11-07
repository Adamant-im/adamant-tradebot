'use strict';

/**
 * @module api/routes/account
 * Structured account endpoints (balances, open orders) without commandTxs markdown.
 */

const { z } = require('zod');

const { routeAccess } = require('../lib/auth');
const { parseOrThrow, queryBoolean } = require('../lib/validate');
const { pairQuerySchema } = require('../schemas/market');
const accountService = require('../services/account');

const balancesQuerySchema = z.object({
  noCache: queryBoolean(),
});

/**
 * Registers `/api/v1/account/*` routes (all require JWT; any role).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function accountRoutes(fastify) {
  const readAccess = routeAccess(fastify, 'read-only');

  fastify.get('/account/balances', readAccess, async (request) => {
    const query = parseOrThrow(balancesQuerySchema, request.query);
    return accountService.getBalances({ noCache: query.noCache });
  });

  fastify.get('/account/orders', readAccess, async (request) => {
    const query = parseOrThrow(pairQuerySchema, request.query);
    return accountService.getOpenOrders(query.pair, { noCache: query.noCache });
  });
}

module.exports = accountRoutes;
