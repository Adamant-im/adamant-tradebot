'use strict';

/* global describe, test, expect */

const { UnauthorizedError, ForbiddenError } = require('../../api/lib/errors');
const {
  WEBUI_JWT_VERIFY_OPTIONS,
  assertJwtLifetime,
  extractJwtToken,
  getAuthenticatedUser,
  getAuthenticatedUserFromPayload,
  assertRouteAccess,
  getRequiredRole,
  isWebUiRole,
  isWriteHttpMethod,
  routeAccess,
} = require('../../api/lib/auth');

/**
 * Builds the request fields `assertRouteAccess()` reads after `jwtVerify()`.
 *
 * @param {string} method HTTP method
 * @param {string | undefined} minRole Route `config.minRole`
 * @param {object} user Verified JWT claims
 */
function routeRequest(method, minRole, user) {
  return {
    method,
    user,
    routeOptions: { config: minRole === undefined ? {} : { minRole } },
  };
}

const viewer = { login: 'viewer', role: 'read-only' };
const manager = { login: 'manager', role: 'manager' };
const admin = { login: 'admin', role: 'admin' };
const legacy = { login: 'legacy' };

const HOUR_MS = 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 9, 1, 12, 0, 0);
const NOW_SEC = NOW_MS / 1000;

describe('WebUI JWT lifetime', () => {
  test('verify options require exp and pin HS256', () => {
    expect(WEBUI_JWT_VERIFY_OPTIONS.requiredClaims).toEqual(['exp']);
    expect(WEBUI_JWT_VERIFY_OPTIONS.algorithms).toEqual(['HS256']);
  });

  test('assertJwtLifetime accepts exp within the cap', () => {
    expect(() => assertJwtLifetime({ login: 'operator', exp: NOW_SEC + 12 * 3600 }, 24 * HOUR_MS, NOW_MS))
        .not.toThrow();
    expect(() => assertJwtLifetime({ login: 'operator', exp: NOW_SEC + 24 * 3600 }, 24 * HOUR_MS, NOW_MS))
        .not.toThrow();
  });

  test('assertJwtLifetime rejects tokens without a numeric exp', () => {
    expect(() => assertJwtLifetime({ login: 'operator' }, 24 * HOUR_MS, NOW_MS)).toThrow(UnauthorizedError);
    expect(() => assertJwtLifetime({ login: 'operator', exp: '9999999999' }, 24 * HOUR_MS, NOW_MS))
        .toThrow(UnauthorizedError);
    expect(() => assertJwtLifetime(undefined, 24 * HOUR_MS, NOW_MS)).toThrow(UnauthorizedError);
  });

  test('assertJwtLifetime rejects exp further ahead than the cap', () => {
    expect(() => assertJwtLifetime({ login: 'operator', exp: NOW_SEC + 24 * 3600 + 1 }, 24 * HOUR_MS, NOW_MS))
        .toThrow(/private_webui_jwt_max_ttl/);
    expect(() => assertJwtLifetime({ login: 'operator', exp: NOW_SEC + 10 * 365 * 24 * 3600 }, 24 * HOUR_MS, NOW_MS))
        .toThrow(UnauthorizedError);
  });

  test('assertJwtLifetime fails closed when the cap is invalid', () => {
    expect(() => assertJwtLifetime({ login: 'operator', exp: NOW_SEC + 60 }, NaN, NOW_MS))
        .toThrow(UnauthorizedError);
  });
});

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

  test('isWriteHttpMethod identifies mutating verbs', () => {
    expect(isWriteHttpMethod('POST')).toBe(true);
    expect(isWriteHttpMethod('put')).toBe(true);
    expect(isWriteHttpMethod('GET')).toBe(false);
  });

  test('getAuthenticatedUser returns role when present', () => {
    expect(getAuthenticatedUser({ user: { login: 'operator', role: 'manager' } }))
        .toEqual({ login: 'operator', role: 'manager' });
  });

  test('getAuthenticatedUserFromPayload rejects unknown roles instead of granting full access', () => {
    expect(() => getAuthenticatedUserFromPayload({ login: 'operator', role: 'superadmin' }))
        .toThrow(UnauthorizedError);
    expect(() => getAuthenticatedUserFromPayload({ login: 'operator', role: 'Read-Only' }))
        .toThrow(UnauthorizedError);
    expect(() => getAuthenticatedUserFromPayload({ login: 'operator', role: '' }))
        .toThrow(UnauthorizedError);
    expect(getAuthenticatedUserFromPayload({ login: 'operator', role: null })).toEqual({ login: 'operator' });
  });
});

