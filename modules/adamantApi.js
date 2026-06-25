/**
 * @module modules/adamantApi
 * @typedef {import('types/bot/adamant.d.js').GetAdamantApi} GetAdamantApi
 */

const config = require('./configReader');
const log = require('../helpers/log');
const utils = require('../helpers/utils');
const { AdamantApi } = require('adamant-api');

/** @type {import('adamant-api').AdamantApi | undefined} */
let instance;

/**
 * Returns a process-wide singleton `AdamantApi` client.
 *
 * On first call, creates the client, logs the bot ADM balance, and reuses the
 * same instance for all later calls (socket, tx checker, command replies).
 *
 * @type {GetAdamantApi}
 */
module.exports = function getAdamantApi() {
  if (!instance) {
    log.log('ADAMANT API: Creating API client instance.');

    instance = new AdamantApi({
      nodes: config.node_ADM,
      logLevel: config.log_level,
      logger: log,
    });

    // Log the bot wallet balance once at startup; failures are non-fatal.
    instance.getAccountBalance(config.address).then((response) => {
      if (response.success) {
        log.log(`ADAMANT API: Bot balance is ${utils.satsToADM(response.balance)} ADM.`);
      } else {
        const details = 'errorMessage' in response ? response.errorMessage : 'No details.';
        log.warn(`ADAMANT API: Failed to fetch bot balance for ${config.address}. ${details || 'No details.'}`);
      }
    }).catch((error) => {
      log.warn(`ADAMANT API: Unexpected error while fetching bot balance for ${config.address}: ${error}`);
    });
  }

  return instance;
};
