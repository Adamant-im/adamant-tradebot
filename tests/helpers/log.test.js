'use strict';

/* global describe, test, expect, jest, beforeEach, afterEach */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// Captured before fake timers replace them
const realSetTimeout = global.setTimeout;

const MINUTE = 60 * 1000;

const notifyMock = jest.fn();

/** @type {string} */
let workDir;
/** @type {string} */
let originalCwd;
/** @type {Record<string, string | undefined>} */
let originalEnv;

/**
 * Loads a fresh `helpers/log` with a mocked config, as every process that requires it does.
 * Only the bot process then calls `startRotation()` and `startHeartbeat()`. Intervals are
 * fake timers, so they fire only when a test advances them.
 *
 * @param {object} [logRotate] `log_rotate` config section
 * @returns {import('types/bot/helpers.d.js').LogModule}
 */
function loadLog(logRotate) {
  let log;

  jest.isolateModules(() => {
    jest.doMock('../../modules/configReader', () => ({
      log_level: 'log',
      log_rotate: logRotate,
      notifyName: 'TestBot',
    }));
    jest.doMock('../../helpers/notify', () => notifyMock);
    log = require('../../helpers/log');
  });

  return log;
}

/**
 * Waits for background file work (stream flushes, gzip, retention) to satisfy `condition`.
 *
 * @param {() => boolean} condition
 * @returns {Promise<void>}
 */
async function waitFor(condition) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => realSetTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for log files');
}

/**
 * @returns {string[]} Names in ./logs of the test working directory
 */
function logFiles() {
  return fs.readdirSync(path.join(workDir, 'logs')).sort();
}

/**
 * @returns {string} Content of ./logs/bot.log
 */
function activeLog() {
  return fs.readFileSync(path.join(workDir, 'logs', 'bot.log'), 'utf8');
}

/**
 * @returns {string} Path of ./logs/heartbeat in the test working directory
 */
function heartbeatFile() {
  return path.join(workDir, 'logs', 'heartbeat');
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradebot-log-'));
  originalCwd = process.cwd();
  originalEnv = { CLI_INSTANCE: process.env.CLI_INSTANCE, MM_CLI: process.env.MM_CLI };
  delete process.env.CLI_INSTANCE;
  delete process.env.MM_CLI;
  process.chdir(workDir);
  notifyMock.mockReset();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'Date'] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  process.chdir(originalCwd);

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('helpers/log file output', () => {
  test('the bot writes the start banner and log lines to ./logs/bot.log', async () => {
    const log = loadLog(undefined);

    log.startRotation();
    log.info('hello');
    log.trace('too verbose');

    expect(log.LOG_FILE_PATH).toBe('./logs/bot.log');
    expect(log.HEARTBEAT_FILE_PATH).toBe('./logs/heartbeat');

    await waitFor(() => activeLog().includes('hello'));

    expect(activeLog()).toMatch(/^\n\n\[The bot started\] _+\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}_+\n\n info\|.+\|hello$/);
  });

  test.each([
    ['a process without these flags', {}],
    ['the CLI instance (CLI_INSTANCE=true)', { CLI_INSTANCE: 'true' }],
    ['an mm command (MM_CLI=1)', { MM_CLI: '1' }],
  ])('%s that only loads the module appends, without a banner, rotation, or heartbeat', (_processName, env) => {
    Object.assign(process.env, env);

    const log = loadLog({ maxSize: '1K', retain: 1, rotateOnRestart: true });

    for (let index = 0; index < 50; index++) {
      log.log(`line ${index} ${'x'.repeat(40)}`);
    }

    jest.advanceTimersByTime(10 * MINUTE);

    expect(logFiles()).toEqual(['bot.log']);
    expect(fs.statSync(path.join(workDir, 'logs', 'bot.log')).size).toBeGreaterThan(1024);
    expect(activeLog()).not.toContain('[The bot started]');
    expect(activeLog()).toContain('line 49 ');
  });

  test.each([
    ['started directly', {}],
    ['started by `mm on` under PM2, which passes MM_CLI=1 down', { MM_CLI: '1' }],
  ])('the bot %s rotates at maxSize, keeps `retain` files, and starts each file with a rotation note', async (_startedBy, env) => {
    Object.assign(process.env, env);

    const log = loadLog({ maxSize: '1K', retain: 2, rotateInterval: '' });

    log.startRotation();

    for (let index = 0; index < 100; index++) {
      log.log(`line ${index} ${'x'.repeat(40)}`);
    }

    await waitFor(() => logFiles().filter((name) => name.endsWith('.log.gz')).length === 2 &&
      !logFiles().some((name) => /^bot-.*\.log$/.test(name)));

    const archives = logFiles().filter((name) => name.startsWith('bot-'));
    const retained = [
      ...archives.map((name) => zlib.gunzipSync(fs.readFileSync(path.join(workDir, 'logs', name))).toString()),
      activeLog(),
    ].join('');
    const numbers = [...retained.matchAll(/line (\d+) /g)].map((match) => Number(match[1]));

    expect(archives).toHaveLength(2);
    expect(numbers[numbers.length - 1]).toBe(99);
    expect(numbers).toEqual([...Array(numbers.length).keys()].map((index) => numbers[0] + index));
    expect(activeLog()).toMatch(/^\n info\|[^|]+\|log: Rotated bot\.log at the 1K size limit\. Earlier lines are in bot-.+\.log\.gz\.\n log\|/);
  });

  test('the bot rotates the previous run on restart, so its banner opens the new file', async () => {
    fs.mkdirSync(path.join(workDir, 'logs'));
    fs.writeFileSync(path.join(workDir, 'logs', 'bot.log'), '\n info|2026-10-01 00:00:00|previous run');

    const log = loadLog({ rotateOnRestart: true });

    log.startRotation();
    log.startRotation();

    await waitFor(() => logFiles().some((name) => name.endsWith('.log.gz')) && activeLog().includes('Rotated bot.log on restart'));

    const archive = logFiles().find((name) => name.endsWith('.log.gz'));

    expect(zlib.gunzipSync(fs.readFileSync(path.join(workDir, 'logs', archive))).toString()).toBe(
        '\n info|2026-10-01 00:00:00|previous run',
    );
    expect(activeLog()).toMatch(/^\n\n\[The bot started\] _+[^\n]+\n\n info\|[^|]+\|log: Rotated bot\.log on restart\./);
    expect(activeLog().match(/\[The bot started\]/g)).toHaveLength(1);
  });

  test('a log file failure in the bot is printed, notified at most once an hour, and never thrown', async () => {
    // A file where the logs directory should be: nothing can be opened inside it
    fs.writeFileSync(path.join(workDir, 'logs'), '');

    const log = loadLog(undefined);

    log.startRotation();

    expect(() => log.error('trading goes on')).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    log.error('still trading');

    await new Promise((resolve) => setImmediate(resolve));

    const printed = /** @type {jest.Mock} */ (console.log).mock.calls.map((call) => call.join(' '));

    expect(printed).toContainEqual(expect.stringContaining('trading goes on'));
    expect(printed).toContainEqual(expect.stringMatching(/log: Cannot (create the logs directory|open)/));
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
        expect.stringMatching(/^TestBot: log: Cannot .*\. Trading continues\. Check free disk space and permissions of the logs directory\.$/),
        'warn',
    );
  });

  test('a log file failure in another process is printed but not notified', async () => {
    fs.writeFileSync(path.join(workDir, 'logs'), '');

    const log = loadLog(undefined);

    log.error('cli command');

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const printed = /** @type {jest.Mock} */ (console.log).mock.calls.map((call) => call.join(' '));

    expect(printed).toContainEqual(expect.stringMatching(/log: Cannot (create the logs directory|append)/));
    expect(notifyMock).not.toHaveBeenCalled();
  });

  test('the bot warns about dated log files of older versions without touching them', async () => {
    fs.mkdirSync(path.join(workDir, 'logs'));
    fs.writeFileSync(path.join(workDir, 'logs', '2026-07-20.log'), 'x'.repeat(2048));

    loadLog({ maxSize: '1K', retain: 1 }).startRotation();

    await waitFor(() => activeLog().includes('from older versions'));

    expect(activeLog()).toMatch(
        / warn\|[^|]+\|log: \.\/logs has 1 log file\(s\) from older versions: 2026-07-20\.log \(2\.0 KB\)\. /,
    );
    expect(fs.readFileSync(path.join(workDir, 'logs', '2026-07-20.log'), 'utf8')).toHaveLength(2048);
  });
});

