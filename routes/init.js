const express = require('express');
const log = require('../helpers/log');
const config = require('../modules/configReader');
const healthApi = require('./health');
const debugApi = require('./debug');

module.exports = {
  initApi() {
    const app = express();

    if (config.api.health) {
      app.use('/', healthApi);
    }

    if (config.api.debug) {
      app.use('/', debugApi);
    }

    app.listen(config.api.port, () => {
      log.info(`API server is listening on http://localhost:${config.api.port}. Health enabled: ${config.api.health}. Debug enabled: ${config.api.debug}.`);
    });
  },
};
