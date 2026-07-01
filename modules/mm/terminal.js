'use strict';

/**
 * ANSI terminal styling for the `mm` CLI.
 *
 * @module modules/mm/terminal
 * @typedef {import('types/bot/mm').MmCheckStatus} MmCheckStatus
 * @typedef {import('types/bot/mm').MmContext} MmContext
 */

const path = require('path');

/** @type {boolean | undefined} */
let disabledOverride;

/**
 * @param {boolean} enabled When false, all formatters return plain text
 */
function setColorEnabled(enabled) {
  disabledOverride = !enabled;
}

/**
 * @param {NodeJS.WriteStream} [stream]
 * @returns {boolean}
 */
function colorEnabled(stream = process.stdout) {
  if (disabledOverride === true) {
    return false;
  }

  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') {
    return false;
  }

  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') {
    return true;
  }

  return Boolean(stream.isTTY);
}

/**
 * @param {string} open
 * @param {string} close
 * @param {string} text
 * @returns {string}
 */
function paint(open, close, text) {
  if (!colorEnabled()) {
    return text;
  }

  return `${open}${text}${close}`;
}

const RESET = '\u001b[0m';
const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const CYAN = '\u001b[36m';

/** @param {string} text @returns {string} */
function bold(text) {
  return paint(BOLD, RESET, text);
}

/** @param {string} text @returns {string} */
function dim(text) {
  return paint(DIM, RESET, text);
}

/** @param {string} text @returns {string} */
function red(text) {
  return paint(RED, RESET, text);
}

/** @param {string} text @returns {string} */
function green(text) {
  return paint(GREEN, RESET, text);
}

/** @param {string} text @returns {string} */
function yellow(text) {
  return paint(YELLOW, RESET, text);
}

/** @param {string} text @returns {string} */
function cyan(text) {
  return paint(CYAN, RESET, text);
}

/**
 * @param {MmCheckStatus | string} status
 * @returns {string}
 */
function formatStatus(status) {
  switch (status) {
    case 'OK':
      return green(status);
    case 'WARNING':
      return yellow(status);
    case 'FAILED':
      return red(status);
    case 'SKIPPED':
      return dim(status);
    default:
      return String(status);
  }
}

/**
 * @param {'OK' | 'WARNING' | 'FAILED' | string} health
 * @returns {string}
 */
function formatHealth(health) {
  switch (health) {
    case 'OK':
      return green(health);
    case 'WARNING':
      return yellow(health);
    case 'FAILED':
      return red(health);
    default:
      return String(health);
  }
}

/**
 * @param {boolean} running
 * @returns {string}
 */
function formatRunning(running) {
  return running ? green('running') : dim('stopped');
}

/**
 * True when output is shown to a host user running `./mm` (Docker install).
 *
 * @param {MmContext} ctx
 * @returns {boolean}
 */
function isHostDockerCli(ctx) {
  return process.env.MM_HOST_CLI === '1';
}

/**
 * User-facing command prefix: `./mm` for Docker installs, `mm` for npm/global.
 *
 * @param {MmContext} ctx
 * @param {string} subcommand
 * @returns {string}
 */
function mmCommand(ctx, subcommand) {
  const prefix = isHostDockerCli(ctx) ? './mm' : 'mm';
  return `${prefix} ${subcommand}`;
}

/**
 * Highlights CLI command names inside a line (e.g. `mm doctor`, `./mm on`).
 *
 * @param {string} text
 * @returns {string}
 */
function highlightCommands(text) {
  if (!colorEnabled()) {
    return text;
  }

  return text.replace(/(?:\.\/)?mm(?:\s+[a-z-]+(?:\s+[^\s#]+)*)?/g, (match) => cyan(match));
}

/**
 * @param {import('types/bot/mm').MmContext} ctx
 * @param {string} subcommand
 * @returns {string}
 */
function highlightMmCommand(ctx, subcommand) {
  return highlightCommands(mmCommand(ctx, subcommand));
}

/**
 * Host-facing path: `/app/config/...` in a container → `docker/config/...`.
 *
 * @param {MmContext} ctx
 * @param {string} absolutePath
 * @returns {string}
 */
function formatUserPath(ctx, absolutePath) {
  const fsPath = String(absolutePath);
  if (isHostDockerCli(ctx) && (fsPath === '/app' || fsPath.startsWith('/app/'))) {
    return fsPath.replace(/^\/app/, 'docker');
  }
  if (fsPath.startsWith(ctx.workDir + path.sep)) {
    return path.relative(ctx.workDir, fsPath);
  }
  return fsPath;
}

/**
 * Docker UX: `./mm` commands and `docker/` paths instead of container internals.
 *
 * @param {MmContext} ctx
 * @param {string} text
 * @returns {string}
 */
function formatUserFacing(ctx, text) {
  let result = String(text);
  if (isHostDockerCli(ctx)) {
    result = result.replace(/(?<!\.\/)\bmm\b/g, './mm');
    result = result.replace(/\/app\//g, 'docker/');
  }
  return result;
}

/**
 * @param {MmContext} ctx
 * @param {string} text
 * @returns {string}
 */
function highlightUserFacing(ctx, text) {
  return highlightCommands(formatUserFacing(ctx, text));
}

/**
 * @param {string} version Package version
 * @param {string} suffix Title suffix, e.g. `Doctor` or `Status`
 * @returns {string}
 */
function formatTitle(version, suffix) {
  return bold(`\nADAMANT Market-Making Software v${version} ${suffix}`);
}

module.exports = {
  setColorEnabled,
  colorEnabled,
  bold,
  dim,
  red,
  green,
  yellow,
  cyan,
  formatStatus,
  formatHealth,
  formatRunning,
  formatUserFacing,
  formatUserPath,
  highlightCommands,
  highlightMmCommand,
  highlightUserFacing,
  isHostDockerCli,
  mmCommand,
  formatTitle,
};
