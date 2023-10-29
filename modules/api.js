const config = require('./configReader');
const log = require('../helpers/log');

if (config.passPhrase) {
  module.exports = require('adamant-api')({ node: config.node_ADM, logLevel: config.log_level }, log);
} else {
  module.exports = {
    sendMessage: () => {
      return { success: true };
    },
  };
}
