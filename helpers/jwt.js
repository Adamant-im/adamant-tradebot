'use strict';

/**
 * JWT sign/verify helpers backed by fast-jwt — the same library @fastify/jwt uses.
 * Inside Fastify routes prefer `request.jwtVerify()` and `fastify.jwt.sign()`.
 *
 * @module helpers/jwt
 */

const { createSigner, createVerifier } = require('fast-jwt');

/**
 * @typedef {object} JwtSignOptions
 * @property {Record<string, string>} [header] Additional JWT header fields
 * @property {string} [kid] Key ID header field
 * @property {number | string} [expiresIn] Token lifetime in milliseconds or as text (e.g. `12h`); sets the `exp` claim
 */

/**
 * @typedef {object} JwtVerifyOptions
 * @property {string[]} [requiredClaims] Claims the token must carry. Defaults to `['exp']`, so a token that never expires is rejected.
 */

/** Claims `verifyHs256()` requires by default: a token without `exp` would never expire */
const DEFAULT_REQUIRED_CLAIMS = Object.freeze(['exp']);

/**
 * Signs a JWT with HS256.
 *
 * @param {Record<string, unknown>} payload JWT claims
 * @param {string} secret HMAC secret
 * @param {JwtSignOptions} [options] Extra header fields and optional lifetime
 * @returns {string} Encoded JWT
 */
function signHs256(payload, secret, options) {
  const { header, kid, expiresIn } = options ?? {};

  /** @type {import('fast-jwt').SignerOptions & { key: string, algorithm: 'HS256' }} */
  const signerOptions = {
    key: secret,
    algorithm: 'HS256',
  };

  if (kid) {
    signerOptions.kid = kid;
  }

  if (header) {
    signerOptions.header = { alg: 'HS256', ...header };
  }

  if (expiresIn !== undefined) {
    signerOptions.expiresIn = expiresIn;
  }

  return createSigner(signerOptions)(payload);
}

/**
 * Verifies a JWT signed with HS256.
 *
 * Rejects expired tokens, tokens that are not active yet (`nbf`), and, by default,
 * tokens without an `exp` claim.
 *
 * @param {string} token Encoded JWT
 * @param {string} secret HMAC secret
 * @param {JwtVerifyOptions} [options] Verification options
 * @returns {Record<string, unknown>} Decoded payload
 * @throws {import('fast-jwt').TokenError} When the signature, a claim, or a required claim is invalid
 */
function verifyHs256(token, secret, options) {
  const { requiredClaims = DEFAULT_REQUIRED_CLAIMS } = options ?? {};

  return createVerifier({
    key: secret,
    algorithms: ['HS256'],
    requiredClaims: [...requiredClaims],
  })(token);
}

/**
 * Signs a JWT with ES256 (Coinbase Advanced, etc.).
 *
 * @param {Record<string, unknown>} payload JWT claims
 * @param {string} privateKey PEM-encoded EC private key
 * @param {JwtSignOptions} [options] Header options
 * @returns {string} Encoded JWT
 */
function signEs256(payload, privateKey, options) {
  const { kid, header } = options ?? {};

  /** @type {import('fast-jwt').SignerOptions & { key: string, algorithm: 'ES256' }} */
  const signerOptions = {
    key: privateKey,
    algorithm: 'ES256',
  };

  if (kid) {
    signerOptions.kid = kid;
  }

  if (header) {
    signerOptions.header = { alg: 'ES256', ...header };
  }

  return createSigner(signerOptions)(payload);
}

module.exports = {
  signHs256,
  verifyHs256,
  signEs256,
};
