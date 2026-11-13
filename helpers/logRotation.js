'use strict';

/**
 * Rotation, retention, and compression for the bot log file.
 *
 * The bot appends to one active file, `logs/bot.log`. A rotation renames it to
 * `bot-YYYY-MM-DD_HH-mm-ss.log` (server local time) and opens a new active file. The
 * previous write stream keeps its file descriptor until it drains, so lines in flight land
 * in the rotated file instead of being lost. Rotated files are gzipped in the background,
 * and only the newest `retain` of them are kept.
 *
 * Only the process that owns the file rotates it. Other writers, such as the CLI instance,
 * append with `fs.appendFileSync()`, so every line goes to the file that is active at that moment.
 *
 * Failures are reported through `onError` and never thrown to the caller: a full disk or a
 * permission problem must not stop trading.
 *
 * @module helpers/logRotation
 */

/**
 * @typedef {import('types/bot/configReader.d.js').BotLogRotateConfig} LogRotateConfig
 */

/**
 * A 5-field cron expression parsed into the values each field allows.
 *
 * @typedef {Object} CronSchedule
 * @property {string} expression Normalized source expression
 * @property {Set<number>[]} fields Allowed values for minute, hour, day of month, month, and day of week (0 is Sunday)
 * @property {boolean} anyDayOfMonth Day-of-month field starts with `*`
 * @property {boolean} anyDayOfWeek Day-of-week field starts with `*`
 */

/**
 * A rotated log file in the logs directory.
 *
 * @typedef {Object} LogArchive
 * @property {string} name File name, e.g. `bot-2026-10-02_00-00-00.log.gz`
 * @property {string} path Path including the logs directory
 * @property {string} id Rotation id shared by the plain and the gzipped copy, e.g. `2026-10-02_00-00-00`
 * @property {boolean} compressed Whether the file is gzipped
 * @property {number} mtimeMs Last modification time
 * @property {number} size Size in bytes
 */

/**
 * A dated log file written by versions before log rotation.
 *
 * @typedef {Object} LegacyLogFile
 * @property {string} name File name, e.g. `2026-07-20.log`
 * @property {string} path Path including the logs directory
 * @property {number} size Size in bytes
 */

/**
 * Options for `createRotatingLogFile()`.
 *
 * @typedef {Object} RotatingLogFileOptions
 * @property {string} filePath Active log file, e.g. `./logs/bot.log`
 * @property {LogRotateConfig} [settings] Normalized `log_rotate` settings. Defaults to `DEFAULT_LOG_ROTATE`.
 * @property {boolean} [owner] Whether this process rotates the file. `false` only appends. Default `true`.
 * @property {(message: string) => void} [onError] Receives failures. Repeats of one kind are throttled.
 * @property {(message: string) => void} [onRotate] Receives a short note after each rotation. It may call
 *   `write()`: the new file is already active, so the note lands at its top.
 * @property {() => number} [now] Clock in Unix ms, for tests
 * @property {number} [checkIntervalMs] Interval of the background check. Default `CHECK_INTERVAL_MS`.
 */

/**
 * An open write stream on the active file.
 *
 * @typedef {Object} OpenedLogFile
 * @property {fs.WriteStream} stream Append stream
 * @property {number} ino Inode of the opened file
 * @property {number} size File size when it was opened
 */

/**
 * Result of a rotation attempt. `failed` means it should be retried later.
 *
 * @typedef {'rotated' | 'skipped' | 'failed'} RotationResult
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

const constants = require('./const');

/** Name of the active bot log file in the logs directory */
const LOG_FILE_NAME = 'bot.log';

/** Dated files written by versions before log rotation, named after the process start date */
const LEGACY_LOG_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.log$/;

/**
 * Defaults for the `log_rotate` config section.
 *
 * @type {Readonly<LogRotateConfig>}
 */
const DEFAULT_LOG_ROTATE = Object.freeze({
  enabled: true,
  maxSize: '300M',
  retain: 5,
  compress: true,
  rotateInterval: '0 0 * * *',
  rotateOnRestart: false,
});

/** How often the owner checks the schedule and the file size, and whether the file was moved or deleted */
const CHECK_INTERVAL_MS = 10 * 1000;

/** A failed rotation is retried after this delay, so a broken filesystem does not cost a rename on every line */
const ROTATION_RETRY_DELAY_MS = constants.MINUTE;

/** Repeated failures of one kind are reported at most this often */
const ERROR_REPORT_INTERVAL_MS = 10 * constants.MINUTE;

/** A compression temp file not modified for this long was left by a crashed process */
const STALE_TEMP_FILE_MS = 10 * constants.MINUTE;

/** After a long pause (sleep, stalled event loop), scheduled minutes are only checked this far back */
const MAX_SCHEDULE_CATCH_UP_MINUTES = 24 * 60;

/** Smallest accepted `maxSize`. Smaller limits would rotate on almost every line. */
const MIN_MAX_SIZE_BYTES = 1024;

const SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*([KMG]?)B?$/i;

