'use strict';

/**
 * Helpers for storing and comparing account balance snapshots in MongoDB.
 *
 * @module helpers/balancesHistory
 */

/**
 * @typedef {import('types/assets.d').Result} AssetsResult
 * @typedef {import('types/assets.d').BalancesAndTimestamp} BalancesAndTimestamp
 * @typedef {import('types/assets.d').CoinComparisonData} CoinComparisonData
 * @typedef {import('types/assets.d').BalanceComparisonInfo} BalanceComparisonInfo
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/balancesHistory.d.js').BalanceTotalType} BalanceTotalType
 * @typedef {import('types/bot/balancesHistory.d.js').BalanceTotalCoin} BalanceTotalCoin
 * @typedef {import('types/bot/balancesHistory.d.js').BalanceTotalsScope} BalanceTotalsScope
 * @typedef {import('types/bot/balancesHistory.d.js').AddBalanceTotalsResult} AddBalanceTotalsResult
 * @typedef {import('types/bot/balancesHistory.d.js').SaveSnapshotParams} SaveSnapshotParams
 * @typedef {import('types/bot/balancesHistory.d.js').SaveUserSnapshotParams} SaveUserSnapshotParams
 * @typedef {import('types/bot/balancesHistory.d.js').BalanceSnapshotQuery} BalanceSnapshotQuery
 * @typedef {import('types/bot/balancesHistory.d.js').BalancesHistoryModule} BalancesHistoryModule
 */

const constants = require('../helpers/const');
const db = /** @type {import('types/bot/db.d.js').DbModule} */ (require('../modules/DB'));
const config = require('../modules/configReader');
const utils = require('./utils');
const log = require('./log');

const readableModuleName = 'balancesHistory';

// Totals and their util functions
/** @type {BalanceTotalType[]} */
const BALANCE_TOTAL_TYPES = ['total', 'totalNonCoin1', 'totalTrading'];

/** @type {BalanceTotalCoin[]} */
const BALANCE_TOTAL_COINS = [
  { key: 'USD', target: 'USD' },
  { key: 'BTC', target: 'BTC' },
  { key: 'COIN2', target: config.coin2 },
];

// Generate full list of total keys (e.g. totalUSD, totalNonCoin1BTC, totalTradingCOIN2, ...).
const balanceTotalsFull = BALANCE_TOTAL_TYPES.flatMap((type) =>
  BALANCE_TOTAL_COINS.map(({ key }) => `${type}${key}`),
);

// Map `totalUSD` -> { type: 'total', key: 'USD' } to avoid nested loops per diff row.
const typesBySpecificity = [...BALANCE_TOTAL_TYPES].sort((a, b) => b.length - a.length);
const totalsKeyToTypeCoin = (() => {
  const map = {};
  balanceTotalsFull.forEach((fullKey) => {
    for (const type of typesBySpecificity) {
      if (!fullKey.startsWith(type)) continue;
      const key = fullKey.slice(type.length); // USD / BTC / COIN2
      map[fullKey] = { type, key };
      break;
    }
  });
  return map;
})();

const exchange = config.exchangeName;

/**
 * Returns the `balancesHistory` MongoDB collection.
 *
 * @returns {Promise<import('mongodb').Collection>}
 */
async function getCollection() {
  const collections = await db.ready;
  return collections.balancesHistory;
}

/**
 * Adds synthetic total rows to `balances` and builds a human-readable summary.
 *
 * Mutates the input array by removing old totals and appending freshly calculated ones.
 * The returned `output` string always ends with a single newline.
 *
 * @param {AssetsResult} balances Balances returned by an exchange API
 * @param {BalanceTotalsScope} [scope='allcoins'] Controls which totals appear in `output`
 *   - 'pair'     → include only Total trading (coin1+coin2)
 *   - 'priority' → include all totals
 *   - 'allcoins'      → include all totals
 * @returns {AddBalanceTotalsResult | undefined} Mutated `balances` and 'Total holdings' message
 */
