'use strict';

/* global describe, test, expect, afterEach */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const {
  findCurrentLogFile,
  followLogFile,
  listLogFiles,
  readRecentLogLines,
} = require('../../helpers/logReader');

/** @type {string[]} */
const tempDirs = [];
/** @type {Array<{ stop: () => void }>} */
const followers = [];

/**
 * @returns {string} New temp logs directory, removed after the test
 */
function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tradebot-log-reader-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * @param {number} from First line number
 * @param {number} to Last line number, inclusive
 * @returns {string} Lines in the bot format: a newline before each line
 */
function lines(from, to) {
  let text = '';
  for (let index = from; index <= to; index++) {
    text += `\n info|2026-10-02 12:00:00|line ${index}`;
  }
  return text;
}

/**
 * @param {string[]} result Lines returned by the reader
 * @returns {number[]} Line numbers
 */
function numbers(result) {
  return result
      .map((text) => /line (\d+)/.exec(text))
      .filter(Boolean)
      .map((match) => Number(match[1]));
}

/**
 * Writes the usual set of files: an old legacy file, two rotated files (plain and gzipped), and the active file.
 *
 * @param {string} dir Logs directory
 */
function writeRotatedSet(dir) {
  fs.writeFileSync(path.join(dir, '2026-07-20.log'), lines(0, 9));
  fs.writeFileSync(path.join(dir, 'bot-2026-10-01_00-00-00.log.gz'), zlib.gzipSync(lines(10, 19)));
  fs.writeFileSync(path.join(dir, 'bot-2026-10-02_00-00-00.log'), lines(20, 29));
  fs.writeFileSync(path.join(dir, 'bot.log'), lines(30, 34));
}

