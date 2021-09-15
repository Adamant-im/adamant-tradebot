const config = require('../modules/configReader');

const fs = require('fs');
if (!fs.existsSync('./logs')) {
  fs.mkdirSync('./logs');
}

const infoStr = fs.createWriteStream('./logs/' + date() + '.log', {
  flags: 'a',
});

infoStr.write(`\n\n[The bot started] _________________${fullTime()}_________________\n`);

module.exports = {
  error(str) {
    if (['error', 'warn', 'info', 'log'].includes(config.log_level)) {
      infoStr.write(`\n ` + 'error|' + fullTime() + '|' + str);
      console.log('\x1b[31m', 'error|' + fullTime(), '\x1b[0m', str);
    }
  },
  warn(str) {
    if (['warn', 'info', 'log'].includes(config.log_level)) {
      console.log('\x1b[33m', 'warn|' + fullTime(), '\x1b[0m', str);
      infoStr.write(`\n ` + 'warn|' + fullTime() + '|' + str);
    }
  },
  info(str) {
    if (['info', 'log'].includes(config.log_level)) {
      console.log('\x1b[32m', 'info|' + fullTime(), '\x1b[0m', str);
      infoStr.write(`\n ` + 'info|' + fullTime() + '|' + str);
    }
  },
  log(str) {
    if (['log'].includes(config.log_level)) {
      console.log('\x1b[34m', 'log|' + fullTime(), '\x1b[0m', str);
      infoStr.write(`\n ` + 'log|[' + fullTime() + '|' + str);
    }
  },
};

function time() {
  return formatDate(Date.now()).hh_mm_ss;
}

function date() {
  return formatDate(Date.now()).YYYY_MM_DD;
}

function fullTime() {
  return date() + ' ' + time();
}

/**
 * Formats unix timestamp to string
 * @param {number} timestamp Timestamp to format
 * @return {object} Contains different formatted strings
 */
function formatDate(timestamp) {
  if (!timestamp) return false;
  const formattedDate = {};
  const dateObject = new Date(timestamp);
  formattedDate.year = dateObject.getFullYear();
  formattedDate.month = ('0' + (dateObject.getMonth() + 1)).slice(-2);
  formattedDate.date = ('0' + dateObject.getDate()).slice(-2);
  formattedDate.hours = ('0' + dateObject.getHours()).slice(-2);
  formattedDate.minutes = ('0' + dateObject.getMinutes()).slice(-2);
  formattedDate.seconds = ('0' + dateObject.getSeconds()).slice(-2);
  formattedDate.YYYY_MM_DD = formattedDate.year + '-' + formattedDate.month + '-' + formattedDate.date;
  formattedDate.YYYY_MM_DD_hh_mm = formattedDate.year + '-' + formattedDate.month + '-' + formattedDate.date + ' ' + formattedDate.hours + ':' + formattedDate.minutes;
  formattedDate.hh_mm_ss = formattedDate.hours + ':' + formattedDate.minutes + ':' + formattedDate.seconds;
  return formattedDate;
}