/** @type {Record<string, number>} */
const SIZE_MULTIPLIERS = {
  '': 1,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
};

const CRON_FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
];

const CRON_ITEM_PATTERN = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/;

/**
 * @param {unknown} error Caught value
 * @returns {string | undefined} Node.js error code such as `ENOENT`
 */
function errorCode(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
}

/**
 * @param {unknown} error Caught value
 * @returns {string} Error message
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lists a directory. A missing directory has no files: the logs directory may be deleted while
 * the bot runs, and the next write creates it again.
 *
 * @param {string} dir Directory
 * @returns {Promise<string[]>} File names
 */
async function readDirOrEmpty(dir) {
  try {
    return await fs.promises.readdir(dir);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

/**
 * @param {string} value
 * @returns {string} `value` with RegExp special characters escaped
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Formats a byte count for log messages.
 *
 * @param {number} bytes Size in bytes
 * @returns {string} e.g. `512 B`, `1.5 MB`, `8.0 GB`
 */
function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Converts a pm2-logrotate style size to bytes. Units are binary: `1K` is 1024 bytes.
 *
 * @param {unknown} value `300M`, `512K`, `1.5G`, `10MB`, or a byte count. `0`, `false`, and `''` disable size-based rotation.
 * @returns {number} Size in bytes, or `0` when size-based rotation is disabled
 * @throws {Error} When `value` is not a size or is below 1K
 */
function parseSize(value) {
  if (value === false || value === '' || value === 0) {
    return 0;
  }

  let bytes;

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`must be a whole number of bytes, got ${value}`);
    }

    bytes = value;
  } else if (typeof value === 'string') {
    const match = SIZE_PATTERN.exec(value.trim());

    if (!match) {
      throw new Error(`'${value}' is not a size. Use a byte count or a number with K, M, or G, e.g. "300M"`);
    }

    bytes = Math.floor(Number(match[1]) * SIZE_MULTIPLIERS[match[2].toUpperCase()]);

    if (Number(match[1]) === 0) {
      return 0;
    }
  } else {
    throw new Error(`must be a size string such as "300M" or a byte count, got ${JSON.stringify(value)}`);
  }

  if (bytes < MIN_MAX_SIZE_BYTES) {
    throw new Error(`must be at least 1K, got ${JSON.stringify(value)}`);
  }

  return bytes;
}

/**
 * Parses one cron field: `*`, `5`, `1-5`, `*\/15`, `10-50/10`, `5/15`, or a comma-separated list of these.
 *
 * @param {string} source Field text
 * @param {{ name: string, min: number, max: number }} field Field name and range
 * @returns {Set<number>} Allowed values
 * @throws {Error} When the field has invalid syntax or values out of range
 */
function parseCronField(source, field) {
  const values = new Set();

  for (const item of source.split(',')) {
    const match = CRON_ITEM_PATTERN.exec(item);

    if (!match) {
      throw new Error(`${field.name} '${item}' is not valid cron syntax`);
    }

    const step = match[2] === undefined ? 1 : Number(match[2]);
    let from = field.min;
    let to = field.max;

    if (match[1] !== '*') {
      const [start, end] = match[1].split('-').map(Number);

      from = start;
      // `5/15` means every 15th value starting at 5
      to = end ?? (match[2] === undefined ? start : field.max);
    }

    if (step < 1 || from < field.min || to > field.max || from > to) {
      throw new Error(`${field.name} '${item}' is out of range ${field.min}-${field.max}`);
    }

    for (let value = from; value <= to; value += step) {
      values.add(value);
    }
  }

  return values;
}

/**
 * Parses a standard 5-field cron expression: minute, hour, day of month, month, day of week.
 * Supports `*`, numbers, ranges, steps, and lists. Day of week accepts 0-7, where 0 and 7 are Sunday.
 * As in cron, when both day fields are restricted, a day matches if either of them matches.
 *
 * @param {unknown} expression Cron expression, e.g. `0 0 * * *` for every day at midnight
 * @returns {CronSchedule}
 * @throws {Error} When the expression is not a valid 5-field cron expression
 */
function parseCronExpression(expression) {
  if (typeof expression !== 'string' || !expression.trim()) {
    throw new Error(`must be a 5-field cron expression such as "0 0 * * *", got ${JSON.stringify(expression)}`);
  }

  const parts = expression.trim().split(/\s+/);

  if (parts.length !== CRON_FIELDS.length) {
    throw new Error(`'${expression}' must have 5 fields: minute hour day-of-month month day-of-week`);
  }

  let fields;

  try {
    fields = parts.map((part, index) => parseCronField(part, CRON_FIELDS[index]));
  } catch (error) {
    throw new Error(`'${expression}': ${errorMessage(error)}`, { cause: error });
  }

  const daysOfWeek = fields[4];

  if (daysOfWeek.has(7)) {
    daysOfWeek.delete(7);
    daysOfWeek.add(0);
  }

  return {
    expression: parts.join(' '),
    fields,
    anyDayOfMonth: parts[2].startsWith('*'),
    anyDayOfWeek: parts[4].startsWith('*'),
  };
}

