'use strict';

/**
 * Lightweight logging with verbosity control.
 * Writes logs into `./logs/<date>.log` and maintains a heartbeat file to detect downtime.
 *
 * @module helpers/log
 */

/**
 * Logging verbosity (least to most verbose):
 * `none` < `error` < `warn` < `info` < `log` < `debug` < `trace`
 *
 * @typedef {import('types/bot/helpers.d.js').LogLevel} LogLevel
 * @typedef {import('types/bot/helpers.d.js').LogModule} LogModule
 */

const config = require('../modules/configReader');
const dateTime = require('./dateTime');
const constants = require('./const');

const fs = require('fs');

if (!fs.existsSync('./logs')) {
  fs.mkdirSync('./logs');
}

const LOG_FILE_PATH = `./logs/${dateTime.date()}.log`;
const HEARTBEAT_FILE_PATH = './logs/heartbeat';
const HEARTBEAT_INTERVAL = constants.MINUTE;

/** @type {LogLevel[]} */
const LEVELS = ['none', 'error', 'warn', 'info', 'log', 'debug', 'trace'];
/** @type {LogLevel} */
const configuredLevel = /** @type {LogLevel} */ (config.log_level || 'info');
const CURRENT_LEVEL_INDEX = LEVELS.indexOf(configuredLevel);

const EFFECTIVE_LEVEL_INDEX = CURRENT_LEVEL_INDEX === -1 ? LEVELS.indexOf('info') : CURRENT_LEVEL_INDEX;

const COLORS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[32m',
  log: '\x1b[34m',
  debug: '\x1b[35m',
  trace: '\x1b[90m',
};

const logFile = fs.createWriteStream(LOG_FILE_PATH, { flags: 'a' });
logFile.write(`\n\n[The bot started] _________________${dateTime.fullTime()}_________________\n`);

/**
 * @param {LogLevel} level
 * @returns {boolean}
 */
function shouldLog(level) {
  return LEVELS.indexOf(level) <= EFFECTIVE_LEVEL_INDEX;
}

/**
 * Writes a log line to the console (unless `CLI_INSTANCE` is set) and to the daily log file.
 *
 * @param {LogLevel} level
 * @param {string} str
 */
function write(level, str) {
  const timestamp = dateTime.fullTime();

  if (!process.env.CLI_INSTANCE) {
    const color = COLORS[level] || '';
    console.log(color, `${level}|${timestamp}`, '\x1b[0m', str);
  }

  logFile.write(`\n ${level}|${timestamp}|${str}`);
}

/** @type {LogModule} */
module.exports = {
  /**
   * Logs an error message.
   * @param {string} str
   */
  error(str) {
    if (shouldLog('error')) {
      write('error', str);
    }
  },

  /**
   * Logs a warning message.
   * @param {string} str
   */
  warn(str) {
    if (shouldLog('warn')) {
      write('warn', str);
    }
  },

  /**
   * Logs an informational message.
   * @param {string} str
   */
  info(str) {
    if (shouldLog('info')) {
      write('info', str);
    }
  },

  /**
   * Logs a general-purpose message (between `info` and `debug` verbosity).
   * @param {string} str
   */
  log(str) {
    if (shouldLog('log')) {
      write('log', str);
    }
  },

  /**
   * Logs a debug message.
   * @param {string} str
   */
  debug(str) {
    if (shouldLog('debug')) {
      write('debug', str);
    }
  },

  /**
   * Logs a trace message.
   * @param {string} str
   */
  trace(str) {
    if (shouldLog('trace')) {
      write('trace', str);
    }
  },

  HEARTBEAT_FILE_PATH,
};

if (CURRENT_LEVEL_INDEX === -1) {
  module.exports.warn(`log: Unknown log_level '${configuredLevel}', falling back to 'info'`);
}

setInterval(() => {
  try {
    fs.writeFileSync(HEARTBEAT_FILE_PATH, Date.now().toString());
  } catch (err) {
    module.exports.error(`log: Failed to update heartbeat file at ${HEARTBEAT_FILE_PATH}. ${err}`);
  }
}, HEARTBEAT_INTERVAL);