function addBalanceTotals(balances, scope = 'allcoins') {
  const orderUtils = require('../trade/orderUtils');
  const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(config.defaultPair));
  const { coin1, coin2, coin2DecimalsForStable } = formattedPair;

  // Remove old totals to prevent duplicates after repeated calls.
  for (let i = balances.length - 1; i >= 0; i -= 1) {
    if (balanceTotalsFull.includes(balances[i].code)) {
      balances.splice(i, 1);
    }
  }

  /** @type {Record<string, number>} */
  const totals = Object.fromEntries(balanceTotalsFull.map((key) => [key, 0]));

  const unknownCryptos = [];

  try {
    const exchangerUtils = require('../helpers/cryptos/exchanger');

    // Calculate new totals
    balances.forEach(({ code, total }) => {
      BALANCE_TOTAL_COINS.forEach(({ key, target }) => {
        const out = exchangerUtils.convertCryptos(code, target, total)?.outAmount;
        if (!utils.isPositiveOrZeroNumber(out)) {
          // Track unknown coins once via USD conversion failures to avoid log spam.
          if (key === 'USD') unknownCryptos.push(code);
          return;
        }

        // total
        totals[`total${key}`] += out;

        // non-coin1
        if (code !== coin1) {
          totals[`totalNonCoin1${key}`] += out;
        }

        // trading (coin1 + coin2)
        if (utils.isTradingCoin(code)) {
          totals[`totalTrading${key}`] += out;
        }
      });
    });

    let output = '';

    const addUSD = !utils.isStableCoin(coin2);
    const addBTC = coin2 !== 'BTC';

    /**
     * Formats total amounts for the `Total holdings` and `Total trading` lines.
     *
     * @param {BalanceTotalType} key Total category prefix.  E.g. 'total', 'totalNonCoin1', 'totalTrading' to get totals[] key.
     * @returns {string}
     */
    const formatTotalAmounts = (key) => {
      const parts = [];
      parts.push(`${utils.formatNumber(totals[`${key}COIN2`], true, coin2DecimalsForStable)} _${coin2}_`);
      if (addUSD) {
        parts.push(`${utils.formatNumber(totals[`${key}USD`], true, 2)} _USD_`);
      }
      if (addBTC) {
        parts.push(`${utils.formatNumber(totals[`${key}BTC`], true, 8)} _BTC_`);
      }
      return parts.join(' or ');
    };

    // Total holdings ~ 62.9821 USDT or 0.00071736 BTC
    if (scope !== 'pair') {
      output += `Total holdings ~ ${formatTotalAmounts('total')}\n`;
      output += `Total holdings (non-${coin1}) ~ ${formatTotalAmounts('totalNonCoin1')}\n`;
    }

    output += `Total trading (${coin1}+${coin2}) ~ ${formatTotalAmounts('totalTrading')}\n`;

    if (unknownCryptos.length && scope !== 'pair') {
      output += `Note: I did not count unknown cryptos _${[...new Set(unknownCryptos)].join(', ')}_\n`;
    }

    balanceTotalsFull.forEach((key) => {
      balances.push({ code: key, total: totals[key] });
    });

    return { balancesWithTotals: balances, output };
  } catch (e) {
    log.error(`${readableModuleName}/addBalanceTotals: ${e}`);
  }
}

/**
 * Removes synthetic total rows from balances.
 *
 * @param {AssetsResult} balances Source balances
 * @returns {AssetsResult}
 */
function removeTotals(balances) {
  if (!Array.isArray(balances)) return [];

  return balances.filter((coin) => !balanceTotalsFull.includes(coin.code));
}

/**
 * Removes zero-balance coins while keeping trading and priority coins.
 *
 * @param {AssetsResult} balances Source balances
 * @returns {AssetsResult}
 */
function removeEmpty(balances) {
  if (!Array.isArray(balances)) return [];

  return balances.filter((coin) => utils.isTradingCoin(coin.code) || constants.COINS_BY_PRIORITY.includes(coin.code) || coin.total);
}

/**
 * Keeps only configured trading coins (coin1 and coin2).
 *
 * @param {AssetsResult} balances Source balances
 * @returns {AssetsResult}
 */
function filterTradingCoins(balances) {
  if (!Array.isArray(balances)) return [];

  return balances.filter((coin) => utils.isTradingCoin(coin.code));
}

/**
 * Builds a lightweight hash of balances for change detection.
 *
 * Uses only `code` and `total`, skips synthetic totals, and ignores empty coins.
 *
 * @param {AssetsResult} balances Source balances
 * @returns {string} E.g. `ALGO:0.03011300|BNB:0.00950000|USDC:0.04604444`
 */
function buildBalancesHash(balances) {
  if (!Array.isArray(balances)) return '';

  return removeEmpty(removeTotals(balances))
      .map((coin) => `${coin.code}:${Number(coin.total || 0).toFixed(constants.PRECISION_DECIMALS)}`)
      .sort()
      .join('|');
}

/**
 * Saves a snapshot when balances changed compared to the previous one
 * for the same account, wallet type, and user id.
 *
 * @param {SaveSnapshotParams} params Snapshot parameters
 * @returns {Promise<void>}
 */
