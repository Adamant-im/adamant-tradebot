'use strict';

/**
 * @module routes/init
 * Debug and health HTTP API (Fastify).
 */

const Fastify = require('fastify');
const sensible = require('@fastify/sensible');

const log = require('../helpers/log');
const config = require('../modules/configReader');
const healthRoutes = require('./health');
const debugRoutes = require('./debug');
const { localhostOnlyHook } = require('./localhostOnly');
const { MIN_DEBUG_TOKEN_LENGTH, createDebugTokenHook, isWeakDebugToken } = require('./debugAuth');

/**
 * Builds the debug/health Fastify app without opening a listening socket.
 *
 * Health (`/ping`) answers on all interfaces when enabled. Debug routes (`/db`) are registered only
 * with a strong `api.debug_token`, in an encapsulated plugin that accepts direct localhost requests
 * carrying that token. A reverse proxy on the same host makes remote clients look local, so the
 * loopback check alone is not enough.
 *
 * @returns {Promise<{ fastify: import('fastify').FastifyInstance, accessNotes: string[] }>}
 */
async function buildApi() {
  const fastify = Fastify({
    logger: false,
  });

  /** @type {string[]} */
  const accessNotes = [];

  fastify.register(sensible);

  if (config.api.health) {
    await fastify.register(healthRoutes);
    accessNotes.push('health /ping on all interfaces');
  }

  if (config.api.debug) {
    if (isWeakDebugToken(config.api.debug_token)) {
      log.warn(
          `Debug API: /db is disabled because api.debug_token is missing or shorter than ${MIN_DEBUG_TOKEN_LENGTH} characters.`,
      );
    } else {
      await fastify.register(async (debugApi) => {
        debugApi.addHook('onRequest', localhostOnlyHook);
        debugApi.addHook('onRequest', createDebugTokenHook(config.api.debug_token));
        await debugApi.register(debugRoutes);
      });
      accessNotes.push('debug /db for direct localhost requests with api.debug_token');
    }
  }

  return {
    fastify,
    accessNotes,
  };
}

/**
 * Starts the debug/health API when `config.api.port` is set.
 *
 * @returns {Promise<void>}
 */
async function initApi() {
  const { fastify, accessNotes } = await buildApi();

  await fastify.listen({
    port: Number(config.api.port),
    host: '0.0.0.0',
  });

  log.info(
      `API server is listening on port ${config.api.port}` +
      ` (${accessNotes.join('; ') || 'no routes enabled'}).`,
  );
}

module.exports = {
  buildApi,
  initApi,
};
