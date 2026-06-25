'use strict';

/**
 * WebUI access scenarios (see `.ai-tasks/2026-06-02 (Plan) Payment-Auth+WebUI+Bot.md`).
 *
 * ## Scenario A — private self-hosted WebUI (`directHttp`)
 *
 * ```
 * Browser --HTTPS--> WebUI (reverse proxy)
 * WebUI   --HTTP--> Bot1:private_webui, Bot2:private_webui, …
 * ```
 *
 * - `private_webui` = listen port on each bot (not the WebUI URL).
 * - `private_webui_secret_key` = shared fleet HMAC; WebUI signs JWT after operator login.
 *
 * ## Scenario B — public subscription WebUI (`relayWs`, 6b/7)
 *
 * ```
 * Browser --HTTPS--> public WebUI + relay
 * Bot --WSS outbound--> public_webui  (license token, no inbound port)
 * relay --HTTPS--> adamant-payment (license validation on relay, not on bot)
 * ```
 *
 * - Auto-detected when `public_webui` and `public_webui_license_token` are set.
 * - `private_webui`: false; `private_webui_secret_key` unused for browser auth.
 *
 * @typedef {Object} WebUiScenarioAPrivate
 * @property {'directHttp'} transport
 * @property {string} secretKey `config.private_webui_secret_key`
 * @property {number} apiPort `config.private_webui`
 *
 * @typedef {Object} WebUiScenarioBPublic
 * @property {'relayWs'} transport
 * @property {string} relayUrl `config.public_webui`
 * @property {string} licenseToken `config.public_webui_license_token`
 */

module.exports = {};
