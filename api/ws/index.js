// @ts-nocheck — reads live params via `services/params` (commandTxs dependency graph).
'use strict';

/**
 * @module api/ws
 * Socket.IO bridge for live trade-param updates in scenario A (`directHttp`).
 */

const { verifyHs256 } = require('../../helpers/jwt');

const config = require('../../modules/configReader');
const {
  WEBUI_JWT_VERIFY_OPTIONS,
  assertJwtLifetime,
  extractJwtToken,
  getAuthenticatedUserFromPayload,
} = require('../lib/auth');
const { isAllowedWebUiClientIp, parsePrivateWebUiJwtMaxTtlMs } = require('../lib/webuiSecurity');
const webuiLog = require('../lib/webuiLog');
const {
  getParamsUpdatePayload,
  bumpParamsRevision,
} = require('../services/params');

/** Longest delay `setTimeout()` supports; a longer delay fires immediately */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** @type {import('socket.io').Server | undefined} */
let activeIo;

/**
 * Disconnects an authenticated socket once its JWT expires, so a connection cannot outlive the token.
 *
 * @param {import('socket.io').Socket} socket Socket with `data.tokenExpiresAt` (ms) set by the auth middleware
 * @returns {void}
 */
function scheduleTokenExpiry(socket) {
  const delay = socket.data.tokenExpiresAt - Date.now();

  if (!(delay > 0)) {
    webuiLog.info(`WS token expired user=${socket.data.user?.login || 'unknown'} id=${socket.id}; disconnecting.`);
    socket.disconnect(true);
    return;
  }

  // Delays above the timer limit re-check on wake-up instead of firing immediately
  socket.data.expiryTimer = setTimeout(() => scheduleTokenExpiry(socket), Math.min(delay, MAX_TIMER_DELAY_MS));
  socket.data.expiryTimer.unref?.();
}

/**
 * Registers JWT authentication and params subscription handlers on Socket.IO.
 *
 * Clients authenticate with a JWT signed by the private WebUI (`private_webui_secret_key`) —
 * same Bearer token as REST (`handshake.auth.token` or `handshake.query.token`). The token must carry
 * `exp` within `private_webui_jwt_max_ttl`; the socket is disconnected when the token expires.
 *
 * @param {import('socket.io').Server} io Socket.IO server attached to Fastify
 */
function registerWebSocket(io) {
  activeIo = io;

  const jwtMaxTtlMs = parsePrivateWebUiJwtMaxTtlMs(config.private_webui_jwt_max_ttl);

  io.use((socket, next) => {
    const ip = socket.handshake.address;
    if (!isAllowedWebUiClientIp(ip, config.private_webui_allowed_ips)) {
      webuiLog.warn(`WS auth denied (IP) ip=${ip}`);
      return next(new Error('Forbidden'));
    }

    const rawToken = socket.handshake.auth?.token || socket.handshake.query?.token;
    const token = extractJwtToken(rawToken);

    if (!token) {
      webuiLog.warn(`WS auth denied (no token) ip=${ip}`);
      return next(new Error('Unauthorized'));
    }

    try {
      const payload = verifyHs256(token, config.private_webui_secret_key, {
        requiredClaims: WEBUI_JWT_VERIFY_OPTIONS.requiredClaims,
      });
      assertJwtLifetime(payload, jwtMaxTtlMs);
      socket.data.user = getAuthenticatedUserFromPayload(payload);
      socket.data.tokenExpiresAt = Number(payload.exp) * 1000;
      return next();
    } catch (error) {
      webuiLog.warn(`WS auth denied (JWT) ip=${ip}: ${error instanceof Error ? error.message : error}`);
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const login = socket.data.user?.login || 'unknown';
    webuiLog.info(`WS connected user=${login} id=${socket.id}`);

    socket.on('disconnect', (reason) => {
      clearTimeout(socket.data.expiryTimer);
      webuiLog.info(`WS disconnected user=${login} id=${socket.id} reason=${reason}`);
    });

    scheduleTokenExpiry(socket);

    // Snapshot only — do not bump revision on connect/subscribe.
    socket.emit('params:updated', getParamsUpdatePayload());

    socket.on('params:subscribe', () => {
      webuiLog.debug(`WS params:subscribe user=${login} id=${socket.id}`);
      socket.emit('params:updated', getParamsUpdatePayload());
    });
  });
}

/**
 * Broadcasts the latest trade params to all connected WebUI clients.
 *
 * @param {import('socket.io').Server | undefined} [io] Explicit instance; falls back to the active server
 * @param {{ params: object, revision: number, origin: 'webui' | 'bot', requestId: string | null }} [payload]
 *   When omitted (bot-side `parameters:update`), bumps revision with `origin: 'bot'`
 */
function broadcastParamsUpdated(io, payload) {
  const target = io || activeIo;
  if (!target) {
    return;
  }

  const data = payload || bumpParamsRevision('bot', null);
  const clients = target.sockets.sockets.size;
  webuiLog.trace(
      `Broadcast params:updated to ${clients} socket(s) revision=${data.revision} origin=${data.origin}.`,
  );
  target.sockets.emit('params:updated', data);
}

module.exports = {
  registerWebSocket,
  broadcastParamsUpdated,
};
