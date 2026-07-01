'use strict';

/**
 * `mm status` — installation, config, process, and health summary.
 *
 * @module modules/mm/commands/status
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmParsedArgs} MmParsedArgs
 */

const { createContext } = require('../context');
const { probeMongo } = require('../mongo-probe');
const configUtil = require('../config-util');
const shell = require('../shell');
const { runDoctor } = require('./doctor');
const { getProcessStatus, getResourceSummary } = require('../process-status');
const terminal = require('../terminal');
const { doctorCodeToHealth, printConfigSection } = require('../health-summary');
const { printBotVerificationHint } = require('../hints');

/**
 * Prints installation, process, config diff, and health summary.
 *
 * @param {MmContext} ctx Runtime context
 * @param {{ json?: boolean, short?: boolean }} [options] Output format flags
 * @returns {Promise<number>} Always 0 unless an internal check throws
 */
async function runStatus(ctx, options = {}) {
  const defaultConfig = configUtil.loadDefaultConfig(ctx.packageRoot);
  const userConfig = configUtil.loadUserConfig(ctx.configPath);
  const processStatus = await getProcessStatus(ctx);
  const resources = await getResourceSummary(ctx);

  let dbSize;
  if (userConfig?.db) {
    try {
      const dbProbe = await probeMongo(ctx, userConfig);
      dbSize = dbProbe.displaySize;
    } catch {
      dbSize = 'unavailable';
    }
  }

  const report = /** @type {{ code: number, sections: Record<string, import('types/bot/mm').MmDoctorSection> }} */ (
    await runDoctor(ctx, { silent: true, report: true })
  );
  const doctorCode = report.code;
  const health = doctorCodeToHealth(doctorCode);

  const dockerVersion = ctx.mode === 'docker' && ctx.composeFile ?
    'Docker Compose' :
    shell.commandExists('docker') ? shell.getCommandVersion('docker') : '';

  const payload = {
    version: ctx.version,
    installMethod: ctx.installMethod,
    mode: ctx.mode,
    nodeVersion: process.version,
    npmVersion: shell.getCommandVersion('npm'),
    dockerVersion,
    workDir: ctx.workDir,
    mmExecutable: ctx.mmExecutable,
    paths: {
      config: ctx.configPath,
      tradeSettings: ctx.tradeSettingsDir,
      logs: ctx.logsDir,
      composeFile: ctx.composeFile,
    },
    process: processStatus,
    resources: {
      ...resources,
      database: dbSize,
    },
    config: userConfig ? configUtil.getChangedConfig(userConfig, defaultConfig) : null,
    health,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  if (options.short) {
    console.log(`Health: ${terminal.formatHealth(health)}${health !== 'OK' ? terminal.dim(` — run ${terminal.mmCommand(ctx, 'doctor')}`) : ''}`);
    printConfigSection(report.sections.Config);
    console.log(`Software: ${terminal.formatRunning(processStatus.running)}`);
    if (processStatus.running) {
      console.log(`Logs: ${resources.logsSize}`);
      if (dbSize) {
        console.log(`Database: ${dbSize}`);
      }
      if (resources.cpu !== undefined) {
        console.log(`CPU: ${resources.cpu}%`);
      }
      if (resources.memory) {
        console.log(`Memory: ${resources.memory}`);
      }
      printBotVerificationHint(ctx);
    }

    console.log('');

    return 0;
  }

  console.log(`${terminal.formatTitle(ctx.version, 'Status')}\n`);
  console.log(terminal.bold('Installation'));
  console.log(`  Version: ${ctx.version}`);
  console.log(`  Install method: ${ctx.installMethod}`);
  console.log(`  Mode: ${ctx.mode}`);
  console.log(`  Node.js: ${process.version}`);
  if (payload.npmVersion) {
    console.log(`  npm: ${payload.npmVersion}`);
  }
  if (payload.dockerVersion) {
    console.log(`  Docker: ${payload.dockerVersion}`);
  }
  console.log(`  Working directory: ${terminal.formatUserPath(ctx, ctx.workDir)}`);
  console.log(`  mm executable: ${terminal.isHostDockerCli(ctx) ? './mm' : ctx.mmExecutable}`);

  console.log(`\n${terminal.bold('Paths')}`);
  console.log(`  Config: ${terminal.formatUserPath(ctx, ctx.configPath)}`);
  console.log(`  Trade settings: ${terminal.formatUserPath(ctx, ctx.tradeSettingsDir)}`);
  console.log(`  Logs: ${terminal.formatUserPath(ctx, ctx.logsDir)}`);
  if (ctx.composeFile) {
    console.log(`  Docker Compose: ${terminal.formatUserPath(ctx, ctx.composeFile)}`);
  }

  console.log(`\n${terminal.bold('Process')}`);
  console.log(`  Running: ${processStatus.running ? terminal.green('yes') : terminal.dim('no')}`);
  if (processStatus.pid) {
    console.log(`  PID: ${processStatus.pid}`);
  }
  if (processStatus.containerId) {
    console.log(`  Container: ${processStatus.containerId.slice(0, 12)}`);
  }
  if (processStatus.uptimeMs) {
    console.log(`  Uptime: ${Math.round(processStatus.uptimeMs / 1000)}s`);
  }
  if (processStatus.restarts !== undefined) {
    console.log(`  Restarts: ${processStatus.restarts}`);
  }

  if (userConfig) {
    console.log(`\n${terminal.bold('Config changes from defaults')}`);
    const changed = configUtil.getChangedConfig(userConfig, defaultConfig);
    for (const [key, value] of Object.entries(changed)) {
      console.log(`  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
  }

  console.log(`\n${terminal.bold('Health summary:')}\n`);
  console.log(`Health: ${terminal.formatHealth(health)}${health !== 'OK' ? terminal.dim(` — run ${terminal.mmCommand(ctx, 'doctor')}`) : ''}`);
  console.log(`Software: ${terminal.formatRunning(processStatus.running)}`);
  if (processStatus.running) {
    console.log(`Logs: ${resources.logsSize}`);
    if (dbSize) {
      console.log(`Database: ${dbSize}`);
    }
    if (resources.cpu !== undefined) {
      console.log(`CPU: ${resources.cpu}%`);
    }
    if (resources.memory) {
      console.log(`Memory: ${resources.memory}`);
    }
    printBotVerificationHint(ctx);
  }

  console.log('');

  return 0;
}

/** @param {MmParsedArgs} args @returns {Promise<number>} */
async function status(args) {
  const ctx = createContext({ mode: args.mode, workDir: args.workDir });
  return runStatus(ctx, { json: args.json, short: args.short });
}

module.exports = { status, runStatus };
