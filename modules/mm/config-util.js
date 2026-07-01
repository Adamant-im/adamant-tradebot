'use strict';

/**
 * Config read/write helpers for the `mm` CLI.
 *
 * Intentionally separate from `modules/configReader.js`: loading configReader
 * during CLI operations would start validation side-effects and can exit the
 * process before the wizard or doctor can run.
 *
 * @module modules/mm/config-util
 */

const fs = require('fs');
const path = require('path');
const jsonminify = require('jsonminify');
const { diff } = require('deep-object-diff');
const { createKeypairFromPassphrase, createAddressFromPublicKey, isAdmAddress } = require('adamant-api');

/** Config keys masked in status output and interactive prompts. */
const SECRET_KEYS = new Set([
  'passPhrase',
  'apikey',
  'apisecret',
  'apipassword',
  'apikey2',
  'apisecret2',
  'apipassword2',
  'perpetual_apikey',
  'perpetual_apisecret',
  'perpetual_apipassword',
  'manageTelegramBotToken',
  'private_webui_secret_key',
  'com_server_secret_key',
  'webui_api_secret',
]);

const CONFIG_FILE_MODE = 0o600;

/**
 * @param {string} filePath
 * @param {string} content
 */
function writePrivateConfigFile(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: CONFIG_FILE_MODE });
}

/**
 * @param {string} sourcePath
 * @param {string} destPath
 */
function copyPrivateConfigFile(sourcePath, destPath) {
  fs.copyFileSync(sourcePath, destPath);
  fs.chmodSync(destPath, CONFIG_FILE_MODE);
}

/**
 * Parses a JSONC file by stripping comments, then parsing as JSON.
 *
 * @param {string} filePath Path to a .jsonc file
 * @returns {Record<string, unknown>} Parsed config object
 */
function parseJsoncFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(jsonminify(raw));
}

/**
 * Loads the shipped default config template.
 *
 * @param {string} packageRoot Installed package root
 * @returns {Record<string, unknown>} Default config values
 */
function loadDefaultConfig(packageRoot) {
  return parseJsoncFile(path.join(packageRoot, 'config.default.jsonc'));
}

/**
 * Loads the user config, or null when the file does not exist yet.
 *
 * @param {string} configPath Absolute path to config.jsonc
 * @returns {Record<string, unknown> | null} User config or null
 */
function loadUserConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  return parseJsoncFile(configPath);
}

/**
 * Creates a timestamped backup before overwriting config.
 *
 * Backup name format: `config.backup-2026-06-29-1530.jsonc`
 *
 * @param {string} configPath Config file to back up
 * @returns {string} Absolute path to the created backup file
 */
function backupConfig(configPath) {
  const dir = path.dirname(configPath);
  const base = path.basename(configPath, path.extname(configPath));
  // ISO timestamp without seconds for readable, sortable backup names
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '-');
  const backupPath = path.join(dir, `${base}.backup-${stamp}.jsonc`);

  copyPrivateConfigFile(configPath, backupPath);
  return backupPath;
}

/**
 * Finds the end index of a JSON value starting at `start` (balanced `{}` / `[]`).
 *
 * @param {string} content
 * @param {number} start
 * @returns {number | undefined}
 */
function findJsonValueEnd(content, start) {
  const open = content[start];
  if (open === '"') {
    let i = start + 1;
    while (i < content.length) {
      if (content[i] === '\\') {
        i += 2;
        continue;
      }
      if (content[i] === '"') {
        return i + 1;
      }
      i++;
    }
    return undefined;
  }

  if (open === '{' || open === '[') {
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    for (let i = start; i < content.length; i++) {
      const ch = content[i];
      if (inString) {
        if (ch === '\\') {
          i++;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === open) {
        depth++;
      } else if (ch === close) {
        depth--;
        if (depth === 0) {
          return i + 1;
        }
      }
    }
    return undefined;
  }

  const scalarEnd = content.slice(start).search(/[,}\]\n]/);
  return scalarEnd === -1 ? content.length : start + scalarEnd;
}

/**
 * @param {string} content
 * @param {string} key
 * @param {unknown} value
 * @returns {string}
 */
