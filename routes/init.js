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

/**
 * Starts the debug/health API when `config.api.port` is set.
 *
 * Health (`/ping`) listens on all interfaces when enabled. Debug routes are
 * registered in an encapsulated plugin with a localhost-only hook.
 *
 * @returns {Promise<void>}
 */
async function initApi() {
  const fastify = Fastify({
    logger: false,
  });

  fastify.register(sensible);

  if (config.api.health) {
    await fastify.register(healthRoutes);
  }

  if (config.api.debug) {
    await fastify.register(async (debugApi) => {
      debugApi.addHook('onRequest', localhostOnlyHook);
      await debugApi.register(debugRoutes);
    });
  }

  await fastify.listen({
    port: config.api.port,
    host: '0.0.0.0',
  });

  const accessNotes = [];
  if (config.api.health) {
    accessNotes.push('health /ping on all interfaces');
  }
  if (config.api.debug) {
    accessNotes.push('debug /db on localhost only');
  }

  log.info(
      `API server is listening on port ${config.api.port}` +
      ` (${accessNotes.join('; ') || 'no routes enabled'}).`,
  );
}

module.exports = {
  initApi,
};
