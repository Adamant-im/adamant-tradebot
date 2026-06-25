'use strict';

/**
 * @module api/lib/webuiSecurity
 * Startup and transport hardening for the private WebUI API (scenario A).
 */

/** Known placeholder secrets that must not be used in production */
const WEAK_SECRET_KEYS = new Set([
  'some-random-string',
  'secret',
  'changeme',
  'password',
  'admin',
]);

/** Minimum length for `private_webui_secret_key` when the inbound WebUI API is enabled */
const MIN_SECRET_KEY_LENGTH = 32;

/** Default bind address for the private WebUI HTTP and Socket.IO server */
const DEFAULT_PRIVATE_WEBUI_BIND_HOST = '127.0.0.1';

/** Bind hosts treated as loopback-only (strict CORS) */
const LOOPBACK_BIND_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
]);

/**
 * Returns whether a WebUI HMAC secret is missing, a known placeholder, or too short.
 *
 * @param {unknown} secretKey Value of `config.private_webui_secret_key`
 * @returns {boolean}
 */
function isWeakPrivateWebUiSecretKey(secretKey) {
  if (!secretKey || typeof secretKey !== 'string') {
    return true;
  }

  const normalized = secretKey.trim().toLowerCase();

  if (normalized.length < MIN_SECRET_KEY_LENGTH) {
    return true;
  }

  return WEAK_SECRET_KEYS.has(normalized);
}

/**
 * Throws when the private WebUI API is enabled with a missing or weak HMAC secret.
 *
 * @param {unknown} secretKey Value of `config.private_webui_secret_key`
 * @returns {void}
 */
function assertPrivateWebUiSecretKey(secretKey) {
  if (isWeakPrivateWebUiSecretKey(secretKey)) {
    throw new Error(
        'private_webui is enabled but private_webui_secret_key is missing, default, or too weak. ' +
        'Set a unique random secret of at least 32 characters.',
    );
  }
}

/**
 * Returns whether an HTTP Origin header points to a local browser context.
 *
 * @param {unknown} origin Value of the `Origin` request header
 * @returns {boolean}
 */
function isLocalhostOrigin(origin) {
  if (!origin || typeof origin !== 'string') {
    return false;
  }

  try {
    const url = new URL(origin);
    const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
    return hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * Normalizes a client IP for allowlist checks (IPv4-mapped IPv6, optional port suffix).
 *
 * @param {unknown} ip Remote address from Fastify or Socket.IO
 * @returns {string}
 */
function normalizeClientIp(ip) {
  if (!ip || typeof ip !== 'string') {
    return '';
  }

  let trimmed = ip.trim();

  if (trimmed.startsWith('::ffff:')) {
    trimmed = trimmed.slice(7);
  }

  if (trimmed.includes('.') && trimmed.includes(':')) {
    return trimmed.split(':')[0];
  }

  return trimmed;
}

/**
 * Builds a set of allowed client IPs from `config.private_webui_allowed_ips`.
 *
 * @param {unknown} allowedIps Config array of IPv4/IPv6 strings
 * @returns {Set<string>}
 */
function resolvePrivateWebUiAllowedIps(allowedIps) {
  if (!Array.isArray(allowedIps)) {
    return new Set();
  }

  return new Set(
      allowedIps
          .filter((ip) => typeof ip === 'string' && ip.trim())
          .map((ip) => normalizeClientIp(ip.trim())),
  );
}

/**
 * Returns whether a client IP is permitted by the optional WebUI allowlist.
 *
 * @param {unknown} clientIp Remote address
 * @param {unknown} allowedIps Config array; empty or missing means allow all
 * @returns {boolean}
 */
function isAllowedWebUiClientIp(clientIp, allowedIps) {
  const allowlist = resolvePrivateWebUiAllowedIps(allowedIps);

  if (allowlist.size === 0) {
    return true;
  }

  return allowlist.has(normalizeClientIp(clientIp));
}

/**
 * Fastify `onRequest` hook that rejects clients outside `private_webui_allowed_ips`.
 *
 * @param {unknown} allowedIps Config array
 * @returns {(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>}
 */
function createWebuiAllowedIpsHook(allowedIps) {
  const allowlist = resolvePrivateWebUiAllowedIps(allowedIps);

  return async function webuiAllowedIpsHook(request, reply) {
    if (allowlist.size === 0) {
      return;
    }

    if (!allowlist.has(normalizeClientIp(request.ip))) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  };
}

/**
 * Returns whether the WebUI API bind host accepts only local clients.
 *
 * @param {unknown} bindHost Value of `config.private_webui_bind_host`
 * @returns {boolean}
 */
function isLoopbackBindHost(bindHost) {
  if (!bindHost || typeof bindHost !== 'string') {
    return true;
  }

  return LOOPBACK_BIND_HOSTS.has(bindHost.trim().toLowerCase());
}

/**
 * Resolves the private WebUI listen address from config.
 *
 * @param {unknown} bindHost Value of `config.private_webui_bind_host`
 * @returns {string}
 */
function resolvePrivateWebUiBindHost(bindHost) {
  if (!bindHost || typeof bindHost !== 'string' || bindHost.trim() === '') {
    return DEFAULT_PRIVATE_WEBUI_BIND_HOST;
  }

  return bindHost.trim();
}

/** CORS options for loopback-only WebUI API binds */
const loopbackWebuiCorsOptions = {
  origin: (origin, callback) => {
    if (!origin || isLocalhostOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
};

/** Socket.IO CORS policy for loopback-only WebUI API binds */
const loopbackWebuiSocketCorsOptions = {
  origin: (origin, callback) => {
    if (!origin || isLocalhostOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('CORS origin not allowed'), false);
  },
};

/**
 * Returns Fastify CORS options for the configured WebUI bind host.
 *
 * Loopback binds stay strict; `0.0.0.0` and other external binds allow any origin so a
 * remote private WebUI fleet can reach bots without a per-bot reverse proxy.
 *
 * @param {unknown} bindHost Value of `config.private_webui_bind_host`
 * @returns {import('@fastify/cors').FastifyCorsOptionsDelegate | { origin: boolean }}
 */
function getWebuiCorsOptions(bindHost) {
  if (isLoopbackBindHost(bindHost)) {
    return loopbackWebuiCorsOptions;
  }

  return { origin: true };
}

/**
 * Returns Socket.IO CORS options for the configured WebUI bind host.
 *
 * @param {unknown} bindHost Value of `config.private_webui_bind_host`
 * @returns {import('socket.io').CorsOptions | { origin: boolean }}
 */
function getWebuiSocketCorsOptions(bindHost) {
  if (isLoopbackBindHost(bindHost)) {
    return loopbackWebuiSocketCorsOptions;
  }

  return { origin: true };
}

module.exports = {
  DEFAULT_PRIVATE_WEBUI_BIND_HOST,
  MIN_SECRET_KEY_LENGTH,
  WEAK_SECRET_KEYS,
  assertPrivateWebUiSecretKey,
  createWebuiAllowedIpsHook,
  getWebuiCorsOptions,
  getWebuiSocketCorsOptions,
  isAllowedWebUiClientIp,
  isLocalhostOrigin,
  isLoopbackBindHost,
  isWeakPrivateWebUiSecretKey,
  normalizeClientIp,
  resolvePrivateWebUiAllowedIps,
  resolvePrivateWebUiBindHost,
};