function replaceJsoncTopLevelValue(content, key, value) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyMatch = new RegExp(`"${escapedKey}"\\s*:`).exec(content);
  if (!keyMatch) {
    return content;
  }

  const valueStart = keyMatch.index + keyMatch[0].length;
  let cursor = valueStart;
  while (cursor < content.length && /\s/.test(content[cursor])) {
    cursor++;
  }

  const valueEnd = findJsonValueEnd(content, cursor);
  if (valueEnd === undefined) {
    return content;
  }

  let suffixStart = valueEnd;
  while (suffixStart < content.length && /\s/.test(content[suffixStart])) {
    suffixStart++;
  }

  const trailingComma = content[suffixStart] === ',' ? ',' : '';
  const serialized = JSON.stringify(value);
  if (trailingComma) {
    return content.slice(0, cursor) + serialized + content.slice(suffixStart);
  }

  return content.slice(0, cursor) + serialized + content.slice(valueEnd);
}

/** JSONC scalar token (boolean, null, number, string) for regex-based key replacement. */
const JSONC_SCALAR = String.raw`(true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|"(?:\\.|[^"\\])*")`;

/**
 * Normalizes a trading pair to uppercase (`dmd/btc` → `DMD/BTC`).
 *
 * @param {string} pair Raw pair from user input
 * @returns {string} Uppercase pair
 */
function normalizePair(pair) {
  const parts = String(pair || '').trim().split('/');
  if (parts.length !== 2) {
    return String(pair || '').trim().toUpperCase();
  }

  return `${parts[0].trim().toUpperCase()}/${parts[1].trim().toUpperCase()}`;
}

/**
 * Replaces a top-level JSONC key value while preserving comments and formatting.
 *
 * @param {string} content JSONC file contents
 * @param {string} key Top-level config key
 * @param {unknown} value New JSON-serializable value
 * @returns {string} Updated file contents
 */
function replaceJsoncKey(content, key, value) {
  const serialized = JSON.stringify(value);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stringOrScalar = new RegExp(`("${escapedKey}"\\s*:\\s*)${JSONC_SCALAR}(\\s*,?)`);
  if (stringOrScalar.test(content)) {
    return content.replace(stringOrScalar, `$1${serialized}$3`);
  }

  const arrayValue = new RegExp(`("${escapedKey}"\\s*:\\s*)\\[[\\s\\S]*?\\](\\s*,?)`);
  if (Array.isArray(value) && arrayValue.test(content)) {
    return content.replace(arrayValue, `$1${serialized}$2`);
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return replaceJsoncTopLevelValue(content, key, value);
  }

  const objectValue = new RegExp(`("${escapedKey}"\\s*:\\s*)\\{[\\s\\S]*?\\}(\\s*,?)`);
  if (objectValue.test(content)) {
    return content.replace(objectValue, `$1${serialized}$2`);
  }

  return content;
}

/**
 * Replaces a nested JSONC key (one level, e.g. `db.url`) while preserving comments.
 *
 * @param {string} content JSONC file contents
 * @param {string} dotPath Parent.child key path
 * @param {unknown} value New JSON-serializable value
 * @returns {string} Updated file contents
 */
function replaceJsoncNestedKey(content, dotPath, value) {
  const dotIndex = dotPath.indexOf('.');
  if (dotIndex === -1) {
    return replaceJsoncKey(content, dotPath, value);
  }

  const parent = dotPath.slice(0, dotIndex);
  const child = dotPath.slice(dotIndex + 1);
  if (child.includes('.')) {
    return content;
  }

  const serialized = JSON.stringify(value);
  const escapedParent = parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedChild = child.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
      `("${escapedParent}"\\s*:\\s*\\{[\\s\\S]*?"${escapedChild}"\\s*:\\s*)${JSONC_SCALAR}`,
  );

  if (!re.test(content)) {
    return content;
  }

  return content.replace(re, `$1${serialized}`);
}

/**
 * Replaces passPhrase and appends the derived ADM address as an inline comment.
 *
 * @param {string} content JSONC file contents
 * @param {string} passPhrase New passphrase value
 * @param {string | undefined} address Bot ADM address
 * @returns {string} Updated file contents
 */
function replacePassPhraseWithAddressComment(content, passPhrase, address) {
  const serialized = JSON.stringify(passPhrase);
  const addrComment = address ? ` // ${address}` : '';
  const trailing = addrComment ? `,${addrComment}` : ',';
  const standardLine = /^(\s*"passPhrase"\s*:\s*)(true|false|null|"(?:\\.|[^"\\])*")(\s*,(?:\s*\/\/[^\n]*)?)\s*$/m;
  if (standardLine.test(content)) {
    return content.replace(standardLine, `$1${serialized}${trailing}`);
  }

  const legacyLine = /^(\s*"passPhrase"\s*:\s*)(true|false|null|"(?:\\.|[^"\\])*")\s*\/\/[^\n]*(\s*,)\s*$/m;
  return content.replace(legacyLine, `$1${serialized}${trailing}`);
}

