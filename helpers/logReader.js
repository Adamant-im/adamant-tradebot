'use strict';

/**
 * Reads recent lines from the bot log files without loading whole files into memory.
 *
 * Files are read newest first: the active `bot.log`, then rotated files (`.log` or `.log.gz`),
 * then dated files written by versions before log rotation. Plain files are read backwards in
 * chunks, so only their tail is touched. Gzipped files are decompressed as a stream, keeping
 * only the last matching lines.
 *
 * Used by `mm logs` and the WebUI log export. Has no side effects on load.
 *
 * @module helpers/logReader
 */

/**
 * A bot log file in the logs directory.
 *
 * @typedef {Object} LogFileEntry
 * @property {string} name File name
 * @property {string} path Path including the logs directory
 * @property {'active' | 'archive' | 'legacy'} kind Active file, rotated file, or dated file from an older version
 * @property {string} id Rotation id of a rotated file, e.g. `2026-10-02_00-00-00`, or the name without `.gz`
 * @property {boolean} compressed Whether the file is gzipped
 * @property {number} size Size on disk in bytes
 * @property {number} mtimeMs Last modification time
 */

/**
 * How `readRecentLogLines()` treats a line:
 * - `keep` returns the line
 * - `skip` leaves it out
 * - `keep-and-stop` returns it and ends the scan, e.g. the start of the current bot session
 * - `stop` leaves it out and ends the scan, e.g. the first line older than `--since`
 *
 * @typedef {'keep' | 'skip' | 'keep-and-stop' | 'stop'} LogLineClass
 */

/**
 * Options for `readRecentLogLines()`.
 *
 * @typedef {Object} RecentLogLinesOptions
 * @property {number} limit Maximum number of lines to return, the most recent ones
 * @property {(line: string) => LogLineClass} [classify] Decides which lines to return. Default keeps every line.
 * @property {number} [maxBytes] Uncompressed bytes to scan at most. Default `DEFAULT_MAX_SCAN_BYTES`.
 * @property {number} [chunkSize] Read size for plain files, for tests
 */

/**
 * Result of `readRecentLogLines()`.
 *
 * @typedef {Object} RecentLogLines
 * @property {string[]} lines Matching lines in file order, oldest first
 * @property {boolean} truncated `true` when the scan stopped at `maxBytes` or at an unreadable file
 *   before the limit or a stop line was reached
 */

/**
 * Result of scanning one file.
 *
 * @typedef {Object} FileScan
 * @property {string[]} lines Matching lines, oldest first
 * @property {boolean} stopped A `stop` or `keep-and-stop` line was found, so older files are not needed
 * @property {boolean} truncated The scan budget ran out or the file could not be read completely
 */

/**
 * Follow position in one file.
 *
 * @typedef {Object} FollowedFile
 * @property {number} fd Open file descriptor
 * @property {number} ino Inode of the file
 * @property {number} position Next byte to read
 * @property {StringDecoder} decoder Keeps multibyte characters split between reads intact
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { StringDecoder } = require('string_decoder');

const {
  LOG_FILE_NAME,
  LEGACY_LOG_FILE_PATTERN,
  archivePattern,
  compareNewestFirst,
  errorCode,
} = require('./logRotation');

/** Uncompressed bytes one read may scan. Covers a few full rotated files of the default 300M size. */
const DEFAULT_MAX_SCAN_BYTES = 1024 ** 3;

/** Read size for plain files */
const READ_CHUNK_BYTES = 64 * 1024;

/** Poll interval of `followLogFile()` */
const FOLLOW_POLL_INTERVAL_MS = 500;

/** Most bytes `followLogFile()` reads at once */
const FOLLOW_READ_CHUNK_BYTES = 1024 * 1024;

const NEWLINE = 0x0a;

/** @type {Record<LogFileEntry['kind'], number>} */
const KIND_ORDER = {
  active: 0,
  archive: 1,
  legacy: 2,
};

/**
 * Keeps the last `capacity` lines pushed to it.
 */
class LineRing {
  /**
   * @param {number} capacity Maximum number of lines
   */
  constructor(capacity) {
    this.capacity = capacity;
    /** @type {string[]} */
    this.items = [];
    this.start = 0;
  }

