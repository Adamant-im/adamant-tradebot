// @ts-nocheck — delegates to `services/logs`.
'use strict';

/**
 * @module api/routes/logs
 * Filtered gzip export of bot process logs for the WebUI.
 */

const { z } = require('zod');

const { getAuthenticatedUser, routeAccess } = require('../lib/auth');
const webuiLog = require('../lib/webuiLog');
const { parseOrThrow } = require('../lib/validate');
const logsService = require('../services/logs');

const logsQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(logsService.MAX_TAIL).optional(),
  level: z.enum(['error', 'warn', 'info', 'log', 'debug', 'trace']).optional(),
  grep: z.string().max(200).optional(),
});

/**
 * Registers `GET /api/v1/logs` (requires JWT; `manager` or `admin`) — returns application/gzip.
 *
 * Bot logs hold the audit trail: full command parameters (withdrawal addresses and amounts),
 * exchange error details, and notifications, so `read-only` tokens cannot export or grep them.
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function logsRoutes(fastify) {
  fastify.get('/logs', routeAccess(fastify, 'manager'), async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(logsQuerySchema, request.query ?? {});
    const { buffer, filename, lineCount } = await logsService.buildLogsGzip(query);

    webuiLog.log(
        `Log export by ${user.login}: ${lineCount} line(s), ` +
        `${buffer.length} bytes gzip` +
        `${query.tail ? `, tail=${query.tail}` : ''}` +
        `${query.level ? `, level=${query.level}+` : ''}` +
        `${query.grep ? `, grep=${JSON.stringify(query.grep)}` : ''}.`,
    );

    reply.header('Content-Type', 'application/gzip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('X-Log-Line-Count', String(lineCount));
    return reply.send(buffer);
  });
}

module.exports = logsRoutes;
