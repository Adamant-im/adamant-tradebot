'use strict';

/**
 * types/bot/cli.d.js
 *
 * Type definitions for the interactive CLI tool (`bin/cli.js`).
 */

/**
 * Reuse existing types from:
 * @typedef {import('types/bot/general.d.js').CommandReply} CommandReply
 */

/**
 * Synthetic transaction passed to `commandTxs()` when a command is typed in the CLI.
 *
 * @typedef {Object} CLICommandTx
 * @property {string} id Unique key: `{senderShellUsername}_{message_id}`
 * @property {number} message_id Random numeric id for this CLI message
 * @property {string} senderId OS shell username of the operator
 * @property {string} senderShellUsername Same as `senderId`; human-readable sender label
 * @property {number} timestamp Local time when the command was typed (Unix ms)
 */

/**
 * MongoDB record stored in `incomingclitxs` for one CLI command.
 *
 * @typedef {Object} IncomingCliTxRecord
 * @property {string} _id Same as `txid`, `{senderId}_{message_id}`
 * @property {string} txid Duplicate of `_id` for compatibility with other incoming-tx collections
 * @property {number} date Record creation time (ms)
 * @property {number} timestamp Local command time from {@link CLICommandTx}
 * @property {string} senderId OS shell username
 * @property {boolean} spam Legacy spam flag set on document creation
 * @property {boolean} isProcessed Whether the command was handled
 * @property {boolean} isNonAdmin Whether the sender is not recognized as an admin
 * @property {string} [commandFix] Normalized command alias, e.g. `help` or `balance`
 */

/**
 * `incomingCLITxsDb` model instance — an `IncomingCliTxRecord` with ORM helpers.
 *
 * @typedef {IncomingCliTxRecord & {
 *   save: () => Promise<any>,
 *   update: (obj: Partial<IncomingCliTxRecord>, shouldSave?: boolean) => Promise<any>
 * }} IncomingCliTxDbRecord
 */

/**
 * Node.js readline completer return value: `[suggestions, originalLine]`.
 *
 * @typedef {[string[], string]} ReadlineCompleterResult
 */

module.exports = {};