describe('helpers/log heartbeat', () => {
  test.each([
    ['a process without these flags', {}],
    ['the CLI instance (CLI_INSTANCE=true)', { CLI_INSTANCE: 'true' }],
    ['an mm command (MM_CLI=1)', { MM_CLI: '1' }],
  ])('%s that only loads the module never writes the heartbeat', (_processName, env) => {
    Object.assign(process.env, env);

    loadLog(undefined).log('working');

    jest.advanceTimersByTime(10 * MINUTE);

    expect(fs.existsSync(heartbeatFile())).toBe(false);
  });

  test.each([
    ['started directly', {}],
    ['started by `mm on` under PM2, which passes MM_CLI=1 down', { MM_CLI: '1' }],
  ])('the bot %s writes the heartbeat every minute after startHeartbeat()', (_startedBy, env) => {
    Object.assign(process.env, env);

    const log = loadLog(undefined);

    log.startRotation();
    log.startHeartbeat();

    jest.advanceTimersByTime(MINUTE - 1);

    expect(fs.existsSync(heartbeatFile())).toBe(false);

    const before = Date.now();

    jest.advanceTimersByTime(1);

    const first = Number(fs.readFileSync(heartbeatFile(), 'utf8'));

    expect(first).toBeGreaterThanOrEqual(before);
    expect(first).toBeLessThanOrEqual(Date.now());

    fs.writeFileSync(heartbeatFile(), '0');
    jest.advanceTimersByTime(MINUTE);

    expect(Number(fs.readFileSync(heartbeatFile(), 'utf8'))).toBeGreaterThanOrEqual(first);
  });

  test('repeated startHeartbeat() calls keep one timer', () => {
    const log = loadLog(undefined);
    const writeFileSync = jest.spyOn(fs, 'writeFileSync');

    log.startHeartbeat();
    log.startHeartbeat();
    jest.advanceTimersByTime(MINUTE);

    expect(writeFileSync.mock.calls.filter(([file]) => file === './logs/heartbeat')).toHaveLength(1);
  });
});