  /**
   * @param {string} line Line to add. Evicts the oldest line when full.
   */
  push(line) {
    if (this.capacity <= 0) {
      return;
    }

    if (this.items.length < this.capacity) {
      this.items.push(line);
      return;
    }

    this.items[this.start] = line;
    this.start = (this.start + 1) % this.capacity;
  }

  clear() {
    this.items = [];
    this.start = 0;
  }

  /**
   * @returns {string[]} Lines in the order they were pushed
   */
  toArray() {
    return [...this.items.slice(this.start), ...this.items.slice(0, this.start)];
  }
}

/**
 * Lists bot log files in `dir`, newest first: the active file, rotated files by rotation time
 * (see `compareNewestFirst()`), then dated files of older versions by date.
 * When an interrupted compression left both `x.log` and `x.log.gz`, only `x.log` is listed.
 *
 * @param {string} dir Logs directory
 * @param {string} [baseName] Active file name
 * @returns {LogFileEntry[]} Empty when the directory does not exist
 */
function listLogFiles(dir, baseName = LOG_FILE_NAME) {
  let names;

  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const archive = archivePattern(baseName);
  const nameSet = new Set(names);
  /** @type {LogFileEntry[]} */
  const entries = [];

  for (const name of names) {
    const plainName = name.replace(/\.gz$/, '');
    const archiveMatch = archive.exec(name);
    /** @type {LogFileEntry['kind'] | undefined} */
    let kind;

    if (name === baseName) {
      kind = 'active';
    } else if (archiveMatch) {
      kind = 'archive';
    } else if (LEGACY_LOG_FILE_PATTERN.test(plainName)) {
      kind = 'legacy';
    }

    if (!kind || (name !== plainName && nameSet.has(plainName))) {
      continue;
    }

    const filePath = path.join(dir, name);

    try {
      const stat = fs.statSync(filePath);

      if (stat.isFile()) {
        entries.push({
          name,
          path: filePath,
          kind,
          id: archiveMatch ? archiveMatch[1] : plainName,
          compressed: name !== plainName,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    } catch {
      // Rotated or deleted while listing
    }
  }

  return entries.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compareNewestFirst(a, b));
}

/**
 * Returns the file `mm logs -f` should follow: the active file, or else the newest plain file.
 *
 * @param {string} dir Logs directory
 * @returns {string | undefined} Path, or `undefined` when there is no plain log file
 */
function findCurrentLogFile(dir) {
  return listLogFiles(dir).find((file) => !file.compressed)?.path;
}

/**
 * Reads the most recent matching lines across log files.
 *
 * @param {LogFileEntry[]} files Files to scan, newest first, as returned by `listLogFiles()`
 * @param {RecentLogLinesOptions} options
 * @returns {Promise<RecentLogLines>}
 */
async function readRecentLogLines(files, options) {
  const limit = Math.max(0, Math.floor(options.limit));
  const classify = options.classify || (() => 'keep');
  const chunkSize = options.chunkSize ?? READ_CHUNK_BYTES;
  const budget = { remaining: options.maxBytes ?? DEFAULT_MAX_SCAN_BYTES };

  /** @type {string[][]} Newest file first */
  const parts = [];
  let collected = 0;
  let truncated = false;

  for (const file of files) {
    if (collected >= limit) {
      break;
    }

    let scan;

    try {
      scan = file.compressed ?
        await scanGzipFile(file.path, limit - collected, classify, budget) :
        await scanPlainFileBackward(file.path, limit - collected, classify, budget, chunkSize);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        // Pruned between listing and reading
        continue;
      }

      // A corrupt or unreadable file: older files would leave a gap, so stop here
      truncated = true;
      break;
    }

    parts.push(scan.lines);
    collected += scan.lines.length;

    if (scan.truncated) {
      truncated = true;
      break;
    }

    if (scan.stopped) {
      break;
    }
  }

  return {
    lines: parts.reverse().flat(),
    truncated,
  };
}

/**
 * Scans a plain file from the end, splitting lines at newline bytes so multibyte characters stay intact.
 *
 * @param {string} filePath File to read
 * @param {number} limit Lines still needed
 * @param {(line: string) => LogLineClass} classify Line filter
 * @param {{ remaining: number }} budget Shared scan budget, decreased by the bytes read
 * @param {number} chunkSize Bytes per read
 * @returns {Promise<FileScan>}
 */
async function scanPlainFileBackward(filePath, limit, classify, budget, chunkSize) {
  /** @type {string[]} Newest first */
  const lines = [];
  const handle = await fs.promises.open(filePath, 'r');

  /**
   * @param {Buffer} bytes One line without the newline
   * @returns {boolean} `true` to end the scan
   */
  const visit = (bytes) => {
    const line = bytes.toString('utf8');
    const kind = classify(line);

    if (kind === 'stop') {
      return true;
    }

    if (kind === 'keep' || kind === 'keep-and-stop') {
      lines.push(line);
    }

    return kind === 'keep-and-stop' || lines.length >= limit;
  };

  const result = (/** @type {boolean} */ stopped, /** @type {boolean} */ truncated) => ({
    lines: lines.reverse(),
    stopped,
    truncated,
  });

  try {
    const { size } = await handle.stat();
    let position = size;
    // Start of the line that continues into the chunk read before
    let carry = Buffer.alloc(0);

    while (position > 0) {
      if (budget.remaining <= 0) {
        return result(true, true);
      }

      const length = Math.min(chunkSize, position);
      const chunk = Buffer.alloc(length);

      position -= length;

      const { bytesRead } = await handle.read(chunk, 0, length, position);

      if (bytesRead !== length) {
        // Truncated while reading
        return result(true, true);
      }

      budget.remaining -= length;

      const data = carry.length ? Buffer.concat([chunk, carry]) : chunk;
      let end = data.length;
      let index = end > 0 ? data.lastIndexOf(NEWLINE, end - 1) : -1;

      while (index >= 0) {
        if (visit(data.subarray(index + 1, end))) {
          return result(true, false);
        }

        end = index;
        index = end > 0 ? data.lastIndexOf(NEWLINE, end - 1) : -1;
      }

      carry = Buffer.from(data.subarray(0, end));
    }

    // First line of the file
    return result(visit(carry), false);
  } finally {
    await handle.close();
  }
}

/**
 * Reads the uncompressed size stored in a gzip trailer. It is modulo 4 GiB, so it is only a hint.
 *
 * @param {string} filePath Gzip file
 * @returns {Promise<number | undefined>}
 */
async function readGzipDeclaredSize(filePath) {
  let handle;

  try {
    handle = await fs.promises.open(filePath, 'r');

    const { size } = await handle.stat();

    if (size < 20) {
      return undefined;
    }

    const trailer = Buffer.alloc(4);

    await handle.read(trailer, 0, 4, size - 4);
    return trailer.readUInt32LE(0);
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

/**
 * Scans a gzipped file from the start, because gzip cannot be read backwards, keeping the last
 * `limit` matching lines. When the budget runs out inside the file, its lines are dropped:
 * returning lines from the middle of a file would leave a gap before the newer files.
 *
 * @param {string} filePath Gzip file
 * @param {number} limit Lines still needed
 * @param {(line: string) => LogLineClass} classify Line filter
 * @param {{ remaining: number }} budget Shared scan budget, decreased by the uncompressed bytes read
 * @returns {Promise<FileScan>}
 */
async function scanGzipFile(filePath, limit, classify, budget) {
  const declaredSize = await readGzipDeclaredSize(filePath);

  if (declaredSize !== undefined && declaredSize > budget.remaining) {
    return { lines: [], stopped: true, truncated: true };
  }

  const ring = new LineRing(limit);
  const decoder = new StringDecoder('utf8');
  const source = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  let stopped = false;
  let scanned = 0;
  let pending = '';

  /**
   * @param {string} line One line
   */
  const visit = (line) => {
    const kind = classify(line);

    if (kind === 'stop') {
      // This line and everything before it are out of range
      ring.clear();
      stopped = true;
    } else if (kind === 'keep-and-stop') {
      ring.clear();
      ring.push(line);
      stopped = true;
    } else if (kind === 'keep') {
      ring.push(line);
    }
  };

  source.on('error', (error) => gunzip.destroy(error));
  source.pipe(gunzip);

  try {
    for await (const chunk of gunzip) {
      scanned += chunk.length;

      if (scanned > budget.remaining) {
        return { lines: [], stopped: true, truncated: true };
      }

      const parts = (pending + decoder.write(chunk)).split('\n');

      pending = parts.pop();
      parts.forEach(visit);
    }

    visit(pending + decoder.end());
  } finally {
    source.destroy();
    gunzip.destroy();
  }

  budget.remaining -= scanned;

  return {
    lines: ring.toArray(),
    stopped,
    truncated: false,
  };
}

/**
 * Opens a file for following.
 *
 * @param {string} filePath File to follow
 * @param {boolean} fromStart Read from the start (a new file) or only bytes appended later
 * @returns {FollowedFile | undefined} `undefined` when the file does not exist
 */
function openFollowedFile(filePath, fromStart) {
  let fd;

  try {
    fd = fs.openSync(filePath, 'r');

    const { ino, size } = fs.fstatSync(fd);

    return {
      fd,
      ino,
      position: fromStart ? 0 : size,
      decoder: new StringDecoder('utf8'),
    };
  } catch {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }

    return undefined;
  }
}

/**
 * @param {FollowedFile | undefined} file
 */
function closeFollowedFile(file) {
  if (!file) {
    return;
  }

  try {
    fs.closeSync(file.fd);
  } catch {
    // Already closed
  }
}

/**
 * Follows a log file like `tail -F`. Reports lines appended after the call. When the path is
 * rotated or recreated, finishes reading the previous file, then continues with the new file
 * from its start. An in-place truncation restarts reading from the beginning.
 *
 * @param {string} filePath File to follow
 * @param {(line: string) => void} onLine Called for each new line, including empty ones
 * @param {{ intervalMs?: number }} [options] Poll interval, default `FOLLOW_POLL_INTERVAL_MS`
 * @returns {{ poll: () => void, stop: () => void }} `poll()` reads now; `stop()` ends following
 */
function followLogFile(filePath, onLine, options = {}) {
  let current = openFollowedFile(filePath, false);
  /** @type {FollowedFile | undefined} Rotated file, read once more on the next poll to catch its last writes */
  let previous;

  /**
   * @param {FollowedFile} file
   */
  const readAppended = (file) => {
    const { size } = fs.fstatSync(file.fd);

    if (size < file.position) {
      file.position = 0;
    }

    while (file.position < size) {
      const length = Math.min(FOLLOW_READ_CHUNK_BYTES, size - file.position);
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(file.fd, buffer, 0, length, file.position);

      if (bytesRead <= 0) {
        break;
      }

      file.position += bytesRead;
      file.decoder.write(buffer.subarray(0, bytesRead)).split('\n').forEach((line) => onLine(line));
    }
  };

  const poll = () => {
    try {
      if (previous) {
        readAppended(previous);
        closeFollowedFile(previous);
        previous = undefined;
      }

      if (!current) {
        current = openFollowedFile(filePath, true);
      }

      if (!current) {
        return;
      }

      readAppended(current);

      let stat;

      try {
        stat = fs.statSync(filePath);
      } catch {
        // Rotated away; the new file appears shortly
        return;
      }

      if (stat.ino !== current.ino) {
        previous = current;
        current = openFollowedFile(filePath, true);

        if (current) {
          readAppended(current);
        }
      }
    } catch {
      // Keep following; a transient read error must not end `mm logs -f`
    }
  };

  const timer = setInterval(poll, options.intervalMs ?? FOLLOW_POLL_INTERVAL_MS);

  return {
    poll,
    stop() {
      clearInterval(timer);
      closeFollowedFile(previous);
      closeFollowedFile(current);
      previous = undefined;
      current = undefined;
    },
  };
}

module.exports = {
  DEFAULT_MAX_SCAN_BYTES,
  listLogFiles,
  findCurrentLogFile,
  readRecentLogLines,
  followLogFile,
};
