'use strict';

/* global describe, test, expect, jest, beforeEach, afterEach */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');

const {
  DEFAULT_LOG_ROTATE,
  ERROR_REPORT_INTERVAL_MS,
  ROTATION_RETRY_DELAY_MS,
  archivePattern,
  compareNewestFirst,
  compressFile,
  createRotatingLogFile,
  cronMatches,
  findLegacyLogFiles,
  formatArchiveName,
  isScheduleDue,
  normalizeLogRotateConfig,
  parseCronExpression,
  parseSize,
  pruneArchives,
  removeStaleTempFiles,
} = require('../../helpers/logRotation');

/** @type {string[]} */
const tempDirs = [];
/** @type {import('../../helpers/logRotation').RotatingLogFile[]} */
const writers = [];

/**
 * @returns {string} New temp logs directory, removed after the test
 */
function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradebot-log-rotation-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * @param {string} dir Logs directory
 * @param {Partial<import('../../helpers/logRotation').RotatingLogFileOptions> & { rotate?: object }} [options]
 */
function createWriter(dir, options = {}) {
  const errors = [];
  const notes = [];
  const writer = createRotatingLogFile({
    filePath: path.join(dir, 'bot.log'),
    settings: normalizeLogRotateConfig({ rotateInterval: '', ...options.rotate }),
    onError: (message) => errors.push(message),
    onRotate: (message) => notes.push(message),
    checkIntervalMs: 60 * 60 * 1000,
    ...options,
  });

  writers.push(writer);
  return { writer, errors, notes };
}

/**
 * @param {number} index Line number
 * @returns {string} One log line in the bot format
 */
function line(index) {
  return `\n info|2026-10-02 12:00:00|line ${index} ${'x'.repeat(40)}`;
}

/**
 * @param {string} dir Logs directory
 * @returns {string[]} Rotated file names, oldest rotation first
 */
function archiveNames(dir) {
  const pattern = archivePattern('bot.log');
  return fs.readdirSync(dir)
      .map((name) => ({ name, match: pattern.exec(name) }))
      .filter(({ match }) => match)
      .map(({ name, match }) => ({ name, id: match[1] }))
      .sort((a, b) => compareNewestFirst(b, a))
      .map(({ name }) => name);
}

/**
 * @param {string} dir Logs directory
 * @returns {string} Content of all rotated files, oldest first, followed by the active file
 */
function readAllLogText(dir) {
  const archives = archiveNames(dir).map((name) => {
    const data = fs.readFileSync(path.join(dir, name));
    return name.endsWith('.gz') ? zlib.gunzipSync(data).toString('utf8') : data.toString('utf8');
  });

  const activePath = path.join(dir, 'bot.log');
  const active = fs.existsSync(activePath) ? fs.readFileSync(activePath, 'utf8') : '';

  return archives.join('') + active;
}

/**
 * @param {string} text Log content
 * @returns {number[]} Line numbers written by `line()`, in file order
 */
function lineNumbers(text) {
  return [...text.matchAll(/line (\d+) /g)].map((match) => Number(match[1]));
}

/**
 * Waits until queued `onError` / `onRotate` callbacks ran.
 *
 * @returns {Promise<void>}
 */
function nextTick() {
  return new Promise((resolve) => process.nextTick(resolve));
}

