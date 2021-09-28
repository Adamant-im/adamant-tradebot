const config = require('../modules/configReader');
const log = require('./log');
const { SAT, EPOCH } = require('./const');

module.exports = {
  /**
   * Returns current time in milliseconds since Unix Epoch
   * @return {number}
   */
  unix() {
    return new Date().getTime();
  },

  /**
   * Converts provided `time` to ADAMANT's epoch timestamp
   * @param {number} time Timestamp to convert
   * @return {number}
   */
  epochTime(time) {
    if (!time) {
      time = Date.now();
    }
    return Math.floor((time - EPOCH) / 1000);
  },

  /**
   * Converts ADAMANT's epoch timestamp to a Unix timestamp
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

    } catch (e) { }
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

    } catch (e) { }
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
    } catch (e) { }
    return false;
  },

  /**
   * Compares two arrays
   * @param {array} array1
   * @param {array} array2
   * @return {boolean} True, if arrays are equal
   */
  isArraysEqual(array1, array2) {
    return array1.length === array2.length && array1.sort().every(function(value, index) {
      return value === array2.sort()[index];
    });
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
   * @param {number} num Number to format
   * @param {boolean} doBold If to add **bold** markdown for integer part
   * @return {string} Formatted number, like 3 134 234.778
   */
  formatNumber(num, doBold) {
    const parts = (+num + '').split('.');
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

  getOrderBookInfo(orderBook, customSpreadPercent, targetPrice) {

    try {

      if (!orderBook || !orderBook.asks[0] || !orderBook.bids[0]) {
        return false;
      }

      const highestBid = orderBook.bids[0].price;
      const lowestAsk = orderBook.asks[0].price;

      let typeTargetPrice; let amountTargetPrice = 0; let targetPriceOrdersCount = 0; let amountTargetPriceQuote = 0;
      if (targetPrice) {
        if (targetPrice > highestBid && targetPrice < lowestAsk) {
          typeTargetPrice = 'inSpread';
        } else if (targetPrice < highestBid) {
          typeTargetPrice = 'sell';
        } else if (targetPrice > lowestAsk) {
          typeTargetPrice = 'buy';
        }
      }

      const spread = lowestAsk - highestBid;
      const averagePrice = (lowestAsk + highestBid) / 2;
      const spreadPercent = spread / averagePrice * 100;

      let downtrendAveragePrice = highestBid + this.randomValue(0, 0.15) * spread;
      if (downtrendAveragePrice >= lowestAsk) {
        downtrendAveragePrice = highestBid;
      }

      let uptrendAveragePrice = lowestAsk - this.randomValue(0, 0.15) * spread;
      if (uptrendAveragePrice <= highestBid) {
        uptrendAveragePrice = lowestAsk;
      }

      let middleAveragePrice = averagePrice - this.randomValue(-0.3, 0.3) * spread;
      if (middleAveragePrice >= lowestAsk || middleAveragePrice <= highestBid) {
        middleAveragePrice = averagePrice;
      }

      const liquidity = [];
      liquidity.percent2 = {};
      liquidity.percent2.spreadPercent = 2;
      liquidity.percent5 = {};
      liquidity.percent5.spreadPercent = 5;
      liquidity.percent10 = {};
      liquidity.percent10.spreadPercent = 10;
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
        liquidity[key].lowPrice = averagePrice - averagePrice * liquidity[key].spreadPercent/100;
        liquidity[key].highPrice = averagePrice + averagePrice * liquidity[key].spreadPercent/100;
        liquidity[key].spread = averagePrice * liquidity[key].spreadPercent / 100;
        // average price is the same for any spread
      }

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
        if (typeTargetPrice === 'sell' && bid.price >= targetPrice) {
          amountTargetPrice += bid.amount;
          amountTargetPriceQuote += bid.amount * bid.price;
          targetPriceOrdersCount += 1;
        }

      }

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
        if (typeTargetPrice === 'buy' && ask.price <= targetPrice) {
          amountTargetPrice += ask.amount;
          amountTargetPriceQuote += ask.amount * ask.price;
          targetPriceOrdersCount += 1;
        }

      }

      const smartBid = this.getSmartPrice(orderBook.bids, 'bids', liquidity);
      const smartAsk = this.getSmartPrice(orderBook.asks, 'asks', liquidity);

      return {
        highestBid,
        lowestAsk,
        smartBid,
        smartAsk,
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
      };

    } catch (e) {
      log.warn(`Error in getOrderBookInfo() of ${this.getModuleName(module.id)} module: ${e}.`);
      return false;
    }
  },

  getSmartPrice(items, type, liquidity) {

    try {

      let smartPrice;
      let c_m1 = 0;
      let a = 0; let a_m1 = 0; let t = 0;
      let c = 0; let c_a = 0; let c_a_m1 = 0; let c_c_m1 = 0; let c_t = 0; let s = 0;
      let prev_c_c_m1 = 0; let prev_s = 0; let prev_c_t = 0;

      const enough_c_t = 0.02;
      const table = [];


      // console.log(liquidity['full']);

      for (let i = 0; i < items.length; i++) {

        const el = items[i];
        const el_m1 = i === 0 ? false : items[i-1];
        if (type === 'asks') {
          a = el.amount;
          a_m1 = el_m1 ? el_m1.amount : false;
          t = liquidity['full'].amountAsks;
        } else {
          a = el.amount * el.price;
          a_m1 = el_m1 ? el_m1.amount * el_m1.price : false;
          t = liquidity['full'].amountBidsQuote;
        }

        prev_c_c_m1 = c_c_m1;
        prev_c_t = c_t;
        prev_s = s;

        c_m1 = c;
        c += a;
        c_a = c / a;
        c_a_m1 = a_m1 ? c / a_m1 : false;
        c_c_m1 = c_m1 === 0 ? false : c / c_m1;
        c_t = c / t;
        s = c_c_m1 * c_t;

        if (!smartPrice && s < prev_s && prev_c_t > enough_c_t) {
          smartPrice = el_m1.price;
        }
        // console.log(ask.price.toFixed(4), ask.amount.toFixed(4), c.toFixed(2), c_a.toFixed(2),
        //   c_a_m1 ? c_a_m1.toFixed(2) : false, c_c_m1 ? c_c_m1.toFixed(2) : false, c_t.toFixed(2));

        if (i < 20) {
          table.push({
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

      // console.table(table);
      // console.log(`smartPrice for ${type}: ${smartPrice}`);
      return smartPrice;

    } catch (e) {
      log.warn(`Error in getSmartPrice() of ${this.getModuleName(module.id)} module: ${e}.`);
      return false;
    }

  },

  getOrdersStats(orders) {

    // order is an object of ordersDb
    // type: type,
    // price: price,
    // coin1Amount: coin1Amount,
    // coin2Amount: coin2Amount,

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

  isOrderOutOfSpread(order, orderBookInfo) {

    // order is an object of ordersDb
    // type: type,
    // price: price,

    const laxityPercent = 30;
    const minPrice = orderBookInfo.liquidity.percentCustom.lowPrice -
      orderBookInfo.liquidity.percentCustom.spread * laxityPercent / 100;
    const maxPrice = orderBookInfo.liquidity.percentCustom.highPrice +
      orderBookInfo.liquidity.percentCustom.spread * laxityPercent / 100;

    return (order.price < minPrice) || (order.price > maxPrice);

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
      value = +str;
      if (!value || value === Infinity) {
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

    if (!from || from === Infinity || !to || to === Infinity) {
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

  difference(a, b) {
    if (!a || !b || !a[0] || !b[0]) return false;
    let obj2;
    const diff = [];
    b.forEach((obj2) => {
      obj1 = a.filter((crypto) => crypto.code === obj2.code)[0];
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

};
