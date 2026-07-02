'use strict';

/**
 * Post-start hints for `mm on` and `mm restart`.
 *
 * @module modules/mm/hints
 * @typedef {import('types/bot/mm').MmContext} MmContext
 */

const configUtil = require('./config-util');
const terminal = require('./terminal');

/**
 * @param {MmContext} ctx
 * @returns {{ botAddress: string, adminAddress?: string } | null}
 */
function getBotVerificationAddresses(ctx) {
  const userConfig = configUtil.loadUserConfig(ctx.configPath);
  if (!userConfig) {
    return null;
  }

  const botAddress = configUtil.getAddressFromPassphrase(String(userConfig.passPhrase || ''));
  if (!botAddress) {
    return null;
  }

  const admins = Array.isArray(userConfig.admin_accounts) ?
    userConfig.admin_accounts.filter((item) => configUtil.isAdmAddress(String(item))) :
    [];

  return {
    botAddress,
    adminAddress: admins[0] ? String(admins[0]) : undefined,
  };
}

/**
 * Prints a hint to verify the bot via ADAMANT Messenger and open the quick start guide.
 *
 * @param {MmContext} ctx Runtime context
 */
function printBotVerificationHint(ctx) {
  const addresses = getBotVerificationAddresses(ctx);
  if (!addresses) {
    return;
  }

  const { botAddress, adminAddress } = addresses;
  const adminPart = adminAddress ?
    `from your admin account ${terminal.cyan(adminAddress)}` :
    'from your admin account';

  console.log('');
  console.log(
      `Send ${terminal.cyan('/balances')} to the bot ADM address ${terminal.cyan(botAddress)} ` +
      `in ADAMANT (${terminal.cyan('https://adm.im')}) ${adminPart} ` +
      'to verify the setup.',
  );
  console.log(`Quick start guide: ${terminal.cyan('https://marketmaking.app/cex-mm/quick-start')}`);
}

module.exports = { getBotVerificationAddresses, printBotVerificationHint };
