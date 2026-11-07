'use strict';

/* global describe, test, expect */

const { signHs256, verifyHs256 } = require('../../helpers/jwt');

const SECRET = 'jwt-helper-test-secret';

describe('helpers/jwt HS256', () => {
  test('signHs256 sets exp from expiresIn', () => {
    const token = signHs256({ login: 'operator' }, SECRET, { expiresIn: '1h' });
    const payload = verifyHs256(token, SECRET);

    expect(payload.login).toBe('operator');
    expect(payload.exp - payload.iat).toBe(3600);
  });

  test('verifyHs256 rejects a token without exp by default', () => {
    const token = signHs256({ login: 'operator' }, SECRET);

    expect(() => verifyHs256(token, SECRET)).toThrow(/exp claim is required/);
  });

  test('verifyHs256 rejects an expired token', () => {
    const token = signHs256({ login: 'operator', exp: Math.floor(Date.now() / 1000) - 60 }, SECRET);

    expect(() => verifyHs256(token, SECRET)).toThrow(/expired/);
  });

  test('verifyHs256 rejects a token signed with another secret', () => {
    const token = signHs256({ login: 'operator' }, 'another-secret', { expiresIn: '1h' });

    expect(() => verifyHs256(token, SECRET)).toThrow();
  });

  test('verifyHs256 accepts a token without exp only when the caller opts out', () => {
    const token = signHs256({ login: 'operator' }, SECRET);

    expect(verifyHs256(token, SECRET, { requiredClaims: [] }).login).toBe('operator');
  });
});
