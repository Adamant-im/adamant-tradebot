'use strict';

/**
 * `mm off` — stop the bot gracefully.
 *
 * @module modules/mm/commands/off
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmParsedArgs} MmParsedArgs
 */

const { createContext } = require('../context');
const docker = require('../docker');
const pm2 = require('../pm2');
const { getProcessStatus } = require('../process-status');
const terminal = require('../terminal');

/**
 * Stops the bot without deleting config, DB, or logs.
 *
 * @param {MmContext} ctx Runtime context
 * @param {{ all?: boolean }} [options] `--all` stops every compose service
 * @returns {Promise<number>} Always 0 unless an underlying command throws
 */
async function runOff(ctx, options = {}) {
  const status = await getProcessStatus(ctx);

  if (!status.running) {
    console.log(terminal.dim('Bot is not running.'));
    return 0;
  }

  if (ctx.mode === 'docker') {
    if (options.all) {
      await docker.compose(ctx, ['stop'], { inherit: true });
      console.log(terminal.green('All Docker Compose services stopped.'));
    } else {
      await docker.stopService(ctx, ctx.composeService, { inherit: true });
      console.log(terminal.green('mm-app service stopped.'));
    }
  } else {
    await pm2.stopProcess(ctx.pm2ProcessName);
    console.log(terminal.green(`PM2 process ${ctx.pm2ProcessName} stopped.`));
  }

  pm2.disconnect();

  console.log('');

  return 0;
}

/**
 * CLI handler for `mm off`.
 *
 * @param {MmParsedArgs} args Parsed CLI arguments
 * @returns {Promise<number>} Process exit code
 */
async function off(args) {
  const ctx = createContext({ mode: args.mode, workDir: args.workDir });
  return runOff(ctx, { all: args.all });
}

module.exports = { off, runOff };
