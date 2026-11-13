'use strict';

/**
 * Bot-side WebUI connectivity settings (see `config.default.jsonc`).
 *
 * Transport is **auto-detected**:
 * - `public_webui` + `public_webui_license_token` set → `relayWs` (scenario B)
 * - else `private_webui` port → `directHttp` (scenario A)
 *
 * @typedef {'directHttp' | 'relayWs'} WebUiTransportMode
 */

/**
 * `GET /api/v1/config` response: whitelisted `config.jsonc` snapshot with
 * credential-looking keys removed recursively (see `api/services/config.js`).
 *
 * @typedef {Object} WebUiBotConfigResponse
 * @property {Record<string, unknown>} config Sanitized config snapshot
 */

module.exports = {};
