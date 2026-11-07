'use strict';

/* global describe, test, expect, jest, beforeEach, afterEach */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

jest.mock('../../modules/mm/pm2', () => ({
  getLogs: jest.fn(async () => ''),
  disconnect: jest.fn(),
}));
jest.mock('../../modules/mm/docker', () => ({
  canUseHostCompose: jest.fn(() => false),
  compose: jest.fn(),
}));

const pm2 = require('../../modules/mm/pm2');
const { runLogs } = require('../../modules/mm/commands/logs');

/** @type {string} */
let logsDir;

/**
 * @param {number} offsetMs Milliseconds before now
 * @returns {string} Local timestamp in the bot log format
 */
function stamp(offsetMs) {
  const date = new Date(Date.now() - offsetMs);
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * @param {string} level
 * @param {number} offsetMs Milliseconds before now
 * @param {string} message
 * @returns {string} One log line as the bot writes it
 */
function entry(level, offsetMs, message) {
  return `\n ${level}|${stamp(offsetMs)}|${message}`;
}

/**
 * @param {import('types/bot/mm').MmContext | object} [overrides]
 * @returns {any} Minimal `mm` context
 */
function context(overrides = {}) {
  return {
    logsDir,
    mode: 'npm',
    pm2ProcessName: 'mm-app',
    composeService: 'mm-app',
    ...overrides,
  };
}

/**
 * @param {object} options `mm logs` options
 * @returns {Promise<string[]>} Printed log lines
 */
async function printedLines(options) {
  const output = jest.spyOn(console, 'log').mockImplementation(() => {});

  expect(await runLogs(context(), options)).toBe(0);

  const printed = output.mock.calls.map((call) => call.join(' '));

  output.mockRestore();
  return printed.join('\n').split('\n').filter((text) => text.trim());
}

beforeEach(() => {
  logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradebot-mm-logs-'));
  jest.clearAllMocks();

  const hour = 60 * 60 * 1000;

  // A session that started 3 hours ago, rotated 2 hours ago into a gzipped file
  fs.writeFileSync(path.join(logsDir, 'bot-2026-10-02_09-00-00.log.gz'), zlib.gzipSync([
    entry('info', 5 * hour, 'previous session'),
    `\n\n[The bot started] _________________${stamp(3 * hour)}_________________\n`,
    entry('info', 3 * hour, 'session start'),
    entry('error', 2.5 * hour, 'order failed'),
    entry('log', 2 * hour, 'last line before rotation'),
  ].join('')));

  fs.writeFileSync(path.join(logsDir, 'bot.log'), [
    entry('info', 2 * hour, 'log: Rotated bot.log at the 300M size limit.'),
    entry('warn', 0.5 * hour, 'spread too wide'),
    entry('log', 0.25 * hour, 'placed order'),
    entry('error', 0.1 * hour, 'cancel failed'),
  ].join(''));
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(logsDir, { recursive: true, force: true });
});

describe('mm logs with rotated files', () => {
  test('shows the current session across the rotation into a gzipped file', async () => {
    const printed = await printedLines({});

    expect(printed[0]).toMatch(/^\[The bot started\]/);
    expect(printed.slice(1).map((text) => text.split('|')[2])).toEqual([
      'session start',
      'order failed',
      'last line before rotation',
      'log: Rotated bot.log at the 300M size limit.',
      'spread too wide',
      'placed order',
      'cancel failed',
    ]);
    expect(pm2.getLogs).not.toHaveBeenCalled();
  });

  test('--tail reads older files when the active file is short', async () => {
    const printed = await printedLines({ tail: 6 });

    expect(printed.map((text) => text.split('|')[2])).toEqual([
      'order failed',
      'last line before rotation',
      'log: Rotated bot.log at the 300M size limit.',
      'spread too wide',
      'placed order',
      'cancel failed',
    ]);
  });

  test('--since stops at the first older line', async () => {
    const printed = await printedLines({ since: '1h' });

    expect(printed.map((text) => text.split('|')[2])).toEqual([
      'spread too wide',
      'placed order',
      'cancel failed',
    ]);
  });

  test('--level and --grep filter across files', async () => {
    expect((await printedLines({ level: 'error', tail: 10 })).map((text) => text.split('|')[2])).toEqual([
      'order failed',
      'cancel failed',
    ]);
    expect((await printedLines({ grep: 'order', tail: 10 })).map((text) => text.split('|')[2])).toEqual([
      'order failed',
      'placed order',
    ]);
  });

  test('falls back to PM2 output only when there are no log files', async () => {
    fs.rmSync(logsDir, { recursive: true, force: true });
    pm2.getLogs.mockResolvedValueOnce('line from pm2');

    const printed = await printedLines({ tail: 5 });

    expect(pm2.getLogs).toHaveBeenCalledWith('mm-app', 5);
    expect(printed).toEqual(['line from pm2']);
  });
});
