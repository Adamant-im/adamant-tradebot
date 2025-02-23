'use strict';

/**
 * Internal object with comprehensive information about response error for debugging.
 * @typedef {Object} ResponseError
 * @prop {number} retCode Original request status code from exchange.
 * @prop {string} retMsg Original request status message from exchange.
 * @prop {string} [bybitErrorInfo] Description from `trade/api/bitget_errors.js` composed in format `[code] message (description)`.
 */

module.exports = {};
