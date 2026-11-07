// @ts-nocheck — FastifyRequest generics disagree with JWT `user` decoration in this package.
'use strict';

/**
 * @module api/routes/config
 * Sanitized bot config for WebUI admins (`GET /api/v1/config`).
 */

const { getAuthenticatedUser, routeAccess } = require('../lib/auth');
const webuiLog = require('../lib/webuiLog');
const { getPublicConfig } = require('../services/config');

/**
 * Registers `GET /api/v1/config` (requires JWT; `admin` role when the token carries a role).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function configRoutes(fastify) {
  fastify.get('/config', routeAccess(fastify, 'admin'), async (request) => {
    const user = getAuthenticatedUser(request);

    webuiLog.log(`Config snapshot requested by ${user.login}.`);
    return getPublicConfig();
  });
}

module.exports = configRoutes;
