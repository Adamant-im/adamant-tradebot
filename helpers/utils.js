'use strict';

/**
 * Shared utility helpers used across the trade bot: config I/O, formatting,
 * numeric parsing, order-book analytics, balance diffs, and CLI param validation.
 *
 * @module helpers/utils
 */

/**
 * @typedef {import('types/bot/utils.d.js').RandomValueFunction} RandomValueFunction
 * @typedef {import('types/bot/utils.d.js').RandomDeviationFunction} RandomDeviationFunction
 * @typedef {import('types/bot/utils.d.js').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/utils.d.js').VerificationTypes} VerificationTypes
 * @typedef {import('types/bot/utils.d.js').ParsedPositiveSmartNumber} ParsedPositiveSmartNumber
 * @typedef {import('types/bot/utils.d.js').ParsedSmartTime} ParsedSmartTime
 * @typedef {import('types/bot/utils.d.js').ParamVerifyResult} ParamVerifyResult
 * @typedef {import('types/bot/utils.d.js').AssetsResultItem} AssetsResultItem
 * @typedef {import('types/bot/utils.d.js').AssetsResult} AssetsResult
 * @typedef {import('types/bot/utils.d.js').DepthItem} DepthItem
 * @typedef {import('types/bot/utils.d.js').DepthResult} DepthResult
 * @typedef {import('types/bot/utils.d.js').LiquidityMap} LiquidityMap
 * @typedef {import('types/bot/utils.d.js').LiquidityLevel} LiquidityLevel
 * @typedef {import('types/bot/utils.d.js').LiquidityKey} LiquidityKey
 * @typedef {import('types/bot/utils.d.js').SideTargetPrice} SideTargetPrice
 * @typedef {import('types/bot/utils.d.js').OrderBookInfo} OrderBookInfo
 * @typedef {import('types/bot/utils.d.js').QuoteHunterBookSideRow} QuoteHunterBookSideRow
 * @typedef {import('types/bot/utils.d.js').QuoteHunterMatchSummary} QuoteHunterMatchSummary
 * @typedef {import('types/bot/utils.d.js').VwapMetrics} VwapMetrics
 * @typedef {import('types/bot/utils.d.js').DebugDecimals} DebugDecimals
 * @typedef {import('types/bot/utils.d.js').HistoryTradesInfo} HistoryTradesInfo
 * @typedef {import('types/bot/utils.d.js').ParsePercentResult} ParsePercentResult
 * @typedef {import('types/bot/utils.d.js').ParseRangeOrValueResult} ParseRangeOrValueResult
 * @typedef {import('types/bot/utils.d.js').BalanceDifferenceItem} BalanceDifferenceItem
 * @typedef {import('types/bot/utils.d.js').BalanceSnapshotWithTimestamp} BalanceSnapshotWithTimestamp
 * @typedef {import('types/bot/utils.d.js').BalanceHelperResult} BalanceHelperResult
 * @typedef {import('types/bot/utils.d.js').OrderOutOfSpreadInfo} OrderOutOfSpreadInfo
 * @typedef {import('types/bot/utils.d.js').CalculateOrderStatsResult} CalculateOrderStatsResult
 * @typedef {import('types/bot/utils.d.js').ParsedCommandParams} ParsedCommandParams
 */

const config = require('../modules/configReader');
const log = require('./log');
let tradeParams = require('../trade/settings/tradeParams_' + config.exchange);
const fs = require('fs');
const constants = require('./const');
const { emitter, events } = require('../modules/eventEmitter');
const equal = require('fast-deep-equal');
const { diff } = require('deep-object-diff');
const { createRequire } = require('module');
const path = require('path');
const { fileURLToPath } = require('url');

/** Stack frames from `helpers/utils.js` itself (skip when detecting `softRequire` caller). */
const SOFT_REQUIRE_SELF = /[/\\]helpers[/\\]utils\.js$/;

/** Memoized `softRequire` results keyed by resolved base + module path, or package name */
const softRequireCache = new Map();

/** No-op Telegram API client when `telegramBot/api.js` is omitted from the build. */
const noopTelegramBot = {
  sendMessage() {
    return Promise.resolve();
  },
};

/**
 * Escapes Telegram MarkdownV2 special characters when the real formatter is unavailable.
 *
 * @param {string} str
 * @returns {string}
 */
