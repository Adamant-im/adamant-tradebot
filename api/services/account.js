'use strict';

/**
 * @module api/services/account
 * @typedef {import('types/webui-api/account.d.js').WebUiBalancesResponse} WebUiBalancesResponse
 * @typedef {import('types/webui-api/account.d.js').WebUiOpenOrdersResponse} WebUiOpenOrdersResponse
 */

const { getTraderConnector } = require('../traderConnector');
const { NotFoundError, ServiceUnavailableError } = require('../lib/errors');
const { resolvePair } = require('./market');

/**
 * Returns non-zero account balances as structured JSON (no commandTxs markdown).
 *
 * @returns {Promise<WebUiBalancesResponse>}
 */
async function getBalances() {
  const connector = getTraderConnector();

  if (typeof connector.getBalances !== 'function') {
    throw new ServiceUnavailableError('Exchange connector does not support getBalances()');
  }

  const balances = await connector.getBalances(true);

  if (!balances) {
    throw new NotFoundError('Balances unavailable');
  }

  return { balances };
}

/**
 * Returns open orders for the requested pair as structured JSON.
 *
 * @param {string | undefined} pairInput Optional pair override
 * @returns {Promise<WebUiOpenOrdersResponse>}
 */
async function getOpenOrders(pairInput) {
  const pair = resolvePair(pairInput);
  const connector = getTraderConnector();

  if (typeof connector.getOpenOrders !== 'function') {
    throw new ServiceUnavailableError('Exchange connector does not support getOpenOrders()');
  }

  const orders = await connector.getOpenOrders(pair);

  if (!orders) {
    throw new NotFoundError(`Open orders unavailable for ${pair}`);
  }

  return { pair, orders };
}

module.exports = {
  getBalances,
  getOpenOrders,
};
