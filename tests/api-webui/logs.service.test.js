'use strict';

/* global describe, test, expect, beforeEach, afterEach */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { buildLogsGzip } = require('../../api/services/logs');

/** @type {string} */
let logsDir;

/**
 * @param {Array<[string, string]>} entries Level and message pairs
 * @returns {string} Lines as the bot writes them
 */
function text(entries) {
  return entries.map(([level, message]) => `\n ${level}|2026-10-02 12:00:00|${message}`).join('');
}

/**
 * @param {{ buffer: Buffer }} result `buildLogsGzip()` result
 * @returns {string[]} Messages of the exported lines
 */
function messages(result) {
  return zlib.gunzipSync(result.buffer).toString('utf8').trim().split('\n').map((line) => line.split('|')[2] ?? line);
}

beforeEach(() => {
  logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradebot-webui-logs-'));

  fs.writeFileSync(path.join(logsDir, 'bot-2026-10-01_00-00-00.log.gz'), zlib.gzipSync(text([
    ['info', 'old info'],
    ['error', 'old error'],
  ])));
  fs.writeFileSync(path.join(logsDir, 'bot-2026-10-02_00-00-00.log'), text([
    ['warn', 'rotated warn'],
    ['debug', 'rotated debug'],
  ]));
  fs.writeFileSync(path.join(logsDir, 'bot.log'), `${text([
    ['info', 'active info'],
    ['trace', 'active trace'],
  ])}\nno level line`);
});

afterEach(() => {
  fs.rmSync(logsDir, { recursive: true, force: true });
});

describe('WebUI log export', () => {
  test('exports lines from the active and rotated files, oldest first, without blank lines', async () => {
    const result = await buildLogsGzip({}, logsDir);

    expect(result.lineCount).toBe(7);
    expect(result.filename).toMatch(/^bot-logs-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.txt\.gz$/);
    expect(messages(result)).toEqual([
      'old info',
      'old error',
      'rotated warn',
      'rotated debug',
      'active info',
      'active trace',
      'no level line',
    ]);
  });

  test('applies the minimum level and grep before tail', async () => {
    expect(messages(await buildLogsGzip({ level: 'warn' }, logsDir))).toEqual([
      'old error',
      'rotated warn',
      'no level line',
    ]);
    expect(messages(await buildLogsGzip({ level: 'info', tail: 2 }, logsDir))).toEqual([
      'active info',
      'no level line',
    ]);
    expect(messages(await buildLogsGzip({ grep: 'old' }, logsDir))).toEqual([
      'old info',
      'old error',
    ]);
  });

  test('returns an empty export when there are no log files', async () => {
    const result = await buildLogsGzip({}, path.join(logsDir, 'missing'));

    expect(result.lineCount).toBe(0);
    expect(zlib.gunzipSync(result.buffer).toString('utf8')).toBe('\n');
  });
});
