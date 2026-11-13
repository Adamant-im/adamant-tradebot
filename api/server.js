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
const { emitter, events } = require('../modules/eventEmitter');
const { ApiError, UnauthorizedError } = require('./lib/errors');
const { isPrivateWebUiApiEnabled, getWebUiTransport } = require('./lib/webuiConfig');
const {
  assertPrivateWebUiJwtMaxTtl,
  assertPrivateWebUiSecretKey,
  createWebuiAllowedIpsHook,
  getWebuiCorsOptions,
  getWebuiSocketCorsOptions,
  parsePrivateWebUiJwtMaxTtlMs,
  resolvePrivateWebUiBindHost,
} = require('./lib/webuiSecurity');
const { broadcastParamsUpdated } = require('./ws');
const {
  WEBUI_JWT_VERIFY_OPTIONS,
  assertJwtLifetime,
  assertRouteAccess,
  getAuthenticatedUser,
} = require('./lib/auth');
const webuiLog = require('./lib/webuiLog');

/**
 * One `warn` line per repeated denial in this window; repeats go to `debug`.
 * The WebUI polls every few seconds, so an expired token or a read-only session would otherwise flood the log.
 */
const REPEATED_DENIAL_WARN_INTERVAL_MS = 60 * 60 * 1000;

const botRoutes = require('./routes/bot');
const statusRoutes = require('./routes/status');
const configRoutes = require('./routes/config');
const marketRoutes = require('./routes/market');
const accountRoutes = require('./routes/account');
const paramsRoutes = require('./routes/params');
const commandsRoutes = require('./routes/commands');
const messagesRoutes = require('./routes/messages');
const logsRoutes = require('./routes/logs');
const { registerWebSocket } = require('./ws');

/**
 * Creates a Fastify application with `/api/v1` routes registered.
 * Does not open a listening socket — use `start()` for that.
 *
 * @returns {import('fastify').FastifyInstance}
 */
function buildApp() {
  const bindHost = resolvePrivateWebUiBindHost(config.private_webui_bind_host);
  const jwtMaxTtlMs = parsePrivateWebUiJwtMaxTtlMs(config.private_webui_jwt_max_ttl);
  const fastify = Fastify({
    logger: false,
  });

  fastify.register(cors, getWebuiCorsOptions(bindHost));
  fastify.addHook('onRequest', createWebuiAllowedIpsHook(config.private_webui_allowed_ips));
  webuiLog.registerAccessLogging(fastify);

  fastify.register(sensible);

  fastify.register(jwt, {
    secret: config.private_webui_secret_key,
    verify: { ...WEBUI_JWT_VERIFY_OPTIONS },
  });

  fastify.decorate('authenticate', async (request) => {
    try {
      await request.jwtVerify();
      assertJwtLifetime(request.user, jwtMaxTtlMs);
      getAuthenticatedUser(request);
    } catch (error) {
      // Any token problem (missing, malformed, unsigned, expired, no `exp`, too long-lived) is a plain 401.
      const reason = error instanceof Error ? error.message : String(error);

      webuiLog.warnThrottled(
          `auth-failed|${request.ip}|${reason}`,
          `Auth failed on ${webuiLog.requestSummary(request)} ip=${request.ip} ` +
          `user=${webuiLog.actorLabel(request)}: ${reason}`,
          REPEATED_DENIAL_WARN_INTERVAL_MS,
      );

      // A rejected token must not attribute the request to its `login` in access logs
      request.user = null;
      throw new UnauthorizedError();
    }

    try {
      assertRouteAccess(request);
    } catch (error) {
      const actor = webuiLog.actorLabel(request);
      const reason = error instanceof Error ? error.message : String(error);

      webuiLog.warnThrottled(
          `access-denied|${actor}|${request.method}|${request.routeOptions?.url}`,
          `Access denied for ${actor} (role=${request.user?.role}) on ${webuiLog.requestSummary(request)}: ${reason}`,
          REPEATED_DENIAL_WARN_INTERVAL_MS,
      );
      throw error;
    }
  });

  fastify.setErrorHandler((error, request, reply) => {
    const err = /** @type {Error & { statusCode?: number, code?: string }} */ (error);

    if (error instanceof ApiError) {
      if (error.statusCode >= 500) {
        webuiLog.error(`${webuiLog.requestSummary(request)} → ${error.statusCode}: ${error.message}`);
      } else {
        webuiLog.debug(`${webuiLog.requestSummary(request)} → ${error.statusCode}: ${error.message}`);
      }
      return reply.status(error.statusCode).send({
        error: error.message,
        details: error.details,
      });
    }

    if (err.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER' ||
        err.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID') {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    webuiLog.error(`Unhandled error on ${webuiLog.requestSummary(request)}: ${err.stack || err}`);
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
    await api.register(statusRoutes);
    await api.register(configRoutes);
    await api.register(marketRoutes);
    await api.register(accountRoutes);
    await api.register(paramsRoutes);
    await api.register(commandsRoutes);
    await api.register(messagesRoutes);
    await api.register(logsRoutes);
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
    webuiLog.debug('Private WebUI API disabled (private_webui is unset or false).');
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
  assertPrivateWebUiJwtMaxTtl(config.private_webui_jwt_max_ttl);

  const bindHost = resolvePrivateWebUiBindHost(config.private_webui_bind_host);
  const fastify = buildApp();

  await fastify.ready();

  // Socket.IO must attach before listen(); Fastify rejects decorators after start (FST_ERR_DEC_AFTER_START).
  const io = new Server(fastify.server, {
    cors: getWebuiSocketCorsOptions(bindHost),
    path: '/api/v1/ws',
  });

  registerWebSocket(io);

  // MM modules may update trade params outside the HTTP API; push updates to browsers.
  emitter.on(events['parameters:update'], () => {
    webuiLog.debug('Broadcasting params:updated (bot-side parameters:update).');
    broadcastParamsUpdated(io);
  });

  await fastify.listen({
    port: config.private_webui,
    host: bindHost,
  });

  webuiLog.info(
      `Listening on http://${bindHost}:${config.private_webui}/api/v1 ` +
      `(transport: ${getWebUiTransport(config)}, bind: ${bindHost}).`,
  );
};

module.exports = {
  buildApp,
  start,
};
