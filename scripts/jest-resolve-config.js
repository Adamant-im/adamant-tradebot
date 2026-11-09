'use strict';

/**
 * Picks a `config.<name>.jsonc` suffix for Jest.
 *
 * Named configs are looked up in `config/` first, then in the project root.
 *
 * Preference:
 * 1. `JEST_CONFIG_NAME` (or an explicit `override`) when that file exists
 * 2. First named config whose `exchange` has `trade/trader/trader_<exchange>.js`
 * 3. `config.default.jsonc` if its exchange connector exists
 *
 * Never auto-selects the obsolete `config.test.jsonc` / `config.dev.jsonc`.
 *
 * @module scripts/jest-resolve-config
 */

const fs = require('fs');
const path = require('path');
const jsonminify = require('jsonminify');
const { findNamedConfigPath, listNamedConfigs } = require('../modules/configPaths');

const REPO_ROOT = path.join(__dirname, '..');
const SKIP_AUTO_NAMES = new Set(['test', 'dev']);

/**
 * @param {string} [rootDir]
 * @returns {string[]} Config suffixes, sorted
 */
function listConfigNames(rootDir = REPO_ROOT) {
  return listNamedConfigs(rootDir).filter((name) => !name.startsWith('-'));
}

/**
 * @param {string} exchange Config `exchange` field
 * @returns {string} Filename slug, e.g. `BiFinance` → `bifinance`
 */
function exchangeSlug(exchange) {
  return String(exchange || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * @param {string} rootDir
 * @param {string} name Config suffix
 * @returns {string | undefined} Exchange field
 */
function readExchange(rootDir, name) {
  const filePath = findNamedConfigPath(name, rootDir);
  const parsed = JSON.parse(jsonminify(fs.readFileSync(filePath, 'utf8')));
  return parsed.exchange;
}

/**
 * @param {string} rootDir
 * @param {string} [exchange]
 * @returns {boolean}
 */
function hasTraderModule(rootDir, exchange) {
  const slug = exchangeSlug(exchange);
  return Boolean(slug) && fs.existsSync(path.join(rootDir, 'trade', 'trader', `trader_${slug}.js`));
}

/**
 * @param {string} rootDir
 * @param {string} name
 * @returns {boolean}
 */
function isLiveConfig(rootDir, name) {
  if (SKIP_AUTO_NAMES.has(name)) {
    return false;
  }

  try {
    return hasTraderModule(rootDir, readExchange(rootDir, name));
  } catch {
    return false;
  }
}

/**
 * @param {{ rootDir?: string, override?: string }} [options]
 * @returns {string} Config suffix for `process.argv`
 */
function resolveJestConfigName(options = {}) {
  const rootDir = options.rootDir || REPO_ROOT;
  const override = (options.override || process.env.JEST_CONFIG_NAME || '').trim();

  if (override) {
    if (!findNamedConfigPath(override, rootDir)) {
      throw new Error(
          `JEST_CONFIG_NAME=${override} but config.${override}.jsonc was not found in config/ or the project root. ` +
          `Example: JEST_CONFIG_NAME=bifinance_zeyo`,
      );
    }
    return override;
  }

  const names = listConfigNames(rootDir);
  const liveNamed = names.filter((name) => name !== 'default' && isLiveConfig(rootDir, name));
  if (liveNamed.length) {
    return liveNamed[0];
  }

  if (names.includes('default') && isLiveConfig(rootDir, 'default')) {
    return 'default';
  }

  throw new Error(
      'No Jest config found. Set JEST_CONFIG_NAME=<name> (e.g. bifinance_zeyo) ' +
      'to a config.<name>.jsonc whose exchange still has trade/trader/trader_<exchange>.js.',
  );
}

module.exports = {
  exchangeSlug,
  listConfigNames,
  resolveJestConfigName,
};
