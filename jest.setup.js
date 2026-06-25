'use strict';

const fs = require('fs');
const path = require('path');

const configRootDir = path.join(__dirname);

/**
 * Resolves an existing config suffix so eager configReader imports do not exit.
 *
 * configReader picks the config name via
 * `process.argv.find(arg => !arg.includes('/') && arg !== 'clear_db')`.
 * Under Jest, argv also contains runner flags (`--runInBand`, `--no-cache`, …)
 * which are mistaken for config names and trigger `process.exit(-1)` in workers.
 *
 * @returns {string} Config name without the `config.` prefix or `.jsonc` suffix
 */
function resolveSafeConfigName() {
  const override = process.env.JEST_CONFIG_NAME?.trim();
  if (override && fs.existsSync(path.join(configRootDir, `config.${override}.jsonc`))) {
    return override;
  }

  const names = fs.readdirSync(configRootDir)
      .map((fileName) => fileName.match(/^config\.(.+)\.jsonc$/i)?.[1])
      .filter(Boolean)
      .sort();

  const preferredOrder = ['test', 'default', 'dev'];
  for (const name of preferredOrder) {
    if (names.includes(name)) {
      return name;
    }
  }

  const custom = names.find((name) => !name.startsWith('-'));
  if (custom) {
    return custom;
  }

  return names[0];
}

process.argv = [process.argv[0], process.argv[1], resolveSafeConfigName()];
