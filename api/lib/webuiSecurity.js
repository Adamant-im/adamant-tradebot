'use strict';

/**
 * @module api/lib/webuiSecurity
 * Startup and transport hardening for the private WebUI API (scenario A).
 */

const constants = require('../../helpers/const');

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

/** Default cap for the remaining lifetime of a WebUI JWT (`exp` minus now) */
const DEFAULT_PRIVATE_WEBUI_JWT_MAX_TTL = '24h';

/** Duration string such as `12h`, `90 min`, or `1d` */
const DURATION_REGEXP = new RegExp(`^\\s*(\\d+)\\s*${constants.REGEXP_TIME.source}\\s*$`, 'i');

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
 * Parses `config.private_webui_jwt_max_ttl` into milliseconds.
 *
 * @param {unknown} value Duration such as `12h` or `1d`; empty or missing means `24h`
 * @returns {number} Positive duration in milliseconds, or `NaN` when the value is not a positive duration
 */
function parsePrivateWebUiJwtMaxTtlMs(value) {
  const text = value === undefined || value === null || value === '' ?
    DEFAULT_PRIVATE_WEBUI_JWT_MAX_TTL :
    String(value);

  const match = DURATION_REGEXP.exec(text);
  if (!match) {
    return NaN;
  }

  const unit = constants.TIME_UNITS[match[2].toLowerCase()];
  const ms = Number(match[1]) * constants.TIME_DIVISORS[unit];

  return ms > 0 ? ms : NaN;
}

/**
 * Throws when `config.private_webui_jwt_max_ttl` is not a positive duration.
 *
 * @param {unknown} value Value of `config.private_webui_jwt_max_ttl`
 * @returns {void}
 */
function assertPrivateWebUiJwtMaxTtl(value) {
  if (Number.isNaN(parsePrivateWebUiJwtMaxTtlMs(value))) {
    throw new Error(
        `private_webui_jwt_max_ttl is invalid: '${value}'. ` +
        `Set a positive duration such as 12h or 1d (default ${DEFAULT_PRIVATE_WEBUI_JWT_MAX_TTL}).`,
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
 * @returns {(request: *, reply: *) => Promise<void>}
 */
function createWebuiAllowedIpsHook(allowedIps) {
  const allowlist = resolvePrivateWebUiAllowedIps(allowedIps);
  const webuiLog = require('./webuiLog');

  return async function webuiAllowedIpsHook(request, reply) {
    if (allowlist.size === 0) {
      return;
    }

    const ip = normalizeClientIp(/** @type {{ ip?: string }} */ (request).ip);
    if (!allowlist.has(ip)) {
      const req = /** @type {{ method?: string, url?: string, raw?: { url?: string } }} */ (request);
      webuiLog.warn(`IP denied ${req.method} ${req.raw?.url || req.url} ip=${ip}`);
      reply.code(403).send({ error: 'Forbidden' });
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
const webuiCorsCommon = {
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
};

const loopbackWebuiCorsOptions = {
  ...webuiCorsCommon,
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
 * @returns {*}
 */
function getWebuiCorsOptions(bindHost) {
  if (isLoopbackBindHost(bindHost)) {
    return loopbackWebuiCorsOptions;
  }

  return { origin: true, ...webuiCorsCommon };
}

/**
 * Returns Socket.IO CORS options for the configured WebUI bind host.
 *
 * @param {unknown} bindHost Value of `config.private_webui_bind_host`
 * @returns {*}
 */
function getWebuiSocketCorsOptions(bindHost) {
  if (isLoopbackBindHost(bindHost)) {
    return loopbackWebuiSocketCorsOptions;
  }

  return { origin: true };
}

module.exports = {
  DEFAULT_PRIVATE_WEBUI_BIND_HOST,
  DEFAULT_PRIVATE_WEBUI_JWT_MAX_TTL,
  MIN_SECRET_KEY_LENGTH,
  WEAK_SECRET_KEYS,
  assertPrivateWebUiJwtMaxTtl,
  assertPrivateWebUiSecretKey,
  createWebuiAllowedIpsHook,
  getWebuiCorsOptions,
  getWebuiSocketCorsOptions,
  isAllowedWebUiClientIp,
  isLocalhostOrigin,
  isLoopbackBindHost,
  isWeakPrivateWebUiSecretKey,
  normalizeClientIp,
  parsePrivateWebUiJwtMaxTtlMs,
  resolvePrivateWebUiAllowedIps,
  resolvePrivateWebUiBindHost,
};