/**
 * Checks whether a schedule fires in the minute of `date`, in the server's local time zone.
 *
 * @param {CronSchedule} schedule Parsed schedule
 * @param {Date} date Moment to check. Seconds are ignored.
 * @returns {boolean}
 */
function cronMatches(schedule, date) {
  const [minutes, hours, daysOfMonth, months, daysOfWeek] = schedule.fields;

  if (!minutes.has(date.getMinutes()) || !hours.has(date.getHours()) || !months.has(date.getMonth() + 1)) {
    return false;
  }

  const dayOfMonthMatches = daysOfMonth.has(date.getDate());
  const dayOfWeekMatches = daysOfWeek.has(date.getDay());

  if (schedule.anyDayOfMonth || schedule.anyDayOfWeek) {
    return dayOfMonthMatches && dayOfWeekMatches;
  }

  return dayOfMonthMatches || dayOfWeekMatches;
}

/**
 * Checks whether a schedule fired in any whole minute that started after `fromMs` and not later than `toMs`.
 * Checking a range instead of the current minute keeps a scheduled rotation when timers fire late.
 *
 * @param {CronSchedule} schedule Parsed schedule
 * @param {number} fromMs Time of the previous check, Unix ms
 * @param {number} toMs Time of this check, Unix ms
 * @returns {boolean}
 */
function isScheduleDue(schedule, fromMs, toMs) {
  const lastMinute = Math.floor(toMs / constants.MINUTE);
  const firstMinute = Math.max(
      Math.floor(fromMs / constants.MINUTE) + 1,
      lastMinute - MAX_SCHEDULE_CATCH_UP_MINUTES + 1,
  );

  for (let minute = firstMinute; minute <= lastMinute; minute++) {
    if (cronMatches(schedule, new Date(minute * constants.MINUTE))) {
      return true;
    }
  }

  return false;
}

/**
 * Validates the `log_rotate` config section and fills in defaults for missing fields.
 *
 * @param {unknown} raw Section from the config file. `undefined` returns the defaults.
 * @returns {LogRotateConfig} Settings with every field present. `rotateInterval` is `''` when disabled.
 * @throws {Error} When a field is unknown or invalid. The message names the field, e.g. `log_rotate.retain must be…`.
 */
function normalizeLogRotateConfig(raw) {
  if (raw === undefined) {
    return { ...DEFAULT_LOG_ROTATE };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`log_rotate must be an object, got ${JSON.stringify(raw)}`);
  }

  const supported = Object.keys(DEFAULT_LOG_ROTATE);
  const unknown = Object.keys(raw).filter((key) => !supported.includes(key));

  if (unknown.length) {
    throw new Error(`log_rotate has unknown field(s) ${unknown.join(', ')}. Supported fields: ${supported.join(', ')}`);
  }

  const overrides = /** @type {Partial<LogRotateConfig>} */ (raw);
  /** @type {LogRotateConfig} */
  const settings = {
    ...DEFAULT_LOG_ROTATE,
    ...overrides,
  };

  for (const key of ['enabled', 'compress', 'rotateOnRestart']) {
    if (typeof settings[key] !== 'boolean') {
      throw new Error(`log_rotate.${key} must be true or false, got ${JSON.stringify(settings[key])}`);
    }
  }

  if (!Number.isInteger(settings.retain) || settings.retain < 1) {
    throw new Error(`log_rotate.retain must be a whole number of at least 1, got ${JSON.stringify(settings.retain)}`);
  }

  try {
    if (parseSize(settings.maxSize) === 0) {
      settings.maxSize = 0;
    }
  } catch (error) {
    throw new Error(`log_rotate.maxSize ${errorMessage(error)}`, { cause: error });
  }

  const rotateInterval = /** @type {unknown} */ (settings.rotateInterval);

  if (rotateInterval === false || rotateInterval === '') {
    settings.rotateInterval = '';
  } else {
    try {
      settings.rotateInterval = parseCronExpression(settings.rotateInterval).expression;
    } catch (error) {
      throw new Error(`log_rotate.rotateInterval ${errorMessage(error)}. Use "" to disable scheduled rotation`, { cause: error });
    }
  }

  return settings;
}

/**
 * Builds the name of a rotated file, e.g. `bot.log` → `bot-2026-10-02_00-00-00.log`.
 *
 * @param {string} baseName Active file name
 * @param {Date} date Rotation time, formatted in the server's local time zone
 * @param {number} [index=0] Suffix that keeps names unique when two rotations happen in one second
 * @returns {string} File name without a directory
 */
