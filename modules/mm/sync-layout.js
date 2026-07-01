'use strict';

/**
 * Syncs user data from Docker-style volume dirs into legacy package paths.
 *
 * Used by `mm on` in npm mode. In Docker, `docker-entrypoint.sh` does the same
 * before app.js starts, so the bot can keep using config.jsonc and trade/settings/.
 *
 * @module modules/mm/sync-layout
 * @typedef {import('types/bot/mm').MmContext} MmContext
 */

const fs = require('fs');
const path = require('path');

/**
 * Links `trade-config/tradeParams_*.js` into `{packageRoot}/trade/settings/`.
 *
 * Symlinks (not copies) so `utils.saveConfig()` / WebUI writes and `fs.watch`
 * use the same file as the mounted user volume.
 *
 * Falls back to copy on platforms where symlinks are unavailable.
 *
 * @param {MmContext} ctx Runtime context
 */
function syncTradeConfigToPackage(ctx) {
  const tradeConfigDir = ctx.tradeSettingsDir;
  if (!fs.existsSync(tradeConfigDir)) {
    return;
  }

  const targetDir = path.join(ctx.packageRoot, 'trade', 'settings');
  for (const fileName of fs.readdirSync(tradeConfigDir)) {
    if (!fileName.startsWith('tradeParams_') || !fileName.endsWith('.js')) {
      continue;
    }

    const source = path.join(tradeConfigDir, fileName);
    const target = path.join(targetDir, fileName);

    if (path.resolve(source) === path.resolve(target)) {
      continue;
    }

    try {
      fs.symlinkSync(source, target, 'file');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        fs.unlinkSync(target);
        fs.symlinkSync(source, target, 'file');
      } else {
        fs.copyFileSync(source, target);
      }
    }
  }
}

module.exports = {
  syncTradeConfigToPackage,
};