/**
 * Creates user config from `config.default.jsonc`, preserving comments.
 *
 * @param {string} configPath Destination path
 * @param {string} packageRoot Installed package root
 * @param {Record<string, unknown>} overrides Top-level keys to patch
 */
function saveConfigFromDefault(configPath, packageRoot, overrides) {
  const defaultPath = path.join(packageRoot, 'config.default.jsonc');
  let content = fs.readFileSync(defaultPath, 'utf8');

  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'passPhrase') {
      continue;
    }
    content = key.includes('.') ?
      replaceJsoncNestedKey(content, key, value) :
      replaceJsoncKey(content, key, value);
  }

  if (overrides.passPhrase !== undefined) {
    const address = getAddressFromPassphrase(String(overrides.passPhrase));
    content = replacePassPhraseWithAddressComment(content, String(overrides.passPhrase), address);
  }

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  writePrivateConfigFile(configPath, content);
}

/**
 * Updates passPhrase in an existing JSONC file, preserving comments and address annotation.
 *
 * @param {string} configPath Config file path
 * @param {string} passPhrase New passphrase
 * @param {string | undefined} [address] Bot ADM address for inline comment
 */
function updatePassPhraseKey(configPath, passPhrase, address) {
  const resolvedAddress = address || getAddressFromPassphrase(passPhrase);
  const content = fs.readFileSync(configPath, 'utf8');
  writePrivateConfigFile(configPath, replacePassPhraseWithAddressComment(content, passPhrase, resolvedAddress));
}

/**
 * Updates one top-level config key in an existing JSONC file, preserving comments.
 *
 * @param {string} configPath Config file path
 * @param {string} key Top-level key (no dot notation)
 * @param {unknown} value New value
 */
function updateConfigKey(configPath, key, value) {
  const content = fs.readFileSync(configPath, 'utf8');
  writePrivateConfigFile(configPath, replaceJsoncKey(content, key, value));
}

/**
 * Writes config as pretty-printed JSON (comments are not preserved).
 *
 * Used only when no JSONC template exists yet.
 *
 * @param {string} configPath Destination path
 * @param {Record<string, unknown>} config Config object to serialize
 */
function saveConfig(configPath, config) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(config, null, 2) + '\n';
  writePrivateConfigFile(configPath, content);
}

/**
 * Masks a secret for terminal display: first/last 4 chars visible.
 *
 * @param {unknown} value Raw secret value
 * @returns {string} Masked string safe to print
 */
function maskSecret(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  const str = String(value);
  if (str.length <= 8) {
    return '*'.repeat(str.length);
  }

  return `${str.slice(0, 4)}${'*'.repeat(Math.max(4, str.length - 8))}${str.slice(-4)}`;
}

/**
 * Applies masking rules for a config key/value pair.
 *
 * @param {string} key Top-level config key
 * @param {unknown} value Config value
 * @returns {unknown} Masked value when the key is sensitive
 */
function maskConfigValue(key, value) {
  if (SECRET_KEYS.has(key)) {
    return maskSecret(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' && key === 'admin_accounts' ? maskSecret(item) : item));
  }

  return value;
}

/**
 * Returns config fields that differ from defaults, with secrets masked.
 *
 * Used by `mm status` and `mm config` summary output.
 *
 * @param {Record<string, unknown>} userConfig User config
 * @param {Record<string, unknown>} defaultConfig Default template
 * @returns {Record<string, unknown>} Diff object with masked secrets
 */
function getChangedConfig(userConfig, defaultConfig) {
  const changes = diff(defaultConfig, userConfig);
  /** @type {Record<string, unknown>} */
  const masked = {};

  for (const [key, value] of Object.entries(changes)) {
    masked[key] = maskConfigValue(key, value);
  }

  return masked;
}

/**
 * Reads a nested config value using dot notation (e.g. `db.url`).
 *
 * @param {Record<string, unknown> | unknown[] | unknown} obj Root object
 * @param {string} dotPath Dot-separated path
 * @returns {unknown} Value at path, or undefined
 */
function getNestedValue(obj, dotPath) {
  return dotPath.split('.').reduce((acc, part) => {
    if (acc && typeof acc === 'object' && part in acc) {
      return /** @type {Record<string, unknown>} */ (acc)[part];
    }
    return undefined;
  }, obj);
}

/**
 * Returns a shallow-cloned config with a nested value updated.
 *
 * @param {Record<string, unknown>} obj Root config object
 * @param {string} dotPath Dot-separated path
 * @param {unknown} value New value to assign
 * @returns {Record<string, unknown>} Updated config copy
 */
function setNestedValue(obj, dotPath, value) {
  const parts = dotPath.split('.');
  /** @type {Record<string, unknown>} */
  const root = { ...obj };
  let current = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = current[part];
    current[part] = typeof next === 'object' && next !== null && !Array.isArray(next) ? { ...next } : {};
    current = /** @type {Record<string, unknown>} */ (current[part]);
  }

  current[parts[parts.length - 1]] = value;
  return root;
}

