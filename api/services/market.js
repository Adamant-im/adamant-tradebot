'use strict';

/**
 * @module api/services/market
 * @typedef {import('types/webui-api/market.d.js').WebUiTickerResponse} WebUiTickerResponse
 * @typedef {import('types/webui-api/market.d.js').WebUiOrderBookResponse} WebUiOrderBookResponse
 * @typedef {import('types/webui-api/market.d.js').WebUiTradesResponse} WebUiTradesResponse
 * @typedef {import('types/webui-api/market.d.js').WebUiOhlcResponse} WebUiOhlcResponse
 * @typedef {import('types/webui-api/market.d.js').WebUiOhlcQuery} WebUiOhlcQuery
 * @typedef {import('types/webui-api/connector.d.js').TraderConnector} TraderConnector
 */

const config = require('../../modules/configReader');
const { getTraderConnector } = require('../traderConnector');
const { BadRequestError, NotFoundError, ServiceUnavailableError } = require('../lib/errors');

/** Human-readable pair format used across WebUI and trader modules. */
const PAIR_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Resolves the trading pair for a market-data request.
 * Falls back to `config.pair` when the client omits the query parameter.
 *
 * @param {string | undefined} pair Optional `BASE/QUOTE` override
 * @returns {string} Validated pair string
 * @throws {BadRequestError} When the format is invalid
 */
function resolvePair(pair) {
  const resolved = pair || config.pair;

  if (!PAIR_PATTERN.test(resolved)) {
    throw new BadRequestError('Invalid pair format. Expected BASE/QUOTE.');
  }

  return resolved;
}

/**
 * Ensures the exchange connector implements a method and did not disable it via `features()`.
 *
 * @param {TraderConnector} connector Active trader connector
 * @param {string} pair Trading pair passed to `features(pair)` when available
 * @param {keyof TraderConnector} method Connector method name to invoke
 * @throws {ServiceUnavailableError} When the method is missing or explicitly disabled
 */
function assertConnectorMethod(connector, pair, method) {
  if (typeof connector?.[method] !== 'function') {
    throw new ServiceUnavailableError(`Exchange connector does not support ${String(method)}()`);
  }

  const features = typeof connector.features === 'function' ? connector.features(pair) : {};

  // Some connectors expose per-method opt-out flags on `features()`.
  if (features[method] === false) {
    throw new ServiceUnavailableError(`Exchange connector disabled ${String(method)}() for this pair`);
  }
}

/**
 * Fetches a normalized 24h ticker for the pair.
 *
 * @param {string | undefined} pairInput Optional pair override
 * @returns {Promise<WebUiTickerResponse>}
 */
async function getTicker(pairInput) {
  const pair = resolvePair(pairInput);
  const connector = getTraderConnector();

  assertConnectorMethod(connector, pair, 'getRates');

  const ticker = await connector.getRates(pair);

  if (!ticker) {
    throw new NotFoundError(`Ticker unavailable for ${pair}`);
  }

  return { pair, ticker };
}

/**
 * Fetches normalized order book depth.
 *
 * @param {string | undefined} pairInput Optional pair override
 * @param {number | undefined} limit Maximum depth levels per side (exchange-specific)
 * @returns {Promise<WebUiOrderBookResponse>}
 */
async function getOrderBook(pairInput, limit) {
  const pair = resolvePair(pairInput);
  const connector = getTraderConnector();

  assertConnectorMethod(connector, pair, 'getOrderBook');

  const depth = await connector.getOrderBook(pair, limit);

  if (!depth) {
    throw new NotFoundError(`Order book unavailable for ${pair}`);
  }

  return { pair, ...depth };
}

/**
 * Fetches recent public trades for the pair.
 *
 * @param {string | undefined} pairInput Optional pair override
 * @param {number} [limit=100] Maximum number of trades
 * @returns {Promise<WebUiTradesResponse>}
 */
async function getTrades(pairInput, limit = 100) {
  const pair = resolvePair(pairInput);
  const connector = getTraderConnector();

  assertConnectorMethod(connector, pair, 'getTradesHistory');

  const trades = await connector.getTradesHistory(pair, limit);

  if (!trades) {
    throw new NotFoundError(`Trades unavailable for ${pair}`);
  }

  return { pair, trades };
}

/**
 * Fetches OHLCV candles via the connector's `getCandlesHistory()` implementation.
 *
 * @param {WebUiOhlcQuery} options Query parameters from the HTTP layer
 * @returns {Promise<WebUiOhlcResponse>}
 */
async function getOhlc(options) {
  const pair = resolvePair(options.pair);
  const connector = getTraderConnector();

  if (!options.timeframe) {
    throw new BadRequestError('timeframe query parameter is required');
  }

  assertConnectorMethod(connector, pair, 'getCandlesHistory');

  const candles = await connector.getCandlesHistory(
      pair,
      options.timeframe,
      options.since,
      options.limit,
      options.excludePartial,
  );

  if (!candles) {
    throw new NotFoundError(`OHLC unavailable for ${pair} (${options.timeframe})`);
  }

  return {
    pair,
    timeframe: options.timeframe,
    candles,
  };
}

module.exports = {
  resolvePair,
  getTicker,
  getOrderBook,
  getTrades,
  getOhlc,
};
