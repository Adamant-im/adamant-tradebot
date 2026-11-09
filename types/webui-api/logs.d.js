'use strict';

/**
 * Query params for `GET /api/v1/logs` (gzip of filtered log lines).
 * Requires the `manager` or `admin` role; `read-only` tokens get 403.
 *
 * @typedef {Object} WebUiLogsQuery
 * @property {number} [tail] Max lines after filters (default 1000, max 20000)
 * @property {string} [level] Keep lines matching this level token
 * @property {string} [grep] Substring filter
 */

module.exports = {};
