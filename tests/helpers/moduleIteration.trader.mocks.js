'use strict';

const path = require('path');

const config = {
  exchange: 'iterationtest',
  exchangeName: 'IterationTest',
  defaultPair: 'ADM/USDT',
  pair: 'ADM/USDT',
  coin1: 'ADM',
  coin2: 'USDT',
  perpetual: '',
  apikey: 'test-apikey',
  apisecret: 'test-apisecret',
  apipassword: '',
  exchange_socket: false,
  exchange_socket_pull: false,
  nice_chart: { enabled: false },
  notifyName: 'IterationTest',
  silent_mode: true,
  log_level: 'none',
  fileWithPath: path.join(__dirname, '../../config.default.jsonc'),
};

const tradeParams = {
  mm_isActive: false,
  mm_isTraderActive: false,
  mm_Policy: 'optimal',
  mm_minInterval: 1000,
  mm_maxInterval: 1000,
};

function traderFactory() {
  return {
    features() {
      return {};
    },
  };
}

const db = {
  ordersDb: {
    find: async () => [],
  },
  ready: Promise.resolve({}),
};

module.exports = {
  config,
  tradeParams,
  traderFactory,
  db,
};
