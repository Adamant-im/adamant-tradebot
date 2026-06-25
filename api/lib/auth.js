'use strict';

/**
 * @module api/lib/auth
 * @typedef {import('types/webui-api/auth.d.js').WebUiJwtPayload} WebUiJwtPayload
 * @typedef {import('types/webui-api/auth.d.js').WebUiJwtUser} WebUiJwtUser
 */

const { UnauthorizedError } = require('./errors');

/**
 * Strips an optional `Bearer ` prefix from a raw JWT string.
 *
 * @param {unknown} rawToken Value from `Authorization` header or Socket.IO handshake
 * @returns {string | null} Token without prefix, or `null` when input is not a non-empty string
 */
function extractJwtToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    return null;
  }

  const trimmed = rawToken.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim() || null;
  }

  return trimmed;
}

/**
 * Resolves the operator identity from a JWT-verified Fastify request.
 *
 * The private WebUI signs tokens with `private_webui_secret_key`; the bot only checks the HMAC
 * and reads the `login` claim — no local user database on the bot.
 *
 * @param {{ user?: WebUiJwtPayload }} request Request after `jwtVerify()`
 * @returns {WebUiJwtUser}
 * @throws {UnauthorizedError} When the JWT payload has no `login` or the account is disabled
 */
function getAuthenticatedUser(request) {
  const login = request.user?.login;

  if (!login || typeof login !== 'string') {
    throw new UnauthorizedError();
  }

  if (request.user?.enabled === false) {
    throw new UnauthorizedError();
  }

  return { login };
}

/**
 * Validates a decoded JWT payload for REST and Socket.IO authentication.
 *
 * @param {WebUiJwtPayload | null | undefined} payload Decoded JWT claims
 * @returns {WebUiJwtUser}
 * @throws {UnauthorizedError} When the payload is missing `login` or the account is disabled
 */
function getAuthenticatedUserFromPayload(payload) {
  if (!payload?.login || typeof payload.login !== 'string') {
    throw new UnauthorizedError();
  }

  if (payload.enabled === false) {
    throw new UnauthorizedError();
  }

  return { login: payload.login };
}

module.exports = {
  extractJwtToken,
  getAuthenticatedUser,
  getAuthenticatedUserFromPayload,
};
