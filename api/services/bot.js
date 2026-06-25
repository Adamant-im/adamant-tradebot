'use strict';

/**
 * @module api/services/bot
 * @typedef {import('types/webui-api/bot.d.js').WebUiBotInfo} WebUiBotInfo
 */

const config = require('../../modules/configReader');
const { getTraderConnector } = require('../traderConnector');
const { getBotCapabilities } = require('../lib/capabilities');
const { getWebUiTransport } = require('../lib/webuiConfig');

/**
 * Builds the WebUI bootstrap payload (`GET /api/v1/bot`).
 *
 * The client uses this response to render pair/exchange context, discover installed MM
 * modules, and decide which control blocks to show or disable.
 *
 * @returns {WebUiBotInfo}
 */
function getBotInfo() {
  const connector = getTraderConnector();
  const pair = config.pair;
  const exchangeFeatures = typeof connector.features === 'function' ?
    connector.features(pair) :
    {};

  return {
    transport: getWebUiTransport(config),
    version: config.version,
    branch: config.projectBranch,
    exchange: config.exchangeName,
    pair,
    base: config.coin1,
    quote: config.coin2,
    perpetual: Boolean(config.perpetual),
    secondAccountEnabled: Boolean(config.apikey2),
    capabilities: getBotCapabilities(exchangeFeatures),
  };
}

module.exports = {
  getBotInfo,
};