function noopEscapeMarkdownTelegram(str) {
  return String(str).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * @param {string} stackFrame
 * @returns {string | undefined}
 */
function parseStackFrameFile(stackFrame) {
  const match = stackFrame.match(/\((.+?):\d+:\d+\)$/) ||
    stackFrame.match(/at (?:async )?(.+?):\d+:\d+$/);

  if (!match) return undefined;

  let file = match[1];

  if (file.startsWith('file://')) {
    file = fileURLToPath(file);
  }

  return file;
}

/**
 * First stack frame outside `helpers/utils.js` — the direct caller of `softRequire()`.
 *
 * @returns {string | undefined} Absolute path to the caller source file
 */
function getSoftRequireCallerFile() {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 16;

  const { stack } = new Error();
  Error.stackTraceLimit = limit;

  if (!stack) return undefined;

  for (const line of stack.split('\n').slice(1)) {
    const file = parseStackFrameFile(line);

    if (!file || SOFT_REQUIRE_SELF.test(file) || file.startsWith('node:')) continue;

    return file;
  }

  return undefined;
}

/**
 * Debug decimal places for amount, quote, and price log formatting.
 * Override with `setDebugDecimals()`.
 *
 * @type {DebugDecimals}
 */
const debugDecimals = {
  ad: 2, // Amount decimal places
  qd: 8, // Quote decimal places
  pd: 8, // Price decimal places
};

module.exports = {
  get moduleName() {
    return this.getModuleName(/** @type {NodeJS.Module} */ (module).id);
  },

  /**
   * Sets debug decimal places for amount, quote, and price log formatting.
   *
   * @param {number} [amountDecimals] Amount decimal places; defaults to `coin1Decimals`
   * @param {number} [quoteDecimals] Quote decimal places; defaults to `coin2DecimalsForStable`
   * @param {number} [priceDecimals] Price decimal places; defaults to `coin2Decimals`
   */
  setDebugDecimals(amountDecimals, quoteDecimals, priceDecimals) {
    const orderUtils = require('../trade/orderUtils');
    const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(config.defaultPair));
    const { coin1Decimals, coin2Decimals, coin2DecimalsForStable } = formattedPair;

    debugDecimals.ad = amountDecimals || coin1Decimals;
    debugDecimals.qd = quoteDecimals || coin2DecimalsForStable;
    debugDecimals.pd = priceDecimals || coin2Decimals;
  },

  /**
   * Reads the trade config file and transforms it into a JSON-readable string.
   *
   * @returns {string} Config body suitable for `JSON.parse()`
   */
  readTradeConfig() {
    const tradeConfig = fs.readFileSync(config.fileWithPath).toString()
        .replace(/\n/g, '').replace('module.exports = ', '').replace(/'/g, '"').replace(';', '').replace(',}', '}');
    return tradeConfig;
  },

  /**
   * Watches `tradeParams_EXCHANGE` for external updates.
   *
   * The file may be changed by the CLI or manually by an admin.
   */
  watchConfig() {
    log.log(`Watching external changes in the trade config file: ${config.fileWithPath}…`);

    fs.watch(config.fileWithPath, () => {
      let newConfigString;

      try {
        newConfigString = this.readTradeConfig();
        const newConfig = JSON.parse(newConfigString);

        if (!equal(tradeParams, newConfig)) {
          log.log(`Trade config updated externally: ${JSON.stringify(diff(tradeParams, newConfig))}.`);
          tradeParams = Object.assign(tradeParams, newConfig);
        }
      } catch (error) {
        if (newConfigString !== undefined) {
          log.warn(`Trade config was updated externally, but it is not valid JSON: '${newConfigString}'. Leaving the in-memory config unchanged.`);
        } else {
          log.warn(`Trade config watcher failed to read ${config.fileWithPath}: ${error}`);
        }
      }
    });
  },

  /**
   * Saves the in-memory trade config to disk when it differs from the file.
   *
   * @param {boolean} [isWebApi=false] Whether the change originated from the Web UI
   * @param {string} [callerName] Caller identifier for logs
   */
  saveConfig(isWebApi = false, callerName) {
    try {
      const oldConfigString = this.readTradeConfig();
      const oldConfig = JSON.parse(oldConfigString);

      if (!equal(tradeParams, oldConfig)) {
        const toSave = 'module.exports = ' + JSON.stringify(tradeParams, null, 2).replace(/"/g, '\'').replace(/\n\}/g, ',\n};\n');
        fs.writeFileSync(config.fileWithPath, toSave);

        const callerInfo = callerName ? ` by ${callerName}` : '';
        log.log(`Trade config ${config.file} updated${callerInfo} and saved: ${JSON.stringify(diff(oldConfig, tradeParams))}`);

        if (!isWebApi) {
          emitter.emit(events['parameters:update']);
        }
      }
    } catch (error) {
      log.warn(`Failed to save trade config ${config.fileWithPath}: ${error}`);
    }
  },

  /**
   * Returns an object with all properties formatted as a string for logging.
   *
   * @param {*} object Value to inspect
   * @returns {string} Colored `util.inspect()` output
   */
  getFullObjectString(object) {
    const util = require('util');
    return util.inspect(object, { showHidden: false, depth: null, colors: true });
  },

  /**
   * Converts a value to a string and truncates it for logging.
   *
   * @param {*} data Value to log
   * @param {number} [length] Maximum output length
   * @param {boolean} [multiLineObjects=true] Whether to use `getFullObjectString()` for objects
   * @returns {string}
   */
  getLogString(data, length, multiLineObjects = true) {
    if (this.isObject(data) && multiLineObjects) {
      data = this.getFullObjectString(data);
    } else {
      data = JSON.stringify(data);
    }

    if (data?.length > length) {
      data = data.slice(0, length-1) + '…';
    }

    return data;
  },

  /**
   * Returns current time in milliseconds since Unix Epoch
   * The Unix epoch is 00:00:00 UTC on 1 January 1970 (an arbitrary date)
   * @return {number}
   */
  unixTimeStampMs() {
    return new Date().getTime();
  },

  /**
   * Converts provided `time` (ms) to ADAMANT's epoch timestamp (sec)
   * @param {number} time Timestamp to convert
   * @return {number}
   */
  epochTime(time) {
    if (!time) {
      time = Date.now(); // current time in milliseconds since Unix Epoch
    }
    return Math.floor((time - constants.EPOCH) / 1000);
  },

  /**
   * Pads a value with leading zeros until it is two digits wide.
   *
   * @example padTo2Digits(2) // '02'
   * @param {number} num Value to pad
   * @returns {string}
   */
  padTo2Digits(num) {
    return num.toString().padStart(2, '0');
  },

  /**
   * Converts a local `Date` to `yyyy-mm-dd hh:mm:ss` format.
   *
   * @param {Date} date Date to format
   * @returns {string}
   */
  formatDate(date) {
    return (
      [
        date.getFullYear(),
        this.padTo2Digits(date.getMonth() + 1),
        this.padTo2Digits(date.getDate()),
      ].join('-') +
      ' ' +
      [
        this.padTo2Digits(date.getHours()),
        this.padTo2Digits(date.getMinutes()),
        this.padTo2Digits(date.getSeconds()),
      ].join(':')
    );
  },

  /**
   * Formats a trade timestamp for logs.
   *
   * @param {number} timestamp Trade timestamp in milliseconds
   * @returns {string} Local clock time in `HH:mm:ss` format, e.g. `14:05:09`
   */
  formatTradeLogTime(timestamp) {
    const tradeDate = new Date(timestamp);
    const hours = `${tradeDate.getHours()}`.padStart(2, '0');
    const minutes = `${tradeDate.getMinutes()}`.padStart(2, '0');
    const seconds = `${tradeDate.getSeconds()}`.padStart(2, '0');

    return `${hours}:${minutes}:${seconds}`;
  },

  /**
   * Formats diagnostic quote values by truncating to the market quote precision.
   *
   * Truncation keeps logs aligned with exchange ticks and avoids rounding a narrow
   * corridor into a visually wider one.
   *
   * @param {number} value Value to format
   * @param {number} decimals Decimal places to keep
   * @returns {string} Truncated fixed-point string, e.g. `1.2345`
   */
  formatDiagnosticQuoteValue(value, decimals) {
    if (!Number.isFinite(value)) {
      return String(value);
    }

    const safeDecimals = Math.max(0, Number.isFinite(decimals) ? Math.trunc(decimals) : 0);
    if (safeDecimals === 0) {
      return `${Math.trunc(value)}`;
    }

    const sign = value < 0 ? '-' : '';
    let absoluteString = Math.abs(value).toString();

    if (absoluteString.includes('e')) {
      absoluteString = Math.abs(value).toFixed(safeDecimals + 20);
    }

    const [intPart, fractionalPartValue = ''] = absoluteString.split('.');
    let fractionalPart = fractionalPartValue;
    fractionalPart = fractionalPart.padEnd(safeDecimals, '0').slice(0, safeDecimals);

    return `${sign}${intPart}.${fractionalPart}`;
  },

  /**
   * Shifts a Unix timestamp (ms) into another time zone while preserving local clock time.
   *
   * @param {number} ms Timestamp to convert
   * @param {string} timeZone IANA time zone name
   * @returns {number} Adjusted timestamp in milliseconds
   */
  formatUnixtimeTimeZone(ms, timeZone) {
    const now = new Date();
    const elsewhere = new Date(now.toLocaleString('en-US', { timeZone }));
    const here = new Date(now.toLocaleString());

    const offset = (+here) - (+elsewhere);

    return ms + offset;
  },

  /**
   * Converts ADAMANT's epoch timestamp (sec) to a Unix timestamp (ms)
   * The Unix epoch is 00:00:00 UTC on 1 January 1970 (an arbitrary date)
   * @param {number} epochTime Timestamp to convert
   * @return {number}
   */
  toTimestamp(epochTime) {
    return epochTime * 1000 + constants.EPOCH;
  },

  /**
   * Converts ADAMANT satoshis to an ADM amount.
   *
   * @param {number|string} sats Satoshis to convert
   * @param {number} [decimals=8] Decimal places to keep
   * @returns {number|undefined} Value in ADM, or `undefined` on failure
   */
  satsToADM(sats, decimals = 8) {
    try {
      const admString = (+sats / constants.SAT).toFixed(decimals);

      return +admString;
    } catch (e) {
      log.error(`Error in satsToADM() of ${this.moduleName} module: ${e}`);
    }
  },

  /**
   * Converts an ADM amount to satoshis.
   *
   * @param {number|string} adm ADM amount to convert
   * @returns {number|undefined} Value in satoshis, or `undefined` on failure
   */
  AdmToSats(adm) {
    try {
      const satsString = (+adm * constants.SAT).toFixed(0);

      return +satsString;
    } catch (e) {
      log.error(`Error in AdmToSats() of ${this.moduleName} module: ${e}`);
    }
  },

  /**
   * Checks whether the given value is a valid ADM address.
   * @param {any} address Value to validate as ADM address (may be any type)
   * @return {boolean}
   */
  isAdmAddress(address) {
    return typeof address === 'string' && constants.REGEXP_ADM_ADDRESS.test(address);
  },

  /**
   * Rounds a value to the nearest multiple of `precision`.
   *
   * @example
   * roundUp(6, 10)   // 10
   * roundUp(30, 10)  // 30
   * roundUp(31, 10)  // 30
   * roundUp(36, 10)  // 40
   * roundUp(561, 100) // 600
   * roundUp(66, 5)   // 65
   *
   * @param {number} value Value to round
   * @param {number} precision Step size, e.g. `5`, `10`, or `100`
   * @returns {number} Rounded value, or the original value when rounding does not apply
   */
  roundUp(value, precision) {
    if (!this.isNumber(value) || !this.isInteger(precision) || precision < 1 || value < precision) return value;
    return Math.round(value / precision) * precision;
  },

  /**
   * Returns a random integer in the inclusive range `[min, max]`.
   *
   * @param {number} min Inclusive minimum
   * @param {number} max Inclusive maximum
   * @returns {number}
   */
  getRandomIntInclusive(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1) + min);
  },

  /**
   * Returns a random number in the inclusive range `[low, high]`.
   *
   * Shared typedef lives in `types/bot/general.d.js` so runtime wrappers can
   * reuse the exact same callable signature when they swap out the RNG source.
   *
   * @type {RandomValueFunction}
   */
  randomValue(low, high, doRound = false) {
    let random = Math.random() * (high - low) + low;

    if (doRound) {
      random = Math.round(random);
    }

    return random;
  },

  /**
   * Returns a random floating-point number inside a bounded range.
   *
   * Unlike `randomValue()`, this helper accepts an injectable RNG so services can
   * keep deterministic tests without reimplementing the range math locally.
   *
   * @param {number} min Inclusive lower edge
   * @param {number} max Inclusive upper edge
   * @param {() => number} [random=Math.random] Random generator returning a value in the `[0, 1)` range
   * @returns {number} Randomized value, or `min` when bounds are unusable
   */
  randomInRange(min, max, random = Math.random) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      return min;
    }

    const randomValue = typeof random === 'function' ? random() : Math.random();
    const boundedRandomValue = this.clampNumber(randomValue, 0, 1);

    return min + (boundedRandomValue * (max - min));
  },

  /**
   * Returns a random number around `number` within ±`deviation` percent.
   *
   * Shared typedef lives in `types/bot/general.d.js` so runtime wrappers can
   * reuse the exact same callable signature when they bind this helper to a
   * deterministic random source for tests.
   *
   * @type {RandomDeviationFunction}
   */
  randomDeviation(number, deviation, doRound = false) {
    const min = number - number * deviation;
    const max = number + number * deviation;

    return this.randomValue(min, max, doRound);
  },

  /**
   * Checks whether a string contains a valid numeric value.
   *
   * @param {string} str String value to check
   * @returns {boolean}
   */
  isNumeric(str) {
    if (typeof str !== 'string') return false;

    return !isNaN(+str) && !isNaN(parseFloat(str));
  },

  /**
   * Checks whether a value is a safe integer.
   *
   * @param {*} value Value to validate
   * @returns {boolean}
   */
  isInteger(value) {
    return Number.isSafeInteger(value);
  },

  /**
   * Checks whether a number is an integer greater than or equal to 1.
   *
   * @param {number} value Number to validate
   * @returns {boolean}
   */
  isPositiveInteger(value) {
    if (!this.isInteger(value) || value < 1) {
      return false;
    } else {
      return true;
    }
  },

  /**
   * Checks whether a number is an integer greater than or equal to 0.
   *
   * @param {number} value Number to validate
   * @returns {boolean}
   */
  isPositiveOrZeroInteger(value) {
    if (!this.isInteger(value) || value < 0) {
      return false;
    } else {
      return true;
    }
  },

  /**
   * Checks whether a value is a finite number.
   *
   * @param {number} value Number to validate
   * @returns {boolean}
   */
  isNumber(value) {
    if (typeof (value) !== 'number' || isNaN(value) || !Number.isFinite(value)) {
      return false;
    } else {
      return true;
    }
  },

  /**
   * Checks whether a number is finite and greater than or equal to 0.
   *
   * @param {number} value Number to validate
   * @returns {boolean}
   */
  isPositiveOrZeroNumber(value) {
    if (!this.isNumber(value) || value < 0) {
      return false;
    } else {
      return true;
    }
  },

  /**
   * Checks whether a number is finite and greater than 0.
   *
   * @param {number} value Number to validate
   * @returns {boolean}
   */
  isPositiveNumber(value) {
    if (!this.isNumber(value) || value <= 0) {
      return false;
    } else {
      return true;
    }
  },

  /**
   * Parses a positive number, including shorthand forms such as `500k`, `10.3m`, or `5b`.
   *
   * @param {number|string} value Number to parse
   * @returns {ParsedPositiveSmartNumber}
   *
   * @example
   * '100'   -> { isNumber: true, fancyNumberString: '100', number: 100 }
   * '500K'  -> { isNumber: true, fancyNumberString: '500k', number: 500_000 }
   * 'abc'   -> { isNumber: false }
   * '-100'  -> { isNumber: false }
   */
  parsePositiveSmartNumber(value) {
    if (
      !value ||
      (typeof value !== 'string' && typeof value !== 'number')
    ) {
      return {
        isNumber: false,
      };
    }

    value = value.toString()?.toLowerCase();

    const multiplierDigit = value.slice(-1);
    let number;

    if (['k', 'm', 'b'].includes(multiplierDigit)) {
      number = +value.slice(0, -1);

      if (!this.isPositiveNumber(number)) {
        return {
          isNumber: false,
        };
      }

      let multiplier;
      switch (multiplierDigit) {
        case 'k':
          multiplier = 1_000;
          break;
        case 'm':
          multiplier = 1_000_000;
          break;
        case 'b':
          multiplier = 1_000_000_000;
          break;
        default:
          break;
      }

      number *= multiplier;

      return {
        isNumber: true,
        fancyNumberString: value,
        number,
      };
    } else {
      number = +value;

      if (!this.isPositiveNumber(number)) {
        return {
          isNumber: false,
        };
      }

      return {
        isNumber: true,
        fancyNumberString: value,
        number,
      };
    }
  },

  /**
   * Checks whether a given string is a valid standalone time unit
   * (e.g., "s", "secs", "hour", "months", "yr").
   *
   * @param {string} value Any input string to test
   * @returns {boolean} True if the string represents only a valid time unit; false otherwise
   *
   * @example
   * isTimeUnitString("s");        // true
   * isTimeUnitString("secs");     // true
   * isTimeUnitString("10s");      // false
   * isTimeUnitString("hui");      // false
   * isTimeUnitString("5 min");    // false
   */
  isTimeUnitString(value) {
    const REGEXP_TIME_ONLY = new RegExp(
        `^${constants.REGEXP_TIME.source}$`,
        constants.REGEXP_TIME.flags,
    );

    return REGEXP_TIME_ONLY.test(String(value).trim());
  },

  /**
   * Converts a time value with unit into milliseconds.
   *
   * Supports:
   * ms, msec, msecs, millisecond(s)
   * s, sec, secs, second(s)
   * m, min, mins, minute(s)
   * h, hr, hrs, hour(s)
   * d, day(s)
   * w, week(s)
   * mon, month(s) (≈30.44 days)
   * y, yr, yrs, year(s) (≈365.25 days)
   *
   * @param {number} num The numeric value of the time
   * @param {string} unit The unit of the time (case-insensitive)
   * @returns {number | NaN} Time in milliseconds
   *
   * @example
   * getTimeInMs(5, 's');     // 5000
   * getTimeInMs(2, 'hours'); // 7200000
   * getTimeInMs(1, 'mon');   // 2629800000
   */
  getTimeInMs(num, unit) {
    const normalized = constants.TIME_UNITS[unit?.toLowerCase()];
    if (!normalized) return NaN;

    return num * constants.TIME_DIVISORS[normalized];
  },

  /**
   * Parses a time value such as `5sec`, `5 secs`, or `5 min`.
   *
   * @param {string|*} value Time string to parse
   * @returns {ParsedSmartTime}
   */
  parseSmartTime(value) {
    value = String(value);

    // Regular expression to match the number and time unit
    const regexSmartTime = new RegExp(
        `^\\s*(\\d+)\\s*${constants.REGEXP_TIME.source}\\s*$`,
        'i',
    );

    const match = value.match(regexSmartTime);

    if (!match) {
      return { isTime: false };
    }

    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    // Convert all units to milliseconds
    const msecs = this.getTimeInMs(num, unit);

    // Convert milliseconds to other units

    return {
      isTime: true,
      ...Object.fromEntries(
          Object.entries(constants.TIME_DIVISORS).map(([key, div]) => [key, msecs / div]),
      ),
    };
  },

  /**
   * Parses a bracketed enum list from a string.
   *
   * @example parseEnumArray('[Stepup, Stepdown]') // ['Stepup', 'Stepdown']
   * @param {string} str String to parse
   * @returns {string[]}
   */
  parseEnumArray(str) {
    // Remove the brackets and split the string by comma
    const trimmed = str.replace(/^\[|\]$/g, '');
    return trimmed.split(/\s*,\s*/);
  },

  /**
   * Safely parses a JSON string into an object.
   *
   * Returns `false` instead of throwing when the input is invalid or not an object.
   *
   * @param {string} jsonString String to parse
   * @returns {object|false} Parsed object or `false`
   */
  tryParseJSON(jsonString) {
    try {
      const o = JSON.parse(jsonString);

      if (o && typeof o === 'object') {
        return o;
      }
    } catch {
      // Invalid JSON is expected for some callers; keep this helper silent.
    }

    return false;
  },

  /**
   * Deep-compares two plain objects by own enumerable properties.
   *
   * @param {object} object1 First object
   * @param {object} object2 Second object
   * @returns {boolean} `true` when objects are equal
   */
  isObjectsEqual(object1, object2) {
    const props1 = Object.getOwnPropertyNames(object1);
    const props2 = Object.getOwnPropertyNames(object2);
    if (props1.length !== props2.length) {
      return false;
    }
    for (let i = 0; i < props1.length; i++) {
      const val1 = object1[props1[i]];
      const val2 = object2[props1[i]];
      const isObjects = this.isObject(val1) && this.isObject(val2);
      if (isObjects && !this.isObjectsEqual(val1, val2) || !isObjects && val1 !== val2) {
        return false;
      }
    }
    return true;
  },

  /**
   * Checks whether a value is a plain object (`null` returns `false`).
   *
   * @param {*} object Value to test
   * @returns {boolean}
   */
  isObject(object) {
    return object !== null && typeof object === 'object';
  },

  /**
   * Checks whether a value is a non-empty object.
   *
   * @param {*} object Value to test
   * @returns {boolean}
   */
  isObjectNotEmpty(object) {
    return this.isObject(object) && !this.isObjectsEqual(object, {});
  },

  /**
   * Compares two arrays after sorting them in place.
   *
   * @param {Array<*>} array1 First array
   * @param {Array<*>} array2 Second array
   * @returns {boolean} `true` when arrays contain the same values
   */
  isArraysEqual(array1, array2) {
    return array1.length === array2.length && array1.sort().every((value, index) => {
      return value === array2.sort()[index];
    });
  },

  /**
   * Clones an array by shallow-copying each element object.
   *
   * This is not a deep clone, but it is enough for arrays of simple objects.
   *
   * @param {Array<*>} arr Array to clone
   * @returns {Array<*>} Cloned array
   */
  cloneArray(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.map((a) => {
      return { ...a };
    });
  },

  /**
   * Clones a plain object recursively.
   *
   * Arrays and nested objects are copied; primitives and `null` are assigned by value.
   *
   * @param {Object} obj Object to clone
   * @returns {Object} Cloned object
   */
  cloneObject(obj) {
    if (typeof obj !== 'object') return obj;
    // return JSON.parse(JSON.stringify(obj));
    const objectCopy = {};
    let key;
    for (key in obj) {
      const toClone = obj[key];
      if (toClone === null) {
        objectCopy[key] = toClone;
      } else if (Array.isArray(toClone)) {
        objectCopy[key] = this.cloneArray(toClone);
      } else if (typeof toClone === 'object') {
        objectCopy[key] = this.cloneObject(toClone);
      } else {
        objectCopy[key] = toClone;
      }
    }
    return objectCopy;
  },

  /**
   * Finds the first object entry whose key appears inside `str`, case-insensitively.
   *
   * @example
   * findObjectEntry(
   *   { 'order is in pending status': 'retry later' },
   *   'The order is in Pending status please try after some time',
   * ) // 'retry later'
   *
   * @param {Object} object Object to search
   * @param {string} str String that may contain one of the keys
   * @returns {*|undefined} Matching value or `undefined`
   */
  findObjectEntry(object, str) {
    if (this.isObjectNotEmpty(object) && typeof str === 'string') {
      for (const [key, value] of Object.entries(object)) {
        if (str.toLowerCase().includes(key.toLowerCase())) {
          return value;
        }
      }
    }
  },

  /**
   * Returns an array with unique primitive values.
   *
   * @param {Array<*>} values Input array
   * @returns {Array<*>}
   */
  getUnique(values) {
    const map = values.reduce((m, v) => {
      m[v] = 1;
      return m;
    }, { });
    return Object.keys(map);
  },

  /**
   * Returns unique objects from an array by the given property names.
   *
   * @param {Object[]} items Input array
   * @param {string|string[]} propNames One property or a list of properties used for uniqueness
   * @returns {Object[]}
   */
  getUniqueByProperties(items, propNames) {
    const propNamesArray = Array.from(propNames);
    const isPropValuesEqual = (subject, target, propNames) =>
      propNames.every((propName) => subject[propName] === target[propName]);
    return items.filter((item, index, array) =>
      index === array.findIndex((foundItem) => isPropValuesEqual(foundItem, item, propNamesArray)),
    );
  },

  /**
   * Splits a string into chunks of the given length.
   *
   * The regex also treats newlines and carriage returns as single characters.
   *
   * @param {string} str String to split
   * @param {number} length Maximum chunk length
   * @returns {string[]}
   */
  chunkString(str, length) {
    // return str.match(new RegExp('.{1,' + length + '}', 'g'));
    // If your string can contain newlines or carriage returns:
    return str.match(new RegExp('(.|[\r\n]){1,' + length + '}', 'g'));
  },

  /**
   * Compares two strings, case sensitive
   * @param {string} string1
   * @param {string} string2
   * @return {boolean} True, if strings are equal
   */
  isStringEqual(string1, string2) {
    if (typeof string1 !== 'string' || typeof string2 !== 'string') return false;
    return string1 === string2;
  },

  /**
   * Compares two strings, case insensitive
   * @param {string} string1
   * @param {string} string2
   * @return {boolean} True, if strings are equal, case insensitive
   */
  isStringEqualCI(string1, string2) {
    if (typeof string1 !== 'string' || typeof string2 !== 'string') return false;
    return string1.toUpperCase() === string2.toUpperCase();
  },

  /**
   * Trims any chars from beginning and from end of string, case sensitive
   * Example: trimAny(str, ' "\') trims quotes, spaces and slashes
   * @param {string} str String to trim
   * @param {string} chars Chars to trim from 'str'
   * @return {string} Trimmed string; or empty string, if 'str' is not a string
   */
  trimAny(str, chars) {
    if (!str || typeof str !== 'string') {
      return '';
    }
    let start = 0;
    let end = str.length;
    while (start < end && chars.indexOf(str[start]) >= 0) {
      ++start;
    }
    while (end > start && chars.indexOf(str[end - 1]) >= 0) {
      --end;
    }
    return (start > 0 || end < str.length) ? str.substring(start, end) : str;
  },

  /**
   * Replaces last occurrence of substring in a string, case sensitive
   * @param {string} str String to process
   * @param {string} searchValue Substring to search
   * @param {string} newValue Substring to replace
   * @return {string} Processed string; or empty string, if 'str' is not a string
   */
  replaceLastOccurrence(str, searchValue, newValue) {
    if (!str || typeof str !== 'string') {
      return '';
    }
    const n = str.lastIndexOf(searchValue);
    return str.slice(0, n) + str.slice(n).replace(searchValue, newValue);
  },

  /**
   * Formats a number to a pretty human-readable string.
   *
   * Rules:
   *  - Never uses scientific notation
   *  - Never rounds (truncate only)
   *  - Uses fixed decimals up to `maxPrecision` (string-based truncation; no FP math)
   *  - Falls back to `meaningful` digits for very small numbers
   *
   * @param {number | string} num Number to format
   * @param {boolean} [makeBold=false] Apply **bold** markdown to integer part
   * @param {number} [maxPrecision=8] Max digits after decimal point (truncate)
   * @param {number} [meaningful=4] Meaningful digits for very small numbers
   * @returns {string} Formatted number
   */
  formatNumber(num, makeBold = false, maxPrecision = 8, meaningful = 4) {
    if (num === null || num === undefined || num === '') return '';

    const n = Number(num);
    if (!Number.isFinite(n)) return String(num);
    if (n === 0) return '0';

    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);

    let str;

    // Very small → meaningful (your existing helper already expands "e")
    if (abs < 10 ** -maxPrecision) {
      str = this.toFixedMeaningful(abs, meaningful);
    } else {
      // Normal → fixed decimals, BUT truncate using string (no FP multiplication)
      let s = abs.toString();
      if (s.includes('e')) s = abs.toFixed(maxPrecision + 20); // expand if needed

      let [intPart, fracPart = ''] = s.split('.');
      if (fracPart.length > maxPrecision) fracPart = fracPart.slice(0, maxPrecision);
      fracPart = fracPart.replace(/0+$/, ''); // trim trailing zeros

      str = fracPart ? `${intPart}.${fracPart}` : intPart;
    }

    const [intPart, fracPart] = str.split('.');

    // format integer part with spaces
    let formattedInt = '';
    for (let i = intPart.length - 1, c = 0; i >= 0; i--, c++) {
      formattedInt = intPart[i] + formattedInt;
      if (c % 3 === 2 && i !== 0) formattedInt = ' ' + formattedInt;
    }

    if (makeBold) formattedInt = `**${formattedInt}**`;

    return sign + (fracPart ? `${formattedInt}.${fracPart}` : formattedInt);
  },

  /**
   * Formats a number to string without scientific notation.
   *
   * Keeps up to `digits` meaningful digits:
   *  - for |x| ≥ 1 → keeps exactly `digits` decimals (truncated, never rounded)
   *  - for 0 < |x| < 1 → keeps `digits` meaningful digits after leading zeros
   *
   * Always returns a decimal representation (never `1.4e-7`).
   *
   * @param {number | string} num The value to format
   * @param {number} [digits=4] How many meaningful digits to keep
   * @returns {string} Formatted number
   *
   * toFixedMeaningful(123.456789) // "123.4567"
   * toFixedMeaningful(123.4, 4) // "123.4"
   * toFixedMeaningful(1.4e-7, 4) // "0.00000014"
   * toFixedMeaningful(5e-12, 3) // "0.000000000005"
   * toFixedMeaningful(0.0000123456, 2) // "0.000012"
   * toFixedMeaningful(-0.000987654, 3) // "-0.000987"
   * toFixedMeaningful(1000000, 4) // "1000000"
   * toFixedMeaningful(0) // "0"
   * toFixedMeaningful(NaN) // "NaN"
   */
  toFixedMeaningful(num, digits = 4) {
    num = +num;

    if (!Number.isFinite(num)) return String(num);
    if (!this.isPositiveInteger(digits)) digits = 4;
    if (num === 0) return '0';

    const sign = num < 0 ? '-' : '';
    const absNum = Math.abs(num);

    // Case 1: |x| >= 1 → keep `digits` decimals, truncate (no rounding)
    if (absNum >= 1) {
      const factor = 10 ** digits;
      const truncated = Math.trunc(absNum * factor) / factor;
      return (
        sign +
        truncated
            .toFixed(digits) // exactly `digits` decimals
            .replace(/\.?0+$/, '') // then remove any trailing zeros + dot
      );
    }

    // Case 2: 0 < |x| < 1 → keep `digits` meaningful digits after leading zeros
    // Represent in fixed notation to avoid scientific form
    let s = absNum.toString();
    if (s.includes('e')) s = absNum.toFixed(digits + 20);

    const [, zeros, following] = /^0\.(0*)(\d+)/.exec(s);
    return sign + '0.' + zeros + following.slice(0, digits); // truncate to `digits`
  },

  /**
   * Calculates the arithmetic mean of the first `maxLength` array items.
   *
   * @param {number[]} arr Array of numbers
   * @param {number} [maxLength] Number of leading items to include
   * @returns {number|false} Average value, or `false` for an empty array
   */
  arrayAverage(arr, maxLength) {
    if (!Array.isArray(arr) || arr.length === 0) {
      return false;
    }

    if (!maxLength) maxLength = arr.length - 1;
    const arrToCalc = arr.slice(0, maxLength);
    const total = arrToCalc.reduce((acc, c) => acc + c, 0);

    return total / arrToCalc.length;
  },

  /**
   * Calculates the root mean square of the first `maxLength` array items.
   *
   * @param {number[]} arr Array of numbers
   * @param {number} [maxLength] Number of leading items to include
   * @returns {number|false} RMS value, or `false` for an empty array
   */
  arrayRMS(arr, maxLength) {
    if (!Array.isArray(arr) || arr.length === 0) {
      return false;
    }

    if (!maxLength) maxLength = arr.length - 1;
    const arrToCalc = arr.slice(0, maxLength);
    const squares = arrToCalc.map((val) => (val*val));
    const total = squares.reduce((acc, c) => acc + c, 0);

    return Math.sqrt(total / squares.length);
  },

  /**
   * Calculates the median of the first `maxLength` array items.
   *
   * @param {number[]} arr Array of numbers
   * @param {number} [maxLength] Number of leading items to include
   * @returns {number|false} Median value, or `false` for an empty array
   */
  arrayMedian(arr, maxLength) {
    if (!Array.isArray(arr) || arr.length === 0) {
      return false;
    }

    if (!maxLength) maxLength = arr.length - 1;
    const arrToCalc = arr.slice(0, maxLength);
    arrToCalc.sort((a, b) => {
      return a - b;
    });

    const lowMiddle = Math.floor( (arrToCalc.length - 1) / 2);
    const highMiddle = Math.ceil( (arrToCalc.length - 1) / 2);

    return (arrToCalc[lowMiddle] + arrToCalc[highMiddle]) / 2;
  },

  /**
   * Calculates historical trade metrics inside the given interval.
   *
   * @param {Object[]} lastTrades Recent trades from `traderapi.getTradesHistory()`
   * @param {number} [startDate] Lower bound timestamp in ms; defaults to one minute ago
   * @returns {HistoryTradesInfo|undefined}
   */
  getHistoryTradesInfo(lastTrades, startDate) {
    try {
      const defaultInterval = constants.MINUTE;

      if (!this.isPositiveNumber(startDate)) {
        startDate = Date.now() - defaultInterval;
      }

      lastTrades = lastTrades.filter((trade) => trade.date > startDate);

      const tradesCount = lastTrades.length;
      const intervalMs = Date.now() - startDate;
      const minPrice = Math.min(...lastTrades.map((trade) => trade.price));
      const maxPrice = Math.max(...lastTrades.map((trade) => trade.price));
      const priceDelta = Math.abs(minPrice - maxPrice) || 0;
      const priceDeltaPercent = this.numbersDifferencePercent(minPrice, maxPrice) || 0;
      const coin1Volume = lastTrades.reduce((total, trade) => total + trade.coin1Amount, 0);
      const coin2Volume = lastTrades.reduce((total, trade) => total + trade.coin2Amount, 0);

      const tradesInfo = {
        tradesCount,
        intervalMs,
        minPrice,
        maxPrice,
        priceDelta,
        priceDeltaPercent,
        coin1Volume,
        coin2Volume,
      };

      return tradesInfo;
    } catch (e) {
      log.error(`Error in getHistoryTradesInfo() of ${this.moduleName} module: ${e}`);
    }
  },

  /**
   * Aggregates (sum) array of objects by field
   * @param {Object[]} arr Array of objects to aggregate
   * @param {string} field Field to aggregate by
   * @return {Object[]} Aggregated array
   */
  aggregateArrayByField(arr, field) {
    try {
      const dictionary = arr.reduce((dic, value) => {
        if (!dic[value[field]]) {
          dic[value[field]] = value;
        } else {
          const old = dic[value[field]];
          Object.keys(old).forEach((key) => {
            if (key !== field) {
              if (typeof old[key] === 'number') {
                old[key] += value[key];
              } else {
                old[key] = value[key];
              }
            }
          });
        }
        return dic;
      }, {});

      return Object.values(dictionary);
    } catch (e) {
      log.error(`Error in aggregateArrayByField() of ${this.moduleName} module: ${e}`);
    }
  },

  /**
   * Calculates order book metrics such as highestBid–lowestAsk, smartBid–smartAsk, spread,
   * liquidity, and amountTargetPrice.
   *
   * @param {DepthResult} orderBookInput Bids[] and asks[] received via traderapi.getOrderBook()
   *   Will be cloned internally to avoid mutating the original object.
   * @param {number} [customSpreadPercent] Optional custom spread (±% from the average price)
   *   to calculate liquidity within this range.
   * @param {number} [targetPrice] If set, calculates how much to buy or sell to reach the
   *   target price and builds a Quote Hunter table.
   * @param {number} [placedAmount] If set, estimates the price impact of a *market* order
   *   with the given amount on both sides.
   * @param {Array<Object>} [openOrders] Optional open orders from traderapi.getOpenOrders()
   *   used to filter out third-party orders.
   * @param {string} [moduleName] Module name used for logging only
   * @return {OrderBookInfo | false} Order book metrics
   */
  getOrderBookInfo(orderBookInput, customSpreadPercent, targetPrice, placedAmount, openOrders, moduleName) {
    try {
      const orderBook = /** @type {DepthResult} */ (this.cloneObject(orderBookInput));

      if (!orderBook || !orderBook.asks?.[0] || !orderBook.bids?.[0]) {
        return false;
      }

      // General order book stats

      const bids = orderBook.bids.length;
      const asks = orderBook.asks.length;

      const highestBid = orderBook.bids[0].price;
      const lowestAsk = orderBook.asks[0].price;

      const highestBidAggregatedAmount = orderBook.bids.reduce((total, order) => {
        return order.price === highestBid ? total + order.amount : total;
      }, 0);
      const highestBidAggregatedQuote = highestBidAggregatedAmount * highestBid;

      const lowestAskAggregatedAmount = orderBook.asks.reduce((total, order) => {
        return order.price === lowestAsk ? total + order.amount : total;
      }, 0);
      const lowestAskAggregatedQuote = lowestAskAggregatedAmount * lowestAsk;

      // Target price logic
      // Amount/quote needed to reach target price (used by many modules)

      let /** @type {SideTargetPrice} */ sideTargetPrice;
      let amountTargetPrice = 0; let targetPriceOrdersCount = 0; let amountTargetPriceQuote = 0;
      let targetPriceExcluded;
      let amountTargetPriceExcluded = 0; let targetPriceOrdersCountExcluded = 0; let amountTargetPriceQuoteExcluded = 0;

      const hasTargetPrice = this.isPositiveNumber(targetPrice);

      if (hasTargetPrice) {
        if (targetPrice > highestBid && targetPrice < lowestAsk) {
          sideTargetPrice = 'inSpread';
        } else if (targetPrice <= highestBid) {
          sideTargetPrice = 'sell';
        } else if (targetPrice >= lowestAsk) {
          sideTargetPrice = 'buy';
        }
      }

      // Spread and average prices calculations

      const spread = lowestAsk - highestBid;
      const averagePrice = (lowestAsk + highestBid) / 2;
      const spreadPercent = spread / averagePrice * 100;

      const avgSpreadDeviation = constants.AVERAGE_SPREAD_DEVIATION;

      let downtrendAveragePrice = highestBid + this.randomValue(0, avgSpreadDeviation) * spread;
      if (downtrendAveragePrice >= lowestAsk) {
        downtrendAveragePrice = highestBid;
      }

      let uptrendAveragePrice = lowestAsk - this.randomValue(0, avgSpreadDeviation) * spread;
      if (uptrendAveragePrice <= highestBid) {
        uptrendAveragePrice = lowestAsk;
      }

      let middleAveragePrice = averagePrice - this.randomValue(-avgSpreadDeviation, avgSpreadDeviation) * spread;
      if (middleAveragePrice >= lowestAsk || middleAveragePrice <= highestBid) {
        middleAveragePrice = averagePrice;
      }

      // Cumulative sums for bids and asks used for statistics output

      const cumulative = {
        bids: [],
        asks: [],
      };

      let cumulativeBidAmount = 0;
      let cumulativeBidQuote = 0;

      for (const bid of orderBook.bids) {
        cumulativeBidAmount += bid.amount;
        cumulativeBidQuote += bid.amount * bid.price;

        cumulative.bids.push({
          amount: cumulativeBidAmount,
          quote: cumulativeBidQuote,
        });
      }

      let cumulativeAskAmount = 0;
      let cumulativeAskQuote = 0;

      for (const ask of orderBook.asks) {
        cumulativeAskAmount += ask.amount;
        cumulativeAskQuote += ask.amount * ask.price;

        cumulative.asks.push({
          amount: cumulativeAskAmount,
          quote: cumulativeAskQuote,
        });
      }

      // Liquidity calculations for different ±spread% levels
      // Liquidity is calculated as total amounts available within certain spread ranges from the average price

      /**
       * Creates empty liquidity level for a given spread percent
       * @param {number} spreadPercent
       * @returns {LiquidityLevel}
       */
      function createLiquidityLevel(spreadPercent) {
        return {
          spreadPercent,
          bidsCount: 0,
          amountBids: 0,
          amountBidsQuote: 0,
          asksCount: 0,
          amountAsks: 0,
          amountAsksQuote: 0,
          totalCount: 0,
          amountTotal: 0,
          amountTotalQuote: 0,
          lowPrice: 0,
          highPrice: 0,
          spread: 0,
        };
      }

      // If custom spread is not provided, keep it as 0 to avoid NaN boundaries
      const safeCustomSpreadPercent = this.isPositiveNumber(customSpreadPercent) ? customSpreadPercent : 0;

      /** @type {LiquidityMap} */
      const liquidity = {
        percentSpreadSupport: createLiquidityLevel(constants.LIQUIDITY_SS_MAX_SPREAD_PERCENT),
        percent2: createLiquidityLevel(2),
        percent5: createLiquidityLevel(5),
        percent10: createLiquidityLevel(10),
        percent50: createLiquidityLevel(50),
        percentCustom: createLiquidityLevel(safeCustomSpreadPercent),
        full: createLiquidityLevel(0),
      };

      /** @type {LiquidityKey[]} */
      const liquidityKeys = /** @type {LiquidityKey[]} */ (Object.keys(liquidity));

      // Liquidity buckets define price boundaries around the average price
      for (const key of liquidityKeys) {
        /** @type {LiquidityLevel} */
        const bucket = liquidity[key];

        bucket.bidsCount = 0;
        bucket.amountBids = 0;
        bucket.amountBidsQuote = 0;
        bucket.asksCount = 0;
        bucket.amountAsks = 0;
        bucket.amountAsksQuote = 0;
        bucket.totalCount = 0;
        bucket.amountTotal = 0;
        bucket.amountTotalQuote = 0;

        bucket.lowPrice = averagePrice * (1 - bucket.spreadPercent / 100);
        bucket.highPrice = averagePrice * (1 + bucket.spreadPercent / 100);
        bucket.spread = bucket.highPrice - bucket.lowPrice;
      }

      // Loop through bids
      // To calculate liquidity, intervals between order prices, and target price amounts

      const bidIntervals = [];
      let previousBid;

      // “Placed amount” block estimates market impact for a hypothetical market order
      const hasPlacedAmount = this.isPositiveNumber(placedAmount);

      let placedAmountCountBid = 0;
      let placedAmountSumBid = 0;
      let placedAmountPriceBid;
      let placedAmountReachedBid = false;

      for (const bid of orderBook.bids) {

        // Each bucket counts liquidity inside its own boundaries.
        // Note: 'full' bucket has spreadPercent = 0 and is treated as “no boundaries”.
        for (const key of liquidityKeys) {
          /** @type {LiquidityLevel} */
          const bucket = liquidity[key];

          // For bids: we include levels above lowPrice (closer to the spread).
          // Using '>' keeps boundary strict; change to '>=' for inclusive boundary.
          if (!bucket.spreadPercent || bid.price > bucket.lowPrice) {
            bucket.bidsCount += 1;
            bucket.amountBids += bid.amount;
            bucket.amountBidsQuote += bid.amount * bid.price;
            bucket.totalCount += 1;
            bucket.amountTotal += bid.amount;
            bucket.amountTotalQuote += bid.amount * bid.price;
          }
        }

        // Target price for sells: how much bid liquidity we need to consume down to targetPrice
        if (hasTargetPrice && sideTargetPrice === 'sell' && bid.price > targetPrice) {
          amountTargetPriceExcluded += bid.amount;
          amountTargetPriceQuoteExcluded += bid.amount * bid.price;
          targetPriceOrdersCountExcluded += 1;
          targetPriceExcluded = bid.price;
        }

        if (hasTargetPrice && sideTargetPrice === 'sell' && bid.price >= targetPrice) {
          amountTargetPrice += bid.amount;
          amountTargetPriceQuote += bid.amount * bid.price;
          targetPriceOrdersCount += 1;
        }

        if (hasPlacedAmount && !placedAmountReachedBid) {
          placedAmountPriceBid = bid.price;

          // “How many top bid levels are needed to sell placedAmount”
          if (placedAmountSumBid + bid.amount <= placedAmount) {
            placedAmountCountBid += 1;
            placedAmountSumBid += bid.amount;
          } else {
            placedAmountReachedBid = true;
          }
        }

        if (previousBid && previousBid.price !== bid.price) {
          bidIntervals.push({
            previousPrice: previousBid.price,
            priceInterval: previousBid.price - bid.price,
            nextPrice: bid.price,
          });
        }

        previousBid = bid;
      }


      // Loop through asks
      // To calculate liquidity, intervals between order prices, and target price amounts

      const askIntervals = [];
      let previousAsk;

      let placedAmountCountAsk = 0;
      let placedAmountSumAsk = 0;
      let placedAmountPriceAsk;
      let placedAmountReachedAsk = false;

      for (const ask of orderBook.asks) {

        for (const key of liquidityKeys) {
          /** @type {LiquidityLevel} */
          const bucket = liquidity[key];

          // For asks: we include levels below highPrice (closer to the spread).
          // Using '<' keeps boundary strict; change to '<=' for inclusive boundary.
          if (!bucket.spreadPercent || ask.price < bucket.highPrice) {
            bucket.asksCount += 1;
            bucket.amountAsks += ask.amount;
            bucket.amountAsksQuote += ask.amount * ask.price;
            bucket.totalCount += 1;
            bucket.amountTotal += ask.amount;
            bucket.amountTotalQuote += ask.amount * ask.price;
          }
        }

        // Target price for buys: how much ask liquidity we need to consume up to targetPrice
        if (hasTargetPrice && sideTargetPrice === 'buy' && ask.price < targetPrice) {
          amountTargetPriceExcluded += ask.amount;
          amountTargetPriceQuoteExcluded += ask.amount * ask.price;
          targetPriceOrdersCountExcluded += 1;
          targetPriceExcluded = ask.price;
        }

        if (hasTargetPrice && sideTargetPrice === 'buy' && ask.price <= targetPrice) {
          amountTargetPrice += ask.amount;
          amountTargetPriceQuote += ask.amount * ask.price;
          targetPriceOrdersCount += 1;
        }

        if (hasPlacedAmount && !placedAmountReachedAsk) {
          placedAmountPriceAsk = ask.price;

          // “How many top ask levels are needed to buy placedAmount”
          if (placedAmountSumAsk + ask.amount <= placedAmount) {
            placedAmountCountAsk += 1;
            placedAmountSumAsk += ask.amount;
          } else {
            placedAmountReachedAsk = true;
          }
        }

        if (previousAsk && previousAsk.price !== ask.price) {
          askIntervals.push({
            previousPrice: previousAsk.price,
            priceInterval: ask.price - previousAsk.price,
            nextPrice: ask.price,
          });
        }

        previousAsk = ask;
      }

      // Smart and clean prices calculations
      // See method comments to understand the magic

      // Used in Price watcher to estimate realistic buy/sell prices with amounts considered
      const smartBid = this.getSmartPrice(orderBook.bids, 'bids', liquidity, moduleName);
      const smartAsk = this.getSmartPrice(orderBook.asks, 'asks', liquidity, moduleName);

      // Used in Cleaner to remove cheaters' orders
      const cleanBid = this.getCleanPrice(orderBook.bids, 'bids', liquidity, smartBid, moduleName);
      const cleanAsk = this.getCleanPrice(orderBook.asks, 'asks', liquidity, smartAsk, moduleName);

      // Price intervals calculations
      // Used in Ant-gap to understand typical spacing between levels near the top

      const ORDERBOOK_HEIGHT = 20;
      const avgBidInterval = this.arrayAverage(bidIntervals.map((bid) => bid.priceInterval), ORDERBOOK_HEIGHT);
      const avgAskInterval = this.arrayAverage(askIntervals.map((ask) => ask.priceInterval), ORDERBOOK_HEIGHT);
      const rmsBidInterval = this.arrayRMS(bidIntervals.map((bid) => bid.priceInterval), ORDERBOOK_HEIGHT);
      const rmsAskInterval = this.arrayRMS(askIntervals.map((ask) => ask.priceInterval), ORDERBOOK_HEIGHT);
      const medianBidInterval = this.arrayMedian(bidIntervals.map((bid) => bid.priceInterval), ORDERBOOK_HEIGHT);
      const medianAskInterval = this.arrayMedian(askIntervals.map((ask) => ask.priceInterval), ORDERBOOK_HEIGHT);

      // Build Quote Hunter's qhTable: an array of third-party bid rows above targetPrice used to choose optimalQhBid.
      // Additionally, build detailed qhOwnThirdPartyTable own-vs-third-party orderbook breakdown for both sides.
      // This is used in Trader and Nice Chart to show how much of the liquidity at each level belongs to the bot vs third parties.

      const qhTable = [];
      const qhOwnThirdPartyTable = {
        bids: [],
        asks: [],
      };
      let optimalQhBid;

      const getOwnAmountLeft = (order) => {
        if (Number.isFinite(Number(order?.amountLeft))) {
          return Number(order.amountLeft);
        }
        if (Number.isFinite(Number(order?.coin1AmountLeft))) {
          return Number(order.coin1AmountLeft);
        }
        if (Number.isFinite(Number(order?.amount))) {
          return Number(order.amount);
        }
        if (Number.isFinite(Number(order?.coin1Amount))) {
          return Number(order.coin1Amount);
        }
        return 0;
      };

      const aggregateQhLevelsPreservingOrder = (items, amountField) => {
        const aggregatedRows = [];
        const rowByPrice = new Map();

        for (const item of items || []) {
          const price = Number(item?.price);
          const amount = Number(item?.[amountField]) || 0;

          if (!Number.isFinite(price)) {
            continue;
          }

          let aggregatedRow = rowByPrice.get(price);

          if (!aggregatedRow) {
            aggregatedRow = {
              price,
              [amountField]: 0,
            };
            rowByPrice.set(price, aggregatedRow);
            aggregatedRows.push(aggregatedRow);
          }

          aggregatedRow[amountField] += amount;
        }

        return aggregatedRows;
      };

      const buildQhSideTable = (orderBookSide, ownOrderSide, sideLabel) => {
        const aggregatedBook = aggregateQhLevelsPreservingOrder(orderBookSide, 'amount');
        const aggregatedOwnOrders = aggregateQhLevelsPreservingOrder(
            (openOrders || [])
                .filter((order) => order.side === ownOrderSide)
                .map((order) => ({
                  price: order.price,
                  amountLeft: getOwnAmountLeft(order),
                })),
            'amountLeft',
        );

        const ownAmountByPrice = new Map();
        for (const ownOrder of aggregatedOwnOrders) {
          ownAmountByPrice.set(ownOrder.price, Number(ownOrder.amountLeft) || 0);
        }

        const rows = [];
        let amountAcc = 0;
        let quoteAcc = 0;
        let ownAmountAcc = 0;
        let ownQuoteAcc = 0;
        let thirdPartyAmountAcc = 0;
        let thirdPartyQuoteAcc = 0;

        for (const [index, level] of aggregatedBook.entries()) {
          const amount = Number(level.amount) || 0;
          const price = Number(level.price) || 0;
          const ownRequested = ownAmountByPrice.get(price) || 0;
          const ownAmount = Math.min(amount, ownRequested);
          const thirdPartyAmount = Math.max(amount - ownAmount, 0);
          const ownAmountMissingInBook = Math.max(ownRequested - ownAmount, 0);

          if (ownAmountMissingInBook > 0) {
            log.warn(`Bot's order to ${ownOrderSide === 'buy' ? 'buy' : 'sell'} ${ownRequested} ${config.coin1} (${ownAmountMissingInBook} ${config.coin1} left) at ${price} ${config.coin2} is not found in the order book. It may be we have slightly stale data.`);
          }

          const quote = amount * price;
          const ownQuote = ownAmount * price;
          const thirdPartyQuote = thirdPartyAmount * price;

          amountAcc += amount;
          quoteAcc += quote;
          ownAmountAcc += ownAmount;
          ownQuoteAcc += ownQuote;
          thirdPartyAmountAcc += thirdPartyAmount;
          thirdPartyQuoteAcc += thirdPartyQuote;

          rows.push({
            index,
            price: +price.toFixed(debugDecimals.pd),
            amount: +amount.toFixed(debugDecimals.ad),
            amountAcc: +amountAcc.toFixed(debugDecimals.ad),
            quote: +quote.toFixed(debugDecimals.qd),
            quoteAcc: +quoteAcc.toFixed(debugDecimals.qd),
            ownAmount: +ownAmount.toFixed(debugDecimals.ad),
            ownAmountAcc: +ownAmountAcc.toFixed(debugDecimals.ad),
            ownQuote: +ownQuote.toFixed(debugDecimals.qd),
            ownQuoteAcc: +ownQuoteAcc.toFixed(debugDecimals.qd),
            thirdPartyAmount: +thirdPartyAmount.toFixed(debugDecimals.ad),
            thirdPartyAmountAcc: +thirdPartyAmountAcc.toFixed(debugDecimals.ad),
            thirdPartyQuote: +thirdPartyQuote.toFixed(debugDecimals.qd),
            thirdPartyQuoteAcc: +thirdPartyQuoteAcc.toFixed(debugDecimals.qd),
            startsWithOurOrders: index === 0 && ownAmount > 0,
            startsWithThirdPartyOrders: index === 0 && ownAmount === 0 && thirdPartyAmount > 0,
            side: sideLabel,
          });
        }

        return rows;
      };

      if (openOrders && lowestAsk && highestBid) {
        qhOwnThirdPartyTable.bids = buildQhSideTable(orderBook.bids, 'buy', 'bids');
        qhOwnThirdPartyTable.asks = buildQhSideTable(orderBook.asks, 'sell', 'asks');

        const orderBookBidsThirdParty = qhOwnThirdPartyTable.bids.filter((row) => row.thirdPartyAmount > 0);

        // Calculate Quote Hunter rows above targetPrice and pick the best koef
        if (hasTargetPrice && orderBookBidsThirdParty.length > 3) {
          let maxBidTakerKoef = 0;

          for (let qhRowIndex = 0; qhRowIndex < orderBookBidsThirdParty.length; qhRowIndex++) {
            const bid = orderBookBidsThirdParty[qhRowIndex];
            const bidPrice = bid.price;

            // Quote Hunter is meaningful only for bids at/above the targetPrice
            if (bidPrice < targetPrice) {
              break;
            }

            const bidPriceDumpPercent = Math.abs(this.numbersDifferencePercentDirect(
                highestBid,
                qhRowIndex === 0 ? orderBookBidsThirdParty[qhRowIndex + 1]?.price || bidPrice : bidPrice,
            ));

            // Penalize large “dump” distance by squaring it
            const bidPriceDumpPercentPowed = Math.max(Math.pow(bidPriceDumpPercent, 2), Number.EPSILON);
            const bidTakerKoef = (qhRowIndex === 1 ? bid.thirdPartyQuote : bid.thirdPartyQuoteAcc) / bidPriceDumpPercentPowed;

            const quoteHunterRow = {
              index: qhRowIndex,
              bidPrice,
              bidAmount: bid.thirdPartyAmount,
              bidAmountAcc: bid.thirdPartyAmountAcc,
              bidQuote: bid.thirdPartyQuote,
              bidQuoteAcc: bid.thirdPartyQuoteAcc,
              bidPriceDumpPercent: +bidPriceDumpPercent.toFixed(4),
              bidTakerKoef: +bidTakerKoef.toFixed(4),
            };

            qhTable.push(quoteHunterRow);

            if (maxBidTakerKoef < bidTakerKoef) {
              maxBidTakerKoef = bidTakerKoef;
              optimalQhBid = quoteHunterRow;
            }
          }
        }
      }

      // Test and debug
      // Debug output for test modules only

      if (moduleName?.startsWith('Test')) {
        const { ad, qd, pd } = debugDecimals;

        console.log('Testing order book metrics calculation:\n');

        let basicInfo = `bids/asks: ${bids}/${asks}\n`;
        basicInfo += `average price: ${averagePrice.toFixed(pd)}, down: ${downtrendAveragePrice.toFixed(pd)}, up: ${uptrendAveragePrice.toFixed(pd)}, mid: ${middleAveragePrice.toFixed(pd)}\n`;
        basicInfo += `spread: ${spread.toFixed(pd)}, ${spreadPercent.toFixed(2)}%\n`;
        basicInfo += `hb–la: ${highestBid.toFixed(pd)}—${lowestAsk.toFixed(pd)}, amounts: ${highestBidAggregatedAmount.toFixed(ad)}–${lowestAskAggregatedAmount.toFixed(ad)}, quotes: ${highestBidAggregatedQuote.toFixed(qd)}–${lowestAskAggregatedQuote.toFixed(qd)}\n`;
        basicInfo += `hb–la Smart: ${smartBid?.toFixed(pd)}—${smartAsk?.toFixed(pd)}\n`;
        basicInfo += `hb–la Clean: ${cleanBid?.toFixed(pd)}—${cleanAsk?.toFixed(pd)}\n\n`;

        basicInfo += `bid/ask intervals avg: ${(+avgBidInterval)?.toFixed(pd)}—${(+avgAskInterval)?.toFixed(pd)}, rms: ${(+rmsBidInterval)?.toFixed(pd)}—${(+rmsAskInterval)?.toFixed(pd)}, median: ${(+medianBidInterval)?.toFixed(pd)}—${(+medianAskInterval)?.toFixed(pd)}\n\n`;

        basicInfo += `to achieve ${targetPrice?.toFixed(pd)} target price: ${sideTargetPrice} ${amountTargetPrice?.toFixed(ad)} coin1 (${amountTargetPriceQuote?.toFixed(qd)} coin2, entries ${targetPriceOrdersCount})\n`;
        basicInfo += `to achieve excluded ${targetPriceExcluded?.toFixed(pd)} target price: ${sideTargetPrice} ${amountTargetPriceExcluded?.toFixed(ad)} coin1 (${amountTargetPriceQuoteExcluded?.toFixed(qd)} coin2, entries ${targetPriceOrdersCountExcluded})\n\n`;

        basicInfo += `placed amount ${placedAmount} coin1 to buy (use asks): isReached: ${placedAmountReachedAsk}, ${placedAmountCountAsk} entries for ${placedAmountSumAsk?.toFixed(ad)} @ ${placedAmountPriceAsk?.toFixed(pd)}\n`;
        basicInfo += `placed amount ${placedAmount} coin1 to sell (use bids): isReached: ${placedAmountReachedBid}, ${placedAmountCountBid} entries for ${placedAmountSumBid?.toFixed(ad)} @ ${placedAmountPriceBid?.toFixed(pd)}\n`;
        console.log(basicInfo);

        let l = liquidity.percent2;
        let liquidityInfo = `liquidity 2%:\n lp–hp: ${l.lowPrice.toFixed(pd)}–${l.highPrice.toFixed(pd)}, spread ${l.spread.toFixed(pd)}, bids–asks: ${l.bidsCount}–${l.asksCount} (of ${bids}–${asks}), amounts: ${l.amountBids.toFixed(ad)}–${l.amountAsks.toFixed(ad)}, quotes: ${l.amountBidsQuote.toFixed(qd)}–${l.amountAsksQuote.toFixed(qd)}\n\n`;
        l = liquidity.percent50;
        liquidityInfo += `liquidity 50%:\n lp–hp: ${l.lowPrice.toFixed(pd)}–${l.highPrice.toFixed(pd)}, spread ${l.spread.toFixed(pd)}, bids–asks: ${l.bidsCount}–${l.asksCount} (of ${bids}–${asks}), amounts: ${l.amountBids.toFixed(ad)}–${l.amountAsks.toFixed(ad)}, quotes: ${l.amountBidsQuote.toFixed(qd)}–${l.amountAsksQuote.toFixed(qd)}\n`;
        console.log(liquidityInfo);

        let qhInfo = `Lowest ask: ${lowestAsk.toFixed(pd)}, Price limit: ${targetPrice?.toFixed(pd)}\n`;
        qhInfo += `Optimal Quote Hunter bid: ${JSON.stringify(optimalQhBid)}\n`;
        console.log(qhInfo);

        // Reducing field widths for console output
        const formatQhOwnThirdPartyDebugRows = (rows) => rows.map((row) => ({
          i: row.index,
          p: row.price,
          a: row.amount,
          aAcc: row.amountAcc,
          q: row.quote,
          qAcc: row.quoteAcc,
          oA: row.ownAmount,
          oAAcc: row.ownAmountAcc,
          oQ: row.ownQuote,
          oQAcc: row.ownQuoteAcc,
          tA: row.thirdPartyAmount,
          tAAcc: row.thirdPartyAmountAcc,
          tQ: row.thirdPartyQuote,
          tQAcc: row.thirdPartyQuoteAcc,
          sOur: row.startsWithOurOrders,
          sTp: row.startsWithThirdPartyOrders,
          sd: row.side,
        }));

        console.log('Quote Hunter table:');
        console.table(qhTable);

        console.log('Own-vs-third-party table (bids):');
        console.table(formatQhOwnThirdPartyDebugRows(qhOwnThirdPartyTable.bids));

        console.log('Own-vs-third-party table (asks):');
        console.table(formatQhOwnThirdPartyDebugRows(qhOwnThirdPartyTable.asks));

        if (moduleName?.startsWith('TestFull')) {
          console.log({ liquidity, bidIntervals, askIntervals });
        }
      }

      return {
        bids, // Number of bids in the order book
        asks, // Number of asks in the order book
        highestBid, // Highest bid price
        lowestAsk, // Lowest ask price
        highestBidAggregatedAmount, // Total amount at the highest bid price
        highestBidAggregatedQuote, // Total quote at the highest bid price
        lowestAskAggregatedAmount, // Total amount at the lowest ask price
        lowestAskAggregatedQuote, // Total quote at the lowest ask price
        cumulative, // Cumulative .bids[] and .asks[]: amount, quote
        smartBid, // See getSmartPrice()
        smartAsk, // See getSmartPrice()
        cleanBid, // See getCleanPrice()
        cleanAsk, // See getCleanPrice()
        spread, // Absolute spread between highest bid and lowest ask
        spreadPercent, // Percentage spread relative to average price
        averagePrice, // Average price between highest bid and lowest ask
        liquidity, // Liquidity metrics for different spread percentages:
        /**
          bidsCount, amountBids, amountBidsQuote,
          asksCount, amountAsks, amountAsksQuote,
          totalCount, amountTotal, amountTotalQuote,
          lowPrice, highPrice, spread
          */
        downtrendAveragePrice, // Adjusted average price for downtrend scenario
        uptrendAveragePrice, // Adjusted average price for uptrend scenario
        middleAveragePrice, // Adjusted middle average price
        sideTargetPrice, // Side of target price (inSpread, sell, buy)
        amountTargetPrice, // Amount required to reach the target price
        amountTargetPriceQuote, // Quote required to reach the target price
        targetPriceOrdersCount, // Number of orders at the target price
        amountTargetPriceExcluded, // Amount excluded for the target price
        amountTargetPriceQuoteExcluded, // Quote excluded for the target price
        targetPriceOrdersCountExcluded, // Number of orders excluded at the target price
        targetPriceExcluded, // Excluded target price
        bidIntervals, // Bid price intervals: previousPrice, priceInterval, nextPrice
        askIntervals, // Ask price intervals: previousPrice, priceInterval, nextPrice
        avgBidInterval, // Average bid price interval
        avgAskInterval, // Average ask price interval
        rmsBidInterval, // RMS bid price interval
        rmsAskInterval, // RMS ask price interval
        medianBidInterval, // Median bid price interval
        medianAskInterval, // Median ask price interval
        placedAmountCountBid, // Number of bid orders to fill placed amount
        placedAmountSumBid, // Cumulative bid amount to fill placed amount
        placedAmountPriceBid, // Bid price when placed amount is reached
        placedAmountReachedBid, // Whether placed amount is reached with bids
        placedAmountCountAsk, // Number of ask orders to fill placed amount
        placedAmountSumAsk, // Cumulative ask amount to fill placed amount
        placedAmountPriceAsk, // Ask price when placed amount is reached
        placedAmountReachedAsk, // Whether placed amount is reached with asks
        qhTable, // Quote Hunter third-party bid table used to choose optimalQhBid
        qhOwnThirdPartyTable, // Own-vs-third-party breakdown of visible order book by price level
        optimalQhBid, // Optimal Quote Hunter bid
      };
    } catch (e) {
      log.error(`Error in getOrderBookInfo() of ${this.moduleName} module: ${e}`);
      return false;
    }
  },

  /**
   * Summarizes how a taker amount traverses an own-vs-third-party order-book table.
   *
   * Rows are consumed in visible matching order. At a mixed price level, the
   * bot's own resting amount is consumed before the third-party remainder because
   * `getOrderBookInfo()` cannot recover the exchange's intra-level queue order
   * and this conservative ordering avoids overstating external fills.
   *
   * `amountUntilThirdParty` includes only the own-liquidity prefix before the
   * first third-party slice. `matchedLevels` preserves the same sequence so a
   * later partial exchange fill can be attributed without rebuilding the book.
   *
   * @param {QuoteHunterBookSideRow[]} rows Target-side rows from `qhOwnThirdPartyTable`
   * @param {number} requestedAmount Requested taker amount in base coin
   * @returns {QuoteHunterMatchSummary} Aggregate totals and sequential match plan
   */
  summarizeQhTableMatch(rows, requestedAmount) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const safeRequestedAmount =
      Number.isFinite(Number(requestedAmount)) && Number(requestedAmount) > 0 ?
        Number(requestedAmount) :
        0;
    const topRow = safeRows[0];
    const matchedLevels = [];
    let ownMatchedAmount = 0;
    let ownMatchedQuote = 0;
    let thirdPartyMatchedAmount = 0;
    let thirdPartyMatchedQuote = 0;
    let amountLeft = safeRequestedAmount;
    let amountUntilThirdParty = 0;
    let hasThirdPartyLiquidity = false;

    for (const row of safeRows) {
      const ownAmount = Math.max(Number(row?.ownAmount) || 0, 0);
      const thirdPartyAmount = Math.max(Number(row?.thirdPartyAmount) || 0, 0);

      if (thirdPartyAmount > 0) {
        // A mixed first external level still lets the taker consume its own
        // prefix before entering the third-party slice at the same price.
        amountUntilThirdParty += ownAmount;
        hasThirdPartyLiquidity = true;
        break;
      }

      amountUntilThirdParty += Math.max(Number(row?.amount) || 0, 0);
    }

    if (!hasThirdPartyLiquidity) {
      amountUntilThirdParty = safeRequestedAmount;
    }

    for (const row of safeRows) {
      if (amountLeft <= 0) {
        break;
      }

      const price = Number(row?.price) || 0;
      const ownAmount = Math.max(Number(row?.ownAmount) || 0, 0);
      const thirdPartyAmount = Math.max(Number(row?.thirdPartyAmount) || 0, 0);
      const ownTake = Math.min(amountLeft, ownAmount);
      const ownTakeQuote = ownTake * price;

      ownMatchedAmount += ownTake;
      ownMatchedQuote += ownTakeQuote;
      amountLeft -= ownTake;

      const thirdPartyTake = amountLeft > 0 ? Math.min(amountLeft, thirdPartyAmount) : 0;
      const thirdPartyTakeQuote = thirdPartyTake * price;

      thirdPartyMatchedAmount += thirdPartyTake;
      thirdPartyMatchedQuote += thirdPartyTakeQuote;
      amountLeft -= thirdPartyTake;

      if (ownTake > 0 || thirdPartyTake > 0) {
        matchedLevels.push({
          price,
          ownMatchedAmount: ownTake,
          ownMatchedQuote: ownTakeQuote,
          thirdPartyMatchedAmount: thirdPartyTake,
          thirdPartyMatchedQuote: thirdPartyTakeQuote,
        });
      }
    }

    return {
      requestedAmount: safeRequestedAmount,
      matchedAmount: ownMatchedAmount + thirdPartyMatchedAmount,
      ownMatchedAmount,
      ownMatchedQuote,
      thirdPartyMatchedAmount,
      thirdPartyMatchedQuote,
      matchedLevels,
      amountUntilThirdParty: Math.min(amountUntilThirdParty, safeRequestedAmount),
      topStartsWithOurOrders: Boolean(topRow?.startsWithOurOrders),
      topStartsWithThirdPartyOrders: Boolean(topRow?.startsWithThirdPartyOrders),
    };
  },

  /**
   * Calculates the smart price for the order book, used by the Price watcher module to set a reliable reference price range.
   * Unlike the highest bid (hb) and lowest ask (la), the smart price also takes order amounts into account.
   * The smart price is the nearest price to hb/la with a sufficient accumulated amount.
   * Note: The smart price does not consider the distance from the spread (unlike the clean price).
   *
   * @param {DepthItem[]} items Bids or asks, as returned by traderapi.getOrderBook()
   * @param {'asks' | 'bids'} itemsSide Indicates whether items are asks or bids
   * @param {LiquidityMap} liquidity Liquidity info calculated in getOrderBookInfo(). Liquidity level percent50 is used as “total” reference for cumulative thresholds.
   * @param {string} [moduleName] Optional module name for debug and logging
   * @return {number | undefined} Smart price
   */
  getSmartPrice(items, itemsSide, liquidity, moduleName) {
    try {
      const isAsks = itemsSide === 'asks';

      // Liquidity level percent50 is used as “total” reference for cumulative thresholds
      const liquidity50 = liquidity.percent50;
      const total = isAsks ? liquidity50.amountAsks : liquidity50.amountBidsQuote;

      const c_t_base = 0.005; // Base cumulative threshold (1% of total) to consider the smart price reached
      const c_t_max = 0.05; // Hard cap threshold (5% of total); once reached, a smart price must be selected

      let smartPrice;
      let smartPriceIndex;

      let c_prev = 0;
      let a = 0; let a_prev = 0; let t = 0;
      let c = 0; let c_a = 0; let c__a_prev = 0; let c__c_prev = 0; let c_t = 0; let s = 0;
      let s_prev = 0; let c_t__prev = 0;

      const table = [];

      for (let i = 0; i < items.length; i++) {
        const el = items[i];
        const el_prev = items[i - 1];

        // For asks we cumulate base amounts, for bids we cumulate quote notional.
        // This makes the “smart” logic symmetric for both sides.
        if (isAsks) {
          a = el.amount;
          a_prev = el_prev?.amount;
          t = total;
        } else {
          a = el.amount * el.price;
          a_prev = el_prev?.amount * el_prev?.price;
          t = total;
        }

        c_t__prev = c_t;
        s_prev = s;
        c_prev = c;

        c += a; // Cumulative amount/notional
        c_a = c / a; // Heuristic: cumulative per current amount showing how significant this order is
        c__a_prev = c / a_prev; // Heuristic: cumulative per previous amount showing how significant the previous order was
        c__c_prev = c_prev ? c / c_prev : 0; // Heuristic: cumulative change compared to previous cumulative showing accumulation speed
        c_t = c / t; // Cumulative % to total showing how much of total liquidity is covered
        s = c_t * c__c_prev; // Heuristic: cumulative speed change showing how fast we accumulate liquidity; slowing down (s < s_prev) means we passed significant orders

        // This table is only for logging
        const { ad, qd, pd } = debugDecimals;
        const sd = isAsks ? ad : qd; // Side-dependent decimal places
        table.push({
          items: items.length,
          [isAsks ? 'total amount' : 'total quote']: +t.toFixed(sd),
          price: el.price.toFixed(pd),
          [isAsks ? 'amount' : 'quote']: a.toFixed(sd),
          cum: c.toFixed(sd),
          c_a: +c_a.toFixed(2),
          c__a_prev: c__a_prev ? +c__a_prev.toFixed(2) : false,
          c__c_prev: c__c_prev ? +c__c_prev.toFixed(2) : false,
          c_t: +c_t.toFixed(5),
          s: +s.toFixed(5),
          // sp: '', // Shown as '*' when smart price is selected
        });

        // Smart price is picked once:
        //   - When we pass the base cumulative threshold AND accumulation speed starts to slow down
        //   - Or when we reach the hard cap threshold
        // If heuristic didn't ever trigger, Smart price stays undefined
        if (!smartPrice) {
          if (i > 0 && c_t__prev > c_t_base && s < s_prev) {
            smartPrice = el_prev.price;
            smartPriceIndex = i - 1;
          } else if (c_t > c_t_max) {
            smartPrice = el.price;
            smartPriceIndex = i;
          }
        }
      }

      // Output debug table to understand the magic
      if (moduleName?.startsWith('Test')) {
        if (table?.[smartPriceIndex]) {
          // @ts-ignore
          table[smartPriceIndex].sp = '*';
        }
        console.table(table);
        const { pd } = debugDecimals;
        console.log(`smartPrice for ${itemsSide} and ${c_t_base} koef: ${smartPrice?.toFixed(pd)}\n`);
      }

      return smartPrice;
    } catch (e) {
      log.error(`Error in getSmartPrice() of ${this.moduleName} module: ${e}`);
    }
  },

  /**
   * Calculates clean (non-cheater) price for the order book
   * It depends on:
   *   - Distance^2 from the smart price: bigger distance means higher probability of cheater order
   *   - Accumulated amount of an order: smaller amount means higher probability of cheater order
   *   - Koef threshold: bigger koef means higher probability of cheater order
   *
   * @param {DepthItem[]} items Bids or asks, as returned by traderapi.getOrderBook()
   * @param {'asks' | 'bids'} itemsSide Items are 'asks' or 'bids'? Asks arranged from low to high, Bids from high to low (spread in the center).
   * @param {LiquidityMap} liquidity Liquidity info, calculated in getOrderBookInfo(). Liquidity level percent50 is used as “total” reference for cumulative thresholds.
   * @param {number} smartPrice Smart price for bids/asks. The clean price is always before the smart price.
   * @param {string} moduleName For logging only
   * @return {number | undefined} Clean price
   */
  getCleanPrice(items, itemsSide, liquidity, smartPrice, moduleName) {
    const koef = 7; // Threshold for ct_d2 to treat an order as “clean enough”

    if (!this.isPositiveNumber(smartPrice)) {
      log.warn(`utils/getCleanPrice: Unexpected smart price ${smartPrice}. Unable to calculate the clean price.`);
      return;
    }

    try {
      const isAsks = itemsSide === 'asks';

      // Liquidity level percent50 is used as “total” reference for cumulative thresholds
      const liquidity50 = liquidity.percent50;
      const total = isAsks ? liquidity50.amountAsks : liquidity50.amountBidsQuote;

      let cleanPrice = items[0].price;
      const smartPriceIndex = items.findIndex((i) => i.price === smartPrice);
      let cleanPriceIndex = 0;

      let a = 0; let t = 0; let c = 0; let c_t = 0;
      let d = 0; let d2 = 0; let ct_d2 = 0;

      const table = [];
      let orderInfo = '';
      let side;
      let quote;

      // Each iteration moves from the best price towards the Smart price.
      // We try to detect “thin” orders far from Smart price (likely manipulative).
      for (let i = 0; i < items.length; i++) {
        const el = items[i];
        quote = el.amount * el.price;

        if (isAsks) {
          if (el.price > smartPrice) break;
          side = 'sell';
          a = el.amount;
          t = total;
        } else {
          if (el.price < smartPrice) break;
          side = 'buy';
          a = quote;
          t = total;
        }

        const { ad, qd, pd } = debugDecimals;
        const sd = isAsks ? ad : qd; // Side-dependent decimal places
        orderInfo = `${this.inclineNumber(i)} order to ${side} ${el.amount.toFixed(ad)} @${el.price.toFixed(pd)} for ${quote.toFixed(qd)}`;

        d = this.numbersDifferencePercent(el.price, smartPrice) / 100; // Distance from Smart price (0…1)
        d2 = d * d; // Squared distance penalizes far-away orders
        c += a; // Cumulative amount/notional towards Smart price
        c_t = c / t; // Cumulative fraction of total (0…1) showing how much liquidity is covered

        // ct_d2 grows as we get closer to Smart price and accumulate more volume.
        // When it large enough (compared to koef), orders are treated as “clean”.
        ct_d2 = d2 === 0 ? Infinity : (c_t / d2);

        // Helper to log cleaner details with order context
        const logCleanerDetails = ((orderStatus) => {
          if (moduleName === 'Cleaner' || moduleName?.startsWith('Test')) {
            const reason = orderStatus === 'decent' ? 'exceeds' : 'is below';
            log.log(`utils/getCleanPrice: Considering the ${orderInfo} as ${orderStatus}. Value ct_d2 ${ct_d2.toFixed(5)} ${reason} the Threshold koef ${koef}.`);
          }
        });

        // While ct_d2 is below threshold, treat current level as suspicious and move cleanPrice forward
        if (ct_d2 < koef && items[i + 1]) {
          cleanPrice = items[i + 1].price;
          cleanPriceIndex = i + 1;
          logCleanerDetails('cheater');
        } else if (i === 0) {
          logCleanerDetails('decent');
        }

        // This table is only for logging
        table.push({
          items: items.length,
          [isAsks ? 'total amount' : 'total quote']: +t.toFixed(sd),
          price: el.price.toFixed(pd),
          d: +d.toFixed(3),
          'd^2': +d2.toFixed(6),
          [isAsks ? 'amount' : 'quote']: a.toFixed(sd),
          cum: c.toFixed(sd),
          c_t: +c_t.toFixed(5),
          ct_d2: +ct_d2.toFixed(5),
          isCheater: ct_d2 < koef,
        });
      }

      // Output debug table to understand the magic
      if (moduleName?.startsWith('Test')) {
        if (table?.[smartPriceIndex]) {
          // @ts-ignore
          table[smartPriceIndex].sp = '*';
        }
        if (table?.[cleanPriceIndex]) {
          // @ts-ignore
          table[cleanPriceIndex].cp = '*';
        }
        console.table(table);
        const { pd } = debugDecimals;
        console.log(`Clean price is ${cleanPrice?.toFixed(pd)} for ${itemsSide} when Smart price = ${smartPrice.toFixed(pd)} and Threshold koef = ${koef}.\n`);
      }

      return cleanPrice;
    } catch (e) {
      log.error(`Error in getCleanPrice() of ${this.moduleName} module: ${e}`);
    }
  },

  /**
   * Returns precision for number of decimals
   * 3 -> 0.001
   * 1 -> 0.1
   * 0 -> 1
   * Works with negative decimals: -3 -> 1000
   * @param {number} decimals Number of decimals
   * @return {number} Precision
   */
  getPrecision(decimals) {
    let precision = Math.pow(10, -decimals);

    if (this.isPositiveOrZeroInteger(decimals)) {
      precision = +precision.toFixed(decimals);
    }

    return precision;
  },

  /**
   * Returns decimals for precision
   * 0.00001 -> 5
   * 0 -> undefined
   * 1 -> 0
   * 1000 -> 0
   * @param {number | string} precision E.g. 0.00001
   * @returns {number} E.g. 5
   */
  getDecimalsFromPrecision(precision) {
    if (!precision) return;
    if (+precision > 1) return 0;

    return Math.round(Math.abs(Math.log10(+precision)));
  },

  /**
   * Returns decimals for precision for number greater than 1
   * 0.00001 -> 5
   * 0 -> undefined
   * 1 -> 0
   * 1000 -> -3
   * Note: 1051.toFixed(-2) doesn't work
   * @param {number | string} precision E.g. 0.00001
   * @returns {number} E.g. 5
   */
  getDecimalsFromPrecisionForBigNumbers(precision) {
    if (!precision) return;

    return Math.round(-Math.log10(+precision));
  },

  /**
   * Returns decimals for arbitrary number
   * 0.00001 -> 5
   * 1000.00001 -> 5
   * 1 -> 0
   * 0 -> 0
   * @param {number|string} number
   * @returns {number|undefined}
   */
  getDecimalsFromNumber(number) {
    number = number?.toString();

    if (!isFinite(+number)) return undefined;

    const split = number.split('.');

    if (split.length === 1) {
      return 0;
    }

    return split[1]?.length;
  },

  /**
   * Clamps a numeric value within the provided range (inclusive).
   * If the value is lower than `from`, returns `from`.
   * If the value is greater than `to`, returns `to`.
   *
   * Examples:
   *   clamp(120, -100, 100); // 100
   *   clamp(-150, -100, 100); // -100
   *   clamp(42, -100, 100); // 42
   *
   * @param {number} value The value to clamp
   * @param {number} from Minimum allowed value
   * @param {number} to Maximum allowed value
   * @return {number} The clamped value
   */
  clampNumber(value, from, to) {
    return Math.min(to, Math.max(from, value));
  },

  /**
   * Formats a signed number, e.g. '+5.82' or '-3.10'.
   * @param {number} n
   * @param {number} [decimals=2]
   * @returns {string | undefined}
   */
  signedNumber(n, decimals = 2) {
    if (!Number.isFinite(n)) return '';

    const abs = Math.abs(n).toFixed(decimals);
    if (n > 0) return `+${abs}`;
    if (n < 0) return `−${abs}`; // minus U+2212
    return abs;
  },

  /**
   * Formats a signed percent, e.g. '-5.82%'.
   * @param {number} n
   * @param {number} [decimals=2]
   * @returns {string}
   */
  formatPercent(n, decimals = 2) {
    return `${this.signedNumber(n, decimals)}%`;
  },

  /**
   * Checks whether an order price is outside the configured liquidity spread.
   *
   * @param {Object} order Order record from `ordersDb`
   * @param {OrderBookInfo} obInfo Result of `getOrderBookInfo()`
   * @returns {OrderOutOfSpreadInfo|undefined}
   */
  isOrderOutOfSpread(order, obInfo) {
    try {
      const isSsOrder = order.subPurpose === 'ss';

      const outOfSpreadInfo = {
        isOrderOutOfSpread: false,
        isOrderOutOfMinMaxSpread: false,
        isOrderOutOfInnerSpread: false,
        isSsOrder,
        orderPrice: order.price,
        minPrice: undefined,
        maxPrice: undefined,
        innerLowPrice: undefined,
        innerHighPrice: undefined,
        spreadPercent: isSsOrder ? constants.LIQUIDITY_SS_MAX_SPREAD_PERCENT : tradeParams.mm_liquiditySpreadPercent,
        spreadPercentMin: tradeParams.mm_liquiditySpreadPercentMin,
      };

      const liqInfo = isSsOrder ? obInfo.liquidity.percentSpreadSupport : obInfo.liquidity.percentCustom;
      const roughness = liqInfo.spread * constants.AVERAGE_SPREAD_DEVIATION;

      // First, check mm_liquiditySpreadPercent
      outOfSpreadInfo.minPrice = liqInfo.lowPrice - roughness;
      outOfSpreadInfo.maxPrice = liqInfo.highPrice + roughness;
      if (order.price < outOfSpreadInfo.minPrice || order.price > outOfSpreadInfo.maxPrice) {
        outOfSpreadInfo.isOrderOutOfSpread = true;
        outOfSpreadInfo.isOrderOutOfMinMaxSpread = true;
        return outOfSpreadInfo;
      }

      // Second, check mm_liquiditySpreadPercentMin: 'depth' orders should be not close to mid of spread
      if (!isSsOrder && tradeParams.mm_liquiditySpreadPercentMin) {
        outOfSpreadInfo.innerLowPrice = obInfo.averagePrice * (1 - tradeParams.mm_liquiditySpreadPercentMin/100) + roughness;
        outOfSpreadInfo.innerHighPrice = obInfo.averagePrice * (1 + tradeParams.mm_liquiditySpreadPercentMin/100) - roughness;
        if (order.price > outOfSpreadInfo.innerLowPrice && order.price < outOfSpreadInfo.innerHighPrice) {
          outOfSpreadInfo.isOrderOutOfSpread = true;
          outOfSpreadInfo.isOrderOutOfInnerSpread = true;
          return outOfSpreadInfo;
        }
      }

      return outOfSpreadInfo;
    } catch (e) {
      log.error(`Error in isOrderOutOfSpread() of ${this.moduleName} module: ${e}`);
    }
  },

  /**
   * Checks if an order price is out of the Price watcher's range
   * @param {Object} order Object of ordersDb
   * @returns {boolean}
   */
  isOrderOutOfPriceWatcherRange(order) {
    try {
      const pw = require('../trade/mm_price_watcher');

      if (pw.getIsPriceActualConsistentAndEnabled()) {
        const lowPrice = pw.getLowPrice();
        const highPrice = pw.getHighPrice();

        if (
          (order.side === 'sell' && lowPrice && order.price < lowPrice) ||
          (order.side === 'buy' && highPrice && order.price > highPrice)
        ) {
          return true;
        }
      }
    } catch (e) {
      log.error(`Error in isOrderOutOfPriceWatcherRange() of ${this.moduleName} module: ${e}`);
    }

    return false;
  },

  /**
   * Checks if an order price is out of the custom range set by lowPrice–highPrice
   * @param {Object} order Object of ordersDb
   * @param {number} lowPrice Lower bound
   * @param {number} highPrice Higher bound
   * @returns {boolean}
   */
  isOrderOutOfPriceRange(order, lowPrice, highPrice) {
    try {
      if (
        (order.side === 'sell' && lowPrice && order.price < lowPrice) ||
        (order.side === 'buy' && highPrice && order.price > highPrice)
      ) {
        return true;
      }
    } catch (e) {
      log.error(`Error in isOrderOutOfPriceRange() of ${this.moduleName} module: ${e}`);
    }

    return false;
  },

  /**
   * Returns module name from its ID
   * @param {string} id Module name, module.id
   * @return {string}
   */
  getModuleName(id) {
    let n = id.lastIndexOf('\\');
    if (n === -1) {
      n = id.lastIndexOf('/');
    }
    if (n === -1) {
      return '';
    } else {
      return id.substring(n + 1);
    }
  },

  /**
   * Returns probable caller function using Error call stack
   * Usage: console.log('Called by:', utils.getFunctionCaller(new Error()));
   * @param {Error} errorInstance Error instance created inside the function
   * @return {string} E.g. 'at Object.<anonymous> (../adamant-tradebot-me/modules/commandTxs.js:59:14)'
   */
  getFunctionCaller(errorInstance) {
    const stack = errorInstance.stack.split('\n');

    return stack[2].trim();
  },

  /**
   * Parses a positive number or range from strings such as `1.25–2.90`.
   *
   * Accepts hyphen, dash, minus, and long-dash separators.
   * All numbers must be positive and finite.
   *
   * @param {string} str String to parse
   * @returns {ParseRangeOrValueResult}
   */
  parseRangeOrValue(str) {
    if (typeof str !== 'string') {
      return {
        isRange: false,
        isValue: false,
      };
    }

    let from; let to;
    let value;

    if (str.indexOf('-') > -1) { // hyphen U+002D
      [from, to] = str.split('-');
    } else if (str.indexOf('—') > -1) { // long dash
      [from, to] = str.split('—');
    } else if (str.indexOf('–') > -1) { // short dash U+2013
      [from, to] = str.split('–');
    } else if (str.indexOf('−') > -1) { // minus U+2212
      [from, to] = str.split('−');
    } else {
      // It's a number
      value = +str;

      if (!this.isPositiveNumber(value)) {
        return {
          isRange: false,
          isValue: false,
        };
      } else {
        return {
          isRange: false,
          isValue: true,
          value,
        };
      }
    }

    from = this.parsePositiveSmartNumber(from);
    to = this.parsePositiveSmartNumber(to);

    const fromNumber = from.number;
    const toNumber = to.number;

    if (!from.isNumber || !to.isNumber || fromNumber > toNumber) {
      return {
        isRange: false,
        isValue: false,
      };
    }

    return {
      isRange: true,
      isValue: false,
      from: fromNumber,
      to: toNumber,
      fromStr: from.fancyNumberString,
      toStr: to.fancyNumberString,
    };
  },

  /**
   * Calculates per-asset balance differences between current and previous snapshots.
   *
   * @param {AssetsResult} [bc] Current balances
   * @param {AssetsResult} [bp] Previous balances
   * @returns {BalanceDifferenceItem[]|undefined}
   */
  differenceInBalances(bc, bp) {
    if (!Array.isArray(bc) || !Array.isArray(bp)) {
      return;
    }

    const bcClone = this.cloneArray(bc);
    const bpClone = this.cloneArray(bp);

    const diff = [];

    // Add to current balances the coins that existed previously but are missing now
    bpClone.forEach((prevItem) => {
      const currentItem = bcClone.find((crypto) => crypto.code === prevItem.code);

      if (!currentItem) {
        bcClone.push({
          code: prevItem.code,
          total: 0,
        });
      }
    });

    // Calculate difference
    bcClone.forEach((currentItem) => {
      const prevItem = bpClone.find((crypto) => crypto.code === currentItem.code);

      if (prevItem) {
        if (currentItem.total !== prevItem.total) {
          diff.push({
            code: currentItem.code,
            prev: prevItem.total,
            now: currentItem.total,
          });
        }
      } else {
        diff.push({
          code: currentItem.code,
          prev: 0,
          now: currentItem.total,
        });
      }
    });

    return diff;
  },

  /**
   * Builds a human-readable balance-diff message ending with a single newline.
   *
   * Includes coin1/coin2 changes and total-holdings deltas.
   *
   * @param {AssetsResult} bc Current balances
   * @param {BalanceSnapshotWithTimestamp} [bpt] Previous balances with timestamp
   * @param {import('types/bot/balancesHistory.d.js').BalanceTotalsScope} [scope='allcoins']
   *   - `pair` — only Total trading (coin1+coin2)
   *   - `priority` / `allcoins` — all totals
   * @returns {string}
   */
  differenceInBalancesString(bc, bpt, scope) {
    let output = '';
    const diff = this.differenceInBalances(bc, bpt?.balances);
    const timeDiffString = bpt?.timestamp ? ' in ' + this.timestampInDaysHoursMins(Date.now() - bpt.timestamp) : '';

    if (!diff) return output;

    output += '\n\n';

    if (!diff[0]) {
      output += `**No changes${timeDiffString}**.\n`;
      return output;
    }

    output += `**Changes${timeDiffString}**:\n\n`;

    // Average buy/sell price calc decimals
    const orderUtils = require('../trade/orderUtils');
    const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(config.defaultPair));
    const { coin1, coin2, coin1Decimals, coin2Decimals, coin2DecimalsForStable } = formattedPair;

    // Output rules
    const addUSD = !this.isStableCoin(coin2);
    const addBTC = coin2 !== 'BTC';

    const balancesHistory = require('../helpers/balancesHistory');
    const { BALANCE_TOTAL_TYPES, BALANCE_TOTAL_COINS, totalsKeyToTypeCoin } = balancesHistory;

    // totalsDiff[type][key] = { delta, sign }
    const initTotalsDiff = () =>
      Object.fromEntries(
          BALANCE_TOTAL_TYPES.map((type) => [
            type,
            Object.fromEntries(BALANCE_TOTAL_COINS.map(({ key }) => [key, { delta: 0, sign: '' }])),
          ]),
      );

    /** @type {Record<string, Record<string, {delta: number, sign: string}>>} */
    const totalsDiff = initTotalsDiff();

    let deltaCoin1 = 0; let deltaCoin2 = 0;
    let signCoin1 = ''; let signCoin2 = '';

    const signFor = (now, prev) => (now > prev ? '+' : '−');

    /**
     * Helper to format total amount diffs for 'Total holdings' and 'Total trading' changes.
     * E.g., Total holdings +42.2963 USDT or +0.00071725 BTC
     * @param {string} type E.g. 'total', 'totalNonCoin1', 'totalTrading' to get totalsDiff[] key
     * @return {string}
     */
    const formatTotalAmounts = (type) => {
      const parts = [];
      parts.push(`${totalsDiff[type].COIN2.sign}${this.formatNumber(totalsDiff[type].COIN2.delta, true, coin2DecimalsForStable)} _${coin2}_`);
      if (addUSD) {
        parts.push(`${totalsDiff[type].USD.sign}${this.formatNumber(totalsDiff[type].USD.delta, true, 2)} _USD_`);
      }
      if (addBTC) {
        parts.push(`${totalsDiff[type].BTC.sign}${this.formatNumber(totalsDiff[type].BTC.delta, true, 8)} _BTC_`);
      }
      return parts.join(' or ');
    };

    const totalHasChanges = (type) =>
      this.isCoinValueSignificant(totalsDiff[type].COIN2.delta, coin2) ||
      this.isCoinValueSignificant(totalsDiff[type].USD.delta, 'USD') ||
      this.isCoinValueSignificant(totalsDiff[type].BTC.delta, 'BTC');

    let singleCoinHasChanges = false;

    diff.forEach((crypto) => {
      const delta = Math.abs(crypto.now - crypto.prev);
      const sign = signFor(crypto.now, crypto.prev);

      // 1) Totals (generated keys)
      const hit = totalsKeyToTypeCoin[crypto.code];
      if (hit) {
        totalsDiff[hit.type][hit.key] = { delta, sign };
        return;
      }

      // 2) Coin1 / coin2 tracking for implied average trade price
      if (crypto.code === coin1) {
        deltaCoin1 = delta;
        signCoin1 = sign;
      }

      if (crypto.code === coin2) {
        deltaCoin2 = delta;
        signCoin2 = sign;
      }

      // 3) Skip near-zero noise
      if (!this.isCoinValueSignificant(delta, crypto.code)) return;

      // 4) Format individual coin change string
      output += `_${crypto.code}_: ${sign}${this.formatNumber(delta, true, 8)}\n`;
      singleCoinHasChanges = true;
    });

    // Show Totals change
    if (totalHasChanges('total') || totalHasChanges('totalNonCoin1') || totalHasChanges('totalTrading')) {
      if (scope !== 'pair') {
        output += totalHasChanges('total') ? `Total holdings ${formatTotalAmounts('total')}\n` : 'Total holdings ~ No changes\n';
        output += totalHasChanges('totalNonCoin1') ? `Total holdings (non-${coin1}) ${formatTotalAmounts('totalNonCoin1')}\n` : `Total holdings (non-${coin1}) ~ No changes\n`;
      }
      output += totalHasChanges('totalTrading') ? `Total trading (${coin1}+${coin2}) ${formatTotalAmounts('totalTrading')}\n` : `Total trading (${coin1}+${coin2}) ~ No changes\n`;
    } else if (singleCoinHasChanges) {
      output += 'Totals ~ No changes\n';
    } else if (!singleCoinHasChanges) {
      output += 'No significant changes.\n';
    }

    // Calculate the average buy/sell price for coin1/coin2
    // Assumes there were no deposits, withdrawals, or trades on other pairs
    if (deltaCoin1 && deltaCoin2 && (signCoin1 !== signCoin2) && this.isCoinValueSignificant(deltaCoin2, coin2)) {
      const isBuy = signCoin1 === '+';
      const price = deltaCoin2 / deltaCoin1;

      const exchangerUtils = require('./cryptos/exchanger');

      // Evaluate significance of the trade 🦐 🍤 🐟 🐬 🦈 🐳
      const deltaCoin1UsdValue = exchangerUtils.convertCryptos(coin1, 'USD', deltaCoin1).outAmount;
      const deltaCoin2UsdValue = exchangerUtils.convertCryptos(coin2, 'USD', deltaCoin2).outAmount;
      const volumeSymbol = this.volumeSymbol(Math.max(deltaCoin1UsdValue, deltaCoin2UsdValue));

      // Compare with market price 🟢⬆️⬆️ or 🔴⬇️
      const marketPrice = exchangerUtils.convertCryptos(coin1, coin2, 1).exchangePrice;
      const priceDifference = this.numbersDifferencePercentDirect(marketPrice, price);
      const priceSymbol = this.deviationSymbol(priceDifference, constants.PRICE_CHANGE_SIGNIFICANCE_PERCENT, true, isBuy);

      // [May be inaccurate] I've sold 🍤 487.1766 ADM for 5.8 USDT @ 🟢⬆️⬆️ 0.0164621 USDT price.\n
      output += `[May be inaccurate] ${isBuy ? 'I\'ve bought' : 'I\'ve sold'}`;
      output += ` ${volumeSymbol}${this.formatNumber(deltaCoin1, true, coin1Decimals)} _${coin1}_`;
      output += ` for ${this.formatNumber(deltaCoin2, true, coin2DecimalsForStable)} _${coin2}_`;
      output += ` @ ${priceSymbol}${this.formatNumber(price, false, coin2Decimals)} ${coin2} price.\n`;
    }

    return output;
  },

  /**
   * Sums balances by asset code for two accounts.
   * @param {AssetsResult} [b1] Balances of the first account
   * @param {AssetsResult} [b2] Balances of the second account
   * @return {AssetsResult} Combined balances (b1 + b2)
   */
  sumBalances(b1, b2) {
    const b1Clone = Array.isArray(b1) ? this.cloneArray(b1) : [];
    const b2Clone = Array.isArray(b2) ? this.cloneArray(b2) : [];

    // Combine all assets into a single array (merging balances from both accounts)
    const bCombined = b1Clone.concat(b2Clone);

    // Calculate sums for each coin
    const sum = { free: [], freezed: [], total: [] };
    bCombined.forEach((crypto) => {
      sum.free[crypto.code] = (sum.free[crypto.code] || 0) + (crypto.free || 0);
      sum.freezed[crypto.code] = (sum.freezed[crypto.code] || 0) + (crypto.freezed || 0);
      sum.total[crypto.code] = (sum.total[crypto.code] || 0) + (crypto.total || 0);
    });

    const result = [];
    for (const code in sum.total) {
      result.push({
        code,
        free: sum.free[code],
        freezed: sum.freezed[code],
        total: sum.total[code],
      });
    }

    // Clean up values that are NaN, e.g. totalBTC.frozen = NaN
    result.forEach((crypto) => {
      if (isNaN(crypto.free)) delete crypto.free;
      if (isNaN(crypto.freezed)) delete crypto.freezed;
      if (isNaN(crypto.total)) delete crypto.total;
    });

    return result;
  },

  /**
   * Creates a formatted total–available–frozen string for a coin.
   * Example: '29 528.7105 ADM (6 937.2207 available & 22 591.4898 frozen)'
   *
   * TODO: parse decimals depending on spot/perpetual pair.
   *
   * @param {AssetsResultItem} coin Coin balance data
   * @param {boolean} [format=false] Whether to use Markdown formatting (bold/italic)
   * @param {'total-free-frozen' | 'free-frozen'} [type='total-free-frozen'] Defines how the balance information is presented
   * @param {boolean} [parseDecimals=false] Whether to parse decimals dynamically or use 8 decimals
   * @returns {string}
   */
  formCoinBalancesString(coin, format = false, type = 'total-free-frozen', parseDecimals = false) {
    let output;
    let formattedPair;

    let coinDecimals = 8;

    const isConfigCoin = coin.code === config.coin1 || coin.code === config.coin2;

    if (parseDecimals && isConfigCoin) {
      const orderUtils = require('../trade/orderUtils');
      formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(config.defaultPair));

      coinDecimals = coin.code === config.coin1 ?
          formattedPair.coin1Decimals :
          formattedPair.coin2Decimals;
    }

    const code = format ? `_${coin.code}_` : coin.code;
    const total = this.formatNumber(coin.total, format, coinDecimals);
    const free = this.formatNumber(coin.free, format, coinDecimals);
    const freezed = this.formatNumber(coin.freezed, format, coinDecimals);

    if (type === 'total-free-frozen') {
      output = `${total} ${code}`;

      if (coin.total !== coin.free) {
        output += ` (${free} available`;

        if (coin.freezed > 0) {
          output += ` & ${freezed} frozen`;
        }

        output += ')';
      }
    } else {
      output = `Free: ${free} ${code}, frozen: ${freezed} ${code}`;
    }

    return output;
  },

  /**
   * Returns formatted balance strings and numeric fields for a trading pair.
   *
   * @param {AssetsResult} balances Balances from `getBalances()`
   * @param {string|ParsedMarket} pair Pair code such as `ADM/USDT`, or a parsed market object
   * @returns {BalanceHelperResult|undefined}
   */
  balanceHelper(balances, pair) {
    try {
      let formattedPair;

      if (typeof pair === 'string') {
        const orderUtils = require('../trade/orderUtils');
        formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pair));
      } else {
        formattedPair = pair;
      }

      const getCoinData = (code) => balances.find((coin) => coin.code === code) || { code: '', total: 0, free: 0, freezed: 0 };

      const coin1Data = getCoinData(formattedPair.coin1);
      const coin2Data = getCoinData(formattedPair.coin2);

      const free1 = coin1Data.free;
      const free2 = coin2Data.free;
      const freezed1 = coin1Data.freezed;
      const freezed2 = coin2Data.freezed;
      const total1 = coin1Data.total;
      const total2 = coin2Data.total;

      const free1s = free1.toFixed(formattedPair.coin1Decimals);
      const free2s = free2.toFixed(formattedPair.coin2Decimals);
      const freezed1s = freezed1.toFixed(formattedPair.coin1Decimals);
      const freezed2s = freezed2.toFixed(formattedPair.coin2Decimals);
      const total1s = total1.toFixed(formattedPair.coin1Decimals);
      const total2s = total2.toFixed(formattedPair.coin2Decimals);

      const coin1s = this.formCoinBalancesString(coin1Data, false);
      const coin2s = this.formCoinBalancesString(coin2Data, false);

      const coin1sf = this.formCoinBalancesString(coin1Data, true);
      const coin2sf = this.formCoinBalancesString(coin2Data, true);

      const coin1s2 = this.formCoinBalancesString(coin1Data, false, 'free-frozen');
      const coin2s2 = this.formCoinBalancesString(coin2Data, false, 'free-frozen');

      return {
        coin1Data,
        coin2Data,

        free1,
        free2,
        freezed1,
        freezed2,
        total1,
        total2,

        free1s,
        free2s,
        freezed1s,
        freezed2s,
        total1s,
        total2s,

        coin1s,
        coin2s,
        coin1sf,
        coin2sf,

        coin1s2,
        coin2s2,
      };
    } catch (e) {
      log.error(`Error in balanceHelper() of ${this.moduleName} module: ${e}`);
      return undefined;
    }
  },

  /**
   * Calculates the symmetric percentage difference between two values.
   * The result is the same regardless of whether `a` and `b` are swapped.
   *
   * Examples:
   *   0, 0   ⟶ 0%
   *   0, 10  ⟶ 200%
   *   5, 10  ⟶ 66.66666%
   *   10, 5  ⟶ 66.66666%
   *   10, 0  ⟶ 200%
   *   10, 10 ⟶ 0%
   *
   * @param {number} a First value
   * @param {number} b Second value
   * @return {number} Symmetric percentage difference, or undefined if inputs are invalid
   */
  numbersDifferencePercent(a, b) {
    if (!this.isNumber(a) || !this.isNumber(b)) return undefined;
    if (a === 0 && b === 0) return 0;
    return 100 * Math.abs( ( a - b ) / ( (a + b)/2 ) );
  },

  /**
   * Calculates the percentage difference from value `a` to value `b`.
   * The result is directional and can be negative.
   *
   * Examples:
   *   0, 0   ⟶ 0%
   *   0, 10  ⟶ Infinity
   *   5, 10  ⟶ +100%
   *   10, 5  ⟶ -50%
   *   10, 0  ⟶ -100%
   *   10, 10 ⟶ 0%
   *
   * @param {number} a Initial value
   * @param {number} b Final value
   * @returns {number | undefined} Percentage difference, or undefined if inputs are invalid
   */
  numbersDifferencePercentDirect(a, b) {
    if (!this.isNumber(a) || !this.isNumber(b)) return undefined;
    if (a === 0 && b === 0) return 0;
    return 100 * ( ( b - a ) / a );
  },

  /**
   * Calculates how much value `a` represents relative to `a + b`.
   *
   * @example
   * disbalancePercent(10, 10)   // 50
   * disbalancePercent(10, 100)  // 9.09
   * disbalancePercent(100, 10)  // 90.91
   *
   * @param {number} a First value
   * @param {number} b Second value
   * @returns {number} Share of `a` in percent
   */
  disbalancePercent(a, b) {
    // Handle the case where both values are zero to avoid division by zero
    if (a === 0 && b === 0) {
      return 50;
    }

    const total = a + b;
    const ratio = a / total;

    // Calculate the disbalance percentage
    return ratio * 100;
  },

  /**
   * Computes how much to add to `a` so that `disbalancePercent(a, b)` reaches the target threshold.
   *
   * 10, 10 -> disbalancePercent 50%, -> targetBalancePercentThreshold = 30 -> +0
   * 10, 100 -> disbalancePercent 9.09%, -> targetBalancePercentThreshold = 30 -> +23
   * 100, 10 -> disbalancePercent 9.09%, -> targetBalancePercentThreshold = 30 -> −23
   * 0, 100 -> disbalancePercent 0%, -> targetBalancePercentThreshold = 40 -> 40
   * 100, 0 -> disbalancePercent 100%, -> targetBalancePercentThreshold = 40 -> −40
   *
   * @param {number} a First value
   * @param {number} b Second value
   * @param {number} targetBalancePercentThreshold Desired share of `a` in percent
   * @returns {number} Adjustment for `a`; positive means add, negative means subtract
   */
  fixDisbalance(a, b, targetBalancePercentThreshold) {
    const total = a + b;

    const targetAPercentage = targetBalancePercentThreshold;
    const currentAPercentage = this.disbalancePercent(a, b);

    let targetValueForA;

    if (currentAPercentage < targetAPercentage) {
      targetValueForA = (total * targetAPercentage) / 100;
    } else if (currentAPercentage > 100 - targetAPercentage) {
      targetValueForA = ((total * (100 - targetAPercentage)) / 100);
    } else {
      return 0;
    }

    return targetValueForA - a;
  },

  /**
   * Returns how many milliseconds are in a named time unit.
   *
   * @param {string} timeUnit Unit name such as `days` or `minutes`
   * @returns {number|undefined} Milliseconds in the unit, or `undefined` when unknown
   */
  timeUnitMultiplier(timeUnit) {
    timeUnit = timeUnit?.toUpperCase();
    let timeUnitMultiplier;
    switch (timeUnit) {
      case 'MIN':
      case 'MINS':
      case 'MINUTE':
      case 'MINUTES':
        timeUnitMultiplier = 1000 * 60;
        break;
      case 'HR':
      case 'HRS':
      case 'HOUR':
      case 'HOURS':
        timeUnitMultiplier = 1000 * 60 * 60;
        break;
      case 'DAY':
      case 'DAYS':
        timeUnitMultiplier = 1000 * 60 * 60 * 24;
        break;
      case 'WEEK':
      case 'WEEKS':
        timeUnitMultiplier = 1000 * 60 * 60 * 24 * 7;
        break;
      case 'MONTH':
      case 'MONTHS':
        timeUnitMultiplier = 1000 * 60 * 60 * 24 * 30;
        break;
      default:
        break;
    }
    return timeUnitMultiplier;
  },

  /**
   * Returns the singular or plural form of a noun based on `number`.
   *
   * @param {number} number Count used for pluralization
   * @param {string} one Singular form, e.g. `day`
   * @param {string} some Plural form, e.g. `days`
   * @returns {string} e.g. `day` for `1`, `days` for `2`
   */
  incline(number, one, some) {
    return number > 1 ? some: one;
  },

  /**
   * Returns an English ordinal suffix for a non-negative integer.
   *
   * @param {number} number Number to format
   * @returns {string} e.g. `0th`, `1st`, `2d`, `4th`, `21st`
   */
  inclineNumber(number) {
    if (!this.isPositiveOrZeroInteger(number)) {
      return String(number);
    }

    if (number % 10 === 1 && number !== 11) {
      return `${number}st`;
    } else if ([2, 3].includes(number % 10) && ![12, 13].includes(number)) {
      return `${number}d`;
    } else {
      return `${number}th`;
    }
  },

  /**
   * Formats a duration in milliseconds as a human-readable string.
   *
   * @param {number} timestamp Duration in milliseconds
   * @param {boolean} [addSecs=false] Whether to include seconds
   * @returns {string} e.g. `1 day 5 hours`
   */
  timestampInDaysHoursMins(timestamp, addSecs = false) {
    let timeString = '';
    let secs = Math.floor(timestamp/1000);
    let mins = Math.floor(secs/60);
    let hours = Math.floor(mins/60);

    const days = Math.floor(hours/24);
    hours = hours-(days*24);
    mins = mins-(days*24*60)-(hours*60);
    secs = secs-(days*24*60*60)-(hours*60*60)-(mins*60);

    if (days > 0) {
      timeString = timeString + days + ' ' + this.incline(days, 'day', 'days');
    }
    if ((days < 7) && (hours > 0)) {
      timeString = timeString + ' ' + hours + ' ' + this.incline(hours, 'hour', 'hours');
    }
    if ((days === 0) && (mins > 0)) {
      timeString = timeString + ' ' + mins + ' ' + this.incline(mins, 'min', 'mins');
    }
    if (addSecs && secs && (days === 0) && (hours === 0) && (mins < 10)) {
      timeString += ' ' + secs + ' ' + this.incline(secs, 'sec', 'secs');
    }

    timeString = timeString.trim();

    if (timeString === '') {
      if (addSecs) {
        timeString = '~0 secs';
      } else {
        timeString = '~0 mins';
      }
    }

    return timeString;
  },

  /**
   * Converts a timestamp (ms) to a human-readable "time ago" string.
   *
   * Rules:
   * - Uses the first unit where value >= 1.
   * - No fractions — integer only.
   * - Units: ms, s, m, h, d, w, mon, y.
   *
   * Examples:
   *   timeAgo(1002)      → "1s ago"
   *   timeAgo(999)       → "999ms ago"
   *   timeAgo(119999)    → "1m ago"
   *   timeAgo(120000)    → "2m ago"
   *   timeAgo(Date.now() - (3 * 60 * 60 * 1000)) → "3h ago"
   *
   * @param {number} timestampMs Timestamp in milliseconds (absolute or diff)
   * @return {string}
   */
  timeAgoString(timestampMs) {
    const diff = timestampMs > 1e12 ? Date.now() - timestampMs : timestampMs;

    const units = [
      { u: 'y', ms: 365 * 24 * 60 * 60 * 1000 },
      { u: 'mon', ms: 30 * 24 * 60 * 60 * 1000 },
      { u: 'w', ms: 7 * 24 * 60 * 60 * 1000 },
      { u: 'd', ms: 24 * 60 * 60 * 1000 },
      { u: 'h', ms: 60 * 60 * 1000 },
      { u: 'm', ms: 60 * 1000 },
      { u: 's', ms: 1000 },
      { u: 'ms', ms: 1 },
    ];

    for (const { u, ms } of units) {
      const v = Math.floor(diff / ms);

      if (v >= 1) {
        return `${v}${u} ago`;
      }
    }

    return '0ms ago';
  },

  /**
   * Markdown to Telegram MarkdownV2 via optional `telegramBot/format.js`, or basic escaping when omitted.
   *
   * @param {string} text Message
   * @returns {string}
   */
  escapeMarkdownTelegram(text) {
    const format = this.softRequire('../telegramBot/format', __filename);

    return format ? format(text) : noopEscapeMarkdownTelegram(text);
  },

  /**
   * Get 30 day ago timestamp
   * @returns {number}
   */
  getPrevMonthTimestamp() {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return +(date.getTime() / 1000).toFixed(0) + 86400;
  },

  /**
   * Creates an url params string as: key1=value1&key2=value2
   * @param {Object} data Request params
   * @returns {String}
   */
  getParamsString(data) {
    const params = [];

    for (const key in data) {
      const value = data[key];

      if (value !== undefined) {
        params.push(`${key}=${value}`);
      }
    }

    return params.join('&');
  },

  /**
   * Recursively sorts object keys in ascending order.
   * Arrays preserve order, but their items are processed recursively.
   *
   * @param {any} value Object/array/primitive to sort
   * @returns {any} Deep clone with sorted object keys
   */
  sortObjectKeys(value) {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortObjectKeys(item));
    }

    if (value && typeof value === 'object') {
      const sorted = {};

      for (const key of Object.keys(value).sort()) {
        sorted[key] = this.sortObjectKeys(value[key]);
      }

      return sorted;
    }

    return value;
  },

  /**
   * Recursively flattens object/array values to a string array.
   * Undefined and null values are skipped.
   *
   * @param {any} value Object/array/primitive to flatten
   * @param {string[]} [result=[]] Result accumulator
   * @returns {string[]} Flat list of values as strings
   */
  flattenObjectValues(value, result = []) {
    if (Array.isArray(value)) {
      value.forEach((item) => this.flattenObjectValues(item, result));
      return result;
    }

    if (value && typeof value === 'object') {
      Object.keys(value).sort().forEach((key) => {
        this.flattenObjectValues(value[key], result);
      });

      return result;
    }

    if (value !== undefined && value !== null) {
      result.push(String(value));
    }

    return result;
  },

  /**
   * Calculates open-order statistics used by the liquidity provider.
   *
   * @param {Object[]} orders Subset of `ordersDb` records
   * @returns {CalculateOrderStatsResult}
   */
  calculateOrderStats(orders) {
    let bidsTotalAmount = 0; let asksTotalAmount = 0;
    let bidsTotalQuoteAmount = 0; let asksTotalQuoteAmount = 0;
    let totalAmount = 0; let totalQuoteAmount = 0;
    let asksCount = 0; let bidsCount = 0; let totalCount = 0;

    for (const order of orders) {
      if (order.side === 'buy') {
        bidsTotalAmount += order.coin1AmountLeft;
        bidsTotalQuoteAmount += order.coin2AmountLeft;
        bidsCount += 1;
      }

      if (order.side === 'sell') {
        asksTotalAmount += order.coin1AmountLeft;
        asksTotalQuoteAmount += order.coin2AmountLeft;
        asksCount += 1;
      }

      totalAmount += order.coin1AmountLeft;
      totalQuoteAmount += order.coin2AmountLeft;
      totalCount += 1;
    }

    return {
      bidsTotalAmount, asksTotalAmount,
      bidsTotalQuoteAmount, asksTotalQuoteAmount,
      totalAmount, totalQuoteAmount,
      asksCount, bidsCount, totalCount,
    };
  },

  /**
   * Calculates VWAP (Volume-Weighted Average Price) for a series of orders executed on the same side (buy OR sell).
   *
   * Important:
   *  - `orders` MUST be pre-filtered by `order.side`.
   *    Mixing buy and sell orders breaks the economic meaning of VWAP.
   *  - The resulting VWAP represents the average EXECUTION price
   *    for the given side, weighted by the actually filled base amount.
   *
   * Typical use cases:
   *  - Buy VWAP: "At what average price did I acquire the asset?"
   *  - Sell VWAP: "At what average price did I dispose of the asset?"
   *  - Execution quality, MM performance, spread capture, balance analysis.
   *
   * @param {Object[]} orders
   *   List of orders from the internal DB, already filtered by `side`.
   *   May include skipped or failed orders (`coin1AmountFilled === 0` or `undefined`), which are ignored in VWAP but counted in statistics.
   *
   * @returns {VwapMetrics} Order execution metrics, including side-specific VWAP
   */
  calculateVWAP(orders) {
    let filledOrders = 0;
    let partFilledOrders = 0;
    let skippedOrders = 0;
    let uncertainOrders = 0;

    let totalQuote = 0;
    let totalAmount = 0;

    orders.forEach((order) => {
      const amount = order.coin1AmountFilled;
      const price = order.priceFilled || order.price; // Special tw-orders include priceFilled

      if (amount && price) {
        totalQuote += amount * price;
        totalAmount += amount;

        if (order.coin1AmountFilled === order.coin1Amount) {
          filledOrders++;
        } else {
          partFilledOrders++;
        }

        if (order.probablyFilled) {
          uncertainOrders++;
        }
      } else {
        skippedOrders++;
      }
    });

    const vwap = totalAmount ? totalQuote / totalAmount : 0;

    return {
      vwap,
      totalOrders: orders.length,
      filledOrders,
      partFilledOrders,
      filledAndPartFilledOrders: filledOrders + partFilledOrders,
      skippedOrders,
      uncertainOrders,
      totalAmount,
      totalQuote,
    };
  },

  /**
   * XOR operand (exclusive or)
   * @param {boolean | any} a Value a
   * @param {boolean | any} b Value b
   * @returns {boolean} a xor b
   */
  xor(a, b) {
    return (a || b) && !(a && b);
  },

  /**
   * Parses a CLI command parameter array.
   *
   * @example
   * BTC/USDT sell amount=10 minprice=32k time=50m interval=30sec strategy=Stepdown
   *
   * @param {string[]} params Command parameter list
   * @param {number} [min=0] Minimum allowed parameter count
   * @returns {ParsedCommandParams|undefined}
   */
  parseCommandParams(params, min = 0) {
    const paramCount = params?.length;
    let paramCountWoMarkers = paramCount; // Subtract -y and -2

    if (!Array.isArray(params) || paramCount < min) {
      return;
    }

    const parsed = {
      more: [],
    };

    for (let index = 0; index < paramCount; index++) {
      const param = params[index];
      const paramNext = params[index+1];

      const paramLc = param.toLowerCase();
      const paramUc = param.toUpperCase();

      let knownParam = true;

      // Check if param is an order purpose like 'ld2' or 'man'
      // Note: parsePurpose() processes only ld(1) and ld2 as module-indexed purpose. E.g., 'man2' or 'ld3' will be ignored.
      // Note: parsedPurpose does not work with features, because not all features have a corresponding order purpose

      const parsedPurpose = require('../trade/orderCollector').parsePurpose(paramLc);

      if (parsedPurpose.parsed) {
        delete parsedPurpose.parsed;
        Object.assign(parsed, parsedPurpose);
      }

      // Test a param for more standard values

      if (this.isPerpetual(param)) {
        parsed.pair = param.toUpperCase();
        parsed.perpetual = true;
      } else if (param.includes('/')) {
        parsed.pair = paramUc;
      } else if (param.includes('=')) {
        const [key, value] = param.split('=');

        const keyLc = key.toLowerCase();
        parsed[keyLc] = value.trim();
        parsed[`${keyLc}__index`] = index; // Plain indexing, including not knownParams in more[]
      } else if (param.endsWith('%')) {
        const percent = this.parsePercent(param, false);

        if (percent.parsed) {
          parsed.percent = percent.percent;
        }

        parsed.percentString = param;
      } else if (param.startsWith('>') || param.startsWith('<')) {
        parsed.condition = {};

        const operator = param.charAt(0);
        const value = +param.substring(1);

        if (!this.isPositiveOrZeroNumber(value)) {
          parsed.condition.isValid = false;
          parsed.condition.error = `Indicate price after '${operator}'`;
        }

        parsed.condition.string = param;
        parsed.condition.operator = operator;
        parsed.condition.value = value;

        const valueCoin = paramNext?.toUpperCase();
        if (/^[A-Z0-9]+$/i.test(valueCoin)) {
          parsed.condition.valueCoin = valueCoin;
        }

        const mongoFilter = {};
        if (operator === '<') {
          mongoFilter.value = { $lt: value };
        } else {
          mongoFilter.value = { $gt: value };
        }

        parsed.condition.mongoFilter = mongoFilter;
      } else if (paramLc === '-y') {
        parsed.isConfirmed = true;

        paramCountWoMarkers -= 1;
      } else if (param === '-2') {
        parsed.useSecondAccount = true;

        paramCountWoMarkers -= 1;
      } else if (['buy', 'sell'].includes(paramLc)) {
        parsed.orderSide = paramLc;
      } else if (index === 0 && /^[A-Z0-9]+$/i.test(param)) { // Treat the first param as coin
        parsed.possibleCoin = param.toUpperCase();
        knownParam = false;
      } else {
        knownParam = false;
      }

      // Include not known params in parsed.more[]

      if (!knownParam) {
        const intervalChars = ['-', '–', '—'];

        parsed.more.push({
          param: paramLc,
          paramPlain: param,
          paramUc,
          paramNumber: Number(param),
          paramSmartNumber: this.parsePositiveSmartNumber(param),
          index, // Plain indexing, including knownParams like param=value
          isFirst: index === 0,
          isLast: index === params.length - 1,
          isInteger: this.isInteger(+param),
          isNumeric: this.isNumeric(param),
          isInterval: intervalChars.some((char) => param.includes(char)),
          isTimeUnit: this.isTimeUnitString(param),
        });
      }
    }

    parsed.paramCount = paramCount;
    parsed.paramCountWoMarkers = paramCountWoMarkers; // Don't count -2 and -y
    parsed.paramCountUnknown = parsed.more.length; // Additional (not knownParams) param count
    parsed.exactParamsCount = paramCountWoMarkers === min; // Check if params don't include nothing unexpected

    parsed.pairErrored = !parsed.pair && paramCount > 0; // Params exist, but none of them is a trading pair or perpetual contract
    parsed.pairOrCoinErrored = !parsed.pair && !parsed.possibleCoin && paramCount > 0; // None of them is a pair, perpetual contract, or coin

    parsed.is = (paramName) => parsed.more.some((param) => param.param === paramName); // If additional (not knownParams) params include paramName

    parsed.moreByName = (paramName) => parsed.more.find((param) => param.param === paramName?.toLowerCase()); // Get param from more[] by param name
    parsed.moreByIndex = (index) => parsed.more.find((param) => param.index === index); // Get param from more[] by plain index
    parsed.getFirst = () => parsed.more.find((param) => param.isFirst); // Get the first param from more[]
    parsed.getLast = () => parsed.more.find((param) => param.isLast); // Get the last param from more[]

    parsed.indexOf = (paramName) => parsed[`${paramName}__index`] ?? parsed.moreByName(paramName)?.index; // Get plain param index

    parsed.nextTo = (paramName) => { // Get param from more[] next to specific param
      const paramIndex = parsed.indexOf(paramName);
      return parsed.moreByIndex(paramIndex+1);
    };
    parsed.prevTo = (paramName) => { // Get param from more[] before specific param
      const paramIndex = parsed.indexOf(paramName);
      return parsed.moreByIndex(paramIndex-1);
    };

    parsed.getInterval = () => parsed.more.find((param) => param.isInterval); // Returns the first interval found, e.g., "1-10"

    parsed.getTimeInterval = () => // Returns the interval that is followed by a time-unit parameter. Example: in "1-10 sec", this returns the param "1-10".
      parsed.more.find((param) => {
        if (!param.isInterval) return false;

        const nextParam = parsed.nextTo(param.param);
        return nextParam?.isTimeUnit;
      });

    parsed.getOtherInterval = () => { // Returns an interval that is NOT a "time interval"
      const timeInterval = parsed.getTimeInterval();

      return parsed.more.find((param) => param.isInterval && param !== timeInterval);
    };

    parsed.getWhereIncluded = (namesArray) => // Returns the first param from parsed.more where param.param is included in the provided list
      parsed.more.find((param) => namesArray.includes(param.param));

    // Check if command params include amount or quote, but not both of them

    parsed.xorAmounts = this.xor(+parsed.amount, +parsed.quote);
    if (parsed.xorAmounts) {
      if (+parsed.amount) {
        parsed.amountType = 'amount';
        parsed.qty = +parsed.amount;
      } else {
        parsed.amountType = 'quote';
        parsed.qty = +parsed.quote;
      }
    }

    parsed.paramString = params.join(' ');

    return /** @type {ParsedCommandParams} */ (parsed);
  },

  /**
   * Validates a CLI command parameter against a verification rule.
   *
   * Error messages may include Markdown formatting.
   *
   * @param {string} name Parameter name
   * @param {string} param Parameter value
   * @param {VerificationTypes} verificationType Verification rule
   * @param {boolean} [isOptional=false] Whether `undefined` is allowed
   * @returns {ParamVerifyResult}
   */
  verifyParam(name, param, verificationType, isOptional = false) {
    if (isOptional && param === undefined) {
      return {
        success: true,
        plain: param,
        parsed: param,
      };
    }

    if (!param) {
      return {
        success: false,
        message: `Param _${name}_ is not set`,
      };
    }

    if (verificationType === 'integer') {
      const parsed = Number(param);

      if (this.isInteger(parsed)) {
        return {
          success: true,
          plain: param,
          parsed,
        };
      } else {
        return {
          success: false,
          message: `Param _${name}_ is not an integer: _${param}_`,
        };
      }
    }

    if (verificationType === 'positive integer') {
      const parsed = Number(param);

      if (this.isPositiveInteger(parsed)) {
        return {
          success: true,
          plain: param,
          parsed,
        };
      } else {
        return {
          success: false,
          message: `Param _${name}_ is not a positive integer: _${param}_`,
        };
      }
    }

    if (verificationType === 'positive or zero integer') {
      const parsed = Number(param);

      if (this.isPositiveOrZeroInteger(parsed)) {
        return {
          success: true,
          plain: param,
          parsed,
        };
      } else {
        return {
          success: false,
          message: `Param _${name}_ is not a positive or zero integer: _${param}_`,
        };
      }
    }

    if (verificationType === 'number') {
      const parsed = Number(param);

      if (this.isNumber(parsed)) {
        return {
          success: true,
          plain: param,
          parsed,
        };
      } else {
        return {
          success: false,
          message: `Param _${name}_ is not a number: _${param}_`,
        };
      }
    }

    if (verificationType === 'positive number') {
      const parsed = Number(param);

      if (this.isPositiveNumber(parsed)) {
        return {
          success: true,
          plain: param,
          parsed,
        };
      } else {
        return {
          success: false,
          message: `Param _${name}_ is not a positive number: _${param}_`,
        };
      }
    }

    if (verificationType === 'positive or zero number') {
      const parsed = Number(param);

      if (this.isPositiveOrZeroNumber(parsed)) {
        return {
          success: true,
          plain: param,
          parsed,
        };
      } else {
        return {
          success: false,
          message: `Param _${name}_ is not a positive or zero number: _${param}_`,
        };
      }
    }

    if (verificationType === 'positive smart number') {
      const parsed = this.parsePositiveSmartNumber(param);

      if (parsed.isNumber) {
        return {
          success: true,
          plain: param,
          parsed, // Type ParsedPositiveSmartNumber
        };
      } else {
        return {
          success: false,
          message: `Param _${name}_ is not a positive smart number: _${param}_`,
        };
      }
    }

    if (verificationType === 'smart time') {
      const parsed = this.parseSmartTime(param);

      if (parsed.isTime) {
        return {
          success: true,
          plain: param,
          parsed, // Type ParsedSmartTime
        };
      } else {
        return {
          success: false,
          message: `Param _${name}_ is not a smart time value: _${param}_`,
        };
      }
    }

    if (verificationType.startsWith('[')) {
      const enumList = this.parseEnumArray(verificationType);

      const lc = param.toLowerCase();

      if (enumList.includes(lc)) {
        return {
          success: true,
          parsed: param,
          lc,
        };
      } else {
        return {
          success: false,
          message: `Param _${name}_ is not in the allowed list _${verificationType}_: _${param}_`,
        };
      }
    }

    return {
      success: true,
      parsed: param,
      lc: param.toLowerCase(),
      uc: param.toUpperCase(),
    };
  },

  /**
   * Pauses async execution for the given duration.
   *
   * @param {number} ms Pause duration in milliseconds
   * @param {string} [pauseReason] Optional message written to the log before sleeping
   * @returns {Promise<void>}
   */
  pauseAsync(ms, pauseReason) {
    if (pauseReason) {
      log.log(pauseReason);
    }

    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * @returns {string[]} Known perpetual quote suffixes
   */
  perpetuals() {
    return ['USDT', 'USDC', 'USD'];
  },

  /**
   * Checks whether a string looks like a perpetual contract ticker.
   *
   * @param {string} str Contract symbol, e.g. `ETHUSDT`
   * @param {string|string[]} [types] Quote suffixes to accept, e.g. `USDT` or `['USDT', 'USDC']`
   * @returns {string|false} Upper-cased ticker when matched, otherwise `false`
   */
  isPerpetual(str, types) {
    try {
      types = types || this.perpetuals();

      if (typeof types === 'string') {
        types = [types];
      }

      for (const type of types) {
        // Match `<BASE><QUOTE>` where the suffix is a known perpetual quote currency.
        if (
          /^[A-Z0-9]+$/i.test(str) &&
          str.toLowerCase().endsWith(type.toLowerCase()) &&
          str.length > type.length
        ) {
          return str.toUpperCase();
        }
      }
    } catch (error) {
      log.debug(`${this.moduleName}/isPerpetual: Unable to parse '${str}'. ${error}`);
    }

    return false;
  },

  /**
   * Default list of popular stable-coin tickers.
   *
   * Used to avoid noisy confirmation prompts such as
   * "Are you sure to convert 10k USDC worth ~10 000 USD to USD?"
   *
   * @returns {string[]}
   */
  stables() {
    return ['USDT', 'USDC', 'USD', 'TUSD'];
  },

  /**
   * Checks whether a string is a known stable-coin ticker.
   *
   * @param {string} str Ticker to test, e.g. `USDC`
   * @param {string|string[]} [tickers] Allowed stable tickers; defaults to `stables()`
   * @returns {boolean}
   */
  isStableCoin(str, tickers) {
    try {
      tickers = tickers || this.stables();

      if (typeof tickers === 'string') {
        tickers = [tickers];
      }

      str = str.toUpperCase();

      return tickers.includes(str);
    } catch (error) {
      log.debug(`${this.moduleName}/isStableCoin: Unable to parse '${str}'. ${error}`);
    }

    return false;
  },

  /**
   * Checks whether `|value|` is large enough to show in balance reports.
   *
   * - Stable coins: greater than ~0.01 USD
   * - BTC: greater than ~0.00000009 BTC (~0.009 USD at BTC 100k)
   * - Trading coins: greater than the market minimum precision for coin1 or coin2
   * - Other coins: greater than ~0.01 USD after conversion
   *
   * @param {number} value Balance amount
   * @param {string} coin Coin ticker
   * @returns {boolean}
   */
  isCoinValueSignificant(value, coin) {
    value = Math.abs(value);
    coin = coin?.toUpperCase();

    const stableCoin = this.isStableCoin(coin);
    const isBTC = coin === 'BTC';

    if (stableCoin) {
      return value >= 0.01;
    } else if (isBTC) {
      return value >= 0.00000009; // ~0.009 USD at BTC 100k
    } else {
      const orderUtils = require('../trade/orderUtils');
      const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(config.defaultPair));
      const { coin1Decimals, coin2DecimalsForStable } = formattedPair;

      if (coin === config.coin1) {
        return value >= this.getPrecision(coin1Decimals);
      }

      if (coin === config.coin2) {
        return value >= this.getPrecision(coin2DecimalsForStable);
      }

      const exchangerUtils = require('./cryptos/exchanger');
      const usdValue = exchangerUtils.convertCryptos(coin, 'USD', value)?.outAmount;

      if (usdValue) {
        return usdValue >= 0.01;
      }
    }

    return true;
  },

  /**
   * Checks whether a ticker belongs to the configured trading pair (`coin1` or `coin2`).
   *
   * @param {string} str Ticker to test, e.g. `USDT`
   * @returns {boolean}
   */
  isTradingCoin(str) {
    str = str?.toUpperCase();
    return str === config.coin1 || str === config.coin2;
  },

  /**
   * Formats text as a Markdown code block.
   *
   * @param {string} text Text to wrap
   * @param {boolean} [addOuterLineBreaks=true] Whether to add `\n` before and after the block
   * @returns {string}
   */
  codeBlock(text, addOuterLineBreaks = true) {
    let code = '```\n' + this.trimAny(text, '\n') + '\n```';

    if (addOuterLineBreaks) {
      code = '\n' + code + '\n';
    }

    return code;
  },

  /**
   * Formats a string as inline Markdown code using backticks.
   *
   * @param {string} str String to format
   * @returns {string}
   */
  codeString(str) {
    return '`' + str + '`';
  },

  /**
   * Builds an ASCII table with aligned columns.
   *
   * @param {string[]} header Header row
   * @param {Array<Array<string|number>>} content Body rows; a row containing only `'---'` renders a separator
   * @returns {string}
   */
  generateTable(header, content) {
    const data = [header, ...content];

    const columnsWidth = data[0].map((_, index) =>
      Math.max(...data.map((row) => row[index] === '---' ? 0 : row[index].toString().length)),
    );

    const separator = '+-' + columnsWidth.map((width) => '-'.repeat(width)).join('-+-') + '-+';

    const formatRow = (row) => {
      return '| ' + row.map((cell, index) => {
        const cellContent = cell.toString();
        return cellContent + ' '.repeat(columnsWidth[index] - cellContent.length);
      }).join(' | ') + ' |';
    };

    const formattedTable = [
      separator,
      formatRow(header),
      separator,
      ...content.map((row) => row.includes('---') ? separator : formatRow(row)),
      separator,
    ];

    return formattedTable.join('\n');
  },

  /**
   * Parses a percent value from a `number%` string.
   *
   * @param {string} str Input string
   * @param {boolean} [allowZeroAndNegative=true] Whether zero and negative values are accepted
   * @returns {ParsePercentResult}
   */
  parsePercent(str, allowZeroAndNegative = true) {
    if (typeof str === 'string' && str.endsWith('%')) {
      const percent = +str.slice(0, -1);

      const condition = allowZeroAndNegative ? this.isNumber(percent) : this.isPositiveNumber(percent);

      if (condition) {
        return {
          parsed: true,
          percent,
        };
      }
    }

    return {
      parsed: false,
    };
  },

  /**
   * Capitalizes the first letter of a string.
   * @param {string} [str=''] Input string
   * @return {string} String with the first character uppercased
   *   - capitalize('hello world'); // "Hello world"
   *   - capitalize(); // ""
   */
  capitalize(str = '') {
    if (!str) return '';
    return str[0].toUpperCase() + str.slice(1);
  },

  /**
   * Safely requires an optional module.
   *
   * Unlike a regular `require`, this helper will not throw if the module
   * does not exist or fails to load. Instead, it returns `undefined`,
   * allowing optional features to be plugged in without hard dependency.
   *
   * Relative paths (`./` or `../`) resolve from the **calling file** (detected
   * via stack trace), not from `helpers/utils.js`. Pass `fromFile` to override
   * the resolution base explicitly (tests, wrappers).
   *
   * @param {string} moduleName Module path or package name
   * @param {string} [fromFile] Optional absolute path used as the `require` base
   * @returns {any | undefined} The required module, or `undefined` if it cannot be loaded
   *
   * @example
   * // In modules/commands/account.js:
   * const bw = utils.softRequire('../../trade/mm_balance_watcher');
   *
   * @example
   * // Explicit base:
   * const make = utils.softRequire('./commands/make', __filename);
   */
  softRequire(moduleName, fromFile) {
    let base;
    let cacheKey;

    if (moduleName.startsWith('.')) {
      base = fromFile || getSoftRequireCallerFile();

      if (!base) {
        log.warn(`utils/softRequire: Cannot resolve relative path '${moduleName}' — caller file undetectable and no fromFile given`);
        return undefined;
      }

      cacheKey = `${base}\0${moduleName}`;
    } else {
      cacheKey = moduleName;
    }

    if (softRequireCache.has(cacheKey)) {
      return softRequireCache.get(cacheKey);
    }

    try {
      const loaded = base ?
        createRequire(path.resolve(base))(moduleName) :
        require(moduleName);

      softRequireCache.set(cacheKey, loaded);
      return loaded;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'MODULE_NOT_FOUND') {
        log.warn(`utils/softRequire: Failed to load '${moduleName}'. ${e}`);
      }

      softRequireCache.set(cacheKey, undefined);
      return undefined;
    }
  },

  /**
   * Optional `telegramBot/api.js`. Returns a no-op client when the module is omitted.
   *
   * @param {string} [token] Telegram Bot API token
   * @returns {import('../telegramBot/api.js') | typeof noopTelegramBot}
   */
  createTelegramBotApi(token = '') {
    const TelegramBotApiClass = this.softRequire('../telegramBot/api', __filename);

    return TelegramBotApiClass ? new TelegramBotApiClass(token) : noopTelegramBot;
  },

  /**
   * Whether `telegramBot/api.js` is present in this build.
   *
   * @returns {boolean}
   */
  isTelegramBotModuleAvailable() {
    return Boolean(this.softRequire('../telegramBot/api', __filename));
  },

  /**
   * Returns a UTF symbol indicating value direction (up/down) and deviation strength relative to a threshold.
   * Threshold is treated as absolute magnitude.
   *
   * Levels:
   *   > 0.5× threshold  → weak
   *   > 1×   threshold → normal
   *   > 2×   threshold → strong
   *   > 5×   threshold → extreme
   *
   * @param {number} value Actual value (can be negative)
   * @param {number} threshold Reference threshold (absolute value is used)
   * @param {boolean} [addSpace=true] Whether to append a trailing space if symbol is not empty
   * @param {boolean} [inverseColor=false] Whether to invert the color indication
   * @returns {string} UTF symbol representing direction and strength, or empty string if insignificant
   *
   * @example
   * deviationSymbol(12, 10);              // '↑ '
   * deviationSymbol(12, 10, false);       // '↑'
   * deviationSymbol(-60, 10);             // '↓↓↓ '
   *
   */
  deviationSymbol(value, threshold, addSpace = true, inverseColor = false) {
    if (!Number.isFinite(value) || !Number.isFinite(threshold) || threshold === 0) {
      return '';
    }

    const absThreshold = Math.abs(threshold);
    const absValue = Math.abs(value);

    let level = 0;

    if (absValue > absThreshold * 5) level = 4;
    else if (absValue > absThreshold * 2) level = 3;
    else if (absValue > absThreshold) level = 2;
    else if (absValue > absThreshold / 2) level = 1;
    else return '';

    const colorCondition = inverseColor ? value < 0 : value > 0;
    let symbol = (colorCondition ? '🟢' : '🔴');
    symbol += (value > 0 ? '⬆️' : '⬇️').repeat(level);

    return addSpace ? `${symbol} ` : symbol;
  },

  /**
   * Returns a volume symbol based on configured thresholds 🦐 🍤 🐟 🐬 🦈 🐳
   * @param {number} volume Volume in USD, can be negative for delta volumes
   * @param {boolean} [addSpace=true] Whether to append a trailing space if symbol is not empty
   * @returns {string} E.g., '🐳 ' or ''
   */
  volumeSymbol(volume, addSpace = true) {
    volume = Math.abs(volume);

    if (!Number.isFinite(volume)) {
      return '';
    }

    let volumeSymbol = '';

    for (const [symbol, threshold] of Object.entries(config.volumes_thresholds_usd)) {
      if (volume >= threshold) {
        volumeSymbol = symbol;
      } else {
        break;
      }
    }

    return volumeSymbol && addSpace ? `${volumeSymbol} ` : volumeSymbol;
  },
};

module.exports.watchConfig();
