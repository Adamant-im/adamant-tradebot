'use strict';

/**
 * @module api/lib/webuiLog
 * Consistent WebUI API logging with level discipline (no poll spam at info).
 *
 * Levels:
 * - error — unexpected failures
 * - warn — auth/IP denials, rejected role access (repeats throttled to debug)
 * - info — listen, WS connect, mutating operator actions
 * - log — notable non-mutating ops (log export, strategy change detail)
 * - debug — command processing start, WS subscribe
 * - trace — per-request access lines (polls)
 */

/**
 * Minimal request shape used for access logging (avoids incomplete Fastify generics).
 *
 * @typedef {object} WebUiAccessRequest
 * @property {string} [method]
 * @property {string} [url]
 * @property {string} [ip]
 * @property {{ url?: string }} [raw]
 * @property {{ login?: string }} [user]
 * @property {bigint} [_webuiStartedAt]
 */

/**
 * @typedef {object} WebUiAccessReply
 * @property {number} [statusCode]
 */

const log = require('../../helpers/log');

const PREFIX = 'WebUI';

/**
 * Last `warn` time per `warnThrottled()` key.
 *
 * @type {Map<string, number>}
 */
const throttledWarnAt = new Map();

/** Upper bound for `throttledWarnAt`; the map is reset when it fills up (e.g. denials from many client IPs) */
const MAX_THROTTLED_WARN_KEYS = 10_000;

/**
 * @param {WebUiAccessRequest | undefined} request
 * @returns {string}
 */
function actorLabel(request) {
  const login = request?.user?.login;
  if (login && typeof login === 'string') {
    return login;
  }
  return 'anonymous';
}

/**
 * @param {WebUiAccessRequest} request
 * @returns {string}
 */
function requestSummary(request) {
  const url = (request.raw && request.raw.url) || request.url || '';
  return `${request.method || '?'} ${url}`;
}

/** @param {string} msg */
function error(msg) {
  log.error(`${PREFIX}: ${msg}`);
}

/** @param {string} msg */
function warn(msg) {
  log.warn(`${PREFIX}: ${msg}`);
}

/** @param {string} msg */
function info(msg) {
  log.info(`${PREFIX}: ${msg}`);
}

/** @param {string} msg */
function logLine(msg) {
  log.log(`${PREFIX}: ${msg}`);
}

/** @param {string} msg */
function debug(msg) {
  log.debug(`${PREFIX}: ${msg}`);
}

/** @param {string} msg */
function trace(msg) {
  log.trace(`${PREFIX}: ${msg}`);
}

/**
 * Logs at `warn` once per `intervalMs` for each `key`; repeats inside the window go to `debug`.
 * Keeps a polling client (e.g. a read-only WebUI session refreshing `/messages`) from flooding the log.
 *
 * @param {string} key Deduplication key, e.g. operator + method + route
 * @param {string} msg Log message
 * @param {number} intervalMs Minimum time between `warn` lines for one key
 * @param {number} [now] Current time in milliseconds
 */
function warnThrottled(key, msg, intervalMs, now = Date.now()) {
  const lastWarnAt = throttledWarnAt.get(key);

  if (lastWarnAt !== undefined && now - lastWarnAt < intervalMs) {
    debug(msg);
    return;
  }

  if (throttledWarnAt.size >= MAX_THROTTLED_WARN_KEYS) {
    throttledWarnAt.clear();
  }

  throttledWarnAt.set(key, now);
  warn(msg);
}

/**
 * Registers access-line logging at `trace` (polls stay quiet at default info).
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
function registerAccessLogging(fastify) {
  fastify.addHook('onRequest', async (request) => {
    /** @type {WebUiAccessRequest} */ (request)._webuiStartedAt = process.hrtime.bigint();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const req = /** @type {WebUiAccessRequest} */ (request);
    const res = /** @type {WebUiAccessReply} */ (reply);

    // CORS preflight — no auth, no business signal; skip to avoid noise.
    if (req.method === 'OPTIONS') {
      return;
    }

    let ms = '?';
    if (typeof req._webuiStartedAt === 'bigint') {
      ms = (Number(process.hrtime.bigint() - req._webuiStartedAt) / 1e6).toFixed(1);
    }
    trace(
        `${requestSummary(req)} ${res.statusCode ?? '?'} ${ms}ms ` +
        `ip=${req.ip || '?'} user=${actorLabel(req)}`,
    );
  });
}

module.exports = {
  actorLabel,
  requestSummary,
  registerAccessLogging,
  error,
  warn,
  info,
  log: logLine,
  debug,
  trace,
  warnThrottled,
};
