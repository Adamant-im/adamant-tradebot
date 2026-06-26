// @ts-nocheck — `require('../trade/trader_*')` loads the full exchange/trade module tree at runtime.
'use strict';

/**
 * @module api/traderConnector
 * @typedef {import('types/webui-api/connector.d.js').TraderConnector} TraderConnector
 */

const config = require('../modules/configReader');
const log = require('../helpers/log');
const utils = require('../helpers/utils');

/** @type {TraderConnector | undefined} */
let connectorInstance;

/**
 * Returns the shared exchange connector used by WebUI market-data and account endpoints.
 *
 * The instance is created lazily on first access and then cached for the process lifetime.
 * Spot mode instantiates `trade/trader_{exchange}`; perpetual mode reuses the singleton
 * from `modules/perpetualApi.js` so WebUI reads the same API object as trading modules.
 *
 * @returns {TraderConnector} Exchange connector API instance
 */
function getTraderConnector() {
  if (connectorInstance) {
    return connectorInstance;
  }

  if (config.perpetual) {
    const perpetualApiFactory = utils.softRequire('../modules/perpetualApi', __filename);

    if (!perpetualApiFactory) {
      log.warn('traderConnector: config.perpetual is set but modules/perpetualApi.js is missing from this build.');
      connectorInstance = /** @type {TraderConnector} */ ({});
      return connectorInstance;
    }

    connectorInstance = perpetualApiFactory();
  } else {
    connectorInstance = require('../trade/trader_' + config.exchange)(
        config.apikey,
        config.apisecret,
        config.apipassword,
        log,
        undefined,
        undefined,
        config.exchange_socket,
        config.exchange_socket_pull,
    );
  }

  return connectorInstance;
}

/**
 * Clears the cached connector instance.
 * Intended for unit tests that need a fresh mock between cases.
 */
function resetTraderConnector() {
  connectorInstance = undefined;
}

module.exports = {
  getTraderConnector,
  resetTraderConnector,
};
