'use strict';

/**
 * @module api/lib/validate
 * @typedef {import('types/webui-api/errors.d.js').WebUiValidationErrorDetails} WebUiValidationErrorDetails
 */

const { z, ZodError } = require('zod');
const { BadRequestError } = require('./errors');

const QUERY_TRUE = new Set(['true', '1', 'yes']);
const QUERY_FALSE = new Set(['false', '0', 'no']);

/** Decimal number written as text, e.g. `12`, `-0.5`, `.25`, `1e-8` */
const NUMERIC_STRING_REGEXP = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i;

/**
 * Number field of a JSON body: a JSON number, or a string with a decimal number (`"0.5"`).
 *
 * Unlike `z.coerce.number()`, a boolean, array, object, `null`, or empty string is rejected
 * instead of becoming `1`, `7` (from `[7]`), or `0`, so a malformed request never reaches a command.
 *
 * @param {import('zod').ZodNumber} [numberSchema] Constraints for the parsed number, e.g. `z.number().positive()`
 * @returns {import('zod').ZodType<number>}
 */
function strictNumber(numberSchema = z.number()) {
  return z.preprocess((value) => {
    if (typeof value === 'string' && NUMERIC_STRING_REGEXP.test(value)) {
      return Number(value);
    }

    return value;
  }, numberSchema);
}

/**
 * Optional query-string boolean that does not use JS truthiness.
 * `false` / `0` / `no` stay false; omitted or empty stays `undefined`.
 *
 * @returns {import('zod').ZodType<boolean | undefined>}
 */
function queryBoolean() {
  return z.optional(z.union([z.boolean(), z.string(), z.number()])).transform((value, ctx) => {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
    }

    const normalized = String(value).trim().toLowerCase();
    if (normalized === '') {
      return undefined;
    }
    if (QUERY_TRUE.has(normalized)) {
      return true;
    }
    if (QUERY_FALSE.has(normalized)) {
      return false;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expected boolean query value',
    });
    return z.NEVER;
  });
}

/**
 * Parses `value` with a Zod schema or throws `BadRequestError` with field paths.
 *
 * @template {import('zod').ZodTypeAny} TSchema
 * @param {TSchema} schema Zod schema for the request body or query object
 * @param {unknown} value Raw Fastify `request.body` / `request.query`
 * @returns {import('zod').z.infer<TSchema>} Parsed value matching the schema
 */
function parseOrThrow(schema, value) {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      /** @type {Record<string, string>} */
      const fields = {};

      for (const issue of error.issues) {
        fields[issue.path.join('.') || 'body'] = issue.message;
      }

      throw new BadRequestError({ fields });
    }

    throw error;
  }
}

module.exports = {
  parseOrThrow,
  queryBoolean,
  strictNumber,
};
