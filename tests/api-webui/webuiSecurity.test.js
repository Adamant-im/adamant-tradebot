'use strict';

/* global describe, test, expect, jest */

const {
  assertPrivateWebUiJwtMaxTtl,
  assertPrivateWebUiSecretKey,
  createWebuiAllowedIpsHook,
  DEFAULT_PRIVATE_WEBUI_BIND_HOST,
  getWebuiCorsOptions,
  isAllowedWebUiClientIp,
  isLocalhostOrigin,
  isLoopbackBindHost,
  isWeakPrivateWebUiSecretKey,
  MIN_SECRET_KEY_LENGTH,
  normalizeClientIp,
  parsePrivateWebUiJwtMaxTtlMs,
  resolvePrivateWebUiBindHost,
} = require('../../api/lib/webuiSecurity');

// @fastify/cors allows only GET, HEAD, and POST by default; browser WebUI clients also send PUT /params
const WEBUI_CORS_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'];

describe('WebUI security helpers', () => {
  test('isWeakPrivateWebUiSecretKey rejects placeholders and short secrets', () => {
    expect(isWeakPrivateWebUiSecretKey('')).toBe(true);
    expect(isWeakPrivateWebUiSecretKey('some-random-string')).toBe(true);
    expect(isWeakPrivateWebUiSecretKey('a'.repeat(MIN_SECRET_KEY_LENGTH - 1))).toBe(true);
  });

  test('isWeakPrivateWebUiSecretKey accepts long unique secrets', () => {
    const secret = 'a'.repeat(MIN_SECRET_KEY_LENGTH);
    expect(isWeakPrivateWebUiSecretKey(secret)).toBe(false);
  });

  test('assertPrivateWebUiSecretKey throws for weak secrets', () => {
    expect(() => assertPrivateWebUiSecretKey('some-random-string')).toThrow(/too weak/i);
  });

  test('isLocalhostOrigin accepts loopback browser origins only', () => {
    expect(isLocalhostOrigin('http://localhost:3000')).toBe(true);
    expect(isLocalhostOrigin('http://127.0.0.1:3000')).toBe(true);
    expect(isLocalhostOrigin('http://[::1]:3000')).toBe(true);
    expect(isLocalhostOrigin('https://example.com')).toBe(false);
    expect(isLocalhostOrigin(undefined)).toBe(false);
  });

  test('resolvePrivateWebUiBindHost defaults to loopback', () => {
    expect(resolvePrivateWebUiBindHost(undefined)).toBe(DEFAULT_PRIVATE_WEBUI_BIND_HOST);
    expect(resolvePrivateWebUiBindHost(' 0.0.0.0 ')).toBe('0.0.0.0');
  });

  test('isLoopbackBindHost distinguishes local and fleet binds', () => {
    expect(isLoopbackBindHost('127.0.0.1')).toBe(true);
    expect(isLoopbackBindHost('0.0.0.0')).toBe(false);
  });

  test('getWebuiCorsOptions relaxes CORS for remote fleet binds', () => {
    expect(getWebuiCorsOptions('127.0.0.1')).toEqual({
      origin: expect.any(Function),
      methods: WEBUI_CORS_METHODS,
    });
    expect(getWebuiCorsOptions('0.0.0.0')).toEqual({
      origin: true,
      methods: WEBUI_CORS_METHODS,
    });
  });

  test('normalizeClientIp handles IPv4-mapped IPv6 and port suffixes', () => {
    expect(normalizeClientIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeClientIp('1.2.3.4:5678')).toBe('1.2.3.4');
  });

  test('isAllowedWebUiClientIp enforces optional allowlist', () => {
    expect(isAllowedWebUiClientIp('1.2.3.4', [])).toBe(true);
    expect(isAllowedWebUiClientIp('1.2.3.4', ['1.2.3.4'])).toBe(true);
    expect(isAllowedWebUiClientIp('5.6.7.8', ['1.2.3.4'])).toBe(false);
    expect(isAllowedWebUiClientIp('::ffff:1.2.3.4', ['1.2.3.4'])).toBe(true);
  });

  test('createWebuiAllowedIpsHook rejects clients outside the allowlist', async () => {
    const hook = createWebuiAllowedIpsHook(['1.2.3.4']);
    const reply = {
      code: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    await hook({ ip: '5.6.7.8' }, reply);
    expect(reply.code).toHaveBeenCalledWith(403);

    reply.code.mockClear();
    reply.send.mockClear();
    await hook({ ip: '1.2.3.4' }, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  test('parsePrivateWebUiJwtMaxTtlMs parses durations and defaults to 24h', () => {
    expect(parsePrivateWebUiJwtMaxTtlMs('12h')).toBe(12 * 60 * 60 * 1000);
    expect(parsePrivateWebUiJwtMaxTtlMs('90 min')).toBe(90 * 60 * 1000);
    expect(parsePrivateWebUiJwtMaxTtlMs('1d')).toBe(24 * 60 * 60 * 1000);
    expect(parsePrivateWebUiJwtMaxTtlMs(undefined)).toBe(24 * 60 * 60 * 1000);
    expect(parsePrivateWebUiJwtMaxTtlMs('')).toBe(24 * 60 * 60 * 1000);
  });

  test('parsePrivateWebUiJwtMaxTtlMs rejects zero and malformed durations', () => {
    expect(parsePrivateWebUiJwtMaxTtlMs('0h')).toBeNaN();
    expect(parsePrivateWebUiJwtMaxTtlMs('-1h')).toBeNaN();
    expect(parsePrivateWebUiJwtMaxTtlMs('12')).toBeNaN();
    expect(parsePrivateWebUiJwtMaxTtlMs('forever')).toBeNaN();
  });

  test('assertPrivateWebUiJwtMaxTtl throws for invalid values only', () => {
    expect(() => assertPrivateWebUiJwtMaxTtl('24h')).not.toThrow();
    expect(() => assertPrivateWebUiJwtMaxTtl(undefined)).not.toThrow();
    expect(() => assertPrivateWebUiJwtMaxTtl('never')).toThrow(/private_webui_jwt_max_ttl/);
  });
});