/**
 * Validates a spot/perpetual pair string (`COIN1/COIN2`).
 *
 * @param {string} pair Pair from user input or config
 * @returns {boolean} True when format is valid
 */
function isValidPair(pair) {
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(String(pair || '').trim());
}

/**
 * Checks whether a trader connector module exists for the exchange.
 *
 * Uses lowercase exchange id to match `trade/trader_{exchange}.js` naming.
 * DEX connectors (e.g. DEX_UniswapV2 → trader_dex_uniswapv2.js) follow the
 * same rule after configReader lowercases the exchange name at runtime.
 *
 * @param {string} exchange Exchange display name from config (e.g. `Binance`)
 * @param {string} packageRoot Installed package root
 * @returns {boolean} True when trader module file exists
 */
function exchangeConnectorExists(exchange, packageRoot) {
  const lc = exchange.toLowerCase();
  const traderPath = path.join(packageRoot, 'trade', `trader_${lc}.js`);
  return fs.existsSync(traderPath);
}

/**
 * Lightweight passphrase check (12 or 24 words).
 *
 * Mirrors `configReader.isPassphrase` without importing configReader.
 *
 * @param {string} phrase Candidate mnemonic
 * @returns {boolean} True for 12- or 24-word passphrases
 */
function isPassphrase(phrase) {
  if (typeof phrase !== 'string') {
    return false;
  }

  const words = phrase.trim().toLowerCase().split(/\s+/);
  return words.length === 12 || words.length === 24;
}

/**
 * Derives the bot ADM address from a valid passphrase.
 *
 * @param {string} phrase ADAMANT mnemonic
 * @returns {string | undefined} U-prefixed address, or undefined on failure
 */
function getAddressFromPassphrase(phrase) {
  if (!isPassphrase(phrase)) {
    return undefined;
  }

  try {
    const keyPair = createKeypairFromPassphrase(phrase);
    return createAddressFromPublicKey(keyPair.publicKey);
  } catch {
    return undefined;
  }
}

/**
 * Copies `tradeParams_Default.js` to an exchange-specific file when missing.
 *
 * Called by `mm init` so the bot can start without manual file creation.
 *
 * @param {Record<string, unknown>} config User config (needs `exchange`)
 * @param {string} tradeSettingsDir Target directory for trade params
 * @param {string} packageRoot Package root (source of Default template)
 */
function ensureTradeParams(config, tradeSettingsDir, packageRoot) {
  const exchange = String(config.exchange || '');
  const fileName = `tradeParams_${exchange}.js`;
  const target = path.join(tradeSettingsDir, fileName);
  const defaultFile = path.join(packageRoot, 'trade', 'settings', 'tradeParams_Default.js');

  if (!fs.existsSync(tradeSettingsDir)) {
    fs.mkdirSync(tradeSettingsDir, { recursive: true });
  }

  if (!fs.existsSync(target)) {
    fs.copyFileSync(defaultFile, target);
  }
}

module.exports = {
  SECRET_KEYS,
  backupConfig,
  exchangeConnectorExists,
  getAddressFromPassphrase,
  getChangedConfig,
  getNestedValue,
  isAdmAddress,
  isPassphrase,
  isValidPair,
  loadDefaultConfig,
  loadUserConfig,
  maskConfigValue,
  maskSecret,
  normalizePair,
  parseJsoncFile,
  replaceJsoncKey,
  replaceJsoncNestedKey,
  replacePassPhraseWithAddressComment,
  saveConfig,
  saveConfigFromDefault,
  setNestedValue,
  updateConfigKey,
  updatePassPhraseKey,
  ensureTradeParams,
};
