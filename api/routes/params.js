// @ts-nocheck — delegates to `services/params` (commandTxs).
'use strict';

/**
 * @module api/routes/params
 * Trade-parameter CRUD; bodies validated with Zod, persistence via `commandTxs`.
 */

const { getAuthenticatedUser, routeAccess } = require('../lib/auth');
const webuiLog = require('../lib/webuiLog');
const { parseOrThrow } = require('../lib/validate');
const { paramsBodySchema, strategyBodySchema } = require('../schemas/params');
const paramsService = require('../services/params');
const { broadcastParamsUpdated } = require('../ws');

/**
 * Reads optional echo correlation id from the client.
 *
 * @param {import('fastify').FastifyRequest} request
 * @returns {string | null}
 */
function readRequestId(request) {
  const header = request.headers['x-request-id'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim().slice(0, 128);
  }
  return null;
}

/**
 * Registers `/api/v1/params` routes (all require JWT; writes require `manager`).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function paramsRoutes(fastify) {
  fastify.get('/params', routeAccess(fastify, 'read-only'), async () => {
    return paramsService.getCurrentParams();
  });

  fastify.put('/params', routeAccess(fastify, 'manager'), async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(paramsBodySchema, request.body);
    const requestId = readRequestId(request);

    const payload = await paramsService.setParams(body, { requestId });
    webuiLog.info(`Trade parameters updated by ${user.login} revision=${payload.revision}.`);
    broadcastParamsUpdated(undefined, payload);
    return payload;
  });

  fastify.put('/params/strategy', routeAccess(fastify, 'manager'), async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(strategyBodySchema, request.body);
    const requestId = readRequestId(request);
    const payload = paramsService.setStrategy(body.strategy, { requestId });
    webuiLog.info(`Strategy set to '${body.strategy}' by ${user.login} revision=${payload.revision}.`);
    broadcastParamsUpdated(undefined, payload);
    return { strategy: body.strategy, revision: payload.revision, requestId: payload.requestId };
  });
}

module.exports = paramsRoutes;
