'use strict';

/**
 * @module api/lib/auth
 * @typedef {import('types/webui-api/auth.d.js').WebUiJwtPayload} WebUiJwtPayload
 * @typedef {import('types/webui-api/auth.d.js').WebUiJwtUser} WebUiJwtUser
 * @typedef {import('types/webui-api/auth.d.js').WebUiRole} WebUiRole
 */

/**
 * Request fields used by route access checks.
 *
 * @typedef {Object} WebUiAuthRequest
 * @property {string} [method] HTTP method
 * @property {WebUiJwtPayload | null} [user] Verified JWT claims set by `jwtVerify()`
 * @property {{ config?: { minRole?: unknown } }} [routeOptions] Matched Fastify route options
 */

const { ForbiddenError, UnauthorizedError } = require('./errors');

const WRITE_HTTP_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** Privilege rank of each WebUI role; a higher rank includes every permission of the lower ranks */
const ROLE_RANK = Object.freeze({
  'read-only': 0,
  manager: 1,
  admin: 2,
});

/**
 * Lowest role for routes that do not declare `config.minRole`.
 * A new route stays closed to `read-only` until it is explicitly marked as a monitoring read.
 */
const DEFAULT_ROUTE_MIN_ROLE = 'manager';

/** Lowest role allowed to use write HTTP methods, whatever the route declares */
const WRITE_MIN_ROLE = 'manager';

/** 403 message by the role a route requires */
const ROLE_DENIED_MESSAGES = Object.freeze({
  'read-only': 'Forbidden',
  manager: 'Read-only access',
  admin: 'Admin role required',
});

/**
 * fast-jwt verifier options shared by REST (`@fastify/jwt`) and Socket.IO (`helpers/jwt.verifyHs256`).
 * A token without `exp` would never expire, so `exp` is required; `nbf` is checked when present.
 */
const WEBUI_JWT_VERIFY_OPTIONS = Object.freeze({
  algorithms: Object.freeze(['HS256']),
  requiredClaims: Object.freeze(['exp']),
});

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
 * Rejects a verified JWT whose `exp` lies further in the future than `maxTtlMs`.
 *
 * The verifier already rejects tokens without `exp` and expired tokens. This check also caps
 * how long one token stays usable when the signer issued it with a long lifetime.
 *
 * @param {WebUiJwtPayload | null | undefined} payload Verified JWT claims
 * @param {number} maxTtlMs Maximum remaining lifetime in milliseconds (`private_webui_jwt_max_ttl`)
 * @param {number} [now] Current time in milliseconds
 * @throws {UnauthorizedError} When `exp` is missing, not a number, or too far in the future
 */
function assertJwtLifetime(payload, maxTtlMs, now = Date.now()) {
  const exp = payload?.exp;

  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    throw new UnauthorizedError('Token has no valid exp claim');
  }

  // Negated `<=` so that an invalid `maxTtlMs` (NaN) rejects the token instead of skipping the cap
  if (!(exp * 1000 - now <= maxTtlMs)) {
    throw new UnauthorizedError('Token lifetime exceeds private_webui_jwt_max_ttl');
  }
}

/**
 * @param {unknown} method HTTP method from Fastify request
 * @returns {boolean}
 */
function isWriteHttpMethod(method) {
  return WRITE_HTTP_METHODS.has(String(method || '').toUpperCase());
}

/**
 * Returns whether `value` is a known WebUI role.
 *
 * @param {unknown} value Role claim or route `config.minRole`
 * @returns {value is WebUiRole}
 */
function isWebUiRole(value) {
  return typeof value === 'string' && Object.hasOwn(ROLE_RANK, value);
}

/**
 * Resolves the lowest role allowed to call the matched route.
 *
 * Routes declare it as `config.minRole`. Routes without a valid `minRole` require `manager`.
 * Write HTTP methods always require at least `manager`, so a route marked `read-only` by mistake
 * still cannot accept writes from a `read-only` token.
 *
 * @param {WebUiAuthRequest} request Fastify request matched to a route
 * @returns {WebUiRole}
 */
