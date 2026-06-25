// @ts-nocheck — MongoDB persistence; response shape is documented in types/webui-api/messages.d.js.
'use strict';

/**
 * @module api/services/messages
 * @typedef {import('types/webui-api/messages.d.js').WebUiTerminalMessage} WebUiTerminalMessage
 * @typedef {import('types/webui-api/messages.d.js').WebUiMessagesListResponse} WebUiMessagesListResponse
 */

const db = require('../../modules/DB');

/**
 * Lists terminal messages for the authenticated WebUI user.
 *
 * @param {string} login Operator login from the verified JWT
 * @returns {Promise<WebUiTerminalMessage[]>}
 */
async function listMessages(login) {
  return db.webTerminalMessages.find({ user: login }).toArray();
}

/**
 * Persists a new terminal message for the user.
 *
 * @param {string} login Owner login
 * @param {{ message: string, isSelfWritten?: boolean }} payload Request body
 * @returns {Promise<WebUiTerminalMessage>}
 */
async function createMessage(login, payload) {
  const record = {
    user: login,
    message: payload.message,
    isSelfWritten: Boolean(payload.isSelfWritten),
    createdAt: Date.now(),
  };

  await db.webTerminalMessages.insertOne(record);
  return record;
}

module.exports = {
  listMessages,
  createMessage,
};
