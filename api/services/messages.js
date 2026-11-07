// @ts-nocheck — MongoDB persistence; response shape is documented in types/webui-api/messages.d.js.
'use strict';

/**
 * @module api/services/messages
 * @typedef {import('types/webui-api/messages.d.js').WebUiTerminalMessage} WebUiTerminalMessage
 * @typedef {import('types/webui-api/messages.d.js').WebUiMessagesListResponse} WebUiMessagesListResponse
 * @typedef {import('types/bot/helpers.d.js').NotifyLevel} NotifyLevel
 */

const db = require('../../modules/DB');
const webuiLog = require('../lib/webuiLog');

const MAX_STORED = 2_000;
const DEFAULT_LIST_LIMIT = 500;

/**
 * Lists recent terminal messages (shared across operators).
 *
 * @param {{ limit?: number }} [options]
 * @returns {Promise<WebUiTerminalMessage[]>}
 */
async function listMessages(options = {}) {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_STORED);
  const rows = await db.webTerminalMessages
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  return rows.reverse();
}

/**
 * Persists a new terminal message.
 *
 * @param {string} login Owner login (use `bot` for notify fan-in)
 * @param {{ message: string, isSelfWritten?: boolean, level?: string }} payload Request body
 * @returns {Promise<WebUiTerminalMessage>}
 */
async function createMessage(login, payload) {
  const record = {
    user: login,
    message: payload.message,
    isSelfWritten: Boolean(payload.isSelfWritten),
    createdAt: Date.now(),
  };

  if (payload.level) {
    record.level = payload.level;
  }

  await db.webTerminalMessages.insertOne(record);
  await pruneOldMessages();
  return record;
}

/**
 * Appends a notify() payload to the shared WebUI terminal feed.
 *
 * @param {NotifyLevel} level
 * @param {string} message Markdown/plain notify text
 * @returns {Promise<void>}
 */
async function appendNotifyMessage(level, message) {
  if (!db.webTerminalMessages || typeof message !== 'string' || !message.trim()) {
    return;
  }

  await createMessage('bot', {
    message,
    isSelfWritten: false,
    level,
  });
  webuiLog.debug(`Terminal notify stored level=${level} (${message.length} chars).`);
}

/**
 * Keeps the collection bounded.
 *
 * @returns {Promise<void>}
 */
async function pruneOldMessages() {
  if (!db.webTerminalMessages) {
    return;
  }

  const count = await db.webTerminalMessages.countDocuments();
  if (count <= MAX_STORED) {
    return;
  }

  const overflow = count - MAX_STORED;
  const oldest = await db.webTerminalMessages
      .find({})
      .sort({ createdAt: 1 })
      .limit(overflow)
      .project({ _id: 1 })
      .toArray();

  if (!oldest.length) {
    return;
  }

  await db.webTerminalMessages.deleteMany({
    _id: { $in: oldest.map((row) => row._id) },
  });
  webuiLog.debug(`Pruned ${oldest.length} old terminal message(s) (cap=${MAX_STORED}).`);
}

module.exports = {
  listMessages,
  createMessage,
  appendNotifyMessage,
};
