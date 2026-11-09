'use strict';

/**
 * `mm logs` — show bot logs from file, PM2, or Docker.
 *
 * Log files are `logs/bot.log` and its rotated copies (`bot-*.log`, `bot-*.log.gz`), plus dated
 * `YYYY-MM-DD.log` files from versions before log rotation. Reading starts at the newest line and
 * stops as soon as enough lines are found, so large and compressed files are not loaded into memory.
 *
 * @module modules/mm/commands/logs
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmParsedArgs} MmParsedArgs
 * @typedef {import('../../../helpers/logReader').LogLineClass} LogLineClass
 */

/**
 * @typedef {Object} LogsOptions
 * @property {number} [tail] Number of lines; disables the session view
 * @property {string} [since] Duration such as `1h`; disables the session view
 * @property {string} [level] Keep lines with this level token
 * @property {string} [grep] Keep lines containing this text
 * @property {boolean} [follow] Follow the log file
 */

const { createContext } = require('../context');
const docker = require('../docker');
const pm2 = require('../pm2');
const terminal = require('../terminal');
const { findCurrentLogFile, followLogFile, listLogFiles, readRecentLogLines } = require('../../../helpers/logReader');

const BOT_STARTED_MARKER = '[The bot started]';
const DEFAULT_TAIL = 100;
const PM2_SESSION_TAIL = 10000;

/** Timestamp anywhere in a line, used for PM2 and Docker output */
const ANY_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;

/** Timestamp of a bot log line: ` info|2026-10-02 12:00:00|message` */
const LOG_LINE_TIMESTAMP_PATTERN = /^\s*[a-z]+\|(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|/;

/**
 * Parses a simple duration like 1h, 30m, 1d.
 *
 * @param {string} value
 * @returns {number | undefined}
 */
function parseSince(value) {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * multipliers[/** @type {'s'|'m'|'h'|'d'} */ (unit)];
}

/**
 * @param {string} line
 * @param {{ level?: string, grep?: string }} filters
 */
function matchesFilters(line, filters) {
  if (filters.grep && !line.includes(filters.grep)) {
    return false;
  }

  if (filters.level) {
    const pattern = new RegExp(`\\b${filters.level}\\b`, 'i');
    if (!pattern.test(line)) {
      return false;
    }
  }

  return true;
}

/**
 * @param {string[]} lines
 * @returns {string[]}
 */
function sliceFromLastBotStart(lines) {
  let lastIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(BOT_STARTED_MARKER)) {
      lastIndex = i;
    }
  }

  return lastIndex >= 0 ? lines.slice(lastIndex) : lines;
}

/**
 * Default view: current session since last bot start. `--tail` / `--since` override.
 *
 * @param {{ tail?: number, since?: string }} options
 * @returns {boolean}
 */
function useBotSessionView(options) {
  return options.tail === undefined && !options.since;
}

/**
 * Filters PM2 or Docker output that is already in memory.
 *
 * @param {string[]} lines
 * @param {{ tail?: number, since?: string, level?: string, grep?: string }} options
 */
function filterLines(lines, options) {
  let filtered = lines;

  if (options.since) {
    const ms = parseSince(options.since);
    if (ms) {
      const cutoff = Date.now() - ms;
      filtered = filtered.filter((line) => {
        const match = ANY_TIMESTAMP_PATTERN.exec(line);
        if (!match) {
          return true;
        }
        const ts = Date.parse(match[0].replace(' ', 'T'));
        return Number.isFinite(ts) ? ts >= cutoff : true;
      });
    }
  }

  filtered = filtered.filter((line) => matchesFilters(line, options));

  if (useBotSessionView(options)) {
    const session = sliceFromLastBotStart(filtered);
    const source = session.length ? session : filtered;
    return source.slice(-DEFAULT_TAIL);
  }

  const tail = options.tail ?? DEFAULT_TAIL;
  return filtered.slice(-tail);
}

/**
 * Builds the line classifier for log files. Matches `filterLines()`: `--since` ends the scan at
 * the first line older than the cutoff, and the session view ends it at the last bot start.
 * Blank lines are skipped, so `--tail` counts only real lines.
 *
 * @param {LogsOptions} options
 * @param {number} [now] Current time, Unix ms
 * @returns {(line: string) => LogLineClass}
 */
function createLineClassifier(options, now = Date.now()) {
  const sinceMs = options.since ? parseSince(options.since) : undefined;
  const cutoff = sinceMs ? now - sinceMs : undefined;
  const sessionView = useBotSessionView(options);

  return (line) => {
    if (!line.trim()) {
      return 'skip';
    }

    if (cutoff !== undefined) {
      const match = LOG_LINE_TIMESTAMP_PATTERN.exec(line);
      const timestamp = match ? Date.parse(match[1].replace(' ', 'T')) : NaN;

      if (Number.isFinite(timestamp) && timestamp < cutoff) {
        return 'stop';
      }
    }

    if (!matchesFilters(line, options)) {
      return 'skip';
    }

    return sessionView && line.includes(BOT_STARTED_MARKER) ? 'keep-and-stop' : 'keep';
  };
}

