'use strict';

/**
 * @module api/lib/errors
 * @typedef {import('types/webui-api/errors.d.js').WebUiErrorResponse} WebUiErrorResponse
 * @typedef {import('types/webui-api/errors.d.js').WebUiValidationErrorDetails} WebUiValidationErrorDetails
 */

/**
 * Base HTTP error with a status code and optional structured `details` payload.
 */
class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status code
   * @param {string} message Error message
   * @param {unknown} [details] Optional structured details (e.g. validation fields)
   */
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * 400 Bad Request — invalid input or business rule rejection.
 */
class BadRequestError extends ApiError {
  /**
   * @param {string | WebUiValidationErrorDetails} messageOrPayload Plain message or `{ fields }` map
   */
  constructor(messageOrPayload) {
    if (typeof messageOrPayload === 'object' && messageOrPayload?.fields) {
      super(400, 'Validation failed', messageOrPayload);
    } else {
      super(400, String(messageOrPayload));
    }
  }
}

/** 401 Unauthorized — missing or invalid authentication. */
class UnauthorizedError extends ApiError {
  /**
   * @param {string} [message='Unauthorized']
   */
  constructor(message = 'Unauthorized') {
    super(401, message);
  }
}

/** 404 Not Found — resource or exchange data unavailable. */
class NotFoundError extends ApiError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(404, message);
  }
}

/** 503 Service Unavailable — exchange connector missing a capability. */
class ServiceUnavailableError extends ApiError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(503, message);
  }
}

module.exports = {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  ServiceUnavailableError,
};
