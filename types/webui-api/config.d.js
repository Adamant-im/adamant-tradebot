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

module.exports = {};
