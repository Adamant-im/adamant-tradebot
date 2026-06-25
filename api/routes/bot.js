'use strict';

/**
 * @module api/routes/bot
 * Bot bootstrap metadata (`GET /api/v1/bot`).
 */

const { getBotInfo } = require('../services/bot');

/**
 * Registers bot info route (requires JWT).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function botRoutes(fastify) {
  fastify.get('/bot', {
    preHandler: [fastify.authenticate],
  }, async () => {
    return getBotInfo();
  });
}

module.exports = botRoutes;
