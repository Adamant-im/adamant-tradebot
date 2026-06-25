'use strict';

/**
 * @module modules/startupWarmup
 * @typedef {import('types/bot/startupWarmup.d.js').ConnectorWarmupOptions} ConnectorWarmupOptions
 * @typedef {import('types/bot/startupWarmup.d.js').ConnectorWarmupResult} ConnectorWarmupResult
 * @typedef {import('types/bot/startupWarmup.d.js').WarmupConnectorApi} WarmupConnectorApi
 */

const config = require('./configReader');
const utils = require('../helpers/utils');

const DEFAULT_CONNECTOR_WARMUP_TIMEOUT_MS = 15000;
const DEFAULT_CONNECTOR_WARMUP_POLL_MS = 250;

/**
 * Waits for the specified number of milliseconds.
 *
 * @param {number} ms Delay duration in milliseconds
 * @returns {Promise<void>} Resolves after the delay elapses
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the connector instance whose metadata should be warmed up.
 *
 * Perpetual mode must use the shared singleton from `modules/perpetualApi.js`
 * so bootstrap warms the same API instance that trading modules reuse later.
 * Spot mode creates a regular trader adapter instance.
 *
 * @returns {WarmupConnectorApi | null | undefined} Active connector API instance
 */
function getWarmupConnectorApi() {
  const log = require('../helpers/log');

  if (config.perpetual) {
    const perpetualApiFactory = utils.softRequire('./perpetualApi', __filename);
    return perpetualApiFactory ? perpetualApiFactory() : undefined;
  }

  return require(`../trade/trader_${config.exchange}`)(
      config.apikey,
      config.apisecret,
      config.apipassword,
      log,
      undefined,
      undefined,
      false,
      false,
  );
}

/**
 * Warms up exchange market metadata before trading modules start.
 *
 * Polls the active connector until price and amount precision metadata becomes
 * available or the timeout expires. Spot connectors are checked via
 * `marketInfo(defaultPair)`; perpetual connectors via `instrumentInfo(defaultPair)`.
 *
 * For slow connectors, the timeout is stretched using the connector's
 * `apiProcessingDelayMs` feature (budget = max(baseTimeout, delay × 3)).
 *
 * @param {ConnectorWarmupOptions} [options={}] Warmup options
 * @returns {Promise<ConnectorWarmupResult>} Warmup outcome summary
 */
async function warmUpConnectorData(options = {}) {
  const timeoutMsOption = Number(options.timeoutMs);
  const pollMsOption = Number(options.pollMs);
  const baseTimeoutMs = Number.isFinite(timeoutMsOption) ? timeoutMsOption : DEFAULT_CONNECTOR_WARMUP_TIMEOUT_MS;
  const pollMs = Number.isFinite(pollMsOption) ? pollMsOption : DEFAULT_CONNECTOR_WARMUP_POLL_MS;

  const log = require('../helpers/log');

  try {
    const traderapi = getWarmupConnectorApi();

    if (!traderapi) {
      log.warn(`Bootstrap: No connector available to warm up for ${config.exchangeName}; skipping metadata preload.`);

      return {
        attempted: false,
        warmedUp: false,
        elapsedMs: 0,
        timeoutMs: baseTimeoutMs,
      };
    }

    const featureFlags = typeof traderapi.features === 'function' ? traderapi.features(config.defaultPair) || {} : {};
    const connectorDelayMs = Number(featureFlags.apiProcessingDelayMs);
    const timeoutMs = Math.max(
        baseTimeoutMs,
        Number.isFinite(connectorDelayMs) ? connectorDelayMs * 3 : 0,
    );
    const startedAt = Date.now();
    const metadataMethodName = config.perpetual ? 'instrumentInfo' : 'marketInfo';

    while (Date.now() - startedAt < timeoutMs) {
      const marketInfo = typeof traderapi[metadataMethodName] === 'function' ?
        await Promise.resolve(traderapi[metadataMethodName](config.defaultPair)) :
        undefined;

      if (marketInfo) {
        const elapsedMs = Date.now() - startedAt;
        const connectorType = config.perpetual ? 'perpetual instruments' : 'spot markets';
        log.log(`Bootstrap: Warmed up ${config.exchangeName} ${connectorType} for ${config.defaultPair} in ${elapsedMs} ms.`);

        return {
          attempted: true,
          warmedUp: true,
          elapsedMs,
          timeoutMs,
        };
      }

      await delay(pollMs);
    }

    log.warn(
        `Bootstrap: ${config.exchangeName} metadata for ${config.defaultPair} is still loading after ` +
        `${timeoutMs} ms. Starting modules with best-effort precision data.`,
    );

    return {
      attempted: true,
      warmedUp: false,
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      reason: 'timeout',
    };
  } catch (error) {
    log.warn(`Bootstrap: Failed to warm up ${config.exchangeName} connector metadata before module start. ${error}`);

    return {
      attempted: true,
      warmedUp: false,
      elapsedMs: 0,
      timeoutMs: baseTimeoutMs,
    };
  }
}

module.exports = {
  delay,
  getWarmupConnectorApi,
  warmUpConnectorData,
};
