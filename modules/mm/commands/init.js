'use strict';

/**
 * `mm init` — interactive first-time setup wizard.
 *
 * @module modules/mm/commands/init
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmParsedArgs} MmParsedArgs
 */

const { createNewPassphrase } = require('adamant-api');
const { createContext, ensureLayoutDirs } = require('../context');
const configUtil = require('../config-util');
const prompts = require('../prompts');
const terminal = require('../terminal');

/** Onboarding campaign end date — offer text is hidden after this instant. */
const CAMPAIGN_END = new Date('2026-09-01T00:00:00Z');

/**
 * Interactive wizard implementation for `mm init`.
 *
 * @param {MmContext} ctx Runtime context
 * @returns {Promise<number>} 0 on success
 */
async function runInit(ctx) {
  ensureLayoutDirs(ctx);

  const defaultConfig = configUtil.loadDefaultConfig(ctx.packageRoot);
  const exchanges = /** @type {string[]} */ (defaultConfig.exchanges || []);
  const choices = [...exchanges, 'other'];

  if (configUtil.loadUserConfig(ctx.configPath)) {
    console.log(terminal.yellow(`\nConfig file already exists: ${terminal.formatUserPath(ctx, ctx.configPath)}`));
    console.log('');
    console.log(`Running \`${terminal.mmCommand(ctx, 'init')}\` will overwrite your current configuration.`);
    console.log('');
    console.log('If you want to change existing parameters, use:');
    console.log('');
    console.log(`  ${terminal.highlightMmCommand(ctx, 'config')}`);
    console.log('');

    const proceed = await prompts.confirm('Continue and overwrite config?');
    if (!proceed) {
      return 0;
    }

    const backupPath = configUtil.backupConfig(ctx.configPath);
    console.log(terminal.dim(`Backup saved: ${terminal.formatUserPath(ctx, backupPath)}`));
  }

  console.log(`${terminal.formatTitle(ctx.version, '— first-time setup')}\n`);

  const exchangeChoice = await prompts.choose('Select exchange:', choices);
  if (exchangeChoice === 'other') {
    console.log('\nContact a manager at https://marketmaking.app/#contact to request a connector.');
    if (Date.now() < CAMPAIGN_END.getTime()) {
      console.log(
          'We may add a connector to your exchange for free or with a special discount as part of the onboarding campaign. ' +
          'Offer valid until September 1, 2026 — contact us.',
      );
    }
    return 0;
  }

  let pair = '';
  while (!configUtil.isValidPair(pair)) {
    pair = await prompts.ask('Trading pair (coin1/coin2): ');
    if (!configUtil.isValidPair(pair)) {
      console.log(terminal.red('Invalid pair format. Example: ETH/USDT'));
    }
  }
  pair = configUtil.normalizePair(pair);

  const apikey = await prompts.ask('API key (from your exchange account): ');
  const apisecret = await prompts.ask('API secret: ');
  console.log('API password / trade password (leave empty if your exchange does not use one):');
  const apipassword = await prompts.ask('API password: ');

  const passPhrase = createNewPassphrase();
  const address = configUtil.getAddressFromPassphrase(passPhrase);

  console.log(`\n${terminal.bold('Bot ADM address')}: ${terminal.cyan(address)}`);
  console.log('A new ADAMANT passphrase was generated and saved in the config file.');
  console.log('Top up this address with ~5 ADM (enough for a year or more) via https://adamant.im/#trade-adm');
  console.log('so the MM software can receive commands and reply.');
  console.log('Back up the passphrase from the config file in a safe place.\n');

  let adminAddress = '';
  while (!configUtil.isAdmAddress(adminAddress)) {
    adminAddress = await prompts.ask('Manager ADM address (create one at https://adm.im): ');
    if (!configUtil.isAdmAddress(adminAddress)) {
      console.log(terminal.red('Invalid ADAMANT address.'));
    }
  }

  /** @type {Record<string, unknown>} */
  const overrides = {
    exchange: exchangeChoice,
    pair,
    apikey,
    apisecret,
    apipassword,
    passPhrase,
    admin_accounts: [adminAddress],
    cli: false,
  };

  if (String(defaultConfig.perpetual || '') !== '') {
    overrides.perpetual = '';
  }

  if (ctx.mode === 'docker') {
    overrides['db.url'] = 'mongodb://mongo:27017/';
  }

  configUtil.saveConfigFromDefault(ctx.configPath, ctx.packageRoot, overrides);
  configUtil.ensureTradeParams({ exchange: exchangeChoice }, ctx.tradeSettingsDir, ctx.packageRoot);

  console.log(`\n${terminal.bold('Configuration summary')}:`);
  console.log(`  Exchange: ${exchangeChoice}`);
  console.log(`  Pair: ${pair}`);
  console.log(`  Bot ADM address: ${address}`);
  console.log(`  Manager ADM address: ${adminAddress}`);
  console.log(`\n${terminal.green('Config saved to')}: ${terminal.formatUserPath(ctx, ctx.configPath)}`);
  console.log('\nOther parameters, including monitoring notifications, can be changed with:');
  console.log(`  ${terminal.highlightMmCommand(ctx, 'config --edit')}`);
  console.log(`\n${terminal.bold('Next steps')}:`);
  console.log(`  ${terminal.highlightMmCommand(ctx, 'doctor   # validate configuration')}`);
  console.log(`  ${terminal.highlightMmCommand(ctx, 'on       # start the bot')}`);
  console.log(`  Send /balances to bot ADM address ${address}`);
  console.log('\n');

  return 0;
}

/**
 * CLI handler for `mm init`.
 *
 * @param {MmParsedArgs} args Parsed CLI arguments
 * @returns {Promise<number>} Process exit code
 */
async function init(args) {
  const ctx = createContext({ mode: args.mode, workDir: args.workDir });
  return runInit(ctx);
}

module.exports = { init, runInit };
