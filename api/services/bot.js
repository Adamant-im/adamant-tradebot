'use strict';

/**
 * @module api/services/bot
 * @typedef {import('types/webui-api/bot.d.js').WebUiBotInfo} WebUiBotInfo
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 */

const config = require('../../modules/configReader');
const orderUtils = require('../../trade/orderUtils');
const { getTraderConnector } = require('../traderConnector');
const { getBotCapabilities } = require('../lib/capabilities');
const { getWebUiTransport } = require('../lib/webuiConfig');

/**
 * Builds the WebUI bootstrap payload (`GET /api/v1/bot`).
 *
 * The client uses this response to render pair/exchange context, discover installed MM
 * modules and `/enable` feature codes, and decide which control blocks to show or disable.
 * Feature availability mirrors `validateFeature()` in `modules/commands/features.js`.
 *
 * @returns {WebUiBotInfo}
 */
function getBotInfo() {
  const connector = getTraderConnector();
  const pair = config.pair;
  const rawFeatures = typeof connector.features === 'function' ?
    connector.features(pair) :
    {};
  const exchangeFeatures = {
    ...rawFeatures,
    convert: typeof connector.convert === 'function',
    transfer: typeof connector.transfer === 'function',
    withdraw: typeof connector.withdraw === 'function',
  };

  const formattedPair = /** @type {ParsedMarket} */ (
    orderUtils.parseMarket(config.defaultPair, undefined, true)
  );

  const coin1Decimals = formattedPair?.coin1Decimals ?? 8;
  const coin2Decimals = formattedPair?.coin2Decimals ?? 8;
  const coin2DecimalsForStable = formattedPair?.coin2DecimalsForStable ?? coin2Decimals;

  /** @type {{ min: number, minFixed?: string, minCoin2?: number, minCoin2Fixed?: string } | undefined} */
  let minOrderAmount;
  if (typeof orderUtils.getMinOrderAmount === 'function') {
    try {
      const min = orderUtils.getMinOrderAmount();
      if (min && typeof min.min === 'number' && Number.isFinite(min.min) && min.min > 0) {
        minOrderAmount = {
          min: min.min,
          minFixed: min.minFixed,
          minCoin2: min.minCoin2,
          minCoin2Fixed: min.minCoin2Fixed,
        };
      }
    } catch {
      // Market info / rates may be unavailable during bootstrap
    }
  }

  return {
    transport: getWebUiTransport(config),
    botId: config.bot_id,
    version: config.version,
    branch: config.projectBranch,
    exchange: config.exchangeName,
    exchanges: Array.isArray(config.exchanges) ?
      config.exchanges.filter((name) => typeof name === 'string' && name.trim() && !name.startsWith('#')) :
      [],
    pair,
    base: config.coin1,
    quote: config.coin2,
    coin1Decimals,
    coin2Decimals,
    coin2DecimalsForStable,
    minOrderAmount,
    perpetual: Boolean(config.perpetual),
    secondAccountEnabled: Boolean(config.apikey2),
    capabilities: getBotCapabilities(exchangeFeatures),
  };
}

module.exports = {
  getBotInfo,
};
