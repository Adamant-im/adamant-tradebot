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

/**
 * `POST /api/v1/commands/transfer` JSON body: move funds between exchange sub-accounts.
 * Requires the `manager` or `admin` role. The former `GET` route with a query string is removed.
 *
 * @typedef {Object} WebUiTransferBody
 * @property {number} amount Positive amount to move
 * @property {string} coin Coin ticker, e.g. `USDT`
 * @property {string} from Source account type from `exchangeFeatures.accountTypes`, e.g. `trade`
 * @property {string} to Destination account type, e.g. `main`
 */

module.exports = {};
