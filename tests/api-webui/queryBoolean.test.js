'use strict';

/* global describe, test, expect */

const { pairQuerySchema } = require('../../api/schemas/market');
const { queryBoolean } = require('../../api/lib/validate');

describe('queryBoolean', () => {
  const schema = queryBoolean();

  test('treats omitted and empty values as undefined', () => {
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse('')).toBeUndefined();
    expect(schema.parse('  ')).toBeUndefined();
  });

  test('parses explicit true/false strings (not JS truthiness)', () => {
    expect(schema.parse('false')).toBe(false);
    expect(schema.parse('true')).toBe(true);
    expect(schema.parse('0')).toBe(false);
    expect(schema.parse('1')).toBe(true);
    expect(schema.parse(false)).toBe(false);
    expect(schema.parse(true)).toBe(true);
  });

  test('pairQuerySchema keeps noCache=false as false', () => {
    expect(pairQuerySchema.parse({ noCache: 'false' })).toEqual({ noCache: false });
    expect(pairQuerySchema.parse({ noCache: 'true' })).toEqual({ noCache: true });
    expect(pairQuerySchema.parse({})).toEqual({});
  });
});
