'use strict';

/**
 * @module api/routes/status
 * Market-making quality (`GET /api/v1/status`). JWT required.
 */

const { getAuthenticatedUser, routeAccess } = require('../lib/auth');
const { getHealthPayload } = require('../../helpers/mmHealthState');

/**
 * Registers MM status route (requires JWT; any role).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function statusRoutes(fastify) {
  fastify.get('/status', routeAccess(fastify, 'read-only'), async (request) => {
    getAuthenticatedUser(request);
    return getHealthPayload();
  });
}

module.exports = statusRoutes;
