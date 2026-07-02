'use strict';

/**
 * `mm logs` — show bot logs from file, PM2, or Docker.
 *
 * @module modules/mm/commands/logs
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmParsedArgs} MmParsedArgs
 */

const fs = require('fs');
const path = require('path');
const { createContext } = require('../context');
const docker = require('../docker');
const pm2 = require('../pm2');

const BOT_STARTED_MARKER = '[The bot started]';
const DEFAULT_TAIL = 100;
const PM2_SESSION_TAIL = 10000;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function readLogFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.log'))
      .map((name) => path.join(dir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

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
        const match = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.exec(line);
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
 * Reads recent lines from ./logs/*.log in the work directory.
 *
 * @param {string} logsDir
 * @param {number} [maxFiles=3]
 * @returns {string[]}
 */
function readLocalLogLines(logsDir, maxFiles = 3) {
  const files = readLogFiles(logsDir);
  const selected = maxFiles > 1 ? files.slice(0, maxFiles).reverse() : files.slice(0, maxFiles);
  /** @type {string[]} */
  const lines = [];

  for (const file of selected) {
    lines.push(...fs.readFileSync(file, 'utf8').split('\n'));
  }

  return lines;
}

/**
 * Follows a local log file, printing new lines until SIGINT.
 *
 * @param {string} filePath
 * @param {{ level?: string, grep?: string }} filters
 * @returns {Promise<void>}
 */
function followLocalLogFile(filePath, filters) {
  return new Promise((resolve) => {
    let position = fs.statSync(filePath).size;

    const readNewLines = () => {
      const stat = fs.statSync(filePath);
      if (stat.size < position) {
        position = 0;
      }
      if (stat.size <= position) {
        return;
      }

      const length = stat.size - position;
      const buffer = Buffer.alloc(length);
      const fd = fs.openSync(filePath, 'r');
      try {
        fs.readSync(fd, buffer, 0, length, position);
      } finally {
        fs.closeSync(fd);
      }
      const chunk = buffer.toString('utf8');
      position = stat.size;
      for (const line of chunk.split('\n')) {
        if (line && matchesFilters(line, filters)) {
          console.log(line);
        }
      }
    };

    fs.watchFile(filePath, { interval: 500 }, readNewLines);

    const stop = () => {
      fs.unwatchFile(filePath);
      resolve();
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

/**
 * @param {MmContext} ctx
 * @param {{ tail?: number, since?: string, level?: string, grep?: string }} options
 * @returns {Promise<number>}
 */
async function runFollowLogs(ctx, options) {
  const latest = readLogFiles(ctx.logsDir)[0];
  if (latest) {
    await followLocalLogFile(latest, options);
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
 * Shows bot logs from Docker, PM2, or plain log files in ./logs.
 *
 * @param {MmContext} ctx Runtime context
 * @param {{ tail?: number, since?: string, level?: string, grep?: string, follow?: boolean }} [options]
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
  const maxFiles = sessionView ? 5 : 1;
  /** @type {string[]} */
  let lines = readLocalLogLines(ctx.logsDir, maxFiles);

  if (!lines.some((line) => line.trim()) && ctx.mode === 'docker' && docker.canUseHostCompose(ctx)) {
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
    lines = result.stdout.split('\n');
  }

  if (!lines.some((line) => line.trim()) && ctx.mode !== 'docker') {
    try {
      const pm2Lines = sessionView ? PM2_SESSION_TAIL : (options.tail ?? DEFAULT_TAIL);
      const pm2Logs = await pm2.getLogs(ctx.pm2ProcessName, pm2Lines);
      lines = pm2Logs.split('\n');
    } catch {
      // No PM2 process or log files — lines stay empty
    } finally {
      pm2.disconnect();
    }
  } else {
    pm2.disconnect();
  }

  console.log('');
  console.log(filterLines(lines, options).join('\n'));
  console.log('');

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

module.exports = { logs, runLogs };
