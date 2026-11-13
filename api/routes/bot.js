// @ts-nocheck — FastifyRequest generics disagree with JWT `user` decoration in this package.
'use strict';

/**
 * @module api/routes/bot
 * Bot bootstrap metadata (`GET /api/v1/bot`).
 */

const { getBotInfo } = require('../services/bot');
const { getAuthenticatedUser, routeAccess } = require('../lib/auth');
const webuiLog = require('../lib/webuiLog');

/**
 * Registers bot info route (requires JWT; any role).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function botRoutes(fastify) {
  fastify.get('/bot', routeAccess(fastify, 'read-only'), async (request) => {
    const user = getAuthenticatedUser(request);
    const info = getBotInfo();
    webuiLog.debug(
        `Bot bootstrap for ${user.login}: ${info.pair} @ ${info.exchange} v${info.version}.`,
    );
    return info;
  });
}

module.exports = botRoutes;