function getRequiredRole(request) {
  const declaredRole = request.routeOptions?.config?.minRole;
  let requiredRole = isWebUiRole(declaredRole) ? declaredRole : DEFAULT_ROUTE_MIN_ROLE;

  if (isWriteHttpMethod(request.method) && ROLE_RANK[requiredRole] < ROLE_RANK[WRITE_MIN_ROLE]) {
    requiredRole = WRITE_MIN_ROLE;
  }

  return requiredRole;
}

/**
 * Rejects a JWT role that ranks below the role required by the matched route,
 * whatever the HTTP method is.
 * Tokens without a `role` claim keep legacy full access.
 *
 * @param {WebUiAuthRequest} request Request after `jwtVerify()`
 * @throws {ForbiddenError} When the role ranks below the route requirement
 */
function assertRouteAccess(request) {
  const role = request.user?.role;

  if (role === undefined || role === null) {
    return;
  }

  const requiredRole = getRequiredRole(request);

  if (isWebUiRole(role) && ROLE_RANK[role] >= ROLE_RANK[requiredRole]) {
    return;
  }

  throw new ForbiddenError(ROLE_DENIED_MESSAGES[requiredRole]);
}

/**
 * Builds Fastify route options for a JWT-protected WebUI route.
 *
 * @param {{ authenticate: Function }} fastify Fastify instance decorated with `authenticate`
 * @param {WebUiRole} minRole Lowest role allowed to call the route
 * @returns {{ preHandler: Function[], config: { minRole: WebUiRole } }}
 */
function routeAccess(fastify, minRole) {
  return {
    preHandler: [fastify.authenticate],
    config: { minRole },
  };
}

/**
 * Resolves the operator identity from a JWT-verified Fastify request.
 *
 * The private WebUI signs tokens with `private_webui_secret_key`; the bot checks the HMAC,
 * reads `login`, and enforces the optional `role` per route (see `assertRouteAccess()`).
 *
 * @param {{ user?: WebUiJwtPayload | null }} request Request after `jwtVerify()`
 * @returns {WebUiJwtUser}
 * @throws {UnauthorizedError} When the JWT payload has no `login`, the account is disabled, or the role is unknown
 */
function getAuthenticatedUser(request) {
  return getAuthenticatedUserFromPayload(request.user);
}

/**
 * Validates a decoded JWT payload for REST and Socket.IO authentication.
 *
 * @param {WebUiJwtPayload | null | undefined} payload Decoded JWT claims
 * @returns {WebUiJwtUser}
 * @throws {UnauthorizedError} When the payload has no `login`, the account is disabled, or the role is unknown
 */
function getAuthenticatedUserFromPayload(payload) {
  if (!payload?.login || typeof payload.login !== 'string') {
    throw new UnauthorizedError('Token has no login claim');
  }

  if (payload.enabled === false) {
    throw new UnauthorizedError('Operator account is disabled');
  }

  /** @type {WebUiJwtUser} */
  const user = { login: payload.login };
  const role = payload.role;

  if (role !== undefined && role !== null) {
    // An unknown role is rejected instead of being treated as a legacy full-access token
    if (!isWebUiRole(role)) {
      throw new UnauthorizedError(`Unknown role '${String(role)}'`);
    }

    user.role = role;
  }

  return user;
}

module.exports = {
  DEFAULT_ROUTE_MIN_ROLE,
  ROLE_RANK,
  WEBUI_JWT_VERIFY_OPTIONS,
  assertJwtLifetime,
  assertRouteAccess,
  extractJwtToken,
  getAuthenticatedUser,
  getAuthenticatedUserFromPayload,
  getRequiredRole,
  isWebUiRole,
  isWriteHttpMethod,
  routeAccess,
};