async function saveSnapshotIfChanged(params) {
  try {
    const {
      accountNo,
      walletType,
      userId,
      balances,
      source = 'getBalancesCached',
      callerName,
      timestamp = Date.now(),
    } = params;

    const collection = await getCollection();

    const hash = buildBalancesHash(balances);
    const tradingBalances = filterTradingCoins(balances);
    const tradingHash = buildBalancesHash(tradingBalances);

    const query = {
      exchange,
      accountNo,
      walletType: walletType || null,
      userId: userId || null,
    };

    const last = await collection.findOne(
        query,
        { sort: { timestamp: -1 }, projection: { hash: 1 } },
    );

    if (last && last.hash === hash) {
      // No changes -> skip saving
      log.debug(`${readableModuleName}/${callerName}: Skipped snapshot on ${config.accountFull}/${walletType || 'defaultWallet'} — balances unchanged (${tradingHash || 'empty trading hash'}).`);
      return;
    }

    await collection.insertOne({
      ...query,
      timestamp,
      balances,
      hash,
      tradingHash,
      source,
      callerName,
      exchange,
    });

    log.log(`${readableModuleName}/${callerName}: Saved a new balances snapshot on ${config.accountFull}/${walletType || 'defaultWallet'} via '${source}' — ${tradingHash || 'empty trading hash'} at ${timestamp}.`);
  } catch (e) {
    log.error(`${readableModuleName}/saveSnapshotIfChanged: ${e}`);
  }
}

/**
 * Saves a user-triggered snapshot used to restore differences after bot restart.
 *
 * @param {SaveUserSnapshotParams} params Snapshot parameters
 * @returns {Promise<void>}
 */
async function saveUserSnapshot(params) {
  const {
    userId,
    accountNo,
    accountType,
    balances,
    callerName,
    timestamp = Date.now(),
  } = params;

  try {
    const collection = await getCollection();

    const hash = buildBalancesHash(balances);
    const tradingBalances = filterTradingCoins(balances);
    const tradingHash = buildBalancesHash(tradingBalances);

    await collection.insertOne({
      userId,
      accountNo,
      accountType: accountType || null,
      walletType: null, // user snapshots are tied to logical accountType
      timestamp,
      balances,
      hash,
      tradingHash,
      source: 'userRequest',
      callerName,
      exchange,
    });

    log.log(`${readableModuleName}/${callerName}: Saved a new balances snapshot on ${config.accountFull}/${accountType || 'defaultAccount'} via 'userRequest' — ${tradingHash || 'empty trading hash'} at ${timestamp}.`);
  } catch (e) {
    log.error(`${readableModuleName}/saveUserSnapshot: ${e}`);
  }
}

/**
 * Returns the latest saved user snapshot.
 *
 * @param {string} userId User id
 * @param {number} accountNo Bot account number
 * @param {string} [accountType] Logical account type
 * @returns {Promise<BalancesAndTimestamp | undefined>}
 */
async function getLastUserSnapshot(userId, accountNo, accountType) {
  try {
    const collection = await getCollection();

    const doc = await collection.findOne(
        {
          exchange,
          userId,
          accountNo,
          accountType: accountType || null,
        },
        { sort: { timestamp: -1 } },
    );

    if (!doc) return undefined;

    return {
      timestamp: doc.timestamp,
      balances: doc.balances || [],
    };
  } catch (e) {
    log.error(`${readableModuleName}/getLastUserSnapshot: ${e}`);
    return undefined;
  }
}

/**
 * Returns the latest snapshot with `timestamp <= params.timestamp`.
 *
 * @param {BalanceSnapshotQuery & { timestamp: number }} params Lookup parameters
 * @returns {Promise<BalancesAndTimestamp | undefined>}
 */
async function getSnapshotByTimestamp(params) {
  const {
    userId,
    accountNo,
    accountType,
    walletType,
    timestamp,
  } = params;

  try {
    const collection = await getCollection();

    const query = {
      exchange,
      accountNo,
      timestamp: { $lte: timestamp },
    };

    // Filter by userId only if provided explicitly
    if (typeof userId !== 'undefined') {
      query.userId = userId;
    }

    // Filter by accountType only if provided explicitly
    if (typeof accountType !== 'undefined') {
      query.accountType = accountType || null;
    }

    // Filter by walletType only if provided explicitly
    if (typeof walletType !== 'undefined') {
      query.walletType = walletType || null;
    }

    const doc = await collection.findOne(
        query,
        { sort: { timestamp: -1 } },
    );

    if (!doc) return undefined;

    return {
      timestamp: doc.timestamp,
      balances: doc.balances || [],
    };
  } catch (e) {
    log.error(`${readableModuleName}/getSnapshotByTimestamp: ${e}`);
    return undefined;
  }
}

