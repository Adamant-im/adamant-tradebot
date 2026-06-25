'use strict';

/**
 * @module routes/debug
 * Debug routes for development (`GET /db`).
 */

const db = require('../modules/DB');

/**
 * Registers debug routes on a Fastify instance.
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function debugRoutes(fastify) {
  fastify.get('/db', async (request, reply) => {
    const { tb } = request.query;
    const collection = tb ? db[tb]?.db : undefined;

    if (!collection) {
      return reply.code(400).send({
        err: 'Unknown table name',
        success: false,
      });
    }

    try {
      const result = await collection.find().toArray();
      return {
        result,
        success: true,
      };
    } catch (err) {
      return reply.code(500).send({
        err: String(err),
        success: false,
      });
    }
  });
}

module.exports = debugRoutes;
