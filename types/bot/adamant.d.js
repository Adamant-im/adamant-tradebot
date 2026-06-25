/**
 * types/bot/adamant.d.js
 *
 * Type definitions for ADAMANT blockchain integration (`modules/adamantApi.js`,
 * `modules/admTxChecker.js`, `modules/admTxParser.js`).
 */

/**
 * Reuse existing types from:
 * @typedef {import('types/bot/general.d.js').CommandReply} CommandReply
 */

/**
 * How an incoming ADM transaction should be routed inside the bot.
 * @typedef {'command'|'transfer'|'unknown'} AdmMessageDirective
 */

/**
 * Incoming ADM transaction as returned by `adamant-api` (REST or WebSocket).
 *
 * Block-related fields are present when the transaction is fetched via REST;
 * relay metadata is present when it arrives over the socket first.
 *
 * @typedef {Object} AdamantIncomingTx
 * @property {string} id Transaction id (hex)
 * @property {string} senderId ADAMANT address of the sender (e.g. `U…`)
 * @property {string} senderPublicKey Sender public key (hex)
 * @property {string} [recipientPublicKey] Recipient public key (hex)
 * @property {number} timestamp Transaction timestamp (Unix seconds)
 * @property {number} amount Transfer amount in ADM satoshis (1 ADM = 1e8)
 * @property {number} fee Transaction fee in ADM satoshis
 * @property {string} [blockId] Block id; absent for socket-first delivery
 * @property {number} [height] Block height; absent for socket-first delivery
 * @property {number} [block_timestamp] Block timestamp (Unix seconds)
 * @property {number} [confirmations] Number of confirmations
 * @property {string[]} [relays] Relay nodes that forwarded the socket event
 * @property {number} [receivedAt] Local receive time (ms) for socket events
 * @property {{ chat?: { message: string, own_message?: boolean | string } }} [asset] Chat message payload for `CHAT_MESSAGE` transactions
 */

/**
 * MongoDB record stored in `incomingtxs` for one ADAMANT message or transfer.
 *
 * @typedef {Object} IncomingAdmTxRecord
 * @property {string} _id Same as `txid`, the ADM transaction id
 * @property {string} txid Duplicate of `_id` for compatibility with other incoming-tx collections
 * @property {number} date Record creation time (ms)
 * @property {number} timestamp Original ADM transaction timestamp (Unix seconds)
 * @property {number} amount Transfer amount in ADM satoshis
 * @property {number} fee Transaction fee in ADM satoshis
 * @property {AdmMessageDirective} type Message category (`messageDirective` alias)
 * @property {string} senderId ADAMANT address of the sender
 * @property {string} senderPublicKey Sender public key (hex)
 * @property {string} [recipientPublicKey] Recipient public key (hex)
 * @property {AdmMessageDirective} messageDirective How the bot should treat the message
 * @property {string} encrypted_content Decrypted chat text (may be empty for bare transfers)
 * @property {boolean} [spam] Legacy spam flag set on document creation
 * @property {boolean} isProcessed Whether the message was handled or intentionally skipped
 * @property {boolean} isNonAdmin Whether the sender is not in the admin list
 * @property {string} [commandFix] Normalized command alias, e.g. `help` or `balance`
 * @property {string} [blockId] Block id; filled when height becomes known
 * @property {number} [height] Block height; filled when the transaction is confirmed via REST
 * @property {number} [block_timestamp] Block timestamp (Unix seconds)
 * @property {number} [confirmations] Number of confirmations
 * @property {string[]} [relays] Relay nodes from a socket-first delivery
 * @property {number} [receivedAt] Local receive time (ms) for socket events
 */

/**
 * `incomingTxsDb` model instance — an `IncomingAdmTxRecord` with ORM helpers.
 *
 * @typedef {IncomingAdmTxRecord & {
 *   save: () => Promise<any>,
 *   update: (obj: Partial<IncomingAdmTxRecord>, shouldSave?: boolean) => Promise<any>
 * }} IncomingAdmTxDbRecord
 */

/**
 * In-memory deduplication entry for `admTxParser.js`.
 *
 * @typedef {Object} ProcessedAdmTxCacheEntry
 * @property {number} updated Timestamp when the cache entry was last updated (ms)
 * @property {number} [height] Block height; absent until the transaction is seen via REST
 */

/**
 * Query parameters passed to `AdamantApi.getTransactions()` by `admTxChecker`.
 *
 * @typedef {Object} AdmTxCheckerQueryParams
 * @property {string} recipientId Bot ADAMANT address to watch
 * @property {number[]} types `TransactionType` values from `adamant-api`
 * @property {number} fromHeight First block height to scan (inclusive)
 * @property {0|1} returnAsset Whether to include decrypted chat payloads
 * @property {string} orderBy Sort order, e.g. `timestamp:desc`
 */

/**
 * Factory that returns a shared `AdamantApi` client instance.
 *
 * @typedef {() => import('adamant-api').AdamantApi} GetAdamantApi
 */

/**
 * Periodic ADM transaction scanner started by `admTxChecker.js`.
 *
 * @typedef {() => void} StartAdmTxChecker
 */

/**
 * Parses one incoming ADM transaction and dispatches it to transfer/command handlers.
 *
 * @typedef {(tx: AdamantIncomingTx) => Promise<void>} ParseAdmTx
 */

module.exports = {};
