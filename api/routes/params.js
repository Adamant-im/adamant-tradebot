// @ts-nocheck — delegates to `services/params` (commandTxs).
'use strict';

/**
 * @module api/routes/params
 * Trade-parameter CRUD; bodies validated with Zod, persistence via `commandTxs`.
 */

const log = require('../../helpers/log');
const { getAuthenticatedUser } = require('../lib/auth');
const { parseOrThrow } = require('../lib/validate');
const { paramsBodySchema, strategyBodySchema } = require('../schemas/params');
const paramsService = require('../services/params');
const { broadcastParamsUpdated } = require('../ws');

/**
 * Registers `/api/v1/params` routes (all require JWT).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function paramsRoutes(fastify) {
  fastify.get('/params', {
    preHandler: [fastify.authenticate],
  }, async () => {
    return paramsService.getCurrentParams();
  });

  fastify.put('/params', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(paramsBodySchema, request.body);

    await paramsService.setParams(body);
    log.log(`Trade parameters updated by ${user.login}.`);
    broadcastParamsUpdated(fastify.io);
    return paramsService.getCurrentParams();
  });

  fastify.put('/params/strategy', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const body = parseOrThrow(strategyBodySchema, request.body);
    paramsService.setStrategy(body.strategy);
    broadcastParamsUpdated(fastify.io);
    return { strategy: body.strategy };
  });
}

module.exports = paramsRoutes;
