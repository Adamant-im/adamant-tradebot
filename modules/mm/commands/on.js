'use strict';

/**
 * `mm on` — start the bot in the background.
 *
 * @module modules/mm/commands/on
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmParsedArgs} MmParsedArgs
 */

const { createContext, ensureLayoutDirs, getAppEntry } = require('../context');
const { syncTradeConfigToPackage } = require('../sync-layout');
const configUtil = require('../config-util');
const docker = require('../docker');
const pm2 = require('../pm2');
const { runDoctor } = require('./doctor');
const { getProcessStatus, getResourceSummary } = require('../process-status');
const logsCmd = require('./logs');
const terminal = require('../terminal');
const { printBotVerificationHint } = require('../hints');
const { doctorCodeToHealth, printConfigSection } = require('../health-summary');

/**
 * Starts the bot after preflight checks; no-op when already running.
 *
 * @param {MmContext} ctx Runtime context
 * @returns {Promise<number>} 0 on success, 1 on failure
 */
async function runOn(ctx) {
  ensureLayoutDirs(ctx);

  const status = await getProcessStatus(ctx);
  if (status.running) {
    console.log(terminal.yellow('\nBot is already running.\n'));

    const resources = await getResourceSummary(ctx);
    const report = /** @type {{ code: number, sections: Record<string, import('types/bot/mm').MmDoctorSection> }} */ (
      await runDoctor(ctx, { silent: true, report: true })
    );
    const health = doctorCodeToHealth(report.code);

    console.log(`Health: ${terminal.formatHealth(health)}${health !== 'OK' ? terminal.dim(` — run ${terminal.mmCommand(ctx, 'doctor')}`) : ''}`);
    printConfigSection(report.sections.Config);
    console.log(`Software: ${terminal.formatRunning(true)}`);
    console.log(`Logs: ${resources.logsSize}`);
    if (resources.cpu !== undefined) {
      console.log(`CPU: ${resources.cpu}%`);
    }
    if (resources.memory) {
      console.log(`Memory: ${resources.memory}`);
    }

    printBotVerificationHint(ctx);

    console.log('');

    return 0;
  }

  if (!configUtil.loadUserConfig(ctx.configPath)) {
    console.error(terminal.red(`Config not found: ${terminal.formatUserPath(ctx, ctx.configPath)}`));
    console.error(`Run: ${terminal.highlightMmCommand(ctx, 'init')}`);

    console.log('');

    return 1;
  }

  const doctorCode = await runDoctor(ctx, { preflight: true });
  if (doctorCode === 1) {
    console.error(terminal.red(`\nPreflight check failed. Fix issues with ${terminal.mmCommand(ctx, 'doctor')} before starting.`));

    console.log('');

    return 1;
  }

  try {
    if (ctx.mode === 'docker') {
      const result = await docker.compose(ctx, ['up', '-d'], { inherit: true });
      if (result.code !== 0) {
        throw new Error(result.stderr || 'docker compose up failed');
      }
      console.log(terminal.green('Docker Compose stack started.'));
    } else {
      syncTradeConfigToPackage(ctx);
      await pm2.startProcess(ctx.pm2ProcessName, getAppEntry(ctx), {
        cwd: ctx.workDir,
        env: {
          MM_CONFIG_PATH: ctx.configPath,
        },
      });

      console.log('');

      console.log(terminal.green(`Bot started under PM2 as ${ctx.pm2ProcessName}.`));
    }

    printBotVerificationHint(ctx);
  } catch (error) {
    console.error(terminal.red(`Failed to start bot: ${error instanceof Error ? error.message : error}`));
    console.error(terminal.bold('\nLast log lines:'));
    await logsCmd.runLogs(ctx, { tail: 20 }).catch(() => undefined);
    console.error(`\nRun ${terminal.highlightMmCommand(ctx, 'doctor')} for details.`);
    return 1;
  } finally {
    pm2.disconnect();
  }

  console.log('');

  return 0;
}

/**
 * CLI handler for `mm on`.
 *
 * @param {MmParsedArgs} args Parsed CLI arguments
 * @returns {Promise<number>} Process exit code
 */
async function on(args) {
  const ctx = createContext({ mode: args.mode, workDir: args.workDir });
  return runOn(ctx);
}

module.exports = { on, runOn };
