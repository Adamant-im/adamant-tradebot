'use strict';

/**
 * Locates named bot configs (`config.<name>.jsonc`).
 *
 * Named configs live in `config/`. The project root stays as a fallback, so setups that keep
 * their configs there continue to work.
 *
 * Separate from `modules/configReader.js`, which reads and validates a config as soon as it is
 * imported. Jest setup and test scripts need these lookups before any config is selected.
 *
 * @module modules/configPaths
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const NAMED_CONFIG_DIR = 'config';
const NAMED_CONFIG_FILE_REGEX = /^config\.(.+)\.jsonc$/i;

/**
 * Returns the directories searched for named configs.
 *
 * @param {string} rootDir Project root
 * @returns {string[]} Absolute directory paths, highest priority first
 */
function getNamedConfigDirs(rootDir) {
  return [path.join(rootDir, NAMED_CONFIG_DIR), rootDir];
}

/**
 * Finds a named config, preferring `config/` over the project root.
 *
 * @param {string} name Config suffix, e.g. `bifinance_zeyo` for `config.bifinance_zeyo.jsonc`
 * @param {string} [rootDir] Project root
 * @returns {string | undefined} Absolute path to the config, `undefined` when it does not exist
 */
function findNamedConfigPath(name, rootDir = PROJECT_ROOT) {
  return getNamedConfigDirs(rootDir)
      .map((dir) => path.join(dir, `config.${name}.jsonc`))
      .find((filePath) => fs.existsSync(filePath));
}

/**
 * Lists named configs from `config/` and the project root.
 *
 * @param {string} [rootDir] Project root
 * @returns {string[]} Unique config suffixes, sorted
 */
function listNamedConfigs(rootDir = PROJECT_ROOT) {
  const names = getNamedConfigDirs(rootDir)
      .filter((dir) => fs.existsSync(dir))
      .flatMap((dir) => fs.readdirSync(dir))
      .map((fileName) => fileName.match(NAMED_CONFIG_FILE_REGEX)?.[1])
      .filter(Boolean);

  return [...new Set(names)].sort();
}

module.exports = {
  findNamedConfigPath,
  listNamedConfigs,
};