function formatArchiveName(baseName, date, index = 0) {
  const { name, ext } = path.parse(baseName);
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');

  const stamp =
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
      `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;

  return `${name}-${stamp}${index ? `_${index}` : ''}${ext}`;
}

/**
 * Matches rotated files of `baseName`. Group 1 is the rotation id, group 2 is `.gz` for compressed files.
 *
 * @param {string} [baseName] Active file name
 * @returns {RegExp}
 */
function archivePattern(baseName = LOG_FILE_NAME) {
  const { name, ext } = path.parse(baseName);

  return new RegExp(
      `^${escapeRegExp(name)}-(\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}(?:_\\d+)?)${escapeRegExp(ext)}(\\.gz)?$`,
  );
}

/**
 * Sort key of a rotation id that orders rotations within one second by their suffix,
 * e.g. `2026-10-02_00-00-00_2` after `2026-10-02_00-00-00_1`. Other names are returned as is.
 *
 * @param {string} id Rotation id, or another file name
 * @returns {string}
 */
function rotationSortKey(id) {
  const match = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(?:_(\d+))?$/.exec(id);

  return match ? `${match[1]}_${(match[2] || '0').padStart(6, '0')}` : id;
}

/**
 * Orders rotations newest first by the rotation time in their names, then by the suffix.
 * Names are used rather than modification times, because a burst of rotations can finish
 * its last writes out of order. Like pm2-logrotate, the order follows the server clock.
 *
 * @param {{ id: string }} a
 * @param {{ id: string }} b
 * @returns {number} Negative when `a` is newer
 */
function compareNewestFirst(a, b) {
  const keyA = rotationSortKey(a.id);
  const keyB = rotationSortKey(b.id);

  if (keyA === keyB) {
    return 0;
  }

  return keyA < keyB ? 1 : -1;
}

/**
 * Lists rotated files of `baseName` in `dir`.
 *
 * @param {string} dir Logs directory
 * @param {string} [baseName] Active file name
 * @returns {Promise<LogArchive[]>} Unordered list
 */
async function listArchives(dir, baseName = LOG_FILE_NAME) {
  const pattern = archivePattern(baseName);
  /** @type {LogArchive[]} */
  const archives = [];

  for (const name of await readDirOrEmpty(dir)) {
    const match = pattern.exec(name);

    if (!match) {
      continue;
    }

    const filePath = path.join(dir, name);

    try {
      const stat = await fs.promises.stat(filePath);

      if (stat.isFile()) {
        archives.push({
          name,
          path: filePath,
          id: match[1],
          compressed: Boolean(match[2]),
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        });
      }
    } catch {
      // Removed while listing
    }
  }

  return archives;
}

/**
 * Deletes rotated files beyond the newest `retain` rotations, ordered by `compareNewestFirst()`.
 * A plain and a gzipped copy of one rotation, left by an interrupted compression, count as one rotation.
 *
 * @param {string} dir Logs directory
 * @param {string} baseName Active file name
 * @param {number} retain Number of rotations to keep
 * @returns {Promise<string[]>} Paths of deleted files
 * @throws {Error} The first deletion error, after trying to delete every other expired file
 */
async function pruneArchives(dir, baseName, retain) {
  /** @type {Map<string, { id: string, paths: string[] }>} */
  const rotations = new Map();

  for (const archive of await listArchives(dir, baseName)) {
    const rotation = rotations.get(archive.id) || { id: archive.id, paths: [] };

    rotation.paths.push(archive.path);
    rotations.set(archive.id, rotation);
  }

  const expired = [...rotations.values()]
      .sort(compareNewestFirst)
      .slice(retain);

  /** @type {string[]} */
  const removed = [];
  let firstError;

  for (const filePath of expired.flatMap((rotation) => rotation.paths)) {
    try {
      await fs.promises.unlink(filePath);
      removed.push(filePath);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        firstError ??= error;
      }
    }
  }

  if (firstError) {
    throw firstError;
  }

  return removed;
}

/**
 * Gzips a file as a stream, without loading it into memory, then deletes the original.
 * The result appears atomically: it is written to a temp file and renamed when complete.
 * It keeps the original modification time, so `ls -lt` and `find -mtime` still see when the lines were written.
 *
 * @param {string} filePath File to compress
 * @returns {Promise<string>} Path of the `.gz` file
 * @throws {Error} When compression fails. The original file is kept and the temp file is removed.
 */
async function compressFile(filePath) {
  const target = `${filePath}.gz`;
  const temp = `${target}.${process.pid}.tmp`;

  try {
    const { atime, mtime } = await fs.promises.stat(filePath);

    await pipeline(
        fs.createReadStream(filePath),
        zlib.createGzip(),
        fs.createWriteStream(temp),
    );

    await fs.promises.utimes(temp, atime, mtime);
    await fs.promises.rename(temp, target);
  } catch (error) {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
    throw error;
  }

  await fs.promises.unlink(filePath);

  return target;
}

/**
 * Deletes compression temp files of `baseName` left by a crashed process.
 *
 * @param {string} dir Logs directory
 * @param {string} baseName Active file name
 * @param {number} [now] Current time, Unix ms
 * @returns {Promise<void>}
 */
async function removeStaleTempFiles(dir, baseName, now = Date.now()) {
  const { name } = path.parse(baseName);
  const pattern = new RegExp(`^${escapeRegExp(name)}-.+\\.gz\\.\\d+\\.tmp$`);

  for (const entry of await readDirOrEmpty(dir)) {
    if (!pattern.test(entry)) {
      continue;
    }

    const filePath = path.join(dir, entry);

    try {
      const { mtimeMs } = await fs.promises.stat(filePath);

      if (now - mtimeMs >= STALE_TEMP_FILE_MS) {
        await fs.promises.unlink(filePath);
      }
    } catch {
      // Removed meanwhile
    }
  }
}

/**
 * Finds dated `YYYY-MM-DD.log` files written by versions before log rotation.
 * The bot never rotates or deletes them.
 *
 * @param {string} dir Logs directory
 * @returns {Promise<LegacyLogFile[]>} Files sorted by name, oldest date first
 */
async function findLegacyLogFiles(dir) {
  /** @type {LegacyLogFile[]} */
  const files = [];

  for (const name of await readDirOrEmpty(dir)) {
    if (!LEGACY_LOG_FILE_PATTERN.test(name)) {
      continue;
    }

    const filePath = path.join(dir, name);

    try {
      const stat = await fs.promises.stat(filePath);

      if (stat.isFile()) {
        files.push({ name, path: filePath, size: stat.size });
      }
    } catch {
      // Removed meanwhile
    }
  }

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Append-only log file with optional rotation. See the module description.
 */
class RotatingLogFile {
  /**
   * Opens the active file. As the owner, it first rotates the existing file when
   * `rotateOnRestart` is set, then starts the background check and cleans up old archives.
   *
   * @param {RotatingLogFileOptions} options
   */
  constructor(options) {
    // Resolved once, so background work keeps targeting this file even if the working directory changes
    this.filePath = path.resolve(options.filePath);
    this.dir = path.dirname(this.filePath);
    this.baseName = path.basename(this.filePath);
    this.settings = options.settings || normalizeLogRotateConfig(undefined);
    this.owner = options.owner !== false;
    this.onError = options.onError || (() => {});
    this.onRotate = options.onRotate || (() => {});
    this.now = options.now || Date.now;

    /** Whether this process rotates, compresses, and prunes */
    this.rotationEnabled = this.owner && this.settings.enabled;
    this.maxSizeBytes = this.rotationEnabled ? parseSize(this.settings.maxSize) : 0;
    this.schedule = this.rotationEnabled && this.settings.rotateInterval ?
      parseCronExpression(this.settings.rotateInterval) :
      undefined;

    /** @type {fs.WriteStream | undefined} */
    this.stream = undefined;
    /** @type {number | undefined} */
    this.streamIno = undefined;
    /**
     * Set when a rotation renamed the file but could not open a new one. The stream keeps
     * writing into this rotated file until a new active file can be created.
     *
     * @type {string | undefined}
     */
    this.streamArchivePath = undefined;
    /** Bytes in the active file, including bytes still buffered in the stream */
    this.size = 0;
    this.closed = false;
    this.lastScheduleCheckAt = this.now();
    this.rotationRetryAt = 0;
    /** @type {Map<string, number>} */
    this.lastErrorAt = new Map();
    /** Serialized background work: compression and retention */
    this.maintenance = Promise.resolve();
    /** @type {Set<Promise<void>>} Streams of rotated files that are still draining */
    this.draining = new Set();
    /** @type {Set<string>} Rotated files whose streams are still draining */
    this.drainingPaths = new Set();
    /** @type {string | undefined} Archive name of the last rotation without the suffix */
    this.lastArchiveSecondName = undefined;
    /** Suffix of the last archive name */
    this.lastArchiveIndex = 0;

    this.ensureDir();

    if (!this.owner) {
      return;
    }

    if (this.rotationEnabled && this.settings.rotateOnRestart) {
      this.rotateOnStart();
    }

    this.setStream(this.openActiveFile());

    if (this.rotationEnabled) {
      this.enqueue(() => this.maintainArchives());
    }

    this.timer = setInterval(() => this.check(), options.checkIntervalMs ?? CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  /**
   * Appends text to the active file. As the owner, rotates first when the text would push
   * the file over `maxSize`. Never throws.
   *
   * @param {string} text Text to append, including line breaks
   */
  write(text) {
    if (!this.owner || this.closed) {
      this.appendDirect(text);
      return;
    }

    try {
      const bytes = Buffer.byteLength(text);

      if (this.maxSizeBytes && this.size > 0 && this.size + bytes > this.maxSizeBytes) {
        this.rotate('size', bytes);
      }

      if (this.stream?.destroyed) {
        // Failed on an earlier write. Its `error` event may not have arrived yet.
        this.detachStream();
      }

      if (!this.stream) {
        this.setStream(this.openActiveFile());
      }

      if (this.stream) {
        this.stream.write(text);
        this.size += bytes;
      }
    } catch (error) {
      this.reportError('write', `Cannot write to ${this.filePath}`, error);
    }
  }

  /**
   * Renames the active file to a timestamped archive and continues in a new active file.
   * The previous stream drains into the archive, which is then compressed and pruned.
   *
   * @param {'size' | 'schedule' | 'manual'} reason What triggered the rotation, for the rotation note
   * @param {number} [incomingBytes=0] Size of the line about to be written. With `size`, rotation is skipped
   *   when the refreshed file size plus this line still fits, e.g. after an external truncation.
   * @returns {RotationResult}
   */
  rotate(reason, incomingBytes = 0) {
    if (!this.owner || this.closed) {
      return 'skipped';
    }

    const now = this.now();

    if (now < this.rotationRetryAt) {
      return 'failed';
    }

    this.syncWithDisk();

    if (this.streamArchivePath) {
      // Still writing into a renamed file because a new one could not be created
      return 'failed';
    }

    if (this.size === 0 || (reason === 'size' && this.size + incomingBytes <= this.maxSizeBytes)) {
      return 'skipped';
    }

    const archivePath = this.nextArchivePath(new Date(now));

    try {
      fs.renameSync(this.filePath, archivePath);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        // Moved away after the check above. The next write opens a new file.
        return 'skipped';
      }

      this.rotationRetryAt = now + ROTATION_RETRY_DELAY_MS;
      this.reportError('rotate', `Cannot rotate ${this.filePath} to ${archivePath}`, error);
      return 'failed';
    }

    const previous = this.stream;
    const opened = this.openActiveFile();

    if (!opened && previous) {
      // Keep appending to the renamed file so that no line is lost. A later check retries.
      this.streamArchivePath = archivePath;
      this.rotationRetryAt = now + ROTATION_RETRY_DELAY_MS;
      return 'failed';
    }

    this.setStream(opened);
    this.retire(previous, archivePath);
    this.announceRotation(reason, archivePath);

    return 'rotated';
  }

  /**
   * One background check: re-opens the file if it was moved or deleted, refreshes the size,
   * and rotates when the schedule fired or other writers pushed the file over `maxSize`.
   */
  check() {
    if (this.closed) {
      return;
    }

    try {
      this.syncWithDisk();

      if (!this.rotationEnabled) {
        return;
      }

      const now = this.now();

      if (this.schedule && isScheduleDue(this.schedule, this.lastScheduleCheckAt, now)) {
        // Keep the due minute in range after a failure, so the rotation is retried
        if (this.rotate('schedule') !== 'failed') {
          this.lastScheduleCheckAt = now;
        }

        return;
      }

      this.lastScheduleCheckAt = now;

      if (this.maxSizeBytes && this.size > this.maxSizeBytes) {
        this.rotate('size');
      }
    } catch (error) {
      this.reportError('check', `Log rotation check of ${this.filePath} failed`, error);
    }
  }

  /**
   * Resolves when everything written so far reached the active file.
   *
   * @returns {Promise<void>}
   */
  flush() {
    const stream = this.stream;

    if (!stream || stream.destroyed) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      stream.write('', () => resolve());
    });
  }

  /**
   * Resolves when rotated files finished draining and compression and retention are done.
   *
   * @returns {Promise<void>}
   */
  async idle() {
    for (;;) {
      const maintenance = this.maintenance;

      await Promise.all([...this.draining, maintenance]);

      if (maintenance === this.maintenance && this.draining.size === 0) {
        return;
      }
    }
  }

  /**
   * Stops the background check, closes the stream, and waits for pending maintenance.
   * Later writes are appended directly.
   *
   * @returns {Promise<void>}
   */
  async close() {
    if (!this.closed) {
      this.closed = true;
      clearInterval(this.timer);
      this.detachStream();
    }

    await this.idle();
  }

  /**
   * Re-opens the active file when the file at its path is not the one this process writes to:
   * it was moved or deleted (for example by the system logrotate), or a rotation is waiting for
   * a new file. Otherwise refreshes the size, so bytes appended by other writers count and an
   * external truncation resets it.
   */
  syncWithDisk() {
    let stat;

    try {
      stat = fs.statSync(this.filePath);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        this.reportError('stat', `Cannot check ${this.filePath}`, error);
        return;
      }
    }

    if (this.stream && !this.streamArchivePath && stat?.ino === this.streamIno) {
      this.size = stat.size + this.stream.writableLength;
      return;
    }

    if (!this.stream && !stat) {
      // Nothing to re-open. The next write creates the file.
      return;
    }

    const opened = this.openActiveFile();

    if (!opened) {
      return;
    }

    const previous = this.stream;
    const archivePath = this.streamArchivePath;

    this.setStream(opened);
    this.retire(previous, archivePath);
  }

  /**
   * Opens the active file for appending. Recreates the logs directory if it was deleted.
   *
   * @returns {OpenedLogFile | undefined} `undefined` when the file cannot be opened (reported)
   */
  openActiveFile() {
    let fd;

    try {
      try {
        fd = fs.openSync(this.filePath, 'a');
      } catch (error) {
        if (errorCode(error) !== 'ENOENT' || !this.ensureDir()) {
          throw error;
        }

        fd = fs.openSync(this.filePath, 'a');
      }

      const { ino, size } = fs.fstatSync(fd);
      const stream = fs.createWriteStream(this.filePath, { fd });

      // A stream without an `error` listener crashes the process on ENOSPC or EIO
      stream.on('error', (error) => this.handleStreamError(stream, error));

      return { stream, ino, size };
    } catch (error) {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // Already closed
        }
      }

      this.reportError('open', `Cannot open ${this.filePath}`, error);
      return undefined;
    }
  }

  /**
   * @param {OpenedLogFile | undefined} opened New active stream, or `undefined` to drop the current one
   */
  setStream(opened) {
    this.stream = opened?.stream;
    this.streamIno = opened?.ino;
    this.size = opened?.size ?? 0;
    this.streamArchivePath = undefined;
  }

  /**
   * Ends a stream that no longer writes to the active file. When it wrote into a rotated file,
   * compresses and prunes once the stream has closed, so its last lines are not lost.
   *
   * @param {fs.WriteStream | undefined} stream Previous stream
   * @param {string | undefined} archivePath Rotated file the stream writes into, if this process rotated it
   */
  retire(stream, archivePath) {
    if (!stream || stream.closed) {
      if (archivePath) {
        this.finalizeArchive(archivePath);
      }

      return;
    }

    if (archivePath) {
      this.drainingPaths.add(archivePath);
    }

    const drained = new Promise((resolve) => {
      stream.once('close', () => {
        if (archivePath) {
          this.drainingPaths.delete(archivePath);
          this.finalizeArchive(archivePath);
        }

        resolve();
      });
    });

    this.draining.add(drained);
    drained.then(() => this.draining.delete(drained));

    if (!stream.destroyed) {
      stream.end();
    }
  }

  /**
   * Queues compression of a rotated file and retention.
   *
   * @param {string} archivePath Rotated file that no stream writes to anymore
   */
  finalizeArchive(archivePath) {
    this.enqueue(async () => {
      if (this.settings.compress) {
        await this.compress(archivePath);
      }

      await this.prune();
    });
  }

  /**
   * Startup cleanup: removes temp files of interrupted compressions, applies retention, and
   * compresses rotated files left uncompressed by a crash or by `compress: false` before.
   *
   * @returns {Promise<void>}
   */
  async maintainArchives() {
    try {
      await removeStaleTempFiles(this.dir, this.baseName, this.now());
    } catch (error) {
      this.reportError('cleanup', `Cannot clean up temp files in ${this.dir}`, error);
    }

    await this.prune();

    if (!this.settings.compress) {
      return;
    }

    let archives;

    try {
      archives = await listArchives(this.dir, this.baseName);
    } catch (error) {
      this.reportError('cleanup', `Cannot list rotated files in ${this.dir}`, error);
      return;
    }

    for (const archive of archives) {
      if (!archive.compressed && !this.drainingPaths.has(archive.path) && archive.path !== this.streamArchivePath) {
        await this.compress(archive.path);
      }
    }
  }

  /**
   * @param {string} archivePath Rotated file to gzip
   * @returns {Promise<void>}
   */
  async compress(archivePath) {
    try {
      await compressFile(archivePath);
    } catch (error) {
      // ENOENT: retention already deleted it after a burst of rotations
      if (errorCode(error) !== 'ENOENT') {
        this.reportError('compress', `Cannot compress ${archivePath}, keeping it uncompressed`, error);
      }
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async prune() {
    try {
      await pruneArchives(this.dir, this.baseName, this.settings.retain);
    } catch (error) {
      this.reportError('retain', `Cannot delete old rotated files in ${this.dir}`, error);
    }
  }

  /**
   * Rotates a non-empty active file left by the previous run (`rotateOnRestart`).
   */
  rotateOnStart() {
    let stat;

    try {
      stat = fs.statSync(this.filePath);
    } catch {
      return;
    }

    if (!stat.isFile() || stat.size === 0) {
      return;
    }

    const archivePath = this.nextArchivePath(new Date(this.now()));

    try {
      fs.renameSync(this.filePath, archivePath);
    } catch (error) {
      this.reportError('rotate', `Cannot rotate ${this.filePath} to ${archivePath} on restart`, error);
      return;
    }

    this.finalizeArchive(archivePath);
    this.announceRotation('restart', archivePath);
  }

  /**
   * Picks a free archive name. Within one second the suffix only grows, even after retention
   * deleted an earlier archive of that second, so a newer rotation never sorts as an older one.
   *
   * @param {Date} date Rotation time
   * @returns {string} Archive path that is not taken yet, in plain or gzipped form
   */
  nextArchivePath(date) {
    const secondName = formatArchiveName(this.baseName, date);
    let index = secondName === this.lastArchiveSecondName ? this.lastArchiveIndex + 1 : 0;

    for (; ; index++) {
      const candidate = path.join(this.dir, formatArchiveName(this.baseName, date, index));

      if (!fs.existsSync(candidate) && !fs.existsSync(`${candidate}.gz`)) {
        this.lastArchiveSecondName = secondName;
        this.lastArchiveIndex = index;
        return candidate;
      }
    }
  }

  /**
   * Sends the rotation note. After a rotation at runtime it is sent right away, so it becomes the
   * first line of the new file, before the line that triggered the rotation. A rotation on restart
   * happens while the logger is still being created, so that note is sent on the next tick.
   *
   * @param {'size' | 'schedule' | 'manual' | 'restart'} reason What triggered the rotation
   * @param {string} archivePath Rotated file
   */
  announceRotation(reason, archivePath) {
    const trigger = {
      size: `at the ${this.settings.maxSize} size limit`,
      schedule: `on schedule '${this.settings.rotateInterval}'`,
      manual: 'on request',
      restart: 'on restart',
    }[reason];
    const archiveName = `${path.basename(archivePath)}${this.settings.compress ? '.gz' : ''}`;
    const message = `Rotated ${this.baseName} ${trigger}. Earlier lines are in ${archiveName}.`;

    const send = () => {
      try {
        this.onRotate(message);
      } catch {
        // A rotation note must not break logging
      }
    };

    if (reason === 'restart') {
      process.nextTick(send);
    } else {
      send();
    }
  }

  /**
   * Appends with a synchronous open-write-close, so the line always goes to the file that is
   * currently at the path, even right after another process rotated it.
   *
   * @param {string} text Text to append
   */
  appendDirect(text) {
    try {
      fs.appendFileSync(this.filePath, text);
    } catch (error) {
      if (errorCode(error) === 'ENOENT' && this.ensureDir()) {
        try {
          fs.appendFileSync(this.filePath, text);
          return;
        } catch (retryError) {
          this.reportError('append', `Cannot append to ${this.filePath}`, retryError);
          return;
        }
      }

      this.reportError('append', `Cannot append to ${this.filePath}`, error);
    }
  }

  /**
   * @returns {boolean} `true` when the logs directory exists or was created
   */
  ensureDir() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      return true;
    } catch (error) {
      this.reportError('mkdir', `Cannot create the logs directory ${this.dir}`, error);
      return false;
    }
  }

  /**
   * Drops a failed stream so the next write opens a new one, then reports the failure.
   * Lines buffered in the failed stream are lost.
   *
   * @param {fs.WriteStream} stream Stream that emitted `error`
   * @param {Error} error Stream error
   */
  handleStreamError(stream, error) {
    if (stream === this.stream) {
      this.detachStream();
    }

    this.reportError('write', `Cannot write to ${this.filePath}`, error);
  }

  /**
   * Stops using the current stream. Its rotated file, if any, is finalized after it closes.
   */
  detachStream() {
    const stream = this.stream;
    const archivePath = this.streamArchivePath;

    this.setStream(undefined);
    this.retire(stream, archivePath);
  }

  /**
   * Reports a failure through `onError`, at most once per `ERROR_REPORT_INTERVAL_MS` for each kind.
   * Delivered on the next tick: the handler usually logs the failure, and that write must not
   * run inside the write or the constructor that failed.
   *
   * @param {string} kind Failure kind used for throttling, e.g. `rotate`
   * @param {string} message What failed
   * @param {unknown} error Cause
   */
  reportError(kind, message, error) {
    const now = this.now();
    const lastReportedAt = this.lastErrorAt.get(kind);

    if (lastReportedAt !== undefined && now - lastReportedAt < ERROR_REPORT_INTERVAL_MS) {
      return;
    }

    this.lastErrorAt.set(kind, now);

    const details = errorMessage(error);

    process.nextTick(() => {
      try {
        this.onError(`${message}. ${details}`);
      } catch {
        // Reporting must never throw into logging
      }
    });
  }

  /**
   * @param {() => Promise<void>} task Background task
   */
  enqueue(task) {
    this.maintenance = this.maintenance
        .then(task)
        .catch((error) => this.reportError('maintenance', `Log maintenance of ${this.filePath} failed`, error));
  }
}

/**
 * Creates the log file writer. See `RotatingLogFile`.
 *
 * @param {RotatingLogFileOptions} options
 * @returns {RotatingLogFile}
 */
function createRotatingLogFile(options) {
  return new RotatingLogFile(options);
}

module.exports = {
  LOG_FILE_NAME,
  LEGACY_LOG_FILE_PATTERN,
  DEFAULT_LOG_ROTATE,
  CHECK_INTERVAL_MS,
  ERROR_REPORT_INTERVAL_MS,
  ROTATION_RETRY_DELAY_MS,
  errorCode,
  formatBytes,
  parseSize,
  parseCronExpression,
  cronMatches,
  isScheduleDue,
  normalizeLogRotateConfig,
  formatArchiveName,
  archivePattern,
  compareNewestFirst,
  listArchives,
  pruneArchives,
  compressFile,
  removeStaleTempFiles,
  findLegacyLogFiles,
  RotatingLogFile,
  createRotatingLogFile,
};
