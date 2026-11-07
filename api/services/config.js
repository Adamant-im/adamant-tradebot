'use strict';

/**
 * @module api/services/config
 * Sanitized `config.jsonc` snapshot for the WebUI (`GET /api/v1/config`).
 *
 * Only whitelisted keys are exposed; nested values are additionally scrubbed of
 * anything that looks like a credential, so a new secret-bearing sub-key added
 * to a whitelisted section cannot leak by accident.
 */

const config = require('../../modules/configReader');

/** Top-level config keys safe to show to WebUI operators */
const PUBLIC_CONFIG_KEYS = [
  'bot_id',
  'bot_name',
  'project_name',
  'exchange',
  'exchanges',
  'pair',
  'perpetual',
  'pair_hidden',
  'account',
  'account2',
  'dev',
  'cli',
  'socket',
  'ws_type',
  'infoservice',
  'notify_non_admins',
  'silent_mode',
  'log_level',
  'log_rotate',
  'private_webui',
  'private_webui_bind_host',
  'private_webui_allowed_ips',
  'public_webui',
  'api',
  'com_server',
  'amount_to_confirm_usd',
  'volumes_thresholds_usd',
  'exchange_socket',
  'exchange_socket_pull',
  'balance_watcher',
  'sniper_bot_watcher',
  'nice_chart',
  'fund_supplier',
  'exchange_restrictions',
  'version',
  'projectBranch',
];

/** Key-name fragments that must never leave the bot, even inside whitelisted sections */
const SENSITIVE_KEY_PATTERN =
  /passphrase|apikey|apisecret|apipassword|secret|password|token|privatekey|mnemonic|webhook/i;

/**
 * Recursively copies a config value, dropping keys that match the sensitive pattern.
 *
 * @param {unknown} value Config subtree
 * @returns {unknown}
 */
function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        continue;
      }
      result[key] = sanitizeValue(item);
    }
    return result;
  }

  return value;
}

/**
 * Builds the sanitized config snapshot.
 *
 * @returns {{ config: Record<string, unknown> }}
 */
function getPublicConfig() {
  /** @type {Record<string, unknown>} */
  const snapshot = {};

  for (const key of PUBLIC_CONFIG_KEYS) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }

    const value = /** @type {Record<string, unknown>} */ (config)[key];
    if (value !== undefined) {
      snapshot[key] = sanitizeValue(value);
    }
  }

  snapshot.secondAccountEnabled = Boolean(config.apikey2);

  return { config: snapshot };
}

module.exports = {
  getPublicConfig,
};