afterEach(() => {
  for (const follower of followers.splice(0)) {
    follower.stop();
  }

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('listLogFiles', () => {
  test('lists the active file, rotated files newest first, then old dated files', () => {
    const dir = createTempDir();

    writeRotatedSet(dir);
    fs.writeFileSync(path.join(dir, '2026-08-01.log'), lines(0, 1));
    fs.writeFileSync(path.join(dir, 'bot-2026-10-02_00-00-00_1.log.gz'), zlib.gzipSync(''));
    fs.writeFileSync(path.join(dir, 'bot-2026-10-02_00-00-00.log.gz.123.tmp'), '');
    fs.writeFileSync(path.join(dir, 'heartbeat'), '1');
    fs.writeFileSync(path.join(dir, 'cli_history'), '');
    fs.writeFileSync(path.join(dir, 'npm-debug.log'), '');

    // Modification times do not change the order
    const old = new Date(2020, 0, 1);
    fs.utimesSync(path.join(dir, 'bot-2026-10-02_00-00-00_1.log.gz'), old, old);

    expect(listLogFiles(dir).map((file) => [file.name, file.kind, file.compressed])).toEqual([
      ['bot.log', 'active', false],
      ['bot-2026-10-02_00-00-00_1.log.gz', 'archive', true],
      ['bot-2026-10-02_00-00-00.log', 'archive', false],
      ['bot-2026-10-01_00-00-00.log.gz', 'archive', true],
      ['2026-08-01.log', 'legacy', false],
      ['2026-07-20.log', 'legacy', false],
    ]);
  });

  test('lists one copy when an interrupted compression left both', () => {
    const dir = createTempDir();

    fs.writeFileSync(path.join(dir, 'bot-2026-10-02_00-00-00.log'), lines(0, 1));
    fs.writeFileSync(path.join(dir, 'bot-2026-10-02_00-00-00.log.gz'), zlib.gzipSync(lines(0, 1)));

    expect(listLogFiles(dir).map((file) => file.name)).toEqual(['bot-2026-10-02_00-00-00.log']);
  });

  test('returns nothing for a missing directory', () => {
    expect(listLogFiles(path.join(createTempDir(), 'missing'))).toEqual([]);
    expect(findCurrentLogFile(path.join(createTempDir(), 'missing'))).toBeUndefined();
  });

  test('follows the active file, or else the newest plain file', () => {
    const dir = createTempDir();

    fs.writeFileSync(path.join(dir, '2026-07-20.log'), '');
    fs.writeFileSync(path.join(dir, 'bot-2026-10-01_00-00-00.log.gz'), zlib.gzipSync(''));

    expect(findCurrentLogFile(dir)).toBe(path.join(dir, '2026-07-20.log'));

    fs.writeFileSync(path.join(dir, 'bot.log'), '');

    expect(findCurrentLogFile(dir)).toBe(path.join(dir, 'bot.log'));
  });
});

describe('readRecentLogLines', () => {
  test('returns the most recent lines across the active, rotated, gzipped, and old files', async () => {
    const dir = createTempDir();

    writeRotatedSet(dir);

    const recent = await readRecentLogLines(listLogFiles(dir), { limit: 22 });

    expect(recent.truncated).toBe(false);
    // 22 lines: each file starts with an empty line, because every line is written as `\n line`
    expect(recent.lines).toHaveLength(22);
    expect(numbers(recent.lines)).toEqual([...Array(20).keys()].map((index) => index + 15));

    const all = await readRecentLogLines(listLogFiles(dir), { limit: 1000 });

    expect(numbers(all.lines)).toEqual([...Array(35).keys()]);
  });

  test('keeps multibyte characters intact across chunk borders', async () => {
    const dir = createTempDir();
    const text = ['\n info|a|Ünïcödé €uro 🚀 line 0', '\n info|b|日本語 line 1', '\n info|c|plain line 2'].join('');

    fs.writeFileSync(path.join(dir, 'bot.log'), text);

    for (const chunkSize of [1, 2, 3, 5, 7, 64]) {
      const { lines: result } = await readRecentLogLines(listLogFiles(dir), { limit: 10, chunkSize });

      expect(result.join('\n')).toBe(text);
    }
  });

  test('stops at a keep-and-stop line, also inside a gzipped file', async () => {
    const dir = createTempDir();
    const marker = '[The bot started] ____';

    fs.writeFileSync(path.join(dir, 'bot-2026-10-01_00-00-00.log.gz'), zlib.gzipSync(`${lines(0, 4)}\n${marker}${lines(5, 7)}`));
    fs.writeFileSync(path.join(dir, 'bot.log'), lines(8, 9));

    const classify = (/** @type {string} */ text) => (text.includes(marker) ? 'keep-and-stop' : 'keep');
    const { lines: result } = await readRecentLogLines(listLogFiles(dir), { limit: 100, classify });

    expect(result[0]).toBe(marker);
    expect(numbers(result)).toEqual([5, 6, 7, 8, 9]);

    fs.writeFileSync(path.join(dir, 'bot.log'), `${lines(8, 9)}\n${marker}${lines(10, 11)}`);

    const { lines: plain } = await readRecentLogLines(listLogFiles(dir), { limit: 100, classify });

    expect(plain[0]).toBe(marker);
    expect(numbers(plain)).toEqual([10, 11]);
  });

  test('a stop line ends the scan before older files', async () => {
    const dir = createTempDir();

    writeRotatedSet(dir);

    const classify = (/** @type {string} */ text) => {
      const match = /line (\d+)/.exec(text);
      if (match && Number(match[1]) < 14) {
        return 'stop';
      }
      return text ? 'keep' : 'skip';
    };

    const { lines: result } = await readRecentLogLines(listLogFiles(dir), { limit: 100, classify });

    expect(numbers(result)).toEqual([...Array(21).keys()].map((index) => index + 14));
  });

  test('filters lines and fills the limit from older files', async () => {
    const dir = createTempDir();

    writeRotatedSet(dir);

    const { lines: result } = await readRecentLogLines(listLogFiles(dir), {
      limit: 4,
      classify: (text) => (/line \d*5\b/.test(text) ? 'keep' : 'skip'),
    });

    expect(numbers(result)).toEqual([5, 15, 25]);
  });

  test('stops at the scan budget without leaving a gap', async () => {
    const dir = createTempDir();

    writeRotatedSet(dir);

    const activeSize = fs.statSync(path.join(dir, 'bot.log')).size;
    const plainSize = fs.statSync(path.join(dir, 'bot-2026-10-02_00-00-00.log')).size;

    // Enough for the active and the plain rotated file, not for the gzipped one
    const recent = await readRecentLogLines(listLogFiles(dir), { limit: 100, maxBytes: activeSize + plainSize + 10 });

    expect(recent.truncated).toBe(true);
    expect(numbers(recent.lines)).toEqual([...Array(15).keys()].map((index) => index + 20));
  });

  test('stops at a corrupt gzipped file and keeps the newer lines', async () => {
    const dir = createTempDir();

    writeRotatedSet(dir);
    fs.writeFileSync(path.join(dir, 'bot-2026-10-01_00-00-00.log.gz'), Buffer.from('not gzip at all, not gzip at all'));

    const recent = await readRecentLogLines(listLogFiles(dir), { limit: 100 });

    expect(recent.truncated).toBe(true);
    expect(numbers(recent.lines)).toEqual([...Array(15).keys()].map((index) => index + 20));
  });

  test('skips a file deleted after listing', async () => {
    const dir = createTempDir();

    writeRotatedSet(dir);

    const files = listLogFiles(dir);

    fs.unlinkSync(path.join(dir, 'bot-2026-10-02_00-00-00.log'));

    const recent = await readRecentLogLines(files, { limit: 100 });

    expect(recent.truncated).toBe(false);
    expect(numbers(recent.lines)).toEqual([...Array(10).keys(), ...[...Array(10).keys()].map((index) => index + 10), 30, 31, 32, 33, 34]);
  });

  test('returns nothing for limit 0', async () => {
    const dir = createTempDir();

    writeRotatedSet(dir);

    expect(await readRecentLogLines(listLogFiles(dir), { limit: 0 })).toEqual({ lines: [], truncated: false });
  });
});

describe('followLogFile', () => {
  test('reports appended lines and continues after a rotation', () => {
    const dir = createTempDir();
    const activePath = path.join(dir, 'bot.log');
    /** @type {string[]} */
    const seen = [];

    fs.writeFileSync(activePath, lines(0, 1));

    const follower = followLogFile(activePath, (text) => seen.push(text), { intervalMs: 60 * 60 * 1000 });

    followers.push(follower);

    fs.appendFileSync(activePath, lines(2, 3));
    follower.poll();

    expect(numbers(seen)).toEqual([2, 3]);

    // Rotation: the old file gets one more line from the previous stream after the rename
    fs.renameSync(activePath, path.join(dir, 'bot-2026-10-02_00-00-00.log'));
    fs.appendFileSync(path.join(dir, 'bot-2026-10-02_00-00-00.log'), lines(4, 4));
    fs.writeFileSync(activePath, lines(5, 6));
    follower.poll();
    fs.appendFileSync(activePath, lines(7, 7));
    follower.poll();

    expect(numbers(seen)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  test('re-reads from the start after an in-place truncation', () => {
    const dir = createTempDir();
    const activePath = path.join(dir, 'bot.log');
    /** @type {string[]} */
    const seen = [];

    fs.writeFileSync(activePath, lines(0, 5));

    const follower = followLogFile(activePath, (text) => seen.push(text), { intervalMs: 60 * 60 * 1000 });

    followers.push(follower);
    fs.truncateSync(activePath, 0);
    fs.appendFileSync(activePath, lines(6, 6));
    follower.poll();

    expect(numbers(seen)).toEqual([6]);
  });

  test('waits for a file that does not exist yet', () => {
    const dir = createTempDir();
    const activePath = path.join(dir, 'bot.log');
    /** @type {string[]} */
    const seen = [];

    const follower = followLogFile(activePath, (text) => seen.push(text), { intervalMs: 60 * 60 * 1000 });

    followers.push(follower);
    follower.poll();
    fs.writeFileSync(activePath, lines(0, 1));
    follower.poll();

    expect(numbers(seen)).toEqual([0, 1]);
  });
});
