'use strict';

/* global describe, test, expect */

const { UnauthorizedError } = require('../../api/lib/errors');
const {
  extractJwtToken,
  getAuthenticatedUser,
  getAuthenticatedUserFromPayload,
} = require('../../api/lib/auth');

describe('WebUI JWT auth', () => {
  test('getAuthenticatedUser returns login from verified JWT payload', () => {
    expect(getAuthenticatedUser({ user: { login: 'operator' } })).toEqual({ login: 'operator' });
  });

  test('getAuthenticatedUser rejects disabled accounts', () => {
    expect(() => getAuthenticatedUser({ user: { login: 'operator', enabled: false } }))
        .toThrow(UnauthorizedError);
  });

  test('getAuthenticatedUserFromPayload rejects disabled accounts', () => {
    expect(() => getAuthenticatedUserFromPayload({ login: 'operator', enabled: false }))
        .toThrow(UnauthorizedError);
  });

  test('getAuthenticatedUser rejects missing or invalid login claim', () => {
    expect(() => getAuthenticatedUser({})).toThrow(UnauthorizedError);
    expect(() => getAuthenticatedUser({ user: {} })).toThrow(UnauthorizedError);
    expect(() => getAuthenticatedUser({ user: { login: '' } })).toThrow(UnauthorizedError);
  });

  test('extractJwtToken strips Bearer prefix', () => {
    expect(extractJwtToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractJwtToken('abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractJwtToken('')).toBeNull();
    expect(extractJwtToken(null)).toBeNull();
  });
});
