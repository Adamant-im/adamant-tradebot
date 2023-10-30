const config = require('../modules/configReader');
const log = require('./log');
let tradeParams = require('../trade/settings/tradeParams_' + config.exchange);
const fs = require('fs');
const { SAT, EPOCH, MINUTE, LIQUIDITY_SS_MAX_SPREAD_PERCENT } = require('./const');
const equal = require('fast-deep-equal');
const { diff } = require('deep-object-diff');


const AVERAGE_SPREAD_DEVIATION = 0.15;

module.exports = {
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
   * @param {number} timeZone Time zone to convert
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
   * @param {number} decimals Round up to
   * @return {number} Value in ADM
   */
  satsToADM(sats, decimals = 8) {
    try {
      let adm = (+sats / SAT).toFixed(decimals);
      adm = +adm;

      return adm;
    } catch (e) {
      // Silent
    }
  },

  /**
   * Converts ADM value to sats
   * @param {number|string} adm ADM to convert
   * @return {number} Value in sats
   */
  AdmToSats(adm) {
    try {
      let sats = (+adm * SAT).toFixed(0);
      sats = +sats;

      return sats;
    } catch (e) {
      // Silent
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
   * @param {number} min Minimum is inclusive
   * @param {number} max Maximum is inclusive
   * @param {number} doRound If to return integer (rounded value)
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
   * @param {number} deviation Deviation in %/100 from number
   * @return {number} Random of number+-deviation
   */
  randomDeviation(number, deviation) {
    const min = number - number * deviation;
    const max = number + number * deviation;
    return Math.random() * (max - min) + min;
  },

  /**
   * Checks if string contains correct number
   * @param {string} str String value to check
   * @return {boolean}
   */
  isNumeric(str) {
    if (typeof str !== 'string') return false;
    return !isNaN(str) && !isNaN(parseFloat(str));
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
   * @param {number} value Number to parse
   * @return {Object} isNumber and number itself
   */
  parsePositiveSmartNumber(value) {
    if (!value) {
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
          multiplier = 1000;
          break;
        case 'm':
          multiplier = 1000000;
          break;
        case 'b':
          multiplier = 1000000000;
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
        fancyNumberString: number,
        number,
      };
    }
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
    } catch (e) {
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
   * Splits a string into chunks
   * @param {string} str
   * @param {number} length
   * @return {array<string>} Array of strings
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
   * Formats number to a pretty string
   * @param {Number|String} num Number to format, e.g., 3134234.778
   * @param {Boolean} doBold If to add **bold** markdown for an integer part
   * @return {String} Formatted number, like '3 134 234.778'
   */
  formatNumber(num, doBold) {
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
      if (doBold) {
        output = `**${output}**.${parts[1]}`;
      } else {
        output = `${output}.${parts[1]}`;
      }
    }

    return output;
  },

  /**
   * Calculates average value in array
   * @param {Array of Number} arr Array of number
   * @param {Number} maxLength Use only first maxLength items (optional)
   * @return {Number} Average value
   */
  arrayAverage(arr, maxLength) {
    if (!Array.isArray(arr) || arr.length === 0) return false;
    if (!maxLength) maxLength = arr.length - 1;
    const arrToCalc = arr.slice(0, maxLength);
    const total = arrToCalc.reduce((acc, c) => acc + c, 0);
    return total / arrToCalc.length;
  },

  /**
   * Calculates Root mean square value in array
   * @param {Array of Number} arr Array of number
   * @param {Number} maxLength Use only first maxLength items (optional)
   * @return {Number} RMS value
   */
  arrayRMS(arr, maxLength) {
    if (!Array.isArray(arr) || arr.length === 0) return false;
    if (!maxLength) maxLength = arr.length - 1;
    const arrToCalc = arr.slice(0, maxLength);
    const squares = arrToCalc.map((val) => (val*val));
    const total = squares.reduce((acc, c) => acc + c, 0);
    return Math.sqrt(total / squares.length);
  },

  /**
   * Calculates median value in array
   * @param {Array of Number} arr Array of number
   * @param {Number} maxLength Use only first maxLength items (optional)
   * @return {Number} Median value
   */
  arrayMedian(arr, maxLength) {
    if (!Array.isArray(arr) || arr.length === 0) return false;
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
   * @param {Array of object} lastTrades Last trades, received using traderapi.getTradesHistory()
   * @param {Number} startDate Timestamp from to filter trades
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
      log.error(`Error in getHistoryTradesInfo() of ${this.getModuleName(module.id)} module: ${e}.`);
      return false;
    }
  },

  /**
   * Aggregates (sum) array of objects by field
   * @param {Array of Object} arr Array of objects to aggregate
   * @param {String} field Field to aggregate by
   * @return {Array of Object} Aggregated array
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
      log.error(`Error in aggregateArrayByField() of ${this.getModuleName(module.id)} module: ${e}.`);
      return false;
    }
  },

  /**
   * Calculates order book metrics, like highestBid-lowestAsk, smartBid-smartAsk, spread, liquidity, amountTargetPrice
   * @param {Array of Object} orderBookInput Bids[] and asks[], received via traderapi.getOrderBook(). To be cloned not to modify.
   * @param {Number} customSpreadPercent If we'd like to calculate liquidity for custom spread, ±% from the average price
   * @param {Number} targetPrice Calculate how much to buy or to sell to set a target price; Build Quote hunter table.
   * @param {Number} placedAmount Calculate price change in case of *market* order placed with placedAmount, both sides
   * @param {Array<Object>} openOrders Open orders[], received via traderapi.getOpenOrders(). To filter third-party orders.
   * @param {String} moduleName For logging only
   * @return {Object} Order book metrics
   */
  getOrderBookInfo(orderBookInput, customSpreadPercent, targetPrice, placedAmount, openOrders, moduleName) {
    try {
      const orderBook = this.cloneObject(orderBookInput);

      if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
        return false;
      }

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
      const smartBid = this.getSmartPrice(orderBook.bids, 'bids', liquidity);
      const smartAsk = this.getSmartPrice(orderBook.asks, 'asks', liquidity);

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

          // See this table to understand the magic
          // console.log('Lowest ask:', lowestAsk, ', Price limit: ', targetPrice);
          // console.table(qhTable);
          // console.log('Optimal Quote hunter bid:', optimalQhBid);
        }
      }

      return {
        highestBid,
        lowestAsk,
        highestBidAggregatedAmount,
        highestBidAggregatedQuote,
        lowestAskAggregatedAmount,
        lowestAskAggregatedQuote,
        smartBid,
        smartAsk,
        cleanBid,
        cleanAsk,
        spread,
        spreadPercent,
        averagePrice,
        liquidity,
        downtrendAveragePrice,
        uptrendAveragePrice,
        middleAveragePrice,
        typeTargetPrice,
        amountTargetPrice,
        amountTargetPriceQuote,
        targetPriceOrdersCount,
        amountTargetPriceExcluded,
        amountTargetPriceQuoteExcluded,
        targetPriceOrdersCountExcluded,
        targetPriceExcluded,
        bidIntervals,
        askIntervals,
        avgBidInterval,
        avgAskInterval,
        rmsBidInterval,
        rmsAskInterval,
        medianBidInterval,
        medianAskInterval,
        placedAmountCountBid,
        placedAmountSumBid,
        placedAmountPriceBid,
        placedAmountReachedBid,
        placedAmountCountAsk,
        placedAmountSumAsk,
        placedAmountPriceAsk,
        placedAmountReachedAsk,
        optimalQhBid,
      };
    } catch (e) {
      log.error(`Error in getOrderBookInfo() of ${this.getModuleName(module.id)} module: ${e}.`);
      return false;
    }
  },

  /**
   * Calculates smart price for the order book
   * @param {Array of object} items Bids or asks, received using traderapi.getOrderBook()
   * @param {String} type Items are 'asks' or 'bids'?
   * @param {Array of object} liquidity Liquidity info, calculated in getOrderBookInfo()
   * @param {Number} koef How to understand we achieve smart price. The more koef, the farther smart price from spread
   * @return {Number} Smart price
   */
  getSmartPrice(items, type, liquidity, koef = 0.02) {

    try {

      let smartPrice;
      let c_m1 = 0;
      let a = 0; let a_m1 = 0; let t = 0;
      let c = 0; let c_a = 0; let c_a_m1 = 0; let c_c_m1 = 0; let c_t = 0; let s = 0;
      let prev_c_c_m1 = 0; let prev_s = 0; let prev_c_t = 0;
      const el_0 = items[0]; let c_t0 = 0;

      const enough_c_t = koef;
      const table = [];

      for (let i = 0; i < items.length; i++) {

        const el = items[i];
        const el_m1 = i === 0 ? false : items[i-1];
        if (type === 'asks') {
          a = el.amount;
          a_m1 = el_m1 ? el_m1.amount : false;
          t = liquidity['percent50'].amountAsks;
        } else {
          a = el.amount * el.price;
          a_m1 = el_m1 ? el_m1.amount * el_m1.price : false;
          t = liquidity['percent50'].amountBidsQuote;
        }

        // eslint-disable-next-line no-unused-vars
        prev_c_c_m1 = c_c_m1;
        prev_c_t = c_t;
        prev_s = s;

        c_m1 = c;
        c += a;
        c_a = c / a;
        c_a_m1 = a_m1 ? c / a_m1 : false;
        c_c_m1 = c_m1 === 0 ? false : c / c_m1;
        c_t = c / t;
        if (i === 0) c_t0 = c_t;
        s = c_c_m1 * c_t;

        if (!smartPrice && s < prev_s && prev_c_t > enough_c_t) {
          smartPrice = (c_t0 > enough_c_t) && (i === 2) ? el_0.price : el_m1.price;
        }

        // This table is only for logging
        if (!smartPrice) {
          table.push({
            items: items.length,
            total: +t.toFixed(2),
            price: el.price.toFixed(8),
            a: a.toFixed(8),
            c: +c.toFixed(8),
            c_a: +c_a.toFixed(2),
            c_a_m1: c_a_m1 ? +c_a_m1.toFixed(2) : false,
            c_c_m1: c_c_m1 ? +c_c_m1.toFixed(2) : false,
            c_t: +c_t.toFixed(5),
            s: +s.toFixed(5),
          });
        }

      }

      // See this table to understand the magic
      // console.table(table);
      // console.log(`smartPrice for ${type} and ${koef} koef: ${smartPrice.toFixed(8)}\n`);

      return smartPrice;

    } catch (e) {
      log.error(`Error in getSmartPrice() of ${this.getModuleName(module.id)} module: ${e}.`);
      return false;
    }

  },

  /**
   * Calculates clean (non-cheater) price for the order book
   * It depends on:
   *   Distance^2 from smart price: bigger distance means higher probability of cheater order
   *   Amount of order (accumulated): smaller amount means higher probability of cheater order
   *   Koef threshold: bigger koef means higher probability of cheater order
   * @param {Array of object} items Bids or asks, received using traderapi.getOrderBook()
   * @param {String} type Items are 'asks' or 'bids'? Asks arranged from low to high, Bids from high to low (spread in the center).
   * @param {Array of object} liquidity Liquidity info, calculated in getOrderBookInfo(). Using percent50 liquidity for total.
   * @param {Number} smartPrice Smart price for the order book
   * @param {String} moduleName For logging only
   * @return {Number} Clean price
   */
  getCleanPrice(items, type, liquidity, smartPrice, moduleName) {
    const koef = 7; // How to understand we achieve clean price

    try {

      let cleanPrice;

      let a = 0; let t = 0; let c = 0; let c_t = 0;
      let d = 0; let d2 = 0; let ct_d2 = 0;
      const table = [];
      let orderInfo = '';

      // Each iteration el.price moves towards to Smart price

      for (let i = 0; i < items.length; i++) {

        const el = items[i];

        if (type === 'asks') {
          if (el.price > smartPrice) break;
          a = el.amount;
          t = liquidity['percent50'].amountAsks;
          orderInfo = `${this.inclineNumber(i)} order to sell ${el.amount} ${config.coin1} @${el.price} ${config.coin2}`;
        } else {
          if (el.price < smartPrice) break;
          a = el.amount * el.price;
          t = liquidity['percent50'].amountBidsQuote;
          orderInfo = `${this.inclineNumber(i)} order to buy ${el.amount} ${config.coin1} @${el.price} ${config.coin2} for ${a} ${config.coin2}`;
        }

        d = this.numbersDifferencePercent(el.price, smartPrice) / 100;
        d2 = d * d; // Decreases every iteration. For order with smartPrice (last iteration) it equals 0.
        c += a;
        c_t = c / t; // Grows each iteration
        ct_d2 = c_t / d2; // Grows each iteration. For order with smartPrice (last iteration) it equals Infinity.

        const logIfCleaner = ((orderStatus, reason) => {
          if (moduleName === 'Cleaner') {
            log.log(`Utils/Cleaner: Considering ${orderInfo} as ${orderStatus}. Value ct_d2 ${ct_d2.toFixed(5)} is ${reason} than Koef ${koef}.`);
          }
        });

        if (ct_d2 < koef && items[i + 1]) { // While ct_d2 is less than Koef, consider an order as a cheater price
          cleanPrice = items[i + 1].price;
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

      } // For i

      if (!cleanPrice) { // Set Clean price as the best bid/ask
        cleanPrice = items?.[0].price;
      }

      // See this table to understand the magic
      // console.table(table);
      // console.log(`Clean price is ${cleanPrice.toFixed(8)} for ${type} when Smart price = ${smartPrice.toFixed(8)} and Koef = ${koef}.\n`);

      return cleanPrice;

    } catch (e) {
      log.error(`Error in getCleanPrice() of ${this.getModuleName(module.id)} module: ${e}.`);
      return false;
    }

  },

  /**
   * Calculates order statistics used in liquidity provider
   * @param {Array of object} orders Order is an object of ordersDb, including: type, price, coin1Amount, coin2Amount
   * @return {Object} Stats on asks, bids, total
   */
  getOrdersStats(orders) {

    let bidsTotalAmount = 0; let asksTotalAmount = 0;
    let bidsTotalQuoteAmount = 0; let asksTotalQuoteAmount = 0;
    let totalAmount = 0; let totalQuoteAmount = 0;
    let asksCount = 0; let bidsCount = 0; let totalCount = 0;
    for (const order of orders) {
      if (order.type === 'buy') {
        bidsTotalAmount += order.coin1Amount;
        bidsTotalQuoteAmount += order.coin2Amount;
        bidsCount += 1;
      }
      if (order.type === 'sell') {
        asksTotalAmount += order.coin1Amount;
        asksTotalQuoteAmount += order.coin2Amount;
        asksCount += 1;
      }
      totalAmount += order.coin1Amount;
      totalQuoteAmount += order.coin2Amount;
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
   * Returns precision for number of decimals. getPrecision(3) = 0.001
   * @param {number} decimals Number of decimals
   * @return {number} Precision
   */
  getPrecision(decimals) {
    return +(Math.pow(10, -decimals).toFixed(decimals));
  },

  /**
   * Returns decimals for precision
   * 0.00001 -> 5
   * 1000 -> 0
   * 1 -> 0
   * 0 -> undefined
   * @param {Number|String} precision e.g. 0.00001
   * @returns {number} returns 5
   */
  getDecimalsFromPrecision(precision) {
    if (!precision) return;
    if (precision > 1) return 0;
    return Math.round(Math.abs(Math.log10(+precision)));
  },

  /**
   * Returns decimals for precision for number greater than 1
   * 0.00001 -> 5
   * 1000 -> -3
   * 1 -> 0
   * 0 -> undefined
   * @param {Number|String} precision e.g. 0.00001
   * @returns {number} returns 5
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
   * @param {Number|String} number
   * @returns {Number|undefined}
   */
  getDecimalsFromNumber(number) {
    number = number?.toString();

    if (!isFinite(number)) return undefined;

    const split = number.split('.');

    if (split.length === 1) {
      return 0;
    }

    return split[1]?.length;
  },

  /**
   * Checks if order price is out of order book custom percent (as mm_liquiditySpreadPercent) spread
   * @param order Object of ordersDb
   * @param obInfo Object of utils.getOrderBookInfo()
   * @returns {Boolean}
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
      log.error(`Error in isOrderOutOfSpread() of ${this.getModuleName(module.id)} module: ${e}.`);
      return false;
    }
  },

  /**
   * Checks if order price is out of Price watcher range
   * @param order Object of ordersDb
   * @returns {Boolean}
   */
  isOrderOutOfPriceWatcherRange(order) {
    try {
      const pw = require('../trade/mm_price_watcher');
      if (pw.getIsPriceActualAndEnabled()) {
        const lowPrice = pw.getLowPrice();
        const highPrice = pw.getHighPrice();
        if (
          (order.type === 'sell' && order.price < lowPrice) ||
          (order.type === 'buy' && order.price > highPrice)
        ) {
          return true;
        }
      }
    } catch (e) {
      log.error(`Error in isOrderOutOfPriceWatcherRange() of ${this.getModuleName(module.id)} module: ${e}.`);
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
   * Parses number or number range from string like 1.25–2.90
   * It considers a separator can be hyphen, dash, minus, long dash
   * All numbers should be positive and finite
   * @param {String} str String to parse
   * @return {Object} isRange, isValue, from, to
   */
  parseRangeOrValue(str) {
    if (!str) {
      return {
        isRange: false,
        isValue: false,
      };
    }

    let from; let to; let value;
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

    from = +from;
    to = +to;

    if (!this.isPositiveNumber(from) || !this.isPositiveNumber(to) || from > to) {
      return {
        isRange: false,
        isValue: false,
      };
    }

    return {
      isRange: true,
      isValue: false,
      from,
      to,
    };
  },

  /**
   * Searches difference between current and previous balances
   * @param {Array of Object} a Current balances
   * @param {Array of Object} b Previous balances
   * @return {Array of Object} Difference
   */
  differenceInBalances(a, b) {
    if (!a || !b || !a[0] || !b[0]) return false;

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
   * @param {Array of Object} a Current balances
   * @param {Object<timestamp, balances>} b Previous balances with timestamp
   * @return {String} Difference string
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
        if (Math.abs(deltaTotalUSD)> 0.01 || Math.abs(deltaTotalBTC > 0.00000009)) {
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
   * Sums balances by code for two accounts
   * @param {Array of Object} arr1 Balances for 1 account
   * @param {Array of Object} arr2 Balances for 2 account
   * @return {Array of Object} arr1 + arr2
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
   * @param {Number} number Number to incline
   * @return {String} 0th, 1st, 2d, 3d, 4th, 10th, 20th, 21st, 22d, 23d, 30th
   */
  inclineNumber(number) {
    if (!this.isPositiveOrZeroInteger(number)) {
      return number;
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
   * @return {String} F. e., '1 day 5 hours'
   */
  timestampInDaysHoursMins(timestamp) {
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
    timeString = timeString.trim();
    if (timeString === '') {
      timeString = '~0 mins';
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
};

module.exports.watchConfig();
