'use strict';

/**
 * `mm restart` — restart the bot.
 *
 * @module modules/mm/commands/restart
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmParsedArgs} MmParsedArgs
 */

const { createContext } = require('../context');
const docker = require('../docker');
const pm2 = require('../pm2');
const { runOn } = require('./on');
const { getProcessStatus } = require('../process-status');
const statusCmd = require('./status');
const terminal = require('../terminal');

/**
 * Restarts a running bot, or starts it with a warning when stopped.
 *
 * @param {MmContext} ctx Runtime context
 * @returns {Promise<number>} Exit code from follow-up status output
 */
async function runRestart(ctx) {
  const status = await getProcessStatus(ctx);

  if (!status.running) {
    console.log(terminal.yellow('\nBot is not running. Starting it instead.'));
    return runOn(ctx);
  }

  console.log('');

  if (ctx.mode === 'docker') {
    await docker.compose(ctx, ['restart', ctx.composeService], { inherit: true });
    console.log(terminal.green('Docker service mm-app restarted.'));
  } else {
    await pm2.restartProcess(ctx.pm2ProcessName);
    console.log(terminal.green(`PM2 process ${ctx.pm2ProcessName} restarted.`));
  }

  pm2.disconnect();

  console.log('');

  return statusCmd.runStatus(ctx, { short: true });
}

/** @param {MmParsedArgs} args @returns {Promise<number>} */
async function restart(args) {
  const ctx = createContext({ mode: args.mode, workDir: args.workDir });
  return runRestart(ctx);
}

module.exports = { restart, runRestart };
