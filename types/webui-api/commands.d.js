'use strict';

/**
 * Generic command handler reply for endpoints that still delegate to `commandTxs`.
 * Structured account/market endpoints prefer typed JSON instead of `message` text.
 *
 * @typedef {Object} WebUiCommandMessageResponse
 * @property {string} message Human-readable bot reply (markdown-ish text from commandTxs)
 */

/**
 * Price-maker confirmation step before executing a scheduled price change.
 *
 * @typedef {Object} WebUiCommandConfirmResponse
 * @property {string} confirmMessage Confirmation text; client must re-submit with `confirm: true`
 */

module.exports = {};
