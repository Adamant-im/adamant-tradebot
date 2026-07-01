'use strict';

/**
 * Shell command helpers for the `mm` CLI.
 *
 * Wraps child_process to run Docker Compose, read tool versions, and probe PATH.
 *
 * @module modules/mm/shell
 * @typedef {import('types/bot/mm').MmShellResult} MmShellResult
 */

const { spawn, spawnSync, execSync } = require('child_process');

/**
 * Checks whether an executable is available on PATH.
 *
 * @param {string} command Command name (e.g. `docker`, `npm`)
 * @returns {boolean} True when `command -v` succeeds
 */
function commandExists(command) {
  if (spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0) {
    return true;
  }

  if (process.platform === 'win32') {
    return spawnSync('where', [command], { stdio: 'ignore' }).status === 0;
  }

  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0;
}

/**
 * Detects the Docker Compose CLI available on the host.
 *
 * Prefers Compose V2 plugin (`docker compose`) over standalone `docker-compose`.
 *
 * @returns {string | undefined} Shell command prefix, or undefined when missing
 */
function getDockerComposeCommand() {
  if (commandExists('docker')) {
    const composeV2 = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    if (composeV2.status === 0) {
      return 'docker compose';
    }
  }

  if (commandExists('docker-compose')) {
    return 'docker-compose';
  }

  return undefined;
}

/**
 * Spawns a command asynchronously and collects stdout/stderr.
 *
 * @param {string} cmd Executable
 * @param {string[]} [args] Arguments
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, inherit?: boolean }} [options]
 * @returns {Promise<MmShellResult>}
 */
function run(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });

    /** @type {string[]} */
    const stdoutChunks = [];
    /** @type {string[]} */
    const stderrChunks = [];

    if (!options.inherit) {
      child.stdout?.on('data', (chunk) => stdoutChunks.push(String(chunk)));
      child.stderr?.on('data', (chunk) => stderrChunks.push(String(chunk)));
    }

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
      });
    });
  });
}

/**
 * Synchronous variant of {@link run} for short-lived probes.
 *
 * @param {string} cmd Executable
 * @param {string[]} [args] Arguments
 * @param {{ cwd?: string }} [options]
 * @returns {MmShellResult}
 */
function runSync(cmd, args = [], options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    encoding: 'utf8',
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

/**
 * Returns the first line of `<command> --version`, or empty string on failure.
 *
 * @param {string} command Command name
 * @returns {string} Version string for status output
 */
function getCommandVersion(command) {
  try {
    return execSync(`${command} --version`, { encoding: 'utf8' }).trim().split('\n')[0];
  } catch {
    return '';
  }
}

module.exports = {
  commandExists,
  getCommandVersion,
  getDockerComposeCommand,
  run,
  runSync,
};