afterEach(async () => {
  jest.restoreAllMocks();

  for (const writer of writers.splice(0)) {
    await writer.close();
  }

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('log_rotate config validation', () => {
  test('returns the defaults when the section is missing', () => {
    expect(normalizeLogRotateConfig(undefined)).toEqual({
      enabled: true,
      maxSize: '300M',
      retain: 5,
      compress: true,
      rotateInterval: '0 0 * * *',
      rotateOnRestart: false,
    });
    expect(normalizeLogRotateConfig({})).toEqual(DEFAULT_LOG_ROTATE);
  });

  test('merges a partial section with the defaults', () => {
    expect(normalizeLogRotateConfig({ maxSize: '100M', retain: 10 })).toEqual({
      ...DEFAULT_LOG_ROTATE,
      maxSize: '100M',
      retain: 10,
    });
  });

  test('normalizes disabled size and schedule', () => {
    expect(normalizeLogRotateConfig({ maxSize: false, rotateInterval: false })).toEqual(
        expect.objectContaining({ maxSize: 0, rotateInterval: '' }),
    );
    expect(normalizeLogRotateConfig({ maxSize: '0', rotateInterval: '' })).toEqual(
        expect.objectContaining({ maxSize: 0, rotateInterval: '' }),
    );
    expect(normalizeLogRotateConfig({ rotateInterval: '  */15   *  * * 1-5 ' }).rotateInterval).toBe('*/15 * * * 1-5');
  });

  test.each([
    [{ maxSize: '300X' }, /log_rotate\.maxSize '300X' is not a size/],
    [{ maxSize: '512' }, /log_rotate\.maxSize must be at least 1K/],
    [{ maxSize: -1 }, /log_rotate\.maxSize must be a whole number of bytes/],
    [{ maxSize: true }, /log_rotate\.maxSize must be a size string/],
    [{ retain: 0 }, /log_rotate\.retain must be a whole number of at least 1, got 0/],
    [{ retain: 2.5 }, /log_rotate\.retain/],
    [{ retain: '5' }, /log_rotate\.retain/],
    [{ enabled: 'yes' }, /log_rotate\.enabled must be true or false/],
    [{ compress: 1 }, /log_rotate\.compress must be true or false/],
    [{ rotateOnRestart: null }, /log_rotate\.rotateOnRestart must be true or false/],
    [{ rotateInterval: '0 0 0 1 *' }, /log_rotate\.rotateInterval '0 0 0 1 \*': day of month '0' is out of range 1-31/],
    [{ rotateInterval: '0 0 * *' }, /must have 5 fields/],
    [{ rotateInterval: '0 0 0 * * *' }, /must have 5 fields/],
    [{ rotateInterval: '61 * * * *' }, /minute '61' is out of range 0-59/],
    [{ rotateInterval: '*/0 * * * *' }, /minute '\*\/0' is out of range/],
    [{ rotateInterval: 'daily' }, /'daily' must have 5 fields/],
    [{ rotateInterval: 'x * * * *' }, /minute 'x' is not valid cron syntax/],
    [{ rotateInterval: '0 0 * * MON' }, /day of week 'MON' is not valid cron syntax/],
    [{ rotateInterval: 5 }, /log_rotate\.rotateInterval must be a 5-field cron expression/],
    [{ maxsize: '1M' }, /log_rotate has unknown field\(s\) maxsize\. Supported fields: enabled, maxSize/],
  ])('rejects %j', (section, message) => {
    expect(() => normalizeLogRotateConfig(section)).toThrow(message);
  });

  test.each([null, [], 'enabled', 5])('rejects a non-object section %j', (section) => {
    expect(() => normalizeLogRotateConfig(section)).toThrow(/log_rotate must be an object/);
  });
});

describe('parseSize', () => {
  test.each([
    ['300M', 300 * 1024 * 1024],
    ['300MB', 300 * 1024 * 1024],
    ['512k', 512 * 1024],
    ['1.5G', 1.5 * 1024 ** 3],
    [' 2 K ', 2048],
    ['4096', 4096],
    [1048576, 1048576],
    ['1K', 1024],
  ])('parses %j', (value, bytes) => {
    expect(parseSize(value)).toBe(bytes);
  });

  test.each([0, '0', '0M', false, ''])('treats %j as disabled', (value) => {
    expect(parseSize(value)).toBe(0);
  });
});

describe('cron schedule', () => {
  test('daily at midnight matches only 00:00 local time', () => {
    const schedule = parseCronExpression('0 0 * * *');

    expect(cronMatches(schedule, new Date(2026, 9, 2, 0, 0, 30))).toBe(true);
    expect(cronMatches(schedule, new Date(2026, 9, 2, 0, 1, 0))).toBe(false);
    expect(cronMatches(schedule, new Date(2026, 9, 2, 12, 0, 0))).toBe(false);
  });

  test('supports lists, ranges, and steps', () => {
    const schedule = parseCronExpression('*/15 9-17 * * 1-5');

    // 2026-10-05 is a Monday, 2026-10-10 is a Saturday
    expect(cronMatches(schedule, new Date(2026, 9, 5, 9, 45))).toBe(true);
    expect(cronMatches(schedule, new Date(2026, 9, 5, 9, 50))).toBe(false);
    expect(cronMatches(schedule, new Date(2026, 9, 5, 18, 0))).toBe(false);
    expect(cronMatches(schedule, new Date(2026, 9, 10, 9, 45))).toBe(false);

    const list = parseCronExpression('5,35 0/12 * * *');

    expect(cronMatches(list, new Date(2026, 9, 5, 12, 35))).toBe(true);
    expect(cronMatches(list, new Date(2026, 9, 5, 6, 35))).toBe(false);
  });

  test('matches a day when either restricted day field matches, like cron', () => {
    // The 1st of the month, or any Monday
    const schedule = parseCronExpression('0 0 1 * 1');

    expect(cronMatches(schedule, new Date(2026, 9, 1, 0, 0))).toBe(true); // Thursday the 1st
    expect(cronMatches(schedule, new Date(2026, 9, 5, 0, 0))).toBe(true); // Monday
    expect(cronMatches(schedule, new Date(2026, 9, 6, 0, 0))).toBe(false);
  });

  test('accepts 7 as Sunday', () => {
    const schedule = parseCronExpression('0 3 * * 7');

    expect(cronMatches(schedule, new Date(2026, 9, 4, 3, 0))).toBe(true); // Sunday
    expect(cronMatches(schedule, new Date(2026, 9, 5, 3, 0))).toBe(false);
  });

  test('a late check still sees a scheduled minute it skipped', () => {
    const schedule = parseCronExpression('0 0 * * *');
    const before = new Date(2026, 9, 1, 23, 59, 50).getTime();
    const after = new Date(2026, 9, 2, 0, 3, 10).getTime();

    expect(isScheduleDue(schedule, before, after)).toBe(true);
    expect(isScheduleDue(schedule, new Date(2026, 9, 2, 0, 0, 5).getTime(), after)).toBe(false);
  });
});

describe('archive naming and retention', () => {
  test('names archives after the local rotation time', () => {
    const date = new Date(2026, 9, 2, 7, 5, 9);

    expect(formatArchiveName('bot.log', date)).toBe('bot-2026-10-02_07-05-09.log');
    expect(formatArchiveName('bot.log', date, 2)).toBe('bot-2026-10-02_07-05-09_2.log');
    expect(archivePattern('bot.log').exec('bot-2026-10-02_07-05-09_2.log.gz').slice(1)).toEqual([
      '2026-10-02_07-05-09_2',
      '.gz',
    ]);
    expect(archivePattern('bot.log').test('bot-2026-10-02_07-05-09.log.gz.123.tmp')).toBe(false);
    expect(archivePattern('bot.log').test('2026-10-02.log')).toBe(false);
  });

  test('keeps the newest rotations by rotation time and ignores other files', async () => {
    const dir = createTempDir();
    const files = [
      'bot-2026-10-01_00-00-00.log.gz',
      'bot-2026-10-02_00-00-00.log.gz',
      'bot-2026-10-02_06-00-00.log',
      'bot-2026-10-02_06-00-00.log.gz',
      'bot-2026-10-02_12-00-00.log.gz',
      '2026-07-20.log',
      'bot.log',
      'heartbeat',
    ];

    files.forEach((name) => fs.writeFileSync(path.join(dir, name), name));

    // Modification time does not matter, e.g. after copying the logs directory
    const old = new Date(2020, 0, 1);
    fs.utimesSync(path.join(dir, 'bot-2026-10-02_12-00-00.log.gz'), old, old);

    const removed = await pruneArchives(dir, 'bot.log', 2);

    expect(removed.map((filePath) => path.basename(filePath)).sort()).toEqual([
      'bot-2026-10-01_00-00-00.log.gz',
      'bot-2026-10-02_00-00-00.log.gz',
    ]);
    expect(fs.readdirSync(dir).sort()).toEqual([
      '2026-07-20.log',
      'bot-2026-10-02_06-00-00.log',
      'bot-2026-10-02_06-00-00.log.gz',
      'bot-2026-10-02_12-00-00.log.gz',
      'bot.log',
      'heartbeat',
    ]);
  });

  test('a missing logs directory has no rotated files to prune or clean up', async () => {
    const missing = path.join(createTempDir(), 'deleted-logs');

    await expect(pruneArchives(missing, 'bot.log', 1)).resolves.toEqual([]);
    await expect(removeStaleTempFiles(missing, 'bot.log')).resolves.toBeUndefined();
    await expect(findLegacyLogFiles(missing)).resolves.toEqual([]);
  });

  test('orders rotations within one second by suffix', async () => {
    const dir = createTempDir();

    for (const name of ['bot-2026-10-02_12-00-00_10.log', 'bot-2026-10-02_12-00-00_9.log', 'bot-2026-10-02_12-00-00.log']) {
      fs.writeFileSync(path.join(dir, name), name);
    }

    await pruneArchives(dir, 'bot.log', 1);

    expect(fs.readdirSync(dir)).toEqual(['bot-2026-10-02_12-00-00_10.log']);
  });

  test('compresses a file atomically and keeps its modification time', async () => {
    const dir = createTempDir();
    const filePath = path.join(dir, 'bot-2026-10-02_00-00-00.log');
    const mtime = new Date(2026, 9, 2, 0, 0, 0);

    fs.writeFileSync(filePath, 'hello\nworld');
    fs.utimesSync(filePath, mtime, mtime);

    const target = await compressFile(filePath);

    expect(target).toBe(`${filePath}.gz`);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(zlib.gunzipSync(fs.readFileSync(target)).toString()).toBe('hello\nworld');
    expect(fs.statSync(target).mtimeMs).toBe(mtime.getTime());
    expect(fs.readdirSync(dir)).toEqual(['bot-2026-10-02_00-00-00.log.gz']);
  });

  test('removes only stale compression temp files', async () => {
    const dir = createTempDir();
    const now = Date.now();
    const stale = path.join(dir, 'bot-2026-10-01_00-00-00.log.gz.111.tmp');
    const fresh = path.join(dir, 'bot-2026-10-02_00-00-00.log.gz.222.tmp');

    fs.writeFileSync(stale, '');
    fs.writeFileSync(fresh, '');
    fs.utimesSync(stale, (now - 60 * 60 * 1000) / 1000, (now - 60 * 60 * 1000) / 1000);

    await removeStaleTempFiles(dir, 'bot.log', now);

    expect(fs.readdirSync(dir)).toEqual(['bot-2026-10-02_00-00-00.log.gz.222.tmp']);
  });

  test('finds dated log files of older versions', async () => {
    const dir = createTempDir();

    fs.writeFileSync(path.join(dir, '2026-08-01.log'), '12345');
    fs.writeFileSync(path.join(dir, '2026-07-20.log'), '123');
    fs.writeFileSync(path.join(dir, 'bot.log'), '');
    fs.writeFileSync(path.join(dir, '2026-07-20.log.gz'), '');

    expect(await findLegacyLogFiles(dir)).toEqual([
      { name: '2026-07-20.log', path: path.join(dir, '2026-07-20.log'), size: 3 },
      { name: '2026-08-01.log', path: path.join(dir, '2026-08-01.log'), size: 5 },
    ]);
  });
});

describe('rotating log file', () => {
  test('appends to the active file', async () => {
    const dir = createTempDir();
    const { writer } = createWriter(dir);

    writer.write('\n first');
    writer.write('\n second');
    await writer.flush();

    expect(fs.readFileSync(path.join(dir, 'bot.log'), 'utf8')).toBe('\n first\n second');
    expect(archiveNames(dir)).toEqual([]);
  });

  test('rotates before a line would exceed maxSize and loses no lines', async () => {
    const dir = createTempDir();
    const { writer, errors, notes } = createWriter(dir, { rotate: { maxSize: '1K', retain: 1000 } });

    for (let index = 0; index < 500; index++) {
      writer.write(line(index));
    }

    await writer.flush();
    await writer.idle();
    await nextTick();

    const archives = archiveNames(dir);

    expect(errors).toEqual([]);
    expect(archives.length).toBeGreaterThan(10);
    expect(archives.every((name) => name.endsWith('.log.gz'))).toBe(true);
    expect(notes[0]).toMatch(/^Rotated bot\.log at the 1K size limit\. Earlier lines are in bot-.+\.log\.gz\.$/);

    for (const name of archives) {
      expect(zlib.gunzipSync(fs.readFileSync(path.join(dir, name))).length).toBeLessThanOrEqual(1024);
    }

    expect(lineNumbers(readAllLogText(dir))).toEqual([...Array(500).keys()]);
  });

  test('keeps exactly `retain` rotated files and the newest lines', async () => {
    const dir = createTempDir();
    const { writer, errors } = createWriter(dir, { rotate: { maxSize: '1K', retain: 3 } });

    for (let index = 0; index < 300; index++) {
      writer.write(line(index));
    }

    await writer.flush();
    await writer.idle();

    expect(errors).toEqual([]);
    expect(archiveNames(dir)).toHaveLength(3);

    const numbers = lineNumbers(readAllLogText(dir));

    expect(numbers[numbers.length - 1]).toBe(299);
    expect(numbers).toEqual([...Array(numbers.length).keys()].map((index) => numbers[0] + index));
  });

  test('keeps rotated files uncompressed when compress is false', async () => {
    const dir = createTempDir();
    const { writer } = createWriter(dir, { rotate: { maxSize: '1K', compress: false, retain: 2 } });

    for (let index = 0; index < 100; index++) {
      writer.write(line(index));
    }

    await writer.flush();
    await writer.idle();

    const archives = archiveNames(dir);

    expect(archives).toHaveLength(2);
    expect(archives.every((name) => name.endsWith('.log'))).toBe(true);
  });

  test('rotates on schedule when the cron minute has passed, only once, and not when empty', async () => {
    const dir = createTempDir();
    let now = new Date(2026, 9, 1, 23, 59, 50).getTime();
    const { writer, notes } = createWriter(dir, { now: () => now, rotate: { rotateInterval: '0 0 * * *' } });

    writer.write(line(1));
    await writer.flush();

    now = new Date(2026, 9, 1, 23, 59, 59).getTime();
    writer.check();
    expect(archiveNames(dir)).toEqual([]);

    now = new Date(2026, 9, 2, 0, 0, 5).getTime();
    writer.check();
    writer.write(line(2));
    await writer.flush();
    await writer.idle();
    await nextTick();

    expect(archiveNames(dir)).toEqual(['bot-2026-10-02_00-00-05.log.gz']);
    expect(notes).toEqual([
      'Rotated bot.log on schedule \'0 0 * * *\'. Earlier lines are in bot-2026-10-02_00-00-05.log.gz.',
    ]);
    expect(lineNumbers(readAllLogText(dir))).toEqual([1, 2]);

    now = new Date(2026, 9, 2, 0, 0, 30).getTime();
    writer.check();
    await writer.idle();

    expect(archiveNames(dir)).toHaveLength(1);

    // Next midnight with an empty active file: nothing to rotate
    const { writer: emptyWriter } = createWriter(createTempDir(), { now: () => now, rotate: { rotateInterval: '0 0 * * *' } });

    now = new Date(2026, 9, 3, 0, 0, 5).getTime();
    emptyWriter.check();
    await emptyWriter.idle();

    expect(archiveNames(emptyWriter.dir)).toEqual([]);
  });

  test('rotates a non-empty file on restart only when rotateOnRestart is set', async () => {
    const dir = createTempDir();
    const activePath = path.join(dir, 'bot.log');

    fs.writeFileSync(activePath, '\n previous run');

    const { writer: appending } = createWriter(dir);

    appending.write('\n second run');
    await appending.close();

    expect(fs.readFileSync(activePath, 'utf8')).toBe('\n previous run\n second run');

    const { writer: rotating, notes } = createWriter(dir, { rotate: { rotateOnRestart: true } });

    rotating.write('\n third run');
    await rotating.flush();
    await rotating.idle();
    await nextTick();

    const archives = archiveNames(dir);

    expect(archives).toHaveLength(1);
    expect(zlib.gunzipSync(fs.readFileSync(path.join(dir, archives[0]))).toString()).toBe('\n previous run\n second run');
    expect(fs.readFileSync(activePath, 'utf8')).toBe('\n third run');
    expect(notes[0]).toMatch(/^Rotated bot\.log on restart\./);
  });

  test('does not rotate an empty file on restart', async () => {
    const dir = createTempDir();

    fs.writeFileSync(path.join(dir, 'bot.log'), '');

    const { writer } = createWriter(dir, { rotate: { rotateOnRestart: true } });

    await writer.idle();

    expect(archiveNames(dir)).toEqual([]);
  });

  test('re-opens the file after logrotate moves it (create mode) without losing lines', async () => {
    const dir = createTempDir();
    const activePath = path.join(dir, 'bot.log');
    const { writer, errors } = createWriter(dir, { rotate: { enabled: false } });

    writer.write(line(1));
    await writer.flush();

    fs.renameSync(activePath, path.join(dir, 'bot.log.1'));
    writer.write(line(2)); // Still goes to the moved file until the next check
    writer.check();
    writer.write(line(3));
    await writer.flush();
    await writer.idle();

    expect(errors).toEqual([]);
    expect(lineNumbers(fs.readFileSync(path.join(dir, 'bot.log.1'), 'utf8'))).toEqual([1, 2]);
    expect(lineNumbers(fs.readFileSync(activePath, 'utf8'))).toEqual([3]);
  });

  test('re-creates the file and the directory after they are deleted', async () => {
    const parent = createTempDir();
    const dir = path.join(parent, 'logs');

    fs.mkdirSync(dir);

    const { writer } = createWriter(dir);

    writer.write(line(1));
    await writer.flush();

    fs.rmSync(dir, { recursive: true, force: true });
    writer.check();
    writer.write(line(2));
    await writer.flush();

    expect(lineNumbers(fs.readFileSync(path.join(dir, 'bot.log'), 'utf8'))).toEqual([2]);
  });

  test('counts external truncation (copytruncate), so it does not rotate early', async () => {
    const dir = createTempDir();
    const activePath = path.join(dir, 'bot.log');
    const { writer } = createWriter(dir, { rotate: { maxSize: '2K' } });

    for (let index = 0; index < 20; index++) {
      writer.write(line(index));
    }

    await writer.flush();
    fs.truncateSync(activePath, 0);
    writer.check();

    for (let index = 20; index < 25; index++) {
      writer.write(line(index));
    }

    await writer.flush();
    await writer.idle();

    expect(archiveNames(dir)).toEqual([]);
    expect(lineNumbers(fs.readFileSync(activePath, 'utf8'))).toEqual([20, 21, 22, 23, 24]);
  });

  test('rotates when other writers pushed the file over maxSize', async () => {
    const dir = createTempDir();
    const activePath = path.join(dir, 'bot.log');
    const { writer } = createWriter(dir, { rotate: { maxSize: '1K' } });

    writer.write(line(1));
    await writer.flush();
    fs.appendFileSync(activePath, 'y'.repeat(2048));
    writer.check();
    await writer.idle();

    expect(archiveNames(dir)).toHaveLength(1);
    expect(fs.statSync(activePath).size).toBe(0);
  });

  test('a follower appends but never rotates, and follows a rotation by the owner', async () => {
    const dir = createTempDir();
    const activePath = path.join(dir, 'bot.log');
    const { writer: owner } = createWriter(dir, { rotate: { maxSize: '1K' } });
    const { writer: follower } = createWriter(dir, { owner: false, rotate: { maxSize: '1K' } });

    for (let index = 0; index < 40; index++) {
      follower.write(line(index));
    }

    expect(archiveNames(dir)).toEqual([]);
    expect(fs.statSync(activePath).size).toBeGreaterThan(1024);

    owner.check();
    await owner.idle();
    follower.write(line(40));

    expect(archiveNames(dir)).toHaveLength(1);
    expect(lineNumbers(fs.readFileSync(activePath, 'utf8'))).toEqual([40]);
  });

  test('a failed rename is reported, retried after a delay, and logging continues', async () => {
    const dir = createTempDir();
    let now = Date.now();
    const { writer, errors } = createWriter(dir, { now: () => now, rotate: { maxSize: '1K' } });
    const failure = Object.assign(new Error('EACCES: permission denied, rename'), { code: 'EACCES' });
    const rename = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw failure;
    });

    for (let index = 0; index < 60; index++) {
      writer.write(line(index));
    }

    await writer.flush();
    await nextTick();

    expect(rename).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([expect.stringMatching(/^Cannot rotate .*bot\.log to .*bot-.*\.log\. EACCES: permission denied, rename$/)]);
    expect(archiveNames(dir)).toEqual([]);

    rename.mockRestore();
    now += ROTATION_RETRY_DELAY_MS;
    writer.write(line(60));
    await writer.flush();
    await writer.idle();

    expect(archiveNames(dir)).toHaveLength(1);
    expect(lineNumbers(readAllLogText(dir))).toEqual([...Array(61).keys()]);
  });

  test('keeps writing into the rotated file when a new file cannot be opened', async () => {
    const dir = createTempDir();
    let now = Date.now();
    const { writer, errors } = createWriter(dir, { now: () => now, rotate: { maxSize: '1K' } });

    for (let index = 0; index < 15; index++) {
      writer.write(line(index));
    }

    const realOpen = fs.openSync;
    const open = jest.spyOn(fs, 'openSync').mockImplementation((...args) => {
      if (String(args[0]).endsWith('bot.log')) {
        throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' });
      }
      return realOpen(...args);
    });

    for (let index = 15; index < 40; index++) {
      writer.write(line(index));
    }

    await writer.flush();
    await nextTick();

    expect(errors).toEqual([expect.stringMatching(/^Cannot open .*bot\.log\. EMFILE/)]);
    expect(fs.existsSync(path.join(dir, 'bot.log'))).toBe(false);

    open.mockRestore();
    now += ROTATION_RETRY_DELAY_MS;
    writer.check();
    writer.write(line(40));
    await writer.flush();
    await writer.idle();

    expect(lineNumbers(readAllLogText(dir))).toEqual([...Array(41).keys()]);
  });

  test('a compression failure keeps the rotated file uncompressed and is reported', async () => {
    const dir = createTempDir();
    const { writer, errors } = createWriter(dir, { rotate: { maxSize: '1K' } });

    jest.spyOn(fs, 'createReadStream').mockImplementation(() => new Readable({
      read() {
        this.destroy(new Error('read failed'));
      },
    }));

    for (let index = 0; index < 30; index++) {
      writer.write(line(index));
    }

    await writer.flush();
    await writer.idle();
    await nextTick();

    const archives = archiveNames(dir);

    expect(archives.length).toBeGreaterThan(0);
    expect(archives.every((name) => name.endsWith('.log'))).toBe(true);
    expect(errors).toEqual([expect.stringMatching(/^Cannot compress .*, keeping it uncompressed\. read failed$/)]);
    expect(fs.readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false);
    expect(lineNumbers(readAllLogText(dir))).toEqual([...Array(30).keys()]);
  });

  test('throttles repeated errors of one kind', async () => {
    const dir = createTempDir();
    let now = Date.now();
    const { writer, errors } = createWriter(dir, { now: () => now, rotate: { maxSize: '1K' } });

    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EROFS'), { code: 'EROFS' });
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      now += ROTATION_RETRY_DELAY_MS;
      writer.write(line(attempt).repeat(30));
    }

    await nextTick();
    expect(errors).toHaveLength(1);

    now += ERROR_REPORT_INTERVAL_MS;
    writer.write(line(99).repeat(30));
    await nextTick();
    expect(errors).toHaveLength(2);
  });

  test('an unwritable log path never throws, even when the error handler throws', async () => {
    const dir = createTempDir();
    const onError = jest.fn(() => {
      throw new Error('handler failed');
    });

    fs.writeFileSync(path.join(dir, 'not-a-directory'), '');

    const writer = createRotatingLogFile({
      filePath: path.join(dir, 'not-a-directory', 'bot.log'),
      settings: normalizeLogRotateConfig({}),
      onError,
    });

    writers.push(writer);

    expect(() => writer.write('\n line')).not.toThrow();
    expect(() => writer.check()).not.toThrow();
    expect(writer.rotate('manual')).toBe('skipped');

    await writer.idle();
    await nextTick();

    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/^Cannot create the logs directory /));
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/^Cannot open .*bot\.log\. /));
  });

  test('startup cleanup prunes old archives and compresses leftovers', async () => {
    const dir = createTempDir();

    ['bot-2026-09-01_00-00-00.log.gz', 'bot-2026-09-02_00-00-00.log.gz', 'bot-2026-09-03_00-00-00.log']
        .forEach((name) => {
          fs.writeFileSync(path.join(dir, name), name.endsWith('.gz') ? zlib.gzipSync(name) : name);
        });

    const { writer } = createWriter(dir, { rotate: { retain: 2 } });

    await writer.idle();

    expect(archiveNames(dir)).toEqual([
      'bot-2026-09-02_00-00-00.log.gz',
      'bot-2026-09-03_00-00-00.log.gz',
    ]);
    expect(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'bot-2026-09-03_00-00-00.log.gz'))).toString())
        .toBe('bot-2026-09-03_00-00-00.log');
  });

  test('with rotation disabled, it never renames, compresses, or deletes', async () => {
    const dir = createTempDir();

    fs.writeFileSync(path.join(dir, 'bot-2026-09-01_00-00-00.log'), 'old');

    const { writer } = createWriter(dir, { rotate: { enabled: false, maxSize: '1K', retain: 1 } });

    for (let index = 0; index < 100; index++) {
      writer.write(line(index));
    }

    writer.check();
    await writer.flush();
    await writer.idle();

    expect(fs.readdirSync(dir).sort()).toEqual(['bot-2026-09-01_00-00-00.log', 'bot.log']);
    expect(lineNumbers(fs.readFileSync(path.join(dir, 'bot.log'), 'utf8'))).toEqual([...Array(100).keys()]);
  });
});

describe('background check timer', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('runs the check on its interval', async () => {
    const dir = createTempDir();
    const { writer } = createWriter(dir, { checkIntervalMs: 1000 });
    const check = jest.spyOn(writer, 'check');

    jest.advanceTimersByTime(3500);

    expect(check).toHaveBeenCalledTimes(3);
  });
});
