'use strict';

/**
 * Network transport mode between WebUI and the bot API.
 *
 * - `directHttp` — scenario A: browser connects to the bot REST/WS API directly (LAN/self-host).
 * - `relayWs` — scenario B: browser and bot both connect to a public relay (future).
 *
 * @typedef {'directHttp' | 'relayWs'} WebUiTransport
 */

module.exports = {};
