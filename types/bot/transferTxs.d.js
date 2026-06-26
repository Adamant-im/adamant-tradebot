/**
 * types/bot/transferTxs.d.js
 *
 * Type definitions for bare ADM transfer handling (`modules/transferTxs.js`).
 */

/**
 * Reuse existing types from:
 * @typedef {import('types/bot/adamant.d.js').AdamantIncomingTx} AdamantIncomingTx
 * @typedef {import('types/bot/adamant.d.js').IncomingAdmTxDbRecord} IncomingAdmTxDbRecord
 */

/**
 * Handles an incoming ADM transfer (no chat command) sent to the bot wallet.
 *
 * Marks the `incomingtxs` record as processed, notifies operators, and sends a
 * short thank-you message back to the sender.
 *
 * @typedef {(itx: IncomingAdmTxDbRecord, tx: AdamantIncomingTx) => Promise<void>} HandleTransferTx
 */

module.exports = {};
