// @ts-nocheck — registers routes/ws that delegate to commandTxs-backed services (params, commands, messages).
'use strict';

/**
 * @module api/server
 * Fastify HTTP server and Socket.IO entry point for the WebUI API (scenario A).
 */

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const sensible = require('@fastify/sensible');
const { Server } = require('socket.io');

const config = require('../modules/configReader');
const log = require('../helpers/log');
const { emitter, events } = require('../modules/eventEmitter');
const { ApiError } = require('./lib/errors');
const { isPrivateWebUiApiEnabled, getWebUiTransport } = require('./lib/webuiConfig');
const {
  assertPrivateWebUiSecretKey,
  createWebuiAllowedIpsHook,
  getWebuiCorsOptions,
  getWebuiSocketCorsOptions,
  resolvePrivateWebUiBindHost,
} = require('./lib/webuiSecurity');
const { broadcastParamsUpdated } = require('./ws');
const { getAuthenticatedUser } = require('./lib/auth');

const botRoutes = require('./routes/bot');
const marketRoutes = require('./routes/market');
const accountRoutes = require('./routes/account');
const paramsRoutes = require('./routes/params');
const commandsRoutes = require('./routes/commands');
const messagesRoutes = require('./routes/messages');
const { registerWebSocket } = require('./ws');

/**
 * Creates a Fastify application with `/api/v1` routes registered.
 * Does not open a listening socket — use `start()` for that.
 *
 * @returns {import('fastify').FastifyInstance}
 */
function buildApp() {
  const bindHost = resolvePrivateWebUiBindHost(config.private_webui_bind_host);
  const fastify = Fastify({
    logger: false,
  });

  fastify.register(cors, getWebuiCorsOptions(bindHost));
  fastify.addHook('onRequest', createWebuiAllowedIpsHook(config.private_webui_allowed_ips));

  fastify.register(sensible);

  fastify.register(jwt, {
    secret: config.private_webui_secret_key,
  });

  fastify.decorate('authenticate', async (request) => {
    await request.jwtVerify();
    getAuthenticatedUser(request);
  });

  fastify.setErrorHandler((error, request, reply) => {
    const err = /** @type {Error & { statusCode?: number, code?: string }} */ (error);

    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: error.message,
        details: error.details,
      });
    }

    if (err.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER' ||
        err.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID') {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    log.error(`WebUI API error on ${request.method} ${request.url}: ${err.stack || err}`);
    return reply.status(err.statusCode || 500).send({
      error: err.message || 'Internal Server Error',
    });
  });

  fastify.register(async (api) => {
    api.get('/health', async () => ({
      status: 'ok',
      transport: getWebUiTransport(config),
    }));

    await api.register(botRoutes);
    await api.register(marketRoutes);
    await api.register(accountRoutes);
    await api.register(paramsRoutes);
    await api.register(commandsRoutes);
    await api.register(messagesRoutes);
  }, { prefix: '/api/v1' });

  return fastify;
}

/**
 * Starts the private WebUI API when `config.private_webui` is a positive port number.
 * No-op when WebUI is disabled (`false` or unset).
 *
 * @returns {Promise<void>}
 */
const start = async () => {
  if (!isPrivateWebUiApiEnabled(config.private_webui)) {
    return;
  }

  if (!config.private_webui_secret_key ||
      typeof config.private_webui_secret_key !== 'string' ||
      config.private_webui_secret_key.trim() === '') {
    throw new Error(
        'private_webui is enabled but private_webui_secret_key is missing or empty',
    );
  }

  assertPrivateWebUiSecretKey(config.private_webui_secret_key);

  const bindHost = resolvePrivateWebUiBindHost(config.private_webui_bind_host);
  const fastify = buildApp();

  await fastify.listen({
    port: config.private_webui,
    host: bindHost,
  });

  const io = new Server(fastify.server, {
    cors: getWebuiSocketCorsOptions(bindHost),
    path: '/api/v1/ws',
  });

  fastify.decorate('io', io);
  registerWebSocket(io);

  // MM modules may update trade params outside the HTTP API; push updates to browsers.
  emitter.on(events['parameters:update'], () => {
    broadcastParamsUpdated(io);
  });

  log.info(`WebUI API listening on http://${bindHost}:${config.private_webui}/api/v1 (transport: ${getWebUiTransport(config)}).`);
};

module.exports = {
  buildApp,
  start,
};
