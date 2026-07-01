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
const { parseDbConfig, probeMongo, usesDockerMongoHost } = require('../mongo-probe');

const DOCKER_MONGO_SERVICE = 'mongo';
const MONGO_READY_TIMEOUT_MS = 30000;
const MONGO_READY_POLL_MS = 500;

/**
 * Starts Compose dependency services before preflight checks (e.g. mongo after `./mm off --all`).
 *
 * @param {MmContext} ctx Runtime context
 * @returns {Promise<void>}
 */
async function ensureDockerStackDependencies(ctx) {
  if (ctx.mode !== 'docker' || !docker.canUseHostCompose(ctx)) {
    return;
  }

  const userConfig = configUtil.loadUserConfig(ctx.configPath);
  if (!userConfig) {
    return;
  }

  const { url } = parseDbConfig(userConfig);
  if (!usesDockerMongoHost(url)) {
    return;
  }

  if (await docker.isServiceRunning(ctx, DOCKER_MONGO_SERVICE)) {
    return;
  }

  const result = await docker.compose(ctx, ['up', '-d', DOCKER_MONGO_SERVICE]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `Failed to start ${DOCKER_MONGO_SERVICE} service`);
  }

  const deadline = Date.now() + MONGO_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await probeMongo(ctx, userConfig);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, MONGO_READY_POLL_MS));
    }
  }

  throw new Error('MongoDB did not become ready in time');
}

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

  if (ctx.mode === 'docker') {
    try {
      await ensureDockerStackDependencies(ctx);
    } catch (error) {
      console.error(terminal.red(`Failed to prepare Docker stack: ${error instanceof Error ? error.message : error}`));

      console.log('');

      return 1;
    }
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

module.exports = { on, runOn, ensureDockerStackDependencies };
