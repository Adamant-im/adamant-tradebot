const config = require('./configReader');
const log = require('../helpers/log');
const { AdamantApi } = require('adamant-api');

if (config.passPhrase) {
  module.exports = new AdamantApi({ nodes: config.node_ADM, logLevel: config.log_level, logger: log });
} else {
  module.exports = {
    sendMessage: () => {
      return { success: true };
    },
  };
}
