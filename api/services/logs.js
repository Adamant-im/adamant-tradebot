// @ts-nocheck — filesystem log export for WebUI; gzip payload.
'use strict';

/**
 * @module api/services/logs
 * Builds a filtered gzip archive of bot log lines for the WebUI.
 *
 * `level` is a minimum severity (level+): e.g. `info` keeps error/warn/info.
 * `tail` is applied after level/grep filters.
 *
 * Lines come from `logs/bot.log` and its rotated copies, including gzipped ones, newest first.
 * Files are streamed, not loaded whole, so an export does not spike the bot's memory.
 */

const path = require('path');
const util = require('util');
const zlib = require('zlib');

const { listLogFiles, readRecentLogLines } = require('../../helpers/logReader');

const gzip = util.promisify(zlib.gzip);

const DEFAULT_TAIL = 1_000;
const MAX_TAIL = 20_000;

/** @type {Record<string, number>} */
const LEVEL_RANK = {
  error: 0,
  warn: 1,
  info: 2,
  log: 3,
  debug: 4,
  trace: 5,
};

const LEVELS = new Set(Object.keys(LEVEL_RANK));

/**
 * @param {string} line
 * @param {string | undefined} minLevel
 * @returns {boolean}
 */
function passesMinLevel(line, minLevel) {
  if (!minLevel) {
    return true;
  }

  const match = /^\s*(error|warn|info|log|debug|trace)\b/i.exec(line);
  if (!match) {
    // Lines without a level still pass (same idea as "Show unspecified").
    return true;
  }

  const rank = LEVEL_RANK[match[1].toLowerCase()];
  return rank <= LEVEL_RANK[minLevel];
}

/**
 * @param {{ tail?: number, level?: string, grep?: string }} options
 * @param {string} [logsDir] Logs directory. Defaults to `./logs` of the bot process.
 * @returns {Promise<{ buffer: Buffer, filename: string, lineCount: number }>}
 */
async function buildLogsGzip(options = {}, logsDir = path.join(process.cwd(), 'logs')) {
  const tail = Math.min(Math.max(Number(options.tail) || DEFAULT_TAIL, 1), MAX_TAIL);
  const level = options.level && LEVELS.has(String(options.level).toLowerCase()) ?
    String(options.level).toLowerCase() :
    undefined;
  const grep = typeof options.grep === 'string' && options.grep.trim() ?
    options.grep.trim() :
    undefined;

  // Filter first, then take the last N matching lines.
  const { lines: filtered } = await readRecentLogLines(listLogFiles(logsDir), {
    limit: tail,
    classify: (line) => {
      if (!line.trim()) {
        return 'skip';
      }
      if (grep && !line.includes(grep)) {
        return 'skip';
      }
      return passesMinLevel(line, level) ? 'keep' : 'skip';
    },
  });

  const text = `${filtered.join('\n')}\n`;
  const buffer = await gzip(Buffer.from(text, 'utf8'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return {
    buffer,
    filename: `bot-logs-${stamp}.txt.gz`,
    lineCount: filtered.length,
  };
}

module.exports = {
  buildLogsGzip,
  DEFAULT_TAIL,
  MAX_TAIL,
};
