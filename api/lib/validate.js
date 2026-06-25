'use strict';

/**
 * @module api/lib/validate
 * @typedef {import('types/webui-api/errors.d.js').WebUiValidationErrorDetails} WebUiValidationErrorDetails
 */

const { ZodError } = require('zod');
const { BadRequestError } = require('./errors');

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
};