/**
 * Compares the latest snapshot with the snapshot at or before a given timestamp.
 *
 * Focuses on absolute and relative changes for `config.coin1`, `config.coin2`, and synthetic totals.
 * Uses total balances rather than available balances.
 *
 * @param {BalanceSnapshotQuery & { timestamp: number }} params Comparison parameters
 * @returns {Promise<BalanceComparisonInfo | undefined>}
 */
async function compareLastWithTimestamp(params) {
  try {
    const { userId, accountNo, accountType, walletType, timestamp } = params;

    const collection = await getCollection();

    const lastQuery = {
      exchange,
      accountNo,
    };

    // Same semantics as in getSnapshotByTimestamp:
    // undefined -> no filter; null or '' -> match null
    if (typeof userId !== 'undefined') lastQuery.userId = userId;
    if (typeof accountType !== 'undefined') lastQuery.accountType = accountType || null;
    if (typeof walletType !== 'undefined') lastQuery.walletType = walletType || null;

    // Last snapshot ("to")
    const lastDoc = await collection.findOne(lastQuery, { sort: { timestamp: -1 } });

    const from = await getSnapshotByTimestamp({
      userId,
      accountNo,
      accountType,
      walletType,
      timestamp,
    });

    if (!lastDoc || !from) return {};

    /** @type {BalancesAndTimestamp} */
    const to = {
      timestamp: lastDoc.timestamp,
      balances: lastDoc.balances || [],
    };

    /** @type {BalanceComparisonInfo} */
    const result = { from, to };

    /**
     * Reads a coin total from balances.
     *
     * @param {AssetsResult} balances
     * @param {string} code
     * @returns {number}
     */
    const findTotal = (balances, code) => balances.find((c) => c.code === code)?.total || 0;

    /**
     * Builds comparison data for one balance code.
     *
     * @param {string} code
     * @param {number} fromValue
     * @param {number} toValue
     * @returns {CoinComparisonData}
     */
    const buildComparison = (code, fromValue, toValue) => {
      const deltaAbs = toValue - fromValue;
      const deltaPercent = utils.numbersDifferencePercent(fromValue, toValue);
      const deltaPercentSigned = deltaPercent * Math.sign(deltaAbs);
      const deltaPercentDirect = utils.numbersDifferencePercentDirect(fromValue, toValue);

      return {
        code,
        from: fromValue,
        to: toValue,
        deltaAbs,
        deltaPercent,
        deltaPercentSigned,
        deltaPercentDirect,
      };
    };

    // Compare data for coin1 and coin2

    const { coin1, coin2 } = config;

    result.coin1 = buildComparison(coin1, findTotal(from.balances, coin1), findTotal(to.balances, coin1));
    result.coin2 = buildComparison(coin2, findTotal(from.balances, coin2), findTotal(to.balances, coin2));
    // Totals diffs (totalUSD, totalNonCoin1BTC, totalTradingCOIN2, etc.)

    /** @type {Object.<string, CoinComparisonData>} */
    const totals = {};

    for (const fullKey of balanceTotalsFull) {
      totals[fullKey] = buildComparison(fullKey, findTotal(from.balances, fullKey), findTotal(to.balances, fullKey));
    }

    result.totals = totals;

    // Expected trading value in coin2 at the current coin1 price plus coin2 balance at the start point.
    // This is the primary metric that shows how the reference balance has increased or decreased, normalized by the token price

    const exchangerUtils = require('../helpers/cryptos/exchanger');
    const coin1From = findTotal(from.balances, coin1);
    const coin2From = findTotal(from.balances, coin2);
    const coin1FromValueCOIN2AtCurrentPrice = exchangerUtils.convertCryptos(coin1, coin2, coin1From)?.outAmount;
    const expectedTradingValueCOIN2 = coin1FromValueCOIN2AtCurrentPrice + coin2From;
    const currentTradingValueCOIN2 = findTotal(to.balances, 'totalTradingCOIN2');

    result.expectedTradingValueCOIN2 = buildComparison('expectedTradingValueCOIN2', expectedTradingValueCOIN2, currentTradingValueCOIN2);

    return result;
  } catch (e) {
    log.error(`${readableModuleName}/compareLastWithTimestamp: ${e}`);
    return undefined;
  }
}

/** @type {BalancesHistoryModule} */
module.exports = {
  BALANCE_TOTAL_COINS,
  BALANCE_TOTAL_TYPES,
  balanceTotalsFull,
  totalsKeyToTypeCoin,
  addBalanceTotals,
  removeTotals,
  filterTradingCoins,
  buildBalancesHash,
  saveSnapshotIfChanged,
  saveUserSnapshot,
  getLastUserSnapshot,
  getSnapshotByTimestamp,
  compareLastWithTimestamp,
};