/**
 * Reads recent lines from the log files in `logsDir`, newest file first, including rotated and gzipped ones.
 *
 * @param {string} logsDir Logs directory
 * @param {LogsOptions} [options] Same options as `mm logs`
 * @returns {Promise<{ lines: string[], truncated: boolean, found: boolean }>} `found` is `false` when there are no log files
 */
async function readLocalLogs(logsDir, options = {}) {
  const files = listLogFiles(logsDir).filter((file) => file.size > 0);

  if (!files.length) {
    return { lines: [], truncated: false, found: false };
  }

  const { lines, truncated } = await readRecentLogLines(files, {
    limit: useBotSessionView(options) ? DEFAULT_TAIL : (options.tail ?? DEFAULT_TAIL),
    classify: createLineClassifier(options),
  });

  return { lines, truncated, found: true };
}

/**
 * Follows the local log file across rotations, printing new lines until SIGINT.
 *
 * @param {string} filePath
 * @param {{ level?: string, grep?: string }} filters
 * @returns {Promise<void>}
 */
function followLocalLogFile(filePath, filters) {
  return new Promise((resolve) => {
    const follower = followLogFile(filePath, (line) => {
      if (line && matchesFilters(line, filters)) {
        console.log(line);
      }
    });

    const stop = () => {
      follower.stop();
      resolve();
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

/**
 * @param {MmContext} ctx
 * @param {LogsOptions} options
 * @returns {Promise<number>}
 */
async function runFollowLogs(ctx, options) {
  const current = findCurrentLogFile(ctx.logsDir);
  if (current) {
    await followLocalLogFile(current, options);
    return 0;
  }

  if (ctx.mode === 'docker' && docker.canUseHostCompose(ctx)) {
    const args = ['logs', '-f', '--tail', String(options.tail ?? DEFAULT_TAIL), ctx.composeService];
    await docker.compose(ctx, args, { inherit: true });
    return 0;
  }

  try {
    const pm2Logs = await pm2.getLogs(ctx.pm2ProcessName, options.tail ?? DEFAULT_TAIL);
    console.log(pm2Logs);
  } finally {
    pm2.disconnect();
  }

  return 0;
}

/**
 * Shows bot logs from the log files in ./logs, or from Docker or PM2 when there are none.
 *
 * @param {MmContext} ctx Runtime context
 * @param {LogsOptions} [options]
 * @returns {Promise<number>} Always 0 unless compose/PM2 fails
 */
async function runLogs(ctx, options = {}) {
  if (options.follow) {
    console.log('');
    await runFollowLogs(ctx, options);
    console.log('');
    return 0;
  }

  const sessionView = useBotSessionView(options);
  const local = await readLocalLogs(ctx.logsDir, options);
  /** @type {string[]} */
  let lines = local.lines;

  if (!local.found && ctx.mode === 'docker' && docker.canUseHostCompose(ctx)) {
    const result = await docker.compose(ctx, [
      'logs',
      '--tail',
      sessionView ? '10000' : String(options.tail ?? DEFAULT_TAIL),
      ctx.composeService,
    ]);
    if (result.code !== 0) {
      console.error(result.stderr || result.stdout);
      return result.code;
    }
    lines = filterLines(result.stdout.split('\n'), options);
  }

  if (!local.found && ctx.mode !== 'docker') {
    try {
      const pm2Lines = sessionView ? PM2_SESSION_TAIL : (options.tail ?? DEFAULT_TAIL);
      const pm2Logs = await pm2.getLogs(ctx.pm2ProcessName, pm2Lines);
      lines = filterLines(pm2Logs.split('\n'), options);
    } catch {
      // No PM2 process or log files — lines stay empty
    } finally {
      pm2.disconnect();
    }
  } else {
    pm2.disconnect();
  }

  console.log('');
  console.log(lines.join('\n'));
  console.log('');

  if (local.truncated) {
    console.error(terminal.dim(
        `Older log files were not searched. For a full search, use zgrep on ${ctx.logsDir}/bot-*.log.gz.`,
    ));
  }

  return 0;
}

/** @param {MmParsedArgs} args @returns {Promise<number>} */
async function logs(args) {
  const ctx = createContext({ mode: args.mode, workDir: args.workDir });
  return runLogs(ctx, {
    tail: args.tail,
    since: args.since,
    level: args.level,
    grep: args.grep,
    follow: args.follow,
  });
}

module.exports = {
  logs,
  runLogs,
  readLocalLogs,
  createLineClassifier,
  filterLines,
  matchesFilters,
};
