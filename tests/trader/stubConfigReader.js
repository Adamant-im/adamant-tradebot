'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Minimal `configReader` stub for mocked trader Jest suites.
 * Dummy keys only — live checks belong in `tests/trader_live/`.
 *
 * `fileWithPath` points at a file that exists in the repo. Trade params themselves
 * are virtual-mocked in each suite (`jest.mock('../../trade/settings/tradeParams_<slug>', …)`).
 *
 * @param {string} exchange Connector slug, e.g. `binance`
 * @param {string} exchangeName Display name
 * @returns {object}
 */
function forExchange(exchange, exchangeName) {
  return {
    coin1: 'BTC',
    coin2: 'USDT',
    pair: 'BTC/USDT',
    pair_hidden: false,
    exchange,
    exchangeName,
    isDemoAccount: false,
    apikey: 'test-apikey',
    apisecret: 'test-apisecret',
    apipassword: 'test-password',
    fileWithPath: path.join(__dirname, '../../config.default.jsonc'),
  };
}

const silentLog = {
  log: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  HEARTBEAT_FILE_PATH: '/tmp/trader-jest-heartbeat',
};

if (typeof jest !== 'undefined' && !fs.watch._isMockFunction) {
  jest.spyOn(fs, 'watch').mockImplementation(() => ({ close() {} }));
}

module.exports = { forExchange, silentLog };
