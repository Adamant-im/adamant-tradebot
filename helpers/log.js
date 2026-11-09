'use strict';

/**
 * Lightweight logging with verbosity control.
 *
 * Every process that loads this module appends to `./logs/bot.log`: the bot, the CLI instance
 * (`npm run cli`), `mm` commands, and tests. Only the bot process takes on two more duties, and
 * `app.js` turns them on explicitly:
 * - `startRotation()` makes it the owner of the log file: it rotates the file by size and on a
 *   schedule, gzips rotated files, and keeps the newest `log_rotate.retain` of them (see `helpers/logRotation.js`)
 * - `startHeartbeat()` refreshes the heartbeat file that `app.js` reads to detect downtime
 *
 * Environment flags cannot tell the bot from the other processes: a bot started by an older
 * `mm on` keeps `MM_CLI=1` in its PM2 env until `mm off` and `mm on`.
 *
 * @module helpers/log
 */

/**
 * Logging verbosity (least to most verbose):
 * `none` < `error` < `warn` < `info` < `log` < `debug` < `trace`
 *
 * @typedef {import('types/bot/helpers.d.js').LogLevel} LogLevel
 * @typedef {import('types/bot/helpers.d.js').LogModule} LogModule
 * @typedef {import('types/bot/configReader.d.js').BotLogRotateConfig} BotLogRotateConfig
 * @typedef {import('./logRotation').RotatingLogFile} RotatingLogFile
 */

const config = require('../modules/configReader');
const dateTime = require('./dateTime');
const constants = require('./const');
const logRotation = require('./logRotation');

const fs = require('fs');

const LOGS_DIR = './logs';
const LOG_FILE_PATH = `${LOGS_DIR}/${logRotation.LOG_FILE_NAME}`;
const HEARTBEAT_FILE_PATH = `${LOGS_DIR}/heartbeat`;
const HEARTBEAT_INTERVAL = constants.MINUTE;

/** Log file failures are sent to notification channels at most this often */
const LOG_FILE_ERROR_NOTIFY_INTERVAL = constants.HOUR;

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

let isReportingLogFileError = false;
let lastLogFileErrorNotifyAt = 0;

/** Set by `startRotation()`: this process is the bot */
let isBotProcess = false;

/** @type {NodeJS.Timeout | undefined} */
let heartbeatTimer;

const rotationSettings = resolveRotationSettings();

/**
 * Appends only, until the bot process calls `startRotation()`.
 *
 * @type {RotatingLogFile}
 */
let logFile = createLogFile(false);

/**
 * @param {LogLevel} level
 * @returns {boolean}
 */
function shouldLog(level) {
  return LEVELS.indexOf(level) <= EFFECTIVE_LEVEL_INDEX;
}

/**
 * Writes a log line to the console (unless `CLI_INSTANCE` is set) and to the log file.
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

/**
 * @param {boolean} owner Whether the process rotates the file or only appends to it
 * @returns {RotatingLogFile}
 */
function createLogFile(owner) {
  // The writer reports failures on the next tick, and a rotation on restart too, after the caller has finished
  return logRotation.createRotatingLogFile({
    filePath: LOG_FILE_PATH,
    settings: rotationSettings,
    owner,
    onError: reportLogFileError,
    onRotate: (message) => module.exports.info(`log: ${message}`),
  });
}

/**
 * Makes this process the owner of `logs/bot.log`. From here on, it rotates the file on restart
 * (when `log_rotate.rotateOnRestart` is set), by size, and on schedule, gzips and prunes rotated
 * files, and re-opens the file after it is moved or deleted. Then writes the `[The bot started]`
 * line that opens each bot run.
 *
 * Only the bot process calls it, from `app.js`, right after loading this module. The CLI instance
 * and `mm` commands share the file and must not rename it under the running bot. Repeated calls do nothing.
 */
