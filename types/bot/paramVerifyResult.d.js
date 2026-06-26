/**
 * types/bot/paramVerifyResult.d.js
 */

'use strict';

/**
 * Types of verification
 *
 * @typedef {(
 *   '' |
 *   'integer' |
 *   'positive integer' |
 *   'positive or zero integer' |
 *   'number' |
 *   'positive number' |
 *   'positive or zero number' |
 *   'positive smart number' |
 *   'smart time' |
 *   string
 * )} VerificationTypes
 */

/**
 * Parsed result for positive smart numbers
 * Example:
 * {
 *   isNumber: true,
 *   fancyNumberString: '100',
 *   number: 100
 * }
 * Example:
 * {
 *   isNumber: true,
 *   fancyNumberString: '500k',
 *   number: 500_000
 * }
 *
 * @typedef {Object} ParsedPositiveSmartNumber
 * @property {boolean} isNumber Whether the value is a positive simple (100) or smart (500k) number
 * @property {string} [fancyNumberString] If `isNumber` is true, the value represented as a string (e.g., '100' or '500k')
 * @property {number} [number] If `isNumber` is true, the value represented as a plain number (e.g., 100 or 500_000)
 */

/**
 * Parsed result for smart time
 * Example:
 * {
 *   isTime: true,
 *   msecs: 60000,
 *   secs: 60,
 *   mins: 1,
 *   hours: 0.0166,
 *   days: ...,
 *   weeks: ...,
 *   months: ...,
 *   years: ...
 * }
 *
 * @typedef {Object} ParsedSmartTime
 * @property {boolean} isTime Whether the string is time (e.g, '5s', '5 secs', '5 seconds')
 * @property {number} [msecs] Time in msecs
 * @property {number} [secs] Time in secs
 * @property {number} [mins] Time in mins
 * @property {number} [hours] Time in hours
 * @property {number} [days] Time in days
 * @property {number} [weeks] Time in weeks
 * @property {number} [months] Time in months
 * @property {number} [years] Time in years
 */

/**
 * Generic verify result shape
 *
 * @template TParsed
 * @typedef {Object} ParamVerifyResultT
 * @property {boolean} success
 * @property {TParsed} [parsed] Parsed value: can be a primitive or a complex object depending on verifier
 * @property {string} [plain] Original string representation
 * @property {string} [lc] Lower-cased value of `plain`
 * @property {string} [uc] Upper-cased value of `plain`
 * @property {string} [message] Optional error / info message
 */

/**
 * Common union for verify results you described:
 *  - simple number
 *  - ParsedPositiveSmartNumber
 *  - ParsedSmartTime
 *
 * @typedef {ParamVerifyResultT<string | number | ParsedPositiveSmartNumber | ParsedSmartTime>} ParamVerifyResult
 */

module.exports = {};

