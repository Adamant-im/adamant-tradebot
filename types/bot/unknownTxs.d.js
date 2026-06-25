/**
 * types/bot/unknownTxs.d.js
 *
 * Type definitions for unrecognized ADM chat messages (`modules/unknownTxs.js`).
 */

/**
 * Reuse existing types from:
 * @typedef {import('types/bot/adamant.d.js').AdamantIncomingTx} AdamantIncomingTx
 * @typedef {import('types/bot/adamant.d.js').IncomingAdmTxDbRecord} IncomingAdmTxDbRecord
 */

/**
 * Index into `UNKNOWN_TX_REPLY_COLLECTIONS` in `unknownTxs.js`.
 *
 * Higher indices correspond to more persistent senders and rougher / more random replies.
 *
 * @typedef {0|1|2|3|4|5} UnknownTxReplyCollectionIndex
 */

/**
 * Handles a chat message that is neither a recognized command nor a bare transfer.
 *
 * Chooses a reply based on how many `unknown` messages the sender posted recently,
 * then marks the `incomingtxs` record as processed.
 *
 * @typedef {(tx: AdamantIncomingTx, itx: IncomingAdmTxDbRecord) => Promise<void>} HandleUnknownTx
 */

module.exports = {};
