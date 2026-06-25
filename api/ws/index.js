// @ts-nocheck — reads live params via `services/params` (commandTxs dependency graph).
'use strict';

/**
 * @module api/ws
 * Socket.IO bridge for live trade-param updates in scenario A (`directHttp`).
 */

const { verifyHs256 } = require('../../helpers/jwt');

const config = require('../../modules/configReader');
const { extractJwtToken, getAuthenticatedUserFromPayload } = require('../lib/auth');
const { isAllowedWebUiClientIp } = require('../lib/webuiSecurity');
const { getCurrentParams } = require('../services/params');

/**
 * Registers JWT authentication and params subscription handlers on Socket.IO.
 *
 * Clients authenticate with a JWT signed by the private WebUI (`private_webui_secret_key`) —
 * same Bearer token as REST (`handshake.auth.token` or `handshake.query.token`).
 *
 * @param {import('socket.io').Server} io Socket.IO server attached to Fastify
 */
function registerWebSocket(io) {
  io.use((socket, next) => {
    if (!isAllowedWebUiClientIp(socket.handshake.address, config.private_webui_allowed_ips)) {
      return next(new Error('Forbidden'));
    }

    const rawToken = socket.handshake.auth?.token || socket.handshake.query?.token;
    const token = extractJwtToken(rawToken);

    if (!token) {
      return next(new Error('Unauthorized'));
    }

    try {
      const payload = verifyHs256(token, config.private_webui_secret_key);
      socket.data.user = getAuthenticatedUserFromPayload(payload);
      return next();
    } catch {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.emit('params:updated', getCurrentParams());

    socket.on('params:subscribe', () => {
      socket.emit('params:updated', getCurrentParams());
    });
  });
}

/**
 * Broadcasts the latest trade params to all connected WebUI clients.
 *
 * @param {import('socket.io').Server | undefined} io Socket.IO instance or `undefined` before listen
 */
function broadcastParamsUpdated(io) {
  if (!io) {
    return;
  }

  io.sockets.emit('params:updated', getCurrentParams());
}

module.exports = {
  registerWebSocket,
  broadcastParamsUpdated,
};
