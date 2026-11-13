// @ts-check
'use strict';

/** HTTP statuses used by Qutrade v2; access failures never establish order absence */
const httpErrorCodeDescriptions = {
  400: { description: 'Bad Request', isTemporary: false },
  401: { description: 'Unauthorized', isTemporary: true },
  403: { description: 'Forbidden', isTemporary: true },
  404: { description: 'Not Found', isTemporary: false },
  405: { description: 'Method Not Allowed', isTemporary: false },
  408: { description: 'Request Timeout', isTemporary: true },
  429: { description: 'Too Many Requests', isTemporary: true },
  500: { description: 'Internal Server Error', isTemporary: true },
  503: { description: 'Service Unavailable', isTemporary: true },
};

module.exports = { httpErrorCodeDescriptions };
