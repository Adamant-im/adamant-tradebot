/**
 * P2PB2B / P2B business-level error codes.
 *
 * Fill / extend this map using:
 * https://github.com/P2B-team/p2b-api-docs/blob/master/errors.md
 *
 * `isTemporary` means the request is considered temporarily failed, and the bot will retry it later with a chance of success.
 */

/**
 * HTTP-level error codes and their meaning for the P2PB2B API.
 * You may rely on specific status codes (e.g., 401, 429, 500)
 * or on broader “ranges” by checking the first digit (4xx, 5xx).
 */
const httpErrorCodeDescriptions = {
  200: {
    description: 'OK',
    isTemporary: false,
  },
  400: {
    description: 'Bad Request (validation error or malformed payload)',
    isTemporary: false,
  },
  401: {
    description: 'Unauthorized: invalid auth, payload or nonce',
    isTemporary: true,
  },
  403: {
    description: 'Forbidden: access denied for this API key',
    isTemporary: true,
  },
  404: {
    description: 'Endpoint not found',
    isTemporary: true,
  },
  422: {
    description: 'Unprocessable Entity: data validation error',
    isTemporary: false,
  },
  423: {
    description: 'Locked: temporary block of API access',
    isTemporary: true,
  },
  429: {
    description: 'Too Many Requests: rate limit exceeded',
    isTemporary: true,
  },
  500: {
    description: 'Internal Server Error: service temporarily unavailable',
    isTemporary: true,
  },
  // Broader ranges
  4: {
    description: 'Client error (4xx)',
    isTemporary: false,
  },
  5: {
    description: 'Server error (5xx)',
    isTemporary: true,
  },
};

const errorCodeDescriptions = {
  // auth / payload / nonce
  1009: {
    description: 'Invalid payload: request parameter does not match the URL',
    isTemporary: false,
  },
  1010: {
    description: 'Invalid API key or signature',
    isTemporary: true,
  },

  // rate limits, blocks etc.
  2002: {
    description: 'Too many requests (rate limit exceeded)',
    isTemporary: true,
  },
  2003: {
    description: 'Temporary block due to suspicious activity',
    isTemporary: true,
  },

  // Generic validation / bad request
  3001: {
    description: 'Invalid request parameters',
    isTemporary: false,
  },
  404: {
    description: 'Endpoint not found',
    isTemporary: true,
  },

  // Example for "order not found"
  3080: {
    description: 'Invalid orderId value or order not found',
    isTemporary: false,
  },
};

module.exports = {
  errorCodeDescriptions,
  httpErrorCodeDescriptions,
};
