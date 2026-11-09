'use strict';

/**
 * Terminal message stored in MongoDB `webTerminalMessages`.
 *
 * @typedef {Object} WebUiTerminalMessage
 * @property {string} user Owner login from JWT, or `bot` for notify fan-in
 * @property {string} message Message body (may include Markdown)
 * @property {boolean} isSelfWritten Whether an operator typed the message (legacy; UI no longer posts)
 * @property {number} createdAt Unix timestamp in milliseconds
 * @property {string} [level] Optional severity: error | warn | info | log | debug | trace
 */

/**
 * `GET /api/v1/messages` response.
 * Requires the `manager` or `admin` role; `read-only` tokens get 403.
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
