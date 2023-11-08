const config = require('../modules/configReader');
const dateTime = require('./dateTime');

const fs = require('fs');
if (!fs.existsSync('./logs')) {
  fs.mkdirSync('./logs');
}

const infoStr = fs.createWriteStream('./logs/' + dateTime.date() + '.log', {
  flags: 'a',
});

infoStr.write(`\n\n[The bot started] _________________${dateTime.fullTime()}_________________\n`);

module.exports = {
  error(str) {
    if (['error', 'warn', 'info', 'log'].includes(config.log_level)) {
      if (!process.env.CLI_MODE_ENABLED) {
        console.log('\x1b[31m', 'error|' + dateTime.fullTime(), '\x1b[0m', str);
      }
      infoStr.write('\n ' + 'error|' + dateTime.fullTime() + '|' + str);
    }
  },
  warn(str) {
    if (['warn', 'info', 'log'].includes(config.log_level)) {
      if (!process.env.CLI_MODE_ENABLED) {
        console.log('\x1b[33m', 'warn|' + dateTime.fullTime(), '\x1b[0m', str);
      }
      infoStr.write('\n ' + 'warn|' + dateTime.fullTime() + '|' + str);
    }
  },
  info(str) {
    if (['info', 'log'].includes(config.log_level)) {
      if (!process.env.CLI_MODE_ENABLED) {
        console.log('\x1b[32m', 'info|' + dateTime.fullTime(), '\x1b[0m', str);
      }
      infoStr.write('\n ' + 'info|' + dateTime.fullTime() + '|' + str);
    }
  },
  log(str) {
    if (['log'].includes(config.log_level)) {
      if (!process.env.CLI_MODE_ENABLED) {
        console.log('\x1b[34m', 'log|' + dateTime.fullTime(), '\x1b[0m', str);
      }
      infoStr.write('\n ' + 'log|[' + dateTime.fullTime() + '|' + str);
    }
  },
};
