'use strict';

/**
 * Terminal message stored in MongoDB `webTerminalMessages`.
 *
 * @typedef {Object} WebUiTerminalMessage
 * @property {string} user Owner login from JWT
 * @property {string} message Message body
 * @property {boolean} isSelfWritten Whether the user typed the message (vs bot output)
 * @property {number} createdAt Unix timestamp in milliseconds
 */

/**
 * `GET /api/v1/messages` response.
 *
 * @typedef {Object} WebUiMessagesListResponse
 * @property {WebUiTerminalMessage[]} messages
 */

/**
 * `POST /api/v1/messages` response.
 *
 * @typedef {Object} WebUiMessageCreateResponse
 * @property {WebUiTerminalMessage} message Persisted message document
 */

module.exports = {};
