'use strict';

/**
 * @module routes/debugAuth
 * Bearer-token check for the debug API (`GET /db`).
 * @typedef {import('./localhostOnly').LocalRequestInfo} LocalRequestInfo
 */

const crypto = require('crypto');

const log = require('../helpers/log');

/** Minimum length for `api.debug_token` */
const MIN_DEBUG_TOKEN_LENGTH = 32;

/**
 * Returns whether `api.debug_token` is missing or too short to protect the debug API.
 *
 * @param {unknown} token Value of `config.api.debug_token`
 * @returns {boolean}
 */
function isWeakDebugToken(token) {
  return typeof token !== 'string' || token.trim().length < MIN_DEBUG_TOKEN_LENGTH;
}

/**
 * Compares two secrets in constant time, whatever their lengths.
 *
 * @param {string} provided Token sent by the client
 * @param {string} expected Configured token
 * @returns {boolean}
 */
function isSameSecret(provided, expected) {
  const providedHash = crypto.createHash('sha256').update(provided).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();

  return crypto.timingSafeEqual(providedHash, expectedHash);
}

/**
 * Creates a Fastify `onRequest` hook that requires `Authorization: Bearer <api.debug_token>`.
 *
 * @param {string} token Expected token (`config.api.debug_token`)
 * @returns {(request: LocalRequestInfo, reply: import('fastify').FastifyReply) => Promise<import('fastify').FastifyReply | void>}
 */
function createDebugTokenHook(token) {
  const expected = token.trim();

  return async function debugTokenHook(request, reply) {
    const header = request.headers?.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;

    if (!match || !isSameSecret(match[1].trim(), expected)) {
      log.warn(`Debug API: Rejected ${request.method} ${request.url} from ip=${request.ip}: missing or invalid api.debug_token.`);

      return reply.code(401).send({
        success: false,
        err: 'Unauthorized',
      });
    }
  };
}

module.exports = {
  MIN_DEBUG_TOKEN_LENGTH,
  createDebugTokenHook,
  isWeakDebugToken,
};
