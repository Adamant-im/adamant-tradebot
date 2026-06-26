'use strict';

/**
 * @module routes/localhostOnly
 * Fastify hook that rejects non-loopback clients.
 */

/** Client addresses treated as local for debug and health APIs */
const LOCALHOST_IPS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);

/**
 * Returns whether a Fastify request originated from the local machine.
 *
 * @param {import('fastify').FastifyRequest} request Incoming request
 * @returns {boolean}
 */
function isLocalhostRequest(request) {
  return LOCALHOST_IPS.has(request.ip);
}

/**
 * Fastify `onRequest` hook that responds with 403 for remote clients.
 *
 * @param {import('fastify').FastifyRequest} request Incoming request
 * @param {import('fastify').FastifyReply} reply Outgoing reply
 * @returns {Promise<void>}
 */
async function localhostOnlyHook(request, reply) {
  if (!isLocalhostRequest(request)) {
    return reply.code(403).send({
      success: false,
      err: 'Forbidden',
    });
  }
}

module.exports = {
  LOCALHOST_IPS,
  isLocalhostRequest,
  localhostOnlyHook,
};
