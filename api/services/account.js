'use strict';

/**
 * @module api/services/account
 * @typedef {import('types/webui-api/account.d.js').WebUiBalancesResponse} WebUiBalancesResponse
 * @typedef {import('types/webui-api/account.d.js').WebUiOpenOrdersResponse} WebUiOpenOrdersResponse
 * @typedef {import('types/assets.d.js').Result} AssetsResult
 * @typedef {import('types/assets.d.js').ResultWithTimestamp} AssetsResultWithTimestamp
 */

const config = require('../../modules/configReader');
const db = require('../../modules/DB');
const log = require('../../helpers/log');
const orderCollector = require('../../trade/orderCollector');
const orderUtils = require('../../trade/orderUtils');
const { getTraderConnector } = require('../traderConnector');
const { NotFoundError, ServiceUnavailableError } = require('../lib/errors');
const { resolvePair } = require('./market');

/**
 * Thin WebUI wrapper around `orderUtils` / trader connector results.
 *
 * Connector contract quirks (`undefined` / `null` / `[]` / error objects / thrown
 * exceptions) are intentional per `.github/exchange-connector-guide.md`. This layer
 * only catches hard failures and maps “no usable payload” to HTTP errors — it does
 * not normalize field shapes.
 */

/**
 * @param {unknown} value
 * @returns {value is { success: false, message?: string }}
 */
function isBalanceErrorPayload(value) {
  return Boolean(
      value &&
      typeof value === 'object' &&
      /** @type {{ success?: unknown }} */ (value).success === false,
  );
}

/**
 * Returns non-zero account balances as structured JSON (no commandTxs markdown).
 * Uses `orderUtils.getBalancesCached` so MM modules and WebUI share one REST cache
 * (and connector sockets when enabled).
 *
 * @param {{ noCache?: boolean }} [options]
 * @returns {Promise<WebUiBalancesResponse>}
 */
async function getBalances(options = {}) {
  const connector = getTraderConnector();

  if (typeof connector.getBalances !== 'function') {
    throw new ServiceUnavailableError('Exchange connector does not support getBalances()');
  }

  /** @type {AssetsResultWithTimestamp | { success: boolean, message: string } | undefined} */
  let balances;
  try {
    balances = await orderUtils.getBalancesCached(true, 'webui-api', Boolean(options.noCache));
  } catch (error) {
    // Hard failure from cache/connector — not a normal “empty / unavailable” return.
    throw new ServiceUnavailableError(
        `Balances request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Some connectors return `{ success: false, message }` instead of throwing.
  if (isBalanceErrorPayload(balances)) {
    throw new NotFoundError(balances.message || 'Balances unavailable');
  }

  if (!balances) {
    throw new NotFoundError('Balances unavailable');
  }

  return { balances: /** @type {AssetsResult} */ (balances) };
}

/**
 * Returns open orders for the requested pair as structured JSON.
 * Uses `orderUtils.getOpenOrdersCached` (shared REST / socket path with MM modules).
 *
 * @param {string | undefined} pairInput Optional pair override
 * @param {{ noCache?: boolean }} [options]
 * @returns {Promise<WebUiOpenOrdersResponse>}
 */
async function getOpenOrders(pairInput, options = {}) {
  const pair = resolvePair(pairInput);
  const connector = getTraderConnector();

  if (typeof connector.getOpenOrders !== 'function') {
    throw new ServiceUnavailableError('Exchange connector does not support getOpenOrders()');
  }

  let orders;
  try {
    orders = await orderUtils.getOpenOrdersCached(pair, 'webui-api', Boolean(options.noCache));
  } catch (error) {
    throw new ServiceUnavailableError(
        `Open orders request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!orders) {
    throw new NotFoundError(`Open orders unavailable for ${pair}`);
  }

  return { pair, orders: await attachOrderPurposes(pair, orders) };
}

/**
 * Joins exchange open orders with `dbOrders.purpose` (`ld`, `ld2`, `t`, `ob`, …).
 * Orders not found locally are tagged `unk`. Failures are logged and the
 * original list is returned so the endpoint still works without Mongo.
 *
 * @param {string} pair
 * @param {object[]} orders
 * @returns {Promise<object[]>}
 */
async function attachOrderPurposes(pair, orders) {
  const ordersDb = db.ordersDb;
  if (!ordersDb || !Array.isArray(orders) || orders.length === 0) {
    return orders;
  }

  try {
    const dbOrders = await ordersDb.find({
      isProcessed: false,
      exchange: config.exchange,
      pair,
    });
    const byId = new Map(dbOrders.map((row) => [String(row._id), row]));
    const labels = orderCollector.orderPurposes;

    return orders.map((order) => {
      const dbOrder = byId.get(String(order.orderId));
      const rawPurpose = dbOrder?.purpose || 'unk';
      const moduleIndex = dbOrder ? (Number(dbOrder.moduleIndex) || 1) : undefined;
      const purpose = rawPurpose === 'ld' && moduleIndex && moduleIndex > 1 ? `ld${moduleIndex}` : rawPurpose;
      const subPurpose = dbOrder?.subPurpose;
      const subType = dbOrder?.subType;
      const subtype = [subPurpose, subType].filter(Boolean).join(', ') || undefined;
      const baseLabel = labels[rawPurpose] || 'Unknown';
      return {
        ...order,
        purpose,
        purposeLabel: purpose === rawPurpose ? baseLabel : `${baseLabel} ${purpose}`,
        moduleIndex,
        subPurpose,
        subType,
        subtype,
        quoteAmount: typeof dbOrder?.coin2Amount === 'number' ? dbOrder.coin2Amount : undefined,
      };
    });
  } catch (error) {
    log.warn(
        `webui-api: Unable to attach order purposes for ${pair}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return orders;
  }
}

module.exports = {
  getBalances,
  getOpenOrders,
};
