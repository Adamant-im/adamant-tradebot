'use strict';

/* global describe, test, expect */

const { z } = require('zod');

const { strictNumber } = require('../../api/lib/validate');

describe('strictNumber', () => {
  const amount = strictNumber(z.number().positive());

  test('accepts JSON numbers and decimal strings', () => {
    expect(amount.parse(7)).toBe(7);
    expect(amount.parse(0.5)).toBe(0.5);
    expect(amount.parse('7')).toBe(7);
    expect(amount.parse(' 0.25 ')).toBe(0.25);
    expect(amount.parse('.5')).toBe(0.5);
    expect(amount.parse('1e-8')).toBe(1e-8);
  });

  test('rejects values that z.coerce.number() would turn into numbers', () => {
    for (const value of [true, false, [7], ['7'], [], null, {}, '', '   ', '0x10', '7 USDT', '1k', 'Infinity', '1e400', NaN]) {
      expect(amount.safeParse(value).success).toBe(false);
    }
  });

  test('keeps the constraints of the number schema', () => {
    expect(amount.safeParse(-1).success).toBe(false);
    expect(amount.safeParse('0').success).toBe(false);
    expect(strictNumber(z.number().int()).safeParse('2.5').success).toBe(false);
    expect(strictNumber(z.number().int()).parse('3')).toBe(3);
  });

  test('works as an optional field', () => {
    const schema = z.object({ price: strictNumber(z.number().positive()).optional() });

    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ price: '1.5' })).toEqual({ price: 1.5 });
    expect(schema.safeParse({ price: true }).success).toBe(false);
  });
});
