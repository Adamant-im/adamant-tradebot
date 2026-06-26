// @ts-nocheck — delegates to `services/messages` (MongoDB).
'use strict';

/**
 * @module api/routes/messages
 * Chat-style message log for the WebUI operator session.
 */

const { z } = require('zod');

const { getAuthenticatedUser } = require('../lib/auth');
const { parseOrThrow } = require('../lib/validate');
const messagesService = require('../services/messages');

const messageBodySchema = z.object({
  message: z.string().min(1),
  isSelfWritten: z.boolean().optional(),
});

/**
 * Registers `GET/POST /api/v1/messages` (require JWT).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function messagesRoutes(fastify) {
  fastify.get('/messages', {
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const user = getAuthenticatedUser(request);
    const messages = await messagesService.listMessages(user.login);
    return { messages };
  });

  fastify.post('/messages', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(messageBodySchema, request.body);
    const message = await messagesService.createMessage(user.login, body);
    reply.code(201);
    return { message };
  });
}

module.exports = messagesRoutes;
