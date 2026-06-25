'use strict';

/**
 * @module routes/health
 * Health check route (`GET /ping`).
 */

/**
 * Registers health routes on a Fastify instance.
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function healthRoutes(fastify) {
  fastify.get('/ping', async () => ({
    timestamp: Date.now(),
  }));
}

module.exports = healthRoutes;
