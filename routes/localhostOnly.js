'use strict';

/**
 * @module routes/localhostOnly
 * Fastify hook that rejects clients outside the local machine, including clients forwarded by a reverse proxy.
 */

/**
 * Request fields read by the localhost checks.
 *
 * @typedef {Object} LocalRequestInfo
 * @property {string} [method] HTTP method
 * @property {string} [url] Request URL
 * @property {string} [ip] Peer address of the TCP connection
 * @property {Record<string, unknown>} [headers] Request headers with lowercase names
 */

const log = require('../helpers/log');

/** Client addresses treated as local for debug and health APIs */
const LOCALHOST_IPS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);

/**
 * Request headers that a reverse proxy or CDN adds when it forwards a client request.
 * A loopback peer address together with one of them means a proxied remote client.
 */
const PROXY_FORWARDING_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'via',
  'cf-connecting-ip',
  'true-client-ip',
  'x-client-ip',
  'x-cluster-client-ip',
];

/**
 * Returns whether a request carries headers added by a reverse proxy.
 *
 * @param {LocalRequestInfo} request Incoming request
 * @returns {boolean}
 */
function hasProxyForwardingHeaders(request) {
  const headers = request.headers || {};

  return PROXY_FORWARDING_HEADERS.some((name) => headers[name] !== undefined);
}

/**
 * Returns whether a Fastify request came straight from the local machine.
 *
 * A loopback peer address is not enough: nginx or Caddy on the same host forwards remote clients
 * from `127.0.0.1`. Requests with proxy forwarding headers count as remote. A proxy that adds no such
 * headers still looks local, which is why the debug API also requires `api.debug_token`.
 *
 * @param {LocalRequestInfo} request Incoming request
 * @returns {boolean}
 */
function isLocalhostRequest(request) {
  return LOCALHOST_IPS.has(request.ip) && !hasProxyForwardingHeaders(request);
}

/**
 * Fastify `onRequest` hook that responds with 403 for remote and proxied clients.
 *
 * @param {LocalRequestInfo} request Incoming request
 * @param {import('fastify').FastifyReply} reply Outgoing reply
 * @returns {Promise<import('fastify').FastifyReply | void>} The sent 403 reply, or nothing for local requests
 */
async function localhostOnlyHook(request, reply) {
  if (!isLocalhostRequest(request)) {
    const proxied = hasProxyForwardingHeaders(request) ? ' through a reverse proxy' : '';
    log.warn(`Debug API: Rejected ${request.method} ${request.url} from ip=${request.ip}${proxied}.`);

    return reply.code(403).send({
      success: false,
      err: 'Forbidden',
    });
  }
}

module.exports = {
  LOCALHOST_IPS,
  PROXY_FORWARDING_HEADERS,
  hasProxyForwardingHeaders,
  isLocalhostRequest,
  localhostOnlyHook,
};
