/**
 * FameEx.net error codes.
 * @see https://fameexdocs.github.io/docs-v1/en/index.html?javascript--node#return-code-type
 */

const errorCodeDescriptions = {
  0: {
    description: 'OK',
  },
  1: {
    description: 'fail',
    isTemporary: true,
  },

  // 10XX - General Server or Network Issues
  '-1000': {
    description: 'An unknown error occurred while processing the request',
    isTemporary: true,
  },
  '-1001': {
    description: 'Internal error; unable to process your request. Please try again.',
    isTemporary: true,
  },
  '-1002': {
    description: 'You are not authorized to execute this request. The request needs to send an API Key, and we recommend appending the X-CH-APIKEY to all request headers',
    isTemporary: true,
  },
  '-1003': {
    description: 'Requests exceed the limit too frequently',
    isTemporary: true,
  },
  '-1004': {
    description: 'You are not authorized to execute this request. User does not exist.',
    isTemporary: true,
  },
  '-1006': {
    description: 'An unexpected response was received from the message bus. Execution status unknown. The OPEN API server finds some exceptions in executing the request. Please report to our Customer Service.',
    isTemporary: true,
  },
  '-1007': {
    description: 'Timeout waiting for response from backend server. Send status unknown; execution status unknown.',
    isTemporary: true,
  },
  '-1015': {
    description: 'Too many orders. Please reduce the number of your orders',
    isTemporary: true,
  },
  '-1016': {
    description: 'This server is no longer available and the interface cannot be accessed',
    isTemporary: true,
  },
  '-1021': {
    description: 'The timestamp offset is too large. Timestamp for this request was 1000ms ahead of the servers time. Please check the difference between your local time and server time.',
    isTemporary: true,
  },
  '-1022': {
    description: 'Invalid signature',
    isTemporary: true,
  },
  '-1023': {
    description: 'You are not authorized to execute this request. The request need to send timestamps, and we recommend appending X-CH-TS to all request headers',
    isTemporary: true,
  },
  '-1024': {
    description: 'You are not authorized to execute this request. The request needs to send sign, and we recommend appending X-CH-SIGN to all request headers',
    isTemporary: true,
  },

  // 11XX - Request issues
  '-1100': {
    description: 'Occurs when trying to cancel order with invalid order id.',
    isTemporary: false,
  },
  '-1105': {
    description: 'The parameter {0} is empty',
    isTemporary: false,
  },
  '-1112': {
    description: 'There are no pending orders for trading pairs',
    isTemporary: false,
  },
  '-1117': {
    description: 'Invalid buying or selling direction',
    isTemporary: false,
  },
  '-1121': {
    description: 'Invalid contract',
    isTemporary: false,
  },
  '-1138': {
    description: 'The order price is outside the allowable range',
    isTemporary: false,
  },

  /** Occurs when trying to place order with volume exceeding allowed precision. */
  10062: {
    description: '价格或数量精度超过最大限制. Occurs when trying to place order with volume exceeding allowed precision.',
    isTemporary: false,
  },
  /** Occurs when trying to place order with volume lower than minimum amount. */
  110046: {
    description: '数量小于最小值. Occurs when trying to place order with volume lower than minimum amount.',
    isTemporary: false,
  },
  /** Occurs when trying to market buy with volume lower than minimum amount. */
  110047: {
    description: '价格或金额小于最小值. Occurs when trying to market buy with volume lower than minimum amount.',
    isTemporary: false,
  },
  /** Occurs when trying to place order with volume exceeding available balance. */
  110049: {
    description: '账户余额不足. Occurs when trying to place order with volume exceeding available balance.',
    isTemporary: false,
  },

  // 2XXX - Other issues
  '-2015': {
    description: 'Invalid API key, IP, or operation permission. Signature or IP is incorrect.',
    isTemporary: true,
  },
  '-2016': {
    description: 'Transactions are frozen.',
    isTemporary: true,
  },
  '-2200': {
    description: 'Illegal IP. Not a trusted IP.',
    isTemporary: true,
  },
  35: {
    description: 'Forbidden to order. Users transactions may be restricted.',
    isTemporary: true,
  },
  40: {
    description: 'IP not in whitelist.',
    isTemporary: true,
  },
};

/** General HTTP error codes. */
const httpErrorCodeDescriptions = {
  4: { // 4XX (400, 402)
    description: 'Malformed request',
  },
  401: {
    description: 'Unauthorized',
    isTemporary: true,
  },
  403: {
    description: 'Forbidden', // Possible causes: 1. IP rate limit breached; 2. You send GET request with an empty json body; 3. You are using U.S IP
    isTemporary: true,
  },
  404: {
    description: 'Page not found', //  Possible causes: 1. Wrong path; 2. Category value does not match account mode
  },
  429: {
    description: 'System protection', // System level frequency protection. Please retry when encounter this.
    isTemporary: true,
  },
  5: { // 5XX
    description: 'Internal error', // Probably error on the exchange's side
    isTemporary: true,
  },
};

module.exports = {
  errorCodeDescriptions,
  httpErrorCodeDescriptions,
};
