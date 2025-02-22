/**
 * @module helpers/utils
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 */

const config = require('../modules/configReader');
const log = require('./log');
let tradeParams = require('../trade/settings/tradeParams_' + config.exchange);
const fs = require('fs');
const { SAT, EPOCH, MINUTE, LIQUIDITY_SS_MAX_SPREAD_PERCENT } = require('./const');
const equal = require('fast-deep-equal');
const { diff } = require('deep-object-diff');

const AVERAGE_SPREAD_DEVIATION = 0.15;

module.exports = {
  get moduleName() {
    return this.getModuleName(/** @type {NodeJS.Module} */ (module).id);
  },

  /**
   * Reads a trade config file and transforms it to a JSON-readable string
   * @return {String}
   */
  readTradeConfig() {
    const tradeConfig = fs.readFileSync(config.fileWithPath).toString()
        .replace(/\n/g, '').replace('module.exports = ', '').replace(/'/g, '"').replace(';', '').replace(',}', '}');
    return tradeConfig;
  },

  /**
   * Watch tradeParams_EXCHANGE file for updates.
   * It may be updated by CLI, or in a manual way by admin.
   */
  watchConfig() {
    log.log(`Watching external changes in the trade config file: ${config.fileWithPath}…`);

    fs.watch(config.fileWithPath, () => {
      let newConfigString;

      try {
        newConfigString = this.readTradeConfig();
        const newConfig = JSON.parse(newConfigString);

        if (!equal(tradeParams, newConfig)) {
          log.log(`Config is updated externally: ${JSON.stringify(diff(tradeParams, newConfig))}.`);
          tradeParams = Object.assign(tradeParams, newConfig);
        }
      } catch {
        log.warn(`Trade config is updated externally, but it's not a valid JSON: '${newConfigString}'. Leaving it as is.`);
      }
    });
  },

  /**
   * If a trade config is changed, saves it to file
   * @param {Boolean} isWebApi If changes are made with WebUI
   * @param {String} callerName Who saved config, for logging
   */
  saveConfig(isWebApi = false, callerName) {
    try {
      const oldConfigString = this.readTradeConfig();
      const oldConfig = JSON.parse(oldConfigString);

      if (!equal(tradeParams, oldConfig)) {
        const toSave = 'module.exports = ' + JSON.stringify(tradeParams, null, 2).replace(/"/g, '\'').replace(/\n\}/g, ',\n};\n');
        fs.writeFileSync(config.fileWithPath, toSave);

        const callerInfo = callerName ? ` by ${callerName}` : '';
        log.log(`Trade config ${config.file} is updated${callerInfo} and saved: ${JSON.stringify(diff(oldConfig, tradeParams))}`);
      }
    } catch (error) {
      log.warn(`Error while saving trade config ${config.file}: ${error}`);
    }
  },

  /**
   * Returns object with all of properties as a string for logging
   * @param {*} object Data to convert to string
   * @return {String}
   */
  getFullObjectString(object) {
    const util = require('util');
    return util.inspect(object, { showHidden: false, depth: null, colors: true });
  },

  /**
   * Converts to a string and truncates for logging
   * @param {String} data Data to log
   * @param {Number} length Max length of output. Optional.
   * @param {Boolean} multiLineObjects If get full object output
   * @return {String}
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
    return Math.floor((time - EPOCH) / 1000);
  },

  /**
   * Pads the value with '0' until length of 2 digits
   * 2 -> '02'
   * @param {Number} num Value to pad
   * @returns {string}
   */
  padTo2Digits(num) {
    return num.toString().padStart(2, '0');
  },

  /**
   * Converts date to yyyy-mm-dd hh:mm:ss format
   * @param {Date} date
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
   * Converts provided `time` (ms) to timeZone's timestamp (ms)
   * @param {number} ms Timestamp to convert
   * @param {string} timeZone Time zone to convert
   * @return {number}
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
    return epochTime * 1000 + EPOCH;
  },

  /**
   * Converts ADAMANT's sats to ADM value
   * @param {number|string} sats Sats to convert
   * @param {number} [decimals=8] Round up to
   * @return {number} Value in ADM
   */
  satsToADM(sats, decimals = 8) {
    try {
      const admString = (+sats / SAT).toFixed(decimals);

      return +admString;
    } catch (e) {
      log.error(`Error in satsToADM() of ${this.moduleName} module: ${e}`);
    }
  },

  /**
   * Converts ADM value to sats
   * @param {number|string} adm ADM to convert
   * @return {number} Value in sats
   */
  AdmToSats(adm) {
    try {
      const satsString = (+adm * SAT).toFixed(0);

      return +satsString;
    } catch (e) {
      log.error(`Error in AdmToSats() of ${this.moduleName} module: ${e}`);
    }
  },

  /**
   * Rounds up to precision
   * roundUp(6, 10) -> 10
   * roundUp(30, 10) -> 30
   * roundUp(31, 10) -> 30
   * roundUp(36, 10) -> 40
   * roundUp(561, 100) -> 600
   * roundUp(66, 5) -> 65
   * roundUp(1, 10) -> 1
   * roundUp(7, 10) -> 1
   * @param {Number} value Value to round up
   * @param {Number} precision 5, 10, 100, etc.
   * @return {Number} Rounded value
   */
  roundUp(value, precision) {
    if (!this.isNumber(value) || !this.isInteger(precision) || precision < 1 || value < precision) return value;
    return Math.round(value / precision) * precision;
  },

  /**
   * Returns integer random of (min-max)
   * @param {number} min Minimum is inclusive
   * @param {number} max Maximum is inclusive
   * @return {number} Integer random of (min-max)
   */
  getRandomIntInclusive(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1) + min);
  },

  /**
   * Returns random of (min-max)
   * @param {number} low Minimum is inclusive
   * @param {number} high Maximum is inclusive
   * @param {boolean} [doRound=false] Return integer (rounded value)
   * @return {number} Random of (min-max)
   */
  randomValue(low, high, doRound = false) {
    let random = Math.random() * (high - low) + low;

    if (doRound) {
      random = Math.round(random);
    }

    return random;
  },

  /**
   * Returns random of near number with deviation %
   * @param {number} number Value near which to return a random
   * @param {number} deviation Deviation in %/100 from number, e.g., 0.1 is 10%
   * @param {boolean} [doRound=false] Return integer (rounded value)
   * @return {number} Random of number+-deviation
   */
  randomDeviation(number, deviation, doRound = false) {
    const min = number - number * deviation;
    const max = number + number * deviation;

    return this.randomValue(min, max, doRound);
  },

  /**
   * Checks if string contains correct number
   * @param {string} str String value to check
   * @return {boolean}
   */
  isNumeric(str) {
    if (typeof str !== 'string') return false;

    return !isNaN(+str) && !isNaN(parseFloat(str));
  },

  /**
   * Checks if number is integer
   * @param {number} value Number to validate
   * @return {boolean}
   */
  isInteger(value) {
    if (typeof (value) !== 'number' || isNaN(value) || !Number.isSafeInteger(value)) {
      return false;
    } else {
      return true;
    }
  },

  /**
   * Checks if number is integer and not less, than 1
   * @param {number} value Number to validate
   * @return {boolean}
   */
  isPositiveInteger(value) {
    if (!this.isInteger(value) || value < 1) {
      return false;
    } else {
      return true;
    }
  },

  /**
   * Checks if number is integer and not less, than 0
   * @param {number} value Number to validate
   * @return {boolean}
   */
  isPositiveOrZeroInteger(value) {
    if (!this.isInteger(value) || value < 0) {
      return false;
    } else {
      return true;
    }
  },

  /**
   * Checks if number is finite
   * @param {number} value Number to validate
   * @return {boolean}
   */
  isNumber(value) {
    if (typeof (value) !== 'number' || isNaN(value) || !Number.isFinite(value)) {
      return false;
    } else {
      return true;
    }
  },

  /**
   * Checks if number is finite and not less, than 0
   * @param {number} value Number to validate
   * @return {boolean}
   */
  isPositiveOrZeroNumber(value) {
    if (!this.isNumber(value) || value < 0) {
      return false;
    } else {
      return true;
    }
  },

  /**
   * Checks if number is finite and greater, than 0
   * @param {number} value Number to validate
   * @return {boolean}
   */
  isPositiveNumber(value) {
    if (!this.isNumber(value) || value <= 0) {
      return false;
    } else {
      return true;
    }
  },

  /**
   * Parses number, including 500k, 10.3m or 5b
   * @param {number | string} value Number to parse
   * @return {{ isNumber: boolean, fancyNumberString?: string, number?: number }}
   *   E.g., 500K -> isNumber: true, fancyNumberString?: 500k, number?: 500_000
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
   * Parses time value, like 5sec, 5 secs, 5 min
   * @param {string} value Time to parse
   * @return {Object} isTime and time itself
   */
  parseSmartTime(value) {
    // Regular expression to match the number and time unit
    const regex = /(\d+)\s*(ms|msec|msecs|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hour|hours?|d|day|days?|w|week|weeks?|mon|month|months?|y|yr|yrs|year|years?)/;
    const match = value.match(regex);

    if (!match) {
      return { isTime: false };
    }

    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    // Convert all units to milliseconds
    let msecs = 0;
    switch (unit) {
      case 'ms':
      case 'msec':
      case 'msecs':
      case 'millisecond':
      case 'milliseconds':
        msecs = num;
        break;
      case 's':
      case 'sec':
      case 'secs':
      case 'second':
      case 'seconds':
        msecs = num * 1000;
        break;
      case 'm':
      case 'min':
      case 'mins':
      case 'minute':
      case 'minutes':
        msecs = num * 60000;
        break;
      case 'h':
      case 'hr':
      case 'hrs':
      case 'hour':
      case 'hours':
        msecs = num * 3600000;
        break;
      case 'd':
      case 'day':
      case 'days':
        msecs = num * 86400000;
        break;
      case 'w':
      case 'week':
      case 'weeks':
        msecs = num * 604800000;
        break;
      case 'mon':
      case 'month':
      case 'months':
        msecs = num * 2629800000; // Approximation
        break;
      case 'y':
      case 'yr':
      case 'yrs':
      case 'year':
      case 'years':
        msecs = num * 31557600000; // Approximation
        break;
    }

    // Convert milliseconds to other units
    return {
      isTime: true,
      msecs,
      secs: msecs / 1000,
      mins: msecs / 60000,
      hours: msecs / 3600000,
      days: msecs / 86400000,
      weeks: msecs / 604800000,
      months: msecs / 2629800000, // Approximation
      years: msecs / 31557600000, // Approximation
    };
  },

  /**
   * Parses String[] from String
   * E.g., '[Stepup, Stepdown]' ⟶ return ['Stepup', Stepdown']
   * @param {String} str String to parse
   * @return {String[]}
   */
  parseEnumArray(str) {
    // Remove the brackets and split the string by comma
    const trimmed = str.replace(/^\[|\]$/g, '');
    return trimmed.split(/\s*,\s*/);
  },

  /**
   * Parses string value to JSON
   * @param {string} jsonString String to parse
   * @return {object} JSON object or false, if unable to parse
   */
  tryParseJSON(jsonString) {
    try {
      const o = JSON.parse(jsonString);

      if (o && typeof o === 'object') {
        return o;
      }
    } catch {
      // Silent
    }

    return false;
  },

  /**
   * Compares two objects
   * @param {object} object1
   * @param {object} object2
   * @return {boolean} True, if objects are equal
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
   * Check if variable is an object
   * @param {any} object
   * @return {boolean}
   */
  isObject(object) {
    return object !== null && typeof object === 'object';
  },

  /**
   * Check if variable is an object and it's not empty
   * @param {any} object
   * @return {boolean}
   */
  isObjectNotEmpty(object) {
    return this.isObject(object) && !this.isObjectsEqual(object, {});
  },

  /**
   * Compares two arrays
   * @param {array} array1
   * @param {array} array2
   * @return {boolean} True, if arrays are equal
   */
  isArraysEqual(array1, array2) {
    return array1.length === array2.length && array1.sort().every((value, index) => {
      return value === array2.sort()[index];
    });
  },

  /**
   * Clones an array. Not a deep clone, but offers to clone array of simple objects.
   * @param {array} arr
   * @return {array} A copy of array1
   */
  cloneArray(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.map((a) => {
      return { ...a };
    });
  },

  /**
   * Clones an object. Not a deep clone, but offers to clone object of nulls, arrays and objects.
   * @param {Object} obj
   * @return {Object} A copy of object
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
   * Returns array with unique values
   * @param {array} values Input array
   * @return {array}
   */
  getUnique(values) {
    const map = values.reduce((m, v) => {
      m[v] = 1;
      return m;
    }, { });
    return Object.keys(map);
  },

  /**
   * Returns array with unique objects
   * @param {array} items Input array
   * @param {array|string} propNames 'property' or ['property1', 'property2']
   * @return {array}
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
   * Splits a string into limited by length chunks
   * @param {string} str
   * @param {number} length
   * @return {string[]} Chunks
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
   * @param {string} chars Chars to trim from 'str'.
   * @return {string} Trimmed string; or empty string, if 'str' is not a string.
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
   * @return {string} Processed string; or empty string, if 'str' is not a string.
   */
  replaceLastOccurrence(str, searchValue, newValue) {
    if (!str || typeof str !== 'string') {
      return '';
    }
    const n = str.lastIndexOf(searchValue);
    return str.slice(0, n) + str.slice(n).replace(searchValue, newValue);
  },

  /**
   * Formats a number to a pretty string, 3134234.778 -> 3 134 234.778
   * @param {number | string} num Number to format, e.g., 3134234.778
   * @param {boolean} [makeBold=false] Apply **bold** markdown for an integer part
   * @return {string} Formatted number
   */
  formatNumber(num, makeBold = false) {
    const parts = String(+num).split('.');

    const main = parts[0];
    const len = main.length;

    let output = '';
    let i = len - 1;

    while (i >= 0) {
      output = main.charAt(i) + output;
      if ((len - i) % 3 === 0 && i > 0) {
        output = ' ' + output;
      }
      --i;
    }

    if (parts.length > 1) {
      if (makeBold) {
        output = `**${output}**.${parts[1]}`;
      } else {
        output = `${output}.${parts[1]}`;
      }
    }

    return output;
  },

  /**
   * Calculates average value in array
   * @param {number[]} arr Array of numbers
   * @param {number} [maxLength] Use only first maxLength items (optional)
   * @return {number|false} Average value
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
   * Calculates Root mean square value in array
   * @param {number[]} arr Array of numbers
   * @param {number} [maxLength] Use only first maxLength items (optional)
   * @return {number|false} RMS value
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
   * Calculates median value in array
   * @param {number[]} arr Array of numbers
   * @param {number} [maxLength] Use only first maxLength items (optional)
   * @return {number|false} Median value
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
   * Calculates history trades metrics within the interval, like max and min price, price deviation
   * @param {Object[]} lastTrades Last trades, received using traderapi.getTradesHistory()
   * @param {number} [startDate] Timestamp from to filter trades. Default is 1 minute before now().
   * @return {Object} History trades metrics
   */
  getHistoryTradesInfo(lastTrades, startDate) {
    try {
      const defaultInterval = MINUTE;
      if (!this.isPositiveNumber(startDate)) {
        startDate = Date.now() - defaultInterval;
      }

      lastTrades = lastTrades.filter((trade) => trade.date > startDate);

      const tradesCount = lastTrades.length;
      const intervalMs = Date.now() - startDate;
      const minPrice = Math.min(...lastTrades.map((trade) => trade.price));
      const maxPrice = Math.max(...lastTrades.map((trade) => trade.price));
      const priceDelta = Math.abs(minPrice - maxPrice);
      const priceDeltaPercent = this.numbersDifferencePercent(minPrice, maxPrice);
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
   * Calculates order book metrics, like highestBid-lowestAsk, smartBid-smartAsk, spread, liquidity, amountTargetPrice
   * @param {Array<Object>} orderBookInput Bids[] and asks[], received via traderapi.getOrderBook(). To be cloned not to modify.
   * @param {number} customSpreadPercent If we'd like to calculate liquidity for custom spread, ±% from the average price
   * @param {number} targetPrice Calculate how much to buy or to sell to set a target price; Build Quote hunter table.
   * @param {number} placedAmount Calculate price change in case of *market* order placed with placedAmount, both sides
   * @param {Array<Object>} openOrders Open orders[], received via traderapi.getOpenOrders(). To filter third-party orders.
   * @param {string} moduleName For logging only
   * @return {Object} Order book metrics
   */
  getOrderBookInfo(orderBookInput, customSpreadPercent, targetPrice, placedAmount, openOrders, moduleName) {
    try {
      const orderBook = this.cloneObject(orderBookInput);

      if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
        return false;
      }

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

      let typeTargetPrice;
      let amountTargetPrice = 0; let targetPriceOrdersCount = 0; let amountTargetPriceQuote = 0;
      let targetPriceExcluded;
      let amountTargetPriceExcluded = 0; let targetPriceOrdersCountExcluded = 0; let amountTargetPriceQuoteExcluded = 0;

      if (targetPrice) {
        if (targetPrice > highestBid && targetPrice < lowestAsk) {
          typeTargetPrice = 'inSpread';
        } else if (targetPrice <= highestBid) {
          typeTargetPrice = 'sell';
        } else if (targetPrice >= lowestAsk) {
          typeTargetPrice = 'buy';
        }
      }

      const spread = lowestAsk - highestBid;
      const averagePrice = (lowestAsk + highestBid) / 2;
      const spreadPercent = spread / averagePrice * 100;

      let downtrendAveragePrice = highestBid + this.randomValue(0, AVERAGE_SPREAD_DEVIATION) * spread;
      if (downtrendAveragePrice >= lowestAsk) {
        downtrendAveragePrice = highestBid;
      }

      let uptrendAveragePrice = lowestAsk - this.randomValue(0, AVERAGE_SPREAD_DEVIATION) * spread;
      if (uptrendAveragePrice <= highestBid) {
        uptrendAveragePrice = lowestAsk;
      }

      let middleAveragePrice = averagePrice - this.randomValue(-AVERAGE_SPREAD_DEVIATION, AVERAGE_SPREAD_DEVIATION) * spread;
      if (middleAveragePrice >= lowestAsk || middleAveragePrice <= highestBid) {
        middleAveragePrice = averagePrice;
      }

      const cumulative = {
        bids: [],
        asks: [],
      };

      // Calculate cumulative amounts and quotes for bids
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

      // Calculate cumulative amounts and quotes for asks
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

      const liquidity = [];
      liquidity.percentSpreadSupport = {};
      liquidity.percentSpreadSupport.spreadPercent = LIQUIDITY_SS_MAX_SPREAD_PERCENT;
      liquidity.percent2 = {};
      liquidity.percent2.spreadPercent = 2;
      liquidity.percent5 = {};
      liquidity.percent5.spreadPercent = 5;
      liquidity.percent10 = {};
      liquidity.percent10.spreadPercent = 10;
      liquidity.percent50 = {};
      liquidity.percent50.spreadPercent = 50;
      liquidity.percentCustom = {};
      liquidity.percentCustom.spreadPercent = customSpreadPercent;
      liquidity.full = {};
      liquidity.full.spreadPercent = 0;

      for (const key in liquidity) {
        liquidity[key].bidsCount = 0;
        liquidity[key].amountBids = 0;
        liquidity[key].amountBidsQuote = 0;
        liquidity[key].asksCount = 0;
        liquidity[key].amountAsks = 0;
        liquidity[key].amountAsksQuote = 0;
        liquidity[key].totalCount = 0;
        liquidity[key].amountTotal = 0;
        liquidity[key].amountTotalQuote = 0;
        liquidity[key].lowPrice = averagePrice * (1 - liquidity[key].spreadPercent/100);
        liquidity[key].highPrice = averagePrice * (1 + liquidity[key].spreadPercent/100);
        liquidity[key].spread = liquidity[key].highPrice - liquidity[key].lowPrice;
        // average price is the same for any spread
      }

      const bidIntervals = [];
      let previousBid;

      let placedAmountCountBid = 0;
      let placedAmountSumBid = 0;
      let placedAmountPriceBid;
      let placedAmountReachedBid = false;

      for (const bid of orderBook.bids) {

        for (const key in liquidity) {
          if (!liquidity[key].spreadPercent || bid.price > liquidity[key].lowPrice) {
            liquidity[key].bidsCount += 1;
            liquidity[key].amountBids += bid.amount;
            liquidity[key].amountBidsQuote += bid.amount * bid.price;
            liquidity[key].totalCount += 1;
            liquidity[key].amountTotal += bid.amount;
            liquidity[key].amountTotalQuote += bid.amount * bid.price;
          }
        }
        if (typeTargetPrice === 'sell' && bid.price > targetPrice) {
          amountTargetPriceExcluded += bid.amount;
          amountTargetPriceQuoteExcluded += bid.amount * bid.price;
          targetPriceOrdersCountExcluded += 1;
          targetPriceExcluded = bid.price;
        }
        if (typeTargetPrice === 'sell' && bid.price >= targetPrice) {
          amountTargetPrice += bid.amount;
          amountTargetPriceQuote += bid.amount * bid.price;
          targetPriceOrdersCount += 1;
        }
        if (!placedAmountReachedBid) {
          placedAmountPriceBid = bid.price;
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

      const askIntervals = [];
      let previousAsk;

      let placedAmountCountAsk = 0;
      let placedAmountSumAsk = 0;
      let placedAmountPriceAsk;
      let placedAmountReachedAsk = false;

      for (const ask of orderBook.asks) {

        for (const key in liquidity) {
          if (!liquidity[key].spreadPercent || ask.price < liquidity[key].highPrice) {
            liquidity[key].asksCount += 1;
            liquidity[key].amountAsks += ask.amount;
            liquidity[key].amountAsksQuote += ask.amount * ask.price;
            liquidity[key].totalCount += 1;
            liquidity[key].amountTotal += ask.amount;
            liquidity[key].amountTotalQuote += ask.amount * ask.price;
          }
        }
        if (typeTargetPrice === 'buy' && ask.price < targetPrice) {
          amountTargetPriceExcluded += ask.amount;
          amountTargetPriceQuoteExcluded += ask.amount * ask.price;
          targetPriceOrdersCountExcluded += 1;
          targetPriceExcluded = ask.price;
        }
        if (typeTargetPrice === 'buy' && ask.price <= targetPrice) {
          amountTargetPrice += ask.amount;
          amountTargetPriceQuote += ask.amount * ask.price;
          targetPriceOrdersCount += 1;
        }
        if (!placedAmountReachedAsk) {
          placedAmountPriceAsk = ask.price;
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

      // Used in Price watcher to understand real buy and sell prices
      const smartBid = this.getSmartPrice(orderBook.bids, 'bids', liquidity, moduleName);
      const smartAsk = this.getSmartPrice(orderBook.asks, 'asks', liquidity, moduleName);

      // Used in Cleaner to remove cheaters' orders
      const cleanBid = this.getCleanPrice(orderBook.bids, 'bids', liquidity, smartBid, moduleName);
      const cleanAsk = this.getCleanPrice(orderBook.asks, 'asks', liquidity, smartAsk, moduleName);

      // Used in Ant-gap
      const ORDERBOOK_HEIGHT = 20;
      const avgBidInterval = this.arrayAverage(bidIntervals.map((bid) => bid.priceInterval), ORDERBOOK_HEIGHT);
      const avgAskInterval = this.arrayAverage(askIntervals.map((ask) => ask.priceInterval), ORDERBOOK_HEIGHT);
      const rmsBidInterval = this.arrayRMS(bidIntervals.map((bid) => bid.priceInterval), ORDERBOOK_HEIGHT);
      const rmsAskInterval = this.arrayRMS(askIntervals.map((ask) => ask.priceInterval), ORDERBOOK_HEIGHT);
      const medianBidInterval = this.arrayMedian(bidIntervals.map((bid) => bid.priceInterval), ORDERBOOK_HEIGHT);
      const medianAskInterval = this.arrayMedian(askIntervals.map((ask) => ask.priceInterval), ORDERBOOK_HEIGHT);

      // Build Quote hunter table
      const qhTable = [];
      let optimalQhBid;

      if (openOrders && lowestAsk && highestBid) {
        // First, Aggregate by price first
        const orderBookBidsAggregated = this.aggregateArrayByField(orderBook.bids, 'price');
        const openOrdersBids = openOrders?.filter((order) => order.side === 'buy');
        const openOrdersBidsAggregated = this.aggregateArrayByField(openOrdersBids, 'price');

        // Second, Deduct bids to filter third-party ones
        for (let i = 0; i < orderBookBidsAggregated?.length; i++) {
          for (let j = 0; j < openOrdersBidsAggregated?.length; j++) {
            if (openOrdersBidsAggregated[j].price === orderBookBidsAggregated[i].price) {
              orderBookBidsAggregated[i].amount -= openOrdersBidsAggregated[j].amountLeft;
              openOrdersBidsAggregated[j].amountLeft = 0;
            }
          }
        }

        // Third, remove 0 amount bids
        const orderBookBidsThirdParty = [];
        for (const bid of orderBookBidsAggregated) {
          if (bid.amount > 0) {
            orderBookBidsThirdParty.push(bid);
          }
        }

        // Forth, verify we have all of our bids in order book
        for (const bid of openOrdersBidsAggregated) {
          if (bid.amountLeft > 0) {
            log.warn(`Bot's order to buy ${bid.amount} ${config.coin1} (${bid.amountLeft} ${config.coin1} left) at ${bid.price} ${config.coin2} is not found in the order book. It may be we've got a bit stale data.`);
          }
        }

        // Fifth, calculate Quote hunter table
        if (orderBookBidsThirdParty.length > 3) {
          let index = 0;
          let maxBidTakerKoef = 0;
          for (const bid of orderBookBidsThirdParty) {
            const bidPrice = bid.price;
            if (bidPrice < targetPrice) {
              break;
            }
            const bidAmount = bid.amount;
            const bidAmountAccPrev = qhTable[qhTable.length - 1] ? qhTable[qhTable.length - 1].bidAmountAcc : 0;
            const bidAmountAcc = bidAmount + bidAmountAccPrev;
            const bidQuote = bidAmount * bidPrice;
            const bidQuoteAccPrev = qhTable[qhTable.length - 1] ? qhTable[qhTable.length - 1].bidQuoteAcc : 0;
            const bidQuoteAcc = bidQuote + bidQuoteAccPrev;
            const bidPriceDumpPercent = this.numbersDifferencePercentDirect(
                highestBid,
                index === 0 ? orderBookBidsThirdParty[index + 1].price : bidPrice,
            );
            // const bidPriceRemainderPercent = 100 - bidPriceDumpPercent;
            // const bidPriceRemainderPowed = Math.pow(bidPriceRemainderPercent/100, 10);
            const bidPriceDumpPercentPowed = Math.pow(bidPriceDumpPercent, 2);
            const bidTakerKoef = (index === 1 ? bidQuote : bidQuoteAcc) / bidPriceDumpPercentPowed;
            qhTable.push({
              index,
              bidPrice,
              bidAmount,
              bidAmountAcc,
              bidQuote,
              bidQuoteAcc,
              bidPriceDumpPercent,
              // bidPriceRemainderPercent,
              bidTakerKoef,
            });
            if (maxBidTakerKoef < bidTakerKoef) {
              maxBidTakerKoef = bidTakerKoef;
              optimalQhBid = qhTable[qhTable.length - 1];
            }
            index++;
          }
        }
      }

      // See this table to understand the magic
      if (moduleName?.startsWith('Test')) {
        let basicInfo = `bids/asks: ${bids}/${asks}\n`;
        basicInfo += `average price: ${averagePrice}, down: ${downtrendAveragePrice}, up: ${uptrendAveragePrice}, mid: ${middleAveragePrice}\n`;
        basicInfo += `spread: ${spread}, ${spreadPercent}%\n`;
        basicInfo += `hb–la: ${highestBid}—${lowestAsk}, amounts: ${highestBidAggregatedAmount}–${lowestAskAggregatedAmount}, quotes: ${highestBidAggregatedQuote}–${lowestAskAggregatedQuote}\n`;
        basicInfo += `hb–la Smart: ${smartBid}—${smartAsk}\n`;
        basicInfo += `hb–la Clean: ${cleanBid}—${cleanAsk}\n\n`;
        basicInfo += `to achieve ${targetPrice} target price: ${typeTargetPrice} ${amountTargetPrice} coin1 (${amountTargetPriceQuote} coin2, positions ${targetPriceOrdersCount})\n`;
        basicInfo += `to achieve excluded ${targetPriceExcluded} target price: ${typeTargetPrice} ${amountTargetPriceExcluded} coin1 (${amountTargetPriceQuoteExcluded} coin2, positions ${targetPriceOrdersCountExcluded})\n`;
        basicInfo += `bid/ask intervals avg: ${avgBidInterval}—${avgAskInterval}, rms: ${rmsBidInterval}—${rmsAskInterval}, median: ${medianBidInterval}—${medianAskInterval}\n`;
        basicInfo += `placed amount ${placedAmount} to buy (use asks): isReached: ${placedAmountReachedAsk}, ${placedAmountCountAsk} positions for ${placedAmountSumAsk} @ ${placedAmountPriceAsk} \n`;
        basicInfo += `placed amount ${placedAmount} to sell (use bids): isReached: ${placedAmountReachedBid}, ${placedAmountCountBid} positions for ${placedAmountSumBid} @ ${placedAmountPriceBid} \n`;
        console.log(basicInfo);

        let l = liquidity.percent2;
        let liquidityInfo = `liquidity 2%: lp–hp: ${l.lowPrice}–${l.highPrice}, spread ${l.spread}, bids–asks: ${l.bidsCount}–${l.asksCount} (of ${bids}–${asks}), amounts: ${l.amountBids}–${l.amountAsks}, quotes: ${l.amountBidsQuote}–${l.amountAsksQuote}\n`;
        l = liquidity.percent50;
        liquidityInfo += `liquidity 50%: lp–hp: ${l.lowPrice}–${l.highPrice}, spread ${l.spread}, bids–asks: ${l.bidsCount}–${l.asksCount} (of ${bids}–${asks}), amounts: ${l.amountBids}–${l.amountAsks}, quotes: ${l.amountBidsQuote}–${l.amountAsksQuote}\n`;
        console.log(liquidityInfo);

        let qhInfo = `Lowest ask: ${lowestAsk}, Price limit: ${targetPrice}\n`;
        qhInfo += `Optimal Quote hunter bid: ${optimalQhBid}`;
        console.log(qhInfo);

        if (moduleName?.startsWith('TestFull')) {
          console.log({
            liquidity,
            bidIntervals,
            askIntervals,
          });

          console.table('Qh table:', qhTable);
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
        typeTargetPrice, // Type of target price (inSpread, sell, buy)
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
        optimalQhBid, // Optimal Quote Hunter bid
      };
    } catch (e) {
      log.error(`Error in getOrderBookInfo() of ${this.moduleName} module: ${e}`);
      return false;
    }
  },

  /**
   * Calculates smart price for the order book:
   * Unlike highest bid (hb) and lowest ask (la), a Smart price also considers amounts.
   * Smart price is a nearest price to hb/la with a decent accumulated amount.
   * Note: the smart price doesn't consider a distance from spread (unlike the clean price).
   * @param {Array<Object>} items Bids or asks, received using traderapi.getOrderBook()
   * @param {string} type Items are 'asks' or 'bids'?
   * @param {Array<Object>} liquidity Liquidity info, calculated in getOrderBookInfo()
   * @return {number} Smart price
   */
  getSmartPrice(items, type, liquidity, moduleName) {
    try {
      const c_t_base = 0.01; // Cumulative % to understand that we achieved a smart price. 0.01 means that current price includes 1% of total bids/asks.
      const c_t_max = 0.05; // When we cumulate, consider we achieved a smart price without any other conditions
      // Smart price is in the 1–5% cumulative amount generally, but the 0–5% is possible.

      let smartPrice;
      let smartPriceIndex;

      let c_prev = 0;
      let a = 0; let a_prev = 0; let t = 0;
      let c = 0; let c_a = 0; let c__a_prev = 0; let c__c_prev = 0; let c_t = 0; let s = 0;
      let s_prev = 0; let c_t__prev = 0;

      const table = [];

      for (let i = 0; i < items.length; i++) {
        const el = items[i];
        const el_prev = items[i-1];

        if (type === 'asks') {
          a = el.amount;
          a_prev = el_prev?.amount;
          t = liquidity['percent50'].amountAsks;
        } else {
          a = el.amount * el.price;
          a_prev = el_prev?.amount * el_prev?.price;
          t = liquidity['percent50'].amountBidsQuote;
        }

        c_t__prev = c_t;
        s_prev = s;
        c_prev = c;

        c += a; // cumulative amount
        c_a = c / a;
        c__a_prev = a_prev ? c / a_prev : false;
        c__c_prev = c_prev ? c / c_prev : false;
        c_t = c / t; // cumulative % to total
        s = c_t * c__c_prev; // cumulative % change

        // This table is only for logging
        table.push({
          items: items.length,
          total: +t.toFixed(2),
          price: el.price.toFixed(8),
          a: a.toFixed(8),
          c: +c.toFixed(8),
          c_a: +c_a.toFixed(2),
          c__a_prev: c__a_prev ? +c__a_prev.toFixed(2) : false,
          c__c_prev: c__c_prev ? +c__c_prev.toFixed(2) : false,
          c_t: +c_t.toFixed(5),
          s: +s.toFixed(5),
        });

        // Smart price is the first price when we accumulate c_t_base%
        // But also starts to decline in cumulative speed
        if (!smartPrice) {
          if (i > 0 && c_t__prev > c_t_base && s < s_prev) {
            smartPrice = el_prev.price;
            smartPriceIndex = i-1;
          } else if (c_t > c_t_max) {
            smartPrice = el.price;
            smartPriceIndex = i;
          }
        }
      }

      // See this table to understand the magic
      if (moduleName?.startsWith('Test')) {
        table[smartPriceIndex].sp = '*';
        console.table(table);
        console.log(`smartPrice for ${type} and ${c_t_base} koef: ${smartPrice.toFixed(8)}\n`);
      }

      return smartPrice;
    } catch (e) {
      log.error(`Error in getSmartPrice() of ${this.moduleName} module: ${e}`);
    }
  },

  /**
   * Calculates clean (non-cheater) price for the order book
   * It depends on:
   *   Distance^2 from the smart price: bigger distance means higher probability of cheater order
   *   Accumulated amount of an order: smaller amount means higher probability of cheater order
   *   Koef threshold: bigger koef means higher probability of cheater order
   * @param {Array<Object>} items Bids or asks, received using traderapi.getOrderBook()
   * @param {string} type Items are 'asks' or 'bids'? Asks arranged from low to high, Bids from high to low (spread in the center).
   * @param {Array<Object>} liquidity Liquidity info, calculated in getOrderBookInfo(). Using percent50 liquidity for total.
   * @param {number} smartPrice Smart price for bids/asks. The clean price is always before the smart price.
   * @param {string} moduleName For logging only
   * @return {number} Clean price
   */
  getCleanPrice(items, type, liquidity, smartPrice, moduleName) {
    const koef = 7; // How to understand we achieve clean price

    if (!this.isPositiveNumber(smartPrice)) {
      log.warn(`Utils/Cleaner: Received unexpected smart price: ${smartPrice}. Unable to calculate clean price.`);
      return;
    }

    try {
      let cleanPrice = items[0].price;
      const smartPriceIndex = items.findIndex((i) => i.price === smartPrice);
      let cleanPriceIndex = 0;

      let a = 0; let t = 0; let c = 0; let c_t = 0;
      let d = 0; let d2 = 0; let ct_d2 = 0;
      const table = [];
      let orderInfo = '';
      let side;
      let quote;

      // Each iteration el.price moves towards to Smart price

      for (let i = 0; i < items.length; i++) {
        const el = items[i];
        quote = el.amount * el.price;

        if (type === 'asks') {
          if (el.price > smartPrice) break;
          side = 'sell';
          a = el.amount;
          t = liquidity['percent50'].amountAsks;
        } else {
          if (el.price < smartPrice) break;
          side = 'buy';
          a = quote;
          t = liquidity['percent50'].amountBidsQuote;
        }

        orderInfo = `${this.inclineNumber(i)} order to ${side} ${el.amount} ${config.coin1} @${el.price} ${config.coin2} for ${quote} ${config.coin2}`;

        d = this.numbersDifferencePercent(el.price, smartPrice) / 100; // Distance from the smart price
        d2 = d * d; // Decreases every iteration. For order with smartPrice (last iteration) it equals 0.
        c += a; // Cumulative amount
        c_t = c / t; // Cumulative % to total. Grows each iteration
        ct_d2 = c_t / d2; // Grows each iteration. For order with smartPrice (last iteration) it equals Infinity.

        const logIfCleaner = ((orderStatus, reason) => {
          if (moduleName === 'Cleaner' || moduleName?.startsWith('Test')) {
            log.log(`Utils/Cleaner: Considering ${orderInfo} as ${orderStatus}. Value ct_d2 ${ct_d2.toFixed(5)} is ${reason} than Koef ${koef}.`);
          }
        });

        if (ct_d2 < koef && items[i + 1]) { // While ct_d2 is less than Koef, consider an order as a cheater price
          cleanPrice = items[i + 1].price;
          cleanPriceIndex = i + 1;
          logIfCleaner('cheater', 'less');
        } else if (i === 0) {
          logIfCleaner('decent', 'higher');
        }

        // This table is only for logging
        table.push({
          items: items.length,
          total: +t.toFixed(2),
          price: el.price.toFixed(8),
          d: +d.toFixed(2),
          d2: +d2.toFixed(4),
          a: a.toFixed(8),
          c: +c.toFixed(8),
          c_t: +c_t.toFixed(5),
          ct_d2: +ct_d2.toFixed(5),
          isCheater: ct_d2 < koef,
        });
      }

      // See this table to understand the magic
      if (moduleName?.startsWith('Test')) {
        table[smartPriceIndex].sp = '*';
        table[cleanPriceIndex].cp = '*';
        console.table(table);
        console.log(`Clean price is ${cleanPrice.toFixed(8)} for ${type} when Smart price = ${smartPrice.toFixed(8)} and Koef = ${koef}.\n`);
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
   * Checks if order price is out of order book custom percent (as mm_liquiditySpreadPercent) spread
   * @param {Object} order Object of ordersDb
   * @param {Object} obInfo Object of utils.getOrderBookInfo()
   * @returns {Object}
   */
  isOrderOutOfSpread(order, obInfo) {
    try {
      const outOfSpreadInfo = {
        isOrderOutOfSpread: false,
        isOrderOutOfMinMaxSpread: false,
        isOrderOutOfInnerSpread: false,
        isSsOrder: order.subPurpose === 'ss',
        orderPrice: order.price,
        minPrice: undefined,
        maxPrice: undefined,
        innerLowPrice: undefined,
        innerHighPrice: undefined,
        spreadPercent: tradeParams.mm_liquiditySpreadPercent,
        spreadPercentMin: tradeParams.mm_liquiditySpreadPercentMin,
      };

      const liqInfo = outOfSpreadInfo.isSsOrder ? obInfo.liquidity.percentSpreadSupport : obInfo.liquidity.percentCustom;
      const roughness = liqInfo.spread * AVERAGE_SPREAD_DEVIATION;

      // First, check mm_liquiditySpreadPercent
      outOfSpreadInfo.minPrice = liqInfo.lowPrice - roughness;
      outOfSpreadInfo.maxPrice = liqInfo.highPrice + roughness;
      if (order.price < outOfSpreadInfo.minPrice || order.price > outOfSpreadInfo.maxPrice) {
        outOfSpreadInfo.isOrderOutOfSpread = true;
        outOfSpreadInfo.isOrderOutOfMinMaxSpread = true;
        return outOfSpreadInfo;
      }

      // Second, check mm_liquiditySpreadPercentMin: 'depth' orders should be not close to mid of spread
      if (!outOfSpreadInfo.isSsOrder && tradeParams.mm_liquiditySpreadPercentMin) {
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
          (order.type === 'sell' && lowPrice && order.price < lowPrice) ||
          (order.type === 'buy' && highPrice && order.price > highPrice)
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
  isOrderOutOfTwapRange(order, lowPrice, highPrice) {
    try {
      if (
        (order.type === 'sell' && lowPrice && order.price < lowPrice) ||
        (order.type === 'buy' && highPrice && order.price > highPrice)
      ) {
        return true;
      }
    } catch (e) {
      log.error(`Error in isOrderOutOfTwapRange() of ${this.moduleName} module: ${e}`);
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
   * Parses number or number range/interval from string like 1.25–2.90
   * It considers a separator can be hyphen, dash, minus, long dash
   * All numbers should be positive and finite
   * @param {string} str String to parse
   * @return {{ isRange: boolean, isValue: boolean, value?: number,
   *     from?: number, to?: number, fromStr?: string, toStr?: string }}
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

    if (str.indexOf('-') > -1) { // hyphen
      [from, to] = str.split('-');
    } else if (str.indexOf('—') > -1) { // long dash
      [from, to] = str.split('—');
    } else if (str.indexOf('–') > -1) { // short dash
      [from, to] = str.split('–');
    } else if (str.indexOf('−') > -1) { // minus
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
   * Searches difference between current and previous balances
   * @param {Object[]} a Current balances
   * @param {Object[]} b Previous balances
   * @return {Object[]} Difference
   */
  differenceInBalances(a, b) {
    if (!a || !b || !a[0] || !b[0]) {
      return;
    }

    let obj2;
    const diff = [];

    b.forEach((obj2) => {
      const obj1 = a.filter((crypto) => crypto.code === obj2.code)[0];
      if (!obj1) {
        a.push({
          code: obj2.code,
          total: 0,
        });
      }
    });

    a.forEach((obj1) => {
      obj2 = b.filter((crypto) => crypto.code === obj1.code)[0];
      if (obj2) {
        if (obj1.total !== obj2.total) {
          diff.push({
            code: obj1.code,
            prev: obj2.total,
            now: obj1.total,
          });
        }
      } else {
        diff.push({
          code: obj1.code,
          prev: 0,
          now: obj1.total,
        });
      }
    });

    return diff;
  },

  /**
   * Creates a difference string for current and previous balances
   * @param {Object[]} a Current balances
   * @param {Object<timestamp, balances>} b Previous balances with timestamp
   * @return {string} Difference string
   */
  differenceInBalancesString(a, b, marketInfo) {
    let output = '';
    const diff = this.differenceInBalances(a, b?.balances);
    const timeDiffString = b?.timestamp ? ' in ' + this.timestampInDaysHoursMins(Date.now() - b.timestamp) : '';

    if (diff) {
      if (diff[0]) {
        output += `\nChanges${timeDiffString}:\n`;

        let delta; let deltaTotalUSD = 0; let deltaTotalBTC = 0;
        let deltaCoin1 = 0; let deltaCoin2 = 0; let deltaTotalNonCoin1USD = 0; let deltaTotalNonCoin1BTC = 0;
        let sign; let signTotalUSD = ''; let signTotalBTC = '';
        let signCoin1 = ''; let signCoin2 = ''; let signTotalNonCoin1USD = ''; let signTotalNonCoin1BTC = '';

        diff.forEach((crypto) => {
          delta = Math.abs(crypto.now - crypto.prev);
          sign = crypto.now > crypto.prev ? '+' : '−';

          if (crypto.code === 'totalUSD') {
            deltaTotalUSD = delta;
            signTotalUSD = sign;
            return;
          }

          if (crypto.code === 'totalBTC') {
            deltaTotalBTC = delta;
            signTotalBTC = sign;
            return;
          }

          if (crypto.code === 'totalNonCoin1USD') {
            deltaTotalNonCoin1USD = delta;
            signTotalNonCoin1USD = sign;
            return;
          }

          if (crypto.code === 'totalNonCoin1BTC') {
            deltaTotalNonCoin1BTC = delta;
            signTotalNonCoin1BTC = sign;
            return;
          }

          if (crypto.code === config.coin1) {
            deltaCoin1 = delta;
            signCoin1 = sign;
          }

          if (crypto.code === config.coin2) {
            deltaCoin2 = delta;
            signCoin2 = sign;
          }

          output += `_${crypto.code}_: ${sign}${this.formatNumber(+(delta).toFixed(8), true)}`;
          output += '\n';
        });

        // Show the total holdings change: Market value of all known coins, including coin1 (Trading coin)
        if (Math.abs(deltaTotalUSD)> 0.01 || Math.abs(deltaTotalBTC) > 0.00000009) {
          output += `Total holdings ${signTotalUSD}${this.formatNumber(+deltaTotalUSD.toFixed(2), true)} _USD_ or ${signTotalBTC}${this.formatNumber(deltaTotalBTC.toFixed(8), true)} _BTC_`;
        } else {
          output += 'Total holdings ~ No changes';
        }

        // Show the holdings change, excluding coin1 (Trading coin)
        if (Math.abs(deltaTotalNonCoin1USD) > 0.01 || Math.abs(deltaTotalNonCoin1BTC) > 0.00000009) {
          output += `\nTotal holdings (non-${config.coin1}) ${signTotalNonCoin1USD}${this.formatNumber(+deltaTotalNonCoin1USD.toFixed(2), true)} _USD_ or ${signTotalNonCoin1BTC}${this.formatNumber(deltaTotalNonCoin1BTC.toFixed(8), true)} _BTC_`;
        } else {
          output += `\nTotal holdings (non-${config.coin1}) ~ No changes`;
        }

        // Calculate the mid price of coin1/coin2 buying or selling
        // We assume that there were no deposit, withdrawals, and trades on other pairs
        if (deltaCoin1 && deltaCoin2 && (signCoin1 !== signCoin2)) {
          const price = deltaCoin2 / deltaCoin1;
          output += `\n[Can be wrong] ${signCoin1 === '+' ? 'I\'ve bought' : 'I\'ve sold'} ${this.formatNumber(+deltaCoin1.toFixed(marketInfo.coin1Decimals), true)} _${config.coin1}_ at ${this.formatNumber(price.toFixed(marketInfo.coin2Decimals), true)} _${config.coin2}_ price.`;
        }
      } else {
        output += `\nNo changes${timeDiffString}.\n`;
      }
    }

    return output;
  },

  /**
   * Summarizes balances by code for two accounts
   * @param {Object[]} arr1 Balances for 1 account
   * @param {Object[]} arr2 Balances for 2 account
   * @return {Object[]} arr1 + arr2
   */
  sumBalances(arr1, arr2) {
    // Combine all the cryptos in the only object
    const arr3 = arr1.concat(arr2);

    // Calculate sums for each coin
    const sum = { free: [], freezed: [], total: [] };
    arr3.forEach((crypto) => {
      sum['free'][crypto.code] = (sum['free'][crypto.code] || 0) + crypto.free;
      sum['freezed'][crypto.code] = (sum['freezed'][crypto.code] || 0) + crypto.freezed;
      sum['total'][crypto.code] = (sum['total'][crypto.code] || 0) + crypto.total;
    });

    // Store result as array of usual balance objects { code-free-freezed-total }
    const result = [];
    for (const code in sum['total']) {
      result.push({ code, free: sum['free'][code], freezed: sum['freezed'][code], total: sum['total'][code] });
    }

    // Clean up values where NaN, e.g., totalBTC.freezed = NaN
    result.forEach((crypto) => {
      if (isNaN(crypto.free)) delete crypto.free;
      if (isNaN(crypto.freezed)) delete crypto.freezed;
      if (isNaN(crypto.total)) delete crypto.total;
    });

    return result;
  },

  /**
   * Mathematical difference in two values, same value if change 'a' and 'b'
   * numbersDifferencePercent(5, 10) = 66.66666
   * numbersDifferencePercent(10, 5) = 66.66666
   * @param {Number} a Value 1
   * @param {Number} b Value 2
   * @return {Number} Difference in %
   */
  numbersDifferencePercent(a, b) {
    if (!this.isNumber(a) || !this.isNumber(b)) return undefined;
    return 100 * Math.abs( ( a - b ) / ( (a + b)/2 ) );
  },

  /**
   * Mathematical difference in two values, from 'a' to 'b' direction, can be negative
   * numbersDifferencePercentDirect(5, 10) = 100
   * numbersDifferencePercentDirect(10, 5) = -50
   * @param {Number} a Value 1
   * @param {Number} b Value 2
   * @return {Number} Difference in %
   */
  numbersDifferencePercentDirectNegative(a, b) {
    if (!this.isNumber(a) || !this.isNumber(b)) return undefined;
    return 100 * ( ( a - b ) / a );
  },

  /**
   * Mathematical difference in two values, from 'a' to 'b' direction
   * numbersDifferencePercentDirect(5, 10) = 100
   * numbersDifferencePercentDirect(10, 5) = 50
   * @param {Number} a Value 1
   * @param {Number} b Value 2
   * @return {Number} Difference in %
   */
  numbersDifferencePercentDirect(a, b) {
    if (!this.isNumber(a) || !this.isNumber(b)) return undefined;
    return 100 * Math.abs( ( a - b ) / a );
  },

  /**
   * The disbalance is calculated based on how much one value dominates over the other.
   * 10, 10 -> 50%
   * 10, 100 -> 9.09%
   * 100, 10 -> 90.91%
   * 0, 100 -> 0%
   * 100, 0 -> 100%
   * @param {Number} a Value 1
   * @param {Number} b Value 2
   * @return {Number} Disbalance in %
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
   * Fix disbalance between a and b to reach targetBalancePercentThreshold
   * 10, 10 -> disbalancePercent 50%, -> targetBalancePercentThreshold = 30 -> +0
   * 10, 100 -> disbalancePercent 9.09%, -> targetBalancePercentThreshold = 30 -> +23
   * 100, 10 -> disbalancePercent 9.09%, -> targetBalancePercentThreshold = 30 -> –23
   * 0, 100 -> disbalancePercent 0%, -> targetBalancePercentThreshold = 40 -> 40
   * 100, 0 -> disbalancePercent 100%, -> targetBalancePercentThreshold = 40 -> –40
   * @param {number} a Value 1
   * @param {number} b Value 2
   * @returns {number} Amount to add (positive) or subtract (negative) to/from a to reach targetBalancePercentThreshold
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
   * Returns how much ms is in time unit
   * @param {String} timeUnit Like days, minutes
   * @return {Number} Ms in time unit, or undefined
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
   * Inclines a noun
   * @param {Number} number Number of objects
   * @param {String} one If 1 object
   * @param {String} some If many objects
   * @return {String} F. e., 1 'day' or 2 'days'
   */
  incline(number, one, some) {
    return number > 1 ? some: one;
  },

  /**
   * Inclines a number
   * @param {number} number Number to incline
   * @return {string} 0th, 1st, 2d, 3d, 4th, 10th, 20th, 21st, 22d, 23d, 30th
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
   * Returns readable timestamp in days, hours, minutes
   * @param {Number} timestamp
   * @param {Boolean} addSecs Include secs
   * @return {String} F. e., '1 day 5 hours'
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
   * Escape symbols for Telegram and transform double asterisks to single
   * @param {string} text Message
   * @returns {String} F.e.: '[start`]' -> '\[start\`]'
   */
  escapeMarkdownTelegram(text) {
    const singleAsterisksText = text.replace(/\*\*/g, '*');
    const symbols = '`['.split('');

    return symbols.reduce((string, replacement) => {
      return string.replace(new RegExp(`\\${replacement}`, 'g'), `\\${replacement}`);
    }, singleAsterisksText);
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
   * Calculates order statistics used in the Liquidity provider
   * @param {Array<Object>} orders A part of ordersDb
   * @return {Object} Stats on asks, bids, total
   */
  calculateOrderStats(orders) {
    let bidsTotalAmount = 0; let asksTotalAmount = 0;
    let bidsTotalQuoteAmount = 0; let asksTotalQuoteAmount = 0;
    let totalAmount = 0; let totalQuoteAmount = 0;
    let asksCount = 0; let bidsCount = 0; let totalCount = 0;

    for (const order of orders) {
      if (order.type === 'buy') {
        bidsTotalAmount += order.coin1AmountLeft;
        bidsTotalQuoteAmount += order.coin2AmountLeft;
        bidsCount += 1;
      }

      if (order.type === 'sell') {
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
   * Calculates TWAP (Time-Weighted Average Price) for a series of orders
   * @param {Array<Object>} orders Order list, got from internal DB. It may include skipped orders (not filled, coin1AmountFilled === 0 or undefined).
   * @returns {Object} Order list metrics, including TWAP
   */
  calculateTWAP(orders) {
    let filledOrders = 0;
    let partFilledOrders = 0;
    let skippedOrders = 0;
    let uncertainOrders = 0;

    let totalQuote = 0;
    let totalAmount = 0;

    orders.forEach((order) => {
      const amount = order.coin1AmountFilled;
      const price = order.priceFilled || order.price; // tw-orders includes priceFilled

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

    const twap = totalAmount ? totalQuote / totalAmount : 0;

    return {
      twap,
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
   * Parses command params array
   * E.g., BTC/USDT sell amount=10 minprice=32k time=50m interval=30sec strategy=Stepdown
   * @param {string[]} params Command param list
   * @param {number} [min=0] Minimum allowed param count
   * @returns {Object} Parsed params
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
        parsed.orderType = paramLc;
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
          index, // Plain indexing, including knownParams like param=value
          isFirst: index === 0,
          isLast: index === params.length - 1,
          isInteger: this.isInteger(+param),
          isNumeric: this.isNumeric(param),
          isInterval: intervalChars.some((char) => param.includes(char)),
        });
      }
    }

    parsed.paramCount = paramCount;
    parsed.paramCountWoMarkers = paramCountWoMarkers; // Don't count -2 and -y
    parsed.exactParamsCount = paramCountWoMarkers === min; // Check if params don't include nothing unexpected

    parsed.pairErrored = !parsed.pair && paramCount > 0; // There are params, but non of them is trading pair or perpetual contract
    parsed.pairOrCoinErrored = !parsed.pair && !parsed.possibleCoin && paramCount > 0; // Non of them is trading pair, perpetual contract, or a coin

    parsed.is = (paramName) => parsed.more.some((param) => param.param === paramName); // If additional (not knownParams) params include paramName
    parsed.moreByName = (paramName) => parsed.more.find((param) => param.param === paramName); // Get param from more[] by param name
    parsed.moreByIndex = (index) => parsed.more.find((param) => param.index === index); // Get param from more[] by plain index

    parsed.indexOf = (paramName) => parsed[`${paramName}__index`] ?? parsed.moreByName(paramName)?.index; // Get plain param index

    parsed.nextTo = (paramName) => { // Get param from more[] next to specific param
      const paramIndex = parsed.indexOf(paramName);
      return parsed.moreByIndex(paramIndex+1);
    };
    parsed.prevTo = (paramName) => { // Get param from more[] before specific param
      const paramIndex = parsed.indexOf(paramName);
      return parsed.moreByIndex(paramIndex-1);
    };

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

    return parsed;
  },

  /**
   * Verifies command param
   * Error messages includes markdown
   * @param {string} name Param name
   * @param {string} param Param value
   * @param {'' | 'integer' | 'positive integer' | 'positive or zero integer' | 'number' | 'positive number' | 'positive or zero number' | 'time' | string} type Param type, e.g., 'number'
   * @param {boolean} [isOptional=false] Allow undefined
   * @returns {{ success: boolean, parsed?: any, plain?: string, lc?: string, uc?: string, message?: string }} Verification results
   */
  verifyParam(name, param, type, isOptional = false) {
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

    if (type === 'integer') {
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

    if (type === 'positive or zero integer') {
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

    if (type === 'positive integer') {
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

    if (type === 'number') {
      const parsed = this.parsePositiveSmartNumber(param);

      if (parsed.isNumber) {
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

    if (type === 'positive number') {
      const parsed = this.parsePositiveSmartNumber(param);

      if (parsed.isNumber) {
        if (this.isPositiveNumber(parsed.number)) {
          return {
            success: true,
            plain: param,
            parsed,
          };
        } else {
          return {
            success: false,
            message: `Param _${name}_ is not a valid number: _${param}_`,
          };
        }
      } else {
        return {
          success: false,
          message: `Param _${name}_ is not a number: _${param}_`,
        };
      }
    }

    if (type === 'positive or zero number') {
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

    if (type === 'time') {
      const parsed = this.parseSmartTime(param);

      if (parsed.isTime) {
        return {
          success: true,
          plain: param,
          parsed,
        };
      } else {
        return {
          success: false,
          message: `Param _${name}_ is not a time value: _${param}_`,
        };
      }
    }

    if (type.startsWith('[')) {
      const enumList = this.parseEnumArray(type);

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
          message: `Param _${name}_ is not in the allowed list _${type}_: _${param}_`,
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
   * Pauses async function execution
   * @param {Number} ms Pause duration
   * @param {String} pauseReason Log message, optional
   */
  pauseAsync(ms, pauseReason) {
    if (pauseReason) {
      log.log(pauseReason);
    }

    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * @returns {Array<string>} List of possible perpetuals
   */
  perpetuals() {
    return ['USDT', 'USDC', 'USD'];
  },

  /**
   * Checks if str is a perpetual pair
   * @param {string} str E.g., 'ETHUSDT'
   * @param {string|[string]} [types] Type of contract. E.g. 'USDT' or ['USDT', 'TUSD']. If omitted, checks all possible perpetuals.
   * @returns {string|boolean} Formatted (upper case) perpetual contract ticker or 'false'
   */
  isPerpetual(str, types = this.perpetuals()) {
    try {
      if (typeof types === 'string') {
        types = [types];
      }

      for (const type of types) {
        // Check that str matches the perpetual pair template case insensitive
        if (
          /^[A-Z0-9]+$/i.test(str) &&
          str.toLowerCase().endsWith(type.toLowerCase()) &&
          str.length > type.length
        ) {
          return str.toUpperCase();
        }
      }
    } catch {
      // Nothing here
    }

    return false;
  },

  /**
   * List of popular stable coins
   * Used generally not to overwhelm messages like 'Are you sure to convert 10k USDC worth ~10 000 USD to USD?'
   * @returns {Array<string>} Stables
   */
  stables() {
    return ['USDT', 'USDC', 'USD', 'TUSD'];
  },

  /**
   * Checks if str is a stable coin ticker
   * @param {string} str E.g. USDC, case insensitive
   * @param {string | [string]} [tickers] List of allowed stable coin tickers. E.g. 'USDT' or ['USDT', 'TUSD']. If omitted, checks with a default stable coin list.
   * @returns {string | boolean} Formatted (upper case) ticker or 'false'
   */
  isStableCoin(str, tickers = this.stables()) {
    try {
      if (typeof tickers === 'string') {
        tickers = [tickers];
      }

      str = str.toUpperCase();

      return tickers.includes(str);
    } catch {
      // Nothing here
    }

    return false;
  },

  /**
   * Formats text as block code using markdown ```
   * Adds \n before and after
   * @param {string} text Text to format
   * @param {boolean} [addOuterLineBreaks=true] Whether to add \n before and after code block
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
   * Formats string as block using markdown `
   * Adds no surrounding spaces
   * @param {string} str String to format
   * @returns {string}
   */
  codeString(str) {
    return '`' + str + '`';
  },

  /**
   * Creates total-available-frozen string for a coin
   * 29 528.7105 ADM (6 937.2207 available & 22 591.4898 frozen)
   * TODO: parse decimals depending on spot/perpetual pair
   * @param {Object} coin Coin balance data
   * @param {boolean} [format=false] Format with markdown
   * @param {'total-free-frozen' | 'free-frozen'} [type='total-free-frozen'] Balance info type
   * @param {boolean} [parseDecimals=false] Parse decimals or use a constant
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
    const total = this.formatNumber(coin.total?.toFixed(coinDecimals), format);
    const free = this.formatNumber(coin.free?.toFixed(coinDecimals), format);
    const freezed = this.formatNumber(coin.freezed?.toFixed(coinDecimals), format);

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
   * Returns balances info on specific coins
   * @param {Object} balances Balances object, received by getBalances()
   * @param {string | ParsedMarket} pair ADM/USDT, ADMUSDT, or formattedPair from parseMarket()
   * @returns {Object | undefined}
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

      const getCoinData = (code) => balances.find((coin) => coin.code === code) || { total: 0, free: 0, freezed: 0 };

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
   * Generates table
   * @param header {Array<String>} Table header row
   * @param content {Array<Array<String>>|Array<Array<Number>>} Table content rows. Use array of '---' to add separator
   * @return {String}
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
   * Parses percent number from 'number%' string
   * @param {string} str String with number%
   * @param {boolean} [allowZeroAndNegative=true] Zero and negative percent values allowed
   * @returns {{ parsed: boolean, percent?: number }}
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
};

module.exports.watchConfig();
