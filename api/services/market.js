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
const orderUtils = require('../../trade/orderUtils');
const { getTraderConnector } = require('../traderConnector');
const { BadRequestError, NotFoundError, ServiceUnavailableError } = require('../lib/errors');

/** Human-readable pair format used across WebUI and trader modules. */
const PAIR_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * Thin WebUI wrapper around trader / orderUtils results.
 *
 * Passes connector return shapes through (including `undefined` / empty arrays).
 * Only maps hard exceptions and “no payload” to HTTP errors — field normalization
 * stays in `trader_*` per the exchange connector guide.
 */

/**
 * Resolves the trading pair for a market-data request.
 * Falls back to `config.pair` when the client omits the query parameter.
 *
 * @param {string} [pair] Optional `BASE/QUOTE` override
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
 * Fetches a normalized 24h ticker for the pair via `orderUtils.getRatesCached`.
 *
 * @param {string | undefined} pairInput Optional pair override
 * @param {{ noCache?: boolean }} [options]
 * @returns {Promise<WebUiTickerResponse>}
 */
async function getTicker(pairInput, options = {}) {
  const pair = resolvePair(pairInput);
  const connector = getTraderConnector();

  assertConnectorMethod(connector, pair, 'getRates');

  let ticker;
  try {
    ticker = await orderUtils.getRatesCached(pair, 'webui-api', Boolean(options.noCache));
  } catch (error) {
    throw new ServiceUnavailableError(
        `Ticker request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!ticker) {
    throw new NotFoundError(`Ticker unavailable for ${pair}`);
  }

  return { pair, ticker };
}

/**
 * Fetches normalized order book depth via `orderUtils.getOrderBookCached`.
 * Optional `limit` is applied after the shared cache read (cache stores full depth).
 *
 * @param {string | undefined} pairInput Optional pair override
 * @param {number | undefined} limit Maximum depth levels per side
 * @param {{ noCache?: boolean }} [options]
 * @returns {Promise<WebUiOrderBookResponse>}
 */
async function getOrderBook(pairInput, limit, options = {}) {
  const pair = resolvePair(pairInput);
  const connector = getTraderConnector();

  assertConnectorMethod(connector, pair, 'getOrderBook');

  let depth;
  try {
    depth = await orderUtils.getOrderBookCached(pair, 'webui-api', Boolean(options.noCache));
  } catch (error) {
    throw new ServiceUnavailableError(
        `Order book request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!depth) {
    throw new NotFoundError(`Order book unavailable for ${pair}`);
  }

  if (limit && Number.isFinite(limit) && limit > 0) {
    return {
      pair,
      bids: Array.isArray(depth.bids) ? depth.bids.slice(0, limit) : depth.bids,
      asks: Array.isArray(depth.asks) ? depth.asks.slice(0, limit) : depth.asks,
    };
  }

  return { pair, ...depth };
}

/**
 * Fetches recent public trades for the pair.
 * No shared `orderUtils` cache exists for trades yet — calls the connector directly.
 *
 * @param {string | undefined} pairInput Optional pair override
 * @param {number} [limit=100] Maximum number of trades
 * @param {{ noCache?: boolean }} [options] Reserved; trades are always fetched fresh today
 * @returns {Promise<WebUiTradesResponse>}
 */
async function getTrades(pairInput, limit = 100, options = {}) {
  void options.noCache;
  const pair = resolvePair(pairInput);
  const connector = getTraderConnector();

  assertConnectorMethod(connector, pair, 'getTradesHistory');

  let trades;
  try {
    trades = await connector.getTradesHistory(pair, limit);
  } catch (error) {
    throw new ServiceUnavailableError(
        `Trades request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Connector may return `undefined` for empty/unavailable — pass that up as 404.
  if (!trades) {
    throw new NotFoundError(`Trades unavailable for ${pair}`);
  }

  return { pair, trades };
}

/**
 * Fetches OHLCV candles via the connector's `getCandlesHistory()`.
 * No shared `orderUtils` cache exists for candles yet — calls the connector directly.
 *
 * @param {WebUiOhlcQuery} options Query parameters from the HTTP layer
 * @param {{ noCache?: boolean }} [cacheOptions] Reserved; candles are always fetched fresh today
 * @returns {Promise<WebUiOhlcResponse>}
 */
async function getOhlc(options, cacheOptions = {}) {
  void cacheOptions.noCache;
  const pair = resolvePair(options.pair);
  const connector = getTraderConnector();

  if (!options.timeframe) {
    throw new BadRequestError('timeframe query parameter is required');
  }

  assertConnectorMethod(connector, pair, 'getCandlesHistory');

  let candles;
  try {
    candles = await connector.getCandlesHistory(
        pair,
        options.timeframe,
        options.since,
        options.limit,
        options.excludePartial,
    );
  } catch (error) {
    throw new ServiceUnavailableError(
        `OHLC request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

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
