'use strict';

/**
 * @module api/lib/webuiConfig
 * @typedef {import('types/webui-api/config.d.js').WebUiTransportMode} WebUiTransportMode
 */

/**
 * Returns whether the bot should start the inbound private WebUI API server.
 *
 * `config.private_webui` is the **listen port on this bot**, not the WebUI host address.
 *
 * @param {number | false | undefined | null} privateWebuiPort Value of `config.private_webui`
 * @returns {privateWebuiPort is number}
 */
function isPrivateWebUiApiEnabled(privateWebuiPort) {
  return typeof privateWebuiPort === 'number' &&
    Number.isInteger(privateWebuiPort) &&
    privateWebuiPort > 0;
}

/**
 * Returns whether scenario B outbound relay is configured (6b — connection not implemented yet).
 *
 * Transport is inferred from config: both `public_webui` and `public_webui_license_token` must be set.
 *
 * @param {import('../../modules/configReader')} config Bot configuration
 * @returns {boolean}
 */
function isPublicWebUiRelayEnabled(config) {
  return typeof config.public_webui === 'string' &&
    config.public_webui.length > 0 &&
    typeof config.public_webui_license_token === 'string' &&
    config.public_webui_license_token.length > 0;
}

/**
 * Resolves the active WebUI transport (`GET /api/v1/bot`, `/health`).
 *
 * Relay wins when `public_webui` + `public_webui_license_token` are set; otherwise `directHttp`.
 *
 * @param {import('../../modules/configReader')} config Bot configuration
 * @returns {WebUiTransportMode}
 */
function getWebUiTransport(config) {
  if (isPublicWebUiRelayEnabled(config)) {
    return 'relayWs';
  }

  return 'directHttp';
}

module.exports = {
  isPrivateWebUiApiEnabled,
  isPublicWebUiRelayEnabled,
  getWebUiTransport,
};
