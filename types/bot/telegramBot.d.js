/**
 * types/bot/telegramBot.d.js
 *
 * Type definitions for the Telegram management bot (`telegramBot/`).
 */

/**
 * Reuse existing types from:
 * @typedef {import('types/bot/general.d.js').CommandReply} CommandReply
 */

/**
 * Telegram user identifier from config: numeric user id or `@username` string.
 * @typedef {number|string} TelegramAdminId
 */

/**
 * Normalized command transaction passed from the management bot to `commandTxs()`.
 *
 * @typedef {Object} TelegramCommandTx
 * @property {string} id Unique message key: `{senderId}_{message_id}`
 * @property {number} message_id Telegram message id
 * @property {string} senderTgUsername Human-readable sender label, e.g. `@alice (id 123)` or `id 123`
 * @property {number} senderId Telegram user id
 * @property {number} timestamp Telegram message date (Unix seconds)
 */

/**
 * MongoDB record stored in `incomingtgtxs` for one Telegram command message.
 *
 * @typedef {Object} IncomingTgTxRecord
 * @property {string} _id Same as `txid`, `{senderId}_{message_id}`
 * @property {string} txid Duplicate of `_id` for compatibility with ADM transaction records
 * @property {number} date Record creation time (ms)
 * @property {number} timestamp Original Telegram message date (Unix seconds)
 * @property {'command'} type Message category
 * @property {number} senderId Telegram user id
 * @property {string} senderTgUsername Human-readable sender label
 * @property {'command'} messageDirective How the bot should treat the message
 * @property {boolean} [spam] Legacy spam flag set on document creation
 * @property {boolean} isProcessed Whether the command was handled or intentionally skipped
 * @property {boolean} [isSpam] Whether the sender exceeded rate limits
 * @property {boolean} isNonAdmin Whether the sender is not in the admin list
 * @property {string} command Parsed command name without the leading `/`
 * @property {string} [commandFix] Optional command text override used by `/help`
 */

/**
 * `incomingTgTxsDb` model instance — an `IncomingTgTxRecord` with ORM helpers.
 *
 * @typedef {IncomingTgTxRecord & {
 *   save: () => Promise<any>,
 *   update: (obj: Partial<IncomingTgTxRecord>, shouldSave?: boolean) => Promise<any>
 * }} IncomingTgTxDbRecord
 */

/**
 * Parameters for Telegram Bot API `sendMessage`.
 *
 * @typedef {Object} TelegramSendMessageParams
 * @property {number|string} chat_id Recipient chat id, `@channel`, or `@group`
 * @property {string} text Message body (MarkdownV2 when `parse_mode` is set)
 * @property {'MarkdownV2'|string} [parse_mode] Telegram parse mode
 * @property {boolean} [disable_notification] Send silently
 */

/**
 * Minimal marked token shape used by `telegramBot/format.js`.
 * Marked may attach nested `tokens` on container nodes.
 *
 * @typedef {Object} MarkedToken
 * @property {string} type Token type, e.g. `text`, `strong`, `link`, `list`
 * @property {string} [raw] Original markdown fragment
 * @property {string} [text] Plain text content
 * @property {string} [href] Link target for `link` tokens
 * @property {MarkedToken[]} [tokens] Nested child tokens
 * @property {MarkedToken[]} [items] List items for `list` tokens
 */

/**
 * HTTP client wrapper for outgoing Telegram Bot API calls.
 *
 * @typedef {Object} TelegramBotApi
 * @property {string} baseURL Base URL `https://api.telegram.org/bot{token}`
 * @property {(params: TelegramSendMessageParams) => Promise<import('axios').AxiosResponse|void>} sendMessage Sends a message via `sendMessage`
 */

module.exports = {};
