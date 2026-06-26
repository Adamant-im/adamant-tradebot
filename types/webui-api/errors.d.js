'use strict';

/**
 * Standard JSON error body returned by the WebUI API error handler.
 *
 * @typedef {Object} WebUiErrorResponse
 * @property {string} error Short error message
 * @property {unknown} [details] Optional structured details (e.g. Zod field errors)
 */

/**
 * Validation error details produced by `api/lib/validate.parseOrThrow()`.
 *
 * @typedef {Object} WebUiValidationErrorDetails
 * @property {Record<string, string>} fields Map of field path → error message
 */

module.exports = {};
