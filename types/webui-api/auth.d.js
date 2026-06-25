'use strict';

/**
 * WebUI JWT authentication (scenario A — private WebUI).
 *
 * Users, passwords, and 2FA live in the **private WebUI service**. After login the WebUI signs a JWT
 * with `private_webui_secret_key` (same on every bot in the fleet). Bots verify the HMAC only.
 *
 * Scenario B: browser session from adamant-payment; bot uses `public_webui_license_token` for relay.
 *
 * @typedef {Object} WebUiJwtPayload
 * @property {string} login Operator id from the WebUI user session
 * @property {boolean} [enabled] When `false`, the operator account is disabled in the WebUI
 *
 * @typedef {Object} WebUiJwtUser
 * @property {string} login Operator id extracted from a verified JWT
 */

module.exports = {};
