'use strict';

/* global describe, test, expect, jest */

const {
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
  resolvePrivateWebUiBindHost,
} = require('../../api/lib/webuiSecurity');

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
    expect(getWebuiCorsOptions('127.0.0.1')).toEqual(expect.objectContaining({ origin: expect.any(Function) }));
    expect(getWebuiCorsOptions('0.0.0.0')).toEqual({ origin: true });
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
});
