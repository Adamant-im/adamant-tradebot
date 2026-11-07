// @ts-nocheck — delegates to `services/messages` (MongoDB).
'use strict';

/**
 * @module api/routes/messages
 * Shared notify/terminal message feed for the WebUI.
 */

const { z } = require('zod');

const { getAuthenticatedUser, routeAccess } = require('../lib/auth');
const webuiLog = require('../lib/webuiLog');
const { parseOrThrow } = require('../lib/validate');
const messagesService = require('../services/messages');

const messageBodySchema = z.object({
  message: z.string().min(1),
  isSelfWritten: z.boolean().optional(),
  level: z.enum(['error', 'warn', 'info', 'log', 'debug', 'trace']).optional(),
});

/**
 * Registers `GET/POST /api/v1/messages` (requires JWT; `manager` or `admin`).
 *
 * The feed mirrors every `notify()`: withdrawal confirmations, remote ComServer actions,
 * and balance alerts, so `read-only` tokens cannot read it.
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function messagesRoutes(fastify) {
  fastify.get('/messages', routeAccess(fastify, 'manager'), async () => {
    const messages = await messagesService.listMessages();
    webuiLog.trace(`Messages list → ${messages.length} item(s).`);
    return { messages };
  });

  fastify.post('/messages', routeAccess(fastify, 'manager'), async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(messageBodySchema, request.body);
    const message = await messagesService.createMessage(user.login, body);
    webuiLog.debug(
        `Message stored by ${user.login}` +
        `${body.level ? ` level=${body.level}` : ''} (${body.message.length} chars).`,
    );
    reply.code(201);
    return { message };
  });
}

module.exports = messagesRoutes;