function startRotation() {
  if (isBotProcess) {
    return;
  }

  isBotProcess = true;
  logFile = createLogFile(true);
  logFile.write(`\n\n[The bot started] _________________${dateTime.fullTime()}_________________\n`);
  warnAboutLegacyLogFiles();
}

/**
 * Starts writing the current time to the heartbeat file every minute. On startup, `app.js` reads
 * the file to tell how long the bot was offline.
 *
 * Only the bot process calls it, after that check. The CLI instance and `mm` commands also load this
 * module, and a heartbeat from them would hide the bot's downtime. Repeated calls do nothing.
 */
function startHeartbeat() {
  if (heartbeatTimer) {
    return;
  }

  heartbeatTimer = setInterval(() => {
    try {
      fs.writeFileSync(HEARTBEAT_FILE_PATH, Date.now().toString());
    } catch (err) {
      module.exports.error(`log: Failed to update heartbeat file at ${HEARTBEAT_FILE_PATH}. ${err}`);
    }
  }, HEARTBEAT_INTERVAL);
}

/**
 * Returns validated `log_rotate` settings. `configReader` validates them at startup and exits on
 * an invalid value, so the fallback only covers mocked configs in tests.
 *
 * @returns {BotLogRotateConfig}
 */
function resolveRotationSettings() {
  try {
    return logRotation.normalizeLogRotateConfig(config.log_rotate);
  } catch (error) {
    console.error(`log: Invalid log_rotate settings, using defaults. ${error}`);
    return logRotation.normalizeLogRotateConfig(undefined);
  }
}

/**
 * Reports a log file failure (open, write, rotation, compression, retention) without throwing,
 * so the bot keeps trading and logging to the console. The bot process also sends a notification
 * at most once an hour, because a failing rotation lets the file grow without limit.
 *
 * @param {string} message Failure description from the log file writer
 */
function reportLogFileError(message) {
  if (isReportingLogFileError) {
    return;
  }

  isReportingLogFileError = true;

  try {
    const text = `log: ${message}`;

    if (shouldLog('error')) {
      write('error', text);
    }

    const now = Date.now();

    if (isBotProcess && now - lastLogFileErrorNotifyAt >= LOG_FILE_ERROR_NOTIFY_INTERVAL) {
      lastLogFileErrorNotifyAt = now;

      // Deferred and loaded lazily: helpers/notify depends on this module
      setImmediate(() => {
        try {
          require('./notify')(
              `${config.notifyName}: ${text}. Trading continues. Check free disk space and permissions of the logs directory.`,
              'warn',
          );
        } catch (error) {
          console.error(`log: Failed to send a log file failure notification. ${error}`);
        }
      });
    }
  } finally {
    isReportingLogFileError = false;
  }
}

/**
 * Warns about dated `YYYY-MM-DD.log` files left by versions before log rotation. The bot does
 * not rotate or delete them, so they keep their disk space until the operator removes them.
 */
function warnAboutLegacyLogFiles() {
  logRotation.findLegacyLogFiles(LOGS_DIR).then((files) => {
    if (!files.length) {
      return;
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const shown = files.slice(0, 5).map((file) => file.name).join(', ');
    const more = files.length > 5 ? ` and ${files.length - 5} more` : '';

    module.exports.warn(
        `log: ${LOGS_DIR} has ${files.length} log file(s) from older versions: ${shown}${more} ` +
        `(${logRotation.formatBytes(totalSize)}). The bot now writes ${LOG_FILE_PATH} and never rotates or deletes ` +
        `these files. Remove them when you no longer need them.`,
    );
  }).catch(() => {
    // The logs directory is not readable; the writer reports that
  });
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

  startRotation,
  startHeartbeat,
  HEARTBEAT_FILE_PATH,
  LOG_FILE_PATH,
};

if (CURRENT_LEVEL_INDEX === -1) {
  module.exports.warn(`log: Unknown log_level '${configuredLevel}', falling back to 'info'`);
}
