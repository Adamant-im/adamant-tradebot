'use strict';

/**
 * PM2 integration for npm/local mode.
 *
 * Users never invoke PM2 directly — `mm on`, `mm off`, and `mm status` call
 * these helpers. PM2 provides background execution, restart counts, and log paths.
 *
 * @module modules/mm/pm2
 * @typedef {import('types/bot/mm').Pm2Api} Pm2Api
 * @typedef {import('types/bot/mm').MmPm2ProcessDescription} MmPm2ProcessDescription
 * @typedef {import('types/bot/mm').MmProcessStatusSummary} MmProcessStatusSummary
 */

/** Process-wide PM2 daemon connection reused across CLI calls in one run. */
/** @type {Pm2Api | undefined} */
let pm2Instance;

/**
 * Connects to the PM2 daemon (or reuses an existing connection).
 *
 * @returns {Promise<Pm2Api>} Connected PM2 API instance
 */
async function connectPm2() {
  if (pm2Instance) {
    return pm2Instance;
  }

  const pm2 = require('pm2');
  await new Promise((resolve, reject) => {
    pm2.connect((error) => {
      if (error) {
        reject(error);
      } else {
        resolve(undefined);
      }
    });
  });

  pm2Instance = pm2;
  return pm2;
}

/**
 * Finds a PM2 process by its registered name.
 *
 * @param {string} name PM2 process name (e.g. `mm-app`)
 * @returns {Promise<MmPm2ProcessDescription | undefined>}
 */
async function getProcess(name) {
  const pm2 = await connectPm2();
  const list = await new Promise((resolve, reject) => {
    pm2.list((error, processes) => {
      if (error) {
        reject(error);
      } else {
        resolve(processes);
      }
    });
  });

  return list.find((proc) => proc.name === name);
}

/**
 * Starts the bot under PM2 with autorestart enabled.
 *
 * @param {string} name PM2 process name
 * @param {string} appPath Absolute path to app.js
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv }} options Working directory and extra env
 * @returns {Promise<void>}
 */
async function startProcess(name, appPath, options) {
  const pm2 = await connectPm2();

  await new Promise((resolve, reject) => {
    pm2.start({
      name,
      script: appPath,
      cwd: options.cwd,
      env: options.env,
      autorestart: true,
      max_restarts: 10,
    }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(undefined);
      }
    });
  });
}

/**
 * Gracefully stops a PM2 process by name.
 *
 * @param {string} name PM2 process name
 * @returns {Promise<void>}
 */
async function stopProcess(name) {
  const pm2 = await connectPm2();
  await new Promise((resolve, reject) => {
    pm2.stop(name, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(undefined);
      }
    });
  });
}

/**
 * Restarts a PM2 process by name.
 *
 * @param {string} name PM2 process name
 * @returns {Promise<void>}
 */
async function restartProcess(name) {
  const pm2 = await connectPm2();
  await new Promise((resolve, reject) => {
    pm2.restart(name, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve(undefined);
      }
    });
  });
}

/**
 * @param {string} name PM2 process name
 * @returns {Promise<boolean>} True when status is `online`
 */
async function isRunning(name) {
  const proc = await getProcess(name);
  return proc?.pm2_env?.status === 'online';
}

/**
 * Maps a PM2 process description to a stable status summary for `mm status`.
 *
 * @param {MmPm2ProcessDescription | undefined} proc PM2 process entry
 * @returns {MmProcessStatusSummary}
 */
function describeProcess(proc) {
  if (!proc || proc.pm2_env?.status !== 'online') {
    return {
      running: false,
      exitCode: proc?.pm2_env?.exit_code ?? undefined,
      lastError: proc?.pm2_env?.pm_uptime ? undefined : proc?.pm2_env?.status,
    };
  }

  const uptimeMs = proc.pm2_env.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : undefined;

  return {
    running: true,
    pid: proc.pid,
    pm2Id: proc.pm_id,
    uptimeMs,
    restarts: proc.pm2_env.restart_time,
    exitCode: proc.pm2_env.exit_code ?? undefined,
  };
}

/**
 * Reads the tail of PM2 stdout/stderr log files for a process.
 *
 * @param {string} name PM2 process name
 * @param {number} [lines] Maximum number of lines to return; omit to read full files
 * @returns {Promise<string>} Combined log tail
 */
async function getLogs(name, lines) {
  const pm2 = await connectPm2();
  const description = await new Promise((resolve, reject) => {
    pm2.describe(name, (error, desc) => {
      if (error) {
        reject(error);
      } else {
        resolve(desc);
      }
    });
  });

  if (!description.length) {
    throw new Error(`PM2 process ${name} not found`);
  }

  /** @type {string[]} */
  const collected = [];
  const fs = require('fs');

  for (const logPath of [
    description[0].pm2_env?.pm_out_log_path,
    description[0].pm2_env?.pm_err_log_path,
  ]) {
    if (logPath && fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      const fileLines = content.split('\n');
      collected.push(...(lines !== undefined ? fileLines.slice(-lines) : fileLines));
    }
  }

  return collected.join('\n');
}

/**
 * @param {string} name PM2 process name
 * @returns {Promise<number | undefined>} CPU usage percent from PM2 monit
 */
async function getCpu(name) {
  const proc = await getProcess(name);
  return proc?.monit?.cpu;
}

/**
 * @param {string} name PM2 process name
 * @returns {Promise<number | undefined>} RSS bytes from PM2 monit
 */
async function getMemory(name) {
  const proc = await getProcess(name);
  return proc?.monit?.memory;
}

/**
 * Closes the PM2 daemon connection. Call in `finally` blocks to avoid hanging CLI.
 */
function disconnect() {
  if (pm2Instance) {
    pm2Instance.disconnect();
    pm2Instance = undefined;
  }
}

module.exports = {
  connectPm2,
  describeProcess,
  disconnect,
  getCpu,
  getLogs,
  getMemory,
  getProcess,
  isRunning,
  restartProcess,
  startProcess,
  stopProcess,
};