describe('WebUI route access', () => {
  test('isWebUiRole knows only the three WebUI roles', () => {
    expect(isWebUiRole('read-only')).toBe(true);
    expect(isWebUiRole('manager')).toBe(true);
    expect(isWebUiRole('admin')).toBe(true);
    expect(isWebUiRole('viewer')).toBe(false);
    expect(isWebUiRole('toString')).toBe(false);
    expect(isWebUiRole(undefined)).toBe(false);
  });

  test('routeAccess builds JWT-protected route options', () => {
    const authenticate = async () => undefined;

    expect(routeAccess({ authenticate }, 'read-only')).toEqual({
      preHandler: [authenticate],
      config: { minRole: 'read-only' },
    });
  });

  test('getRequiredRole defaults to manager and raises write methods to manager', () => {
    expect(getRequiredRole(routeRequest('GET', undefined, viewer))).toBe('manager');
    expect(getRequiredRole(routeRequest('GET', 'reader', viewer))).toBe('manager');
    expect(getRequiredRole(routeRequest('GET', 'read-only', viewer))).toBe('read-only');
    expect(getRequiredRole(routeRequest('POST', 'read-only', viewer))).toBe('manager');
    expect(getRequiredRole(routeRequest('GET', 'admin', viewer))).toBe('admin');
  });

  test('read-only role passes monitoring reads only', () => {
    expect(() => assertRouteAccess(routeRequest('GET', 'read-only', viewer))).not.toThrow();
    expect(() => assertRouteAccess(routeRequest('HEAD', 'read-only', viewer))).not.toThrow();
  });

  test('read-only role is denied on manager routes regardless of HTTP method', () => {
    expect(() => assertRouteAccess(routeRequest('GET', 'manager', viewer))).toThrow('Read-only access');
    expect(() => assertRouteAccess(routeRequest('GET', undefined, viewer))).toThrow(ForbiddenError);
    expect(() => assertRouteAccess(routeRequest('POST', 'manager', viewer))).toThrow('Read-only access');
  });

  test('read-only role is denied on write methods even when a route is marked read-only', () => {
    expect(() => assertRouteAccess(routeRequest('POST', 'read-only', viewer))).toThrow('Read-only access');
    expect(() => assertRouteAccess(routeRequest('PUT', 'read-only', viewer))).toThrow(ForbiddenError);
    expect(() => assertRouteAccess(routeRequest('DELETE', 'read-only', viewer))).toThrow(ForbiddenError);
  });

  test('manager passes manager routes but not admin routes', () => {
    expect(() => assertRouteAccess(routeRequest('POST', 'manager', manager))).not.toThrow();
    expect(() => assertRouteAccess(routeRequest('GET', 'read-only', manager))).not.toThrow();
    expect(() => assertRouteAccess(routeRequest('GET', 'admin', manager))).toThrow('Admin role required');
  });

  test('admin and legacy tokens without role pass every route', () => {
    for (const user of [admin, legacy]) {
      expect(() => assertRouteAccess(routeRequest('GET', 'admin', user))).not.toThrow();
      expect(() => assertRouteAccess(routeRequest('POST', 'manager', user))).not.toThrow();
      expect(() => assertRouteAccess(routeRequest('GET', undefined, user))).not.toThrow();
    }
  });
});
