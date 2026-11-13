// @ts-check
'use strict';

/**
 * Qutrade v2 spot REST adapter
 *
 * Live exchange behavior:
 * - A same-account limit sell that would fully fill a resting buy returned HTTP 500 on CHESS/USDT and DOGE/USDT,
 *   even with a 3 s pause between legs. Partial fills of a resting buy and full fills of a resting sell worked.
 *   In the bot's in-spread t flow, an unresolved taker submission has no ID. The bot saves the maker and asks the
 *   collector to cancel it. The live failures left the maker cancelled without fills and no open orders.
 *   A 5xx still leaves submission uncertain in general. If the exchange accepted an unidentifiable taker that
 *   remains open, it can appear as an unknown order. The submission journal retains the label for reconciliation.
 *
 * - A create response can omit the label and say 'filled' with zero execution. Keep a matching acknowledged ID
 *   and verify the actual lifecycle through order reads. Creation timestamps from the acknowledgement also
 *   differed from the open/history timestamps by three hours in live samples.
 *
 * - There is no read-by-order-ID endpoint. Check current open orders first on a cache miss, then load history
 *   on demand. History accepts time bounds. Reuse the creation timestamp from the open list to narrow the query.
 *   Keep terminal orders and scan progress in memory across instances using the same credentials.
 *   For an unseen ID, reuse complete history coverage and check fresh open and pending orders before returning
 *   'unknown'. A late terminal row under an older creation timestamp can be missed if the bot never saw the ID.
 *   Keep acknowledged and previously open IDs unverified when they disappear from the current snapshots.
 *   Invalidate terminal entries on contrary open-order evidence.
 *
 * - Cancellation can return two concatenated JSON documents and repeat 'canceled' for an already closed order.
 *   The REST client validates both documents and the adapter checks order state to distinguish repeated cancels.
 *
 * - Some markets publish a zero quote step. Keep base-sized trading available and reject quote-sized market orders
 *   when the quote step is unavailable. Deposit addresses can be read after generation on the exchange website.
 *
 * @typedef {import('../../types/qutrade/api.d.js').QutradeLogger} QutradeLogger
 * @typedef {import('../../types/qutrade/api.d.js').QutradeOrder} QutradeOrder
 * @typedef {import('../../types/qutrade/api.d.js').QutradeMarket} QutradeMarket
 * @typedef {import('../../types/qutrade/api.d.js').QutradeSide} QutradeSide
 * @typedef {import('../../types/markets.d.js').ResultItem} Market
 * @typedef {import('../../types/currencies.d.js').CurrenciesResult} Currencies
 * @typedef {import('../../types/currencies.d.js').ResultItem} Currency
 * @typedef {import('../../types/currencies.d.js').CurrenciesNetworkItem} CurrencyNetwork
 * @typedef {import('../../types/assets.d.js').Result} Balances
 * @typedef {import('../../types/address.d.js').Result} Addresses
 * @typedef {import('../../types/orders.d.js').ResultItem} OpenOrder
 * @typedef {import('../../types/order-info.d.js').Result} OrderDetails
 * @typedef {import('../../types/order-info.d.js').OrderStatus} OrderStatus
 * @typedef {import('../../types/order-place.d.js').Result} OrderPlacement
 * @typedef {import('../../types/depth.d.js').DepthResult} Depth
 * @typedef {import('../../types/rates.d.js').RatesResult} Rates
 * @typedef {import('../../types/trades.d.js').TradesResult} Trades
 * @typedef {import('../../types/candles.d.js').CandlesResult} Candles
 * @typedef {import('../../helpers/orderSubmissionJournal').SubmissionEvent} SubmissionEvent
 * @typedef {{coin1:string, coin2:string, pairPlain:string, pairReadable:string}} QutradePair
 * @typedef {Market & {minPriceBuy:number, maxPriceBuy:number, minPriceSell:number, maxPriceSell:number}} QutradeMarketInfo
 * @typedef {Record<string,QutradeMarketInfo>} QutradeMarkets
 * @typedef {Object} QutradeOrderState
 * @property {Map<string,number|undefined>} knownOrders Verified creation times; undefined means ACK only
 * @property {Map<string,OrderDetails>} terminalOrders Verified terminal states retained for the process lifetime
 * @property {Map<string,Promise<QutradeOrder[]>>} pendingHistoryReads In-flight pages by pair and time window
 * @property {Map<string,Array<{oldest:number,newest:number}>>} historyCoverage Validated cold-scan ranges by pair
 * @property {Map<string,Promise<boolean|undefined>>} pendingCancellations In-flight cancellations by pair and ID
 */
/** @template T @typedef {import('../../types/qutrade/api.d.js').QutradeResponse<T>} QutradeResponse */

const crypto = require('node:crypto');
const QutradeAPI = require('../api/qutrade_api');
const utils = require('../../helpers/utils');
const networks = require('../../helpers/networks');
const config = require('../../modules/configReader');
const { appendSubmissionEvent } = require('../../helpers/orderSubmissionJournal');

const API_SERVER = 'https://qutrade.io/api/v2';
const HISTORY_PAGE_SIZE = 1000;
const MAX_HISTORY_PAGES = 50;
const PLACEMENT_MARKET_TTL_MS = 5000;
const SUBMISSION_JOURNAL_ROTATION = { maxBytes: 4 * 1024 * 1024, archives: 4 };
// CHESS/USDT placement and cancellation reads agreed with no extra sleep.
// The REST client still enforces endpoint pacing.
const API_PROCESSING_DELAY_MS = 0;
/** @type {Record<string,OrderStatus>} */
const ORDER_STATUSES = {
  opened: 'new',
  filling: 'part_filled',
  filled: 'filled',
  canceled: 'cancelled',
};
const TIMEFRAMES = {
  '15m': '15',
  '1h': '1H',
  '1d': '1D',
  '1w': '1W',
  '1M': '1M',
};
const INTERVALS = {
  '15m': 900000,
  '1h': 3600000,
  '1d': 86400000,
  '1w': 604800000,
};

/** @type {Map<string,QutradeOrderState>} */
const accountOrderStates = new Map();

/**
 * Share private order evidence across the bot's clients for one credential
 * @param {string} [accountReference] Credential fingerprint; omit for public-only clients
 * @returns {QutradeOrderState} Private order caches and in-flight requests
 */
function getOrderState(accountReference) {
  const existing = accountReference && accountOrderStates.get(accountReference);
  if (existing) return existing;

  /** @type {QutradeOrderState} */
  const state = {
    knownOrders: new Map(),
    terminalOrders: new Map(),
    pendingHistoryReads: new Map(),
    historyCoverage: new Map(),
    pendingCancellations: new Map(),
  };

  if (accountReference) accountOrderStates.set(accountReference, state);
  return state;
}

/**
 * Create an isolated credential client with shared public metadata
 * @param {string} apiKey Hex Ed25519 public key
 * @param {string} secretKey Hex seed or NaCl secret
 * @param {string} pwd Unused compatibility password
 * @param {QutradeLogger} log Bot logger
 * @param {boolean} [publicOnly=false] Disable authenticated requests
 * @param {boolean} [loadMarket=true] Preload metadata
 * @param {boolean} [useSocket=false] Unused; REST only
 * @param {boolean} [useSocketPull=false] Unused; REST only
 * @param {number} [accountNo=0] Credential slot, not an exchange wallet selector
 * @param {string} [coin1] Default base asset
 * @param {string} [coin2] Default quote asset
 * @returns Bot-compatible Qutrade methods
 */
module.exports = (
    apiKey,
    secretKey,
    pwd,
    log,
    publicOnly = false,
    loadMarket = true,
    useSocket = false,
    useSocketPull = false,
    accountNo = 0,
    coin1 = config.coin1,
    coin2 = config.coin2,
) => {
  const api = QutradeAPI();
  api.setConfig(API_SERVER, apiKey, secretKey, pwd, log, publicOnly);
  const accountReference = crypto
      .createHash('sha256')
      .update(apiKey || '')
      .digest('hex')
      .slice(0, 16);
  const { knownOrders, terminalOrders, pendingHistoryReads, historyCoverage, pendingCancellations } =
    getOrderState(publicOnly || !apiKey ? undefined : accountReference);
  /** @type {Map<string,{market:QutradeMarketInfo,row:QutradeMarket,expiresAt:number}>} */
  const placementMarkets = new Map();

  /**
   * Separate transport failure from malformed data; neither becomes an empty result
   * @template T,R
   * @param {string} method Operation and non-secret parameters
   * @param {() => Promise<QutradeResponse<T>>} request Single request
   * @param {(data:T) => R} normalize Strict conversion
   * @returns {Promise<R|undefined>} Trustworthy normalized result
   */
  async function read(method, request, normalize) {
    let response;
    try {
      response = await request();
    } catch (error) {
      log.warn(`API request ${method} of trader_qutrade module failed: ${error}`);
      return undefined;
    }

    try {
      if (response?.result !== 'success') throw new Error(response?.details || response?.message || 'Invalid envelope');
      return normalize(response.payload);
    } catch (error) {
      log.warn(`Error while processing ${method} of trader_qutrade module: ${error}`);
      return undefined;
    }
  }

  /**
   * Load shared market rules; ticker consumers always fetch fresh data separately
   * @param {string} [pair] Readable/native pair, omit for all markets
   * @param {boolean} [forceUpdate=false] Refresh rules
   * @returns {Promise<QutradeMarkets|QutradeMarketInfo|undefined>} Rules keyed by native symbol
   */
  async function getMarkets(pair, forceUpdate = false) {
    const names = pair === undefined ? undefined : formatPairName(pair);
    if (pair !== undefined && !names) return undefined;

    if (!module.exports.exchangeMarkets || forceUpdate) {
      if (!module.exports.marketsPromise) {
        module.exports.marketsPromise = read(
            'getMarkets()',
            () => api.markets(),
            (data) => {
              assertRecord(data, 'market map');
              /** @type {QutradeMarkets} */
              const result = {};
              for (const [symbol, item] of Object.entries(data)) {
                result[symbol] = normalizeMarket(symbol, item);
              }
              if (!Object.keys(result).length) throw new Error('Empty market map');
              module.exports.exchangeMarkets = result;
              log.log(`Qutrade getMarkets(): loaded ${Object.keys(result).length} markets`);
              return result;
            },
        ).finally(() => {
          module.exports.marketsPromise = undefined;
        });
      }
      if (!(await module.exports.marketsPromise)) return undefined;
    }
    const markets = /** @type {QutradeMarkets} */ (module.exports.exchangeMarkets);
    return names ? markets?.[names.pairPlain] : markets;
  }

  /** @param {string} pair Readable/native pair @returns {QutradeMarketInfo|undefined} Cached rules */
  function marketInfo(pair) {
    const names = formatPairName(pair);
    const markets = /** @type {QutradeMarkets} */ (module.exports.exchangeMarkets);
    return names ? markets?.[names.pairPlain] : undefined;
  }

  /**
   * Fetch currency and network metadata without inventing wallet precision
   * @param {string} [coin] Asset symbol, omit for all currencies
   * @param {boolean} [forceUpdate=false] Refresh metadata
   * @returns {Promise<Currencies|Currency|undefined>} Normalized currencies
   */
  async function getCurrencies(coin, forceUpdate = false) {
    if (coin !== undefined && (typeof coin !== 'string' || !/^[A-Z0-9]+$/i.test(coin))) return undefined;
    if (!module.exports.exchangeCurrencies || forceUpdate) {
      if (!module.exports.currenciesPromise) {
        module.exports.currenciesPromise = read(
            'getCurrencies()',
            () => api.currencies(),
            (data) => {
              assertRecord(data, 'currency map');
              /** @type {Currencies} */
              const result = {};
              for (const [symbol, item] of Object.entries(data)) {
                if (
                  !item ||
                !Array.isArray(item.chains) ||
                typeof item.name !== 'string' ||
                typeof item.deposits_can !== 'boolean' ||
                typeof item.withdrawals_can !== 'boolean'
                ) {
                  throw new Error(`Invalid currency ${symbol}`);
                }
                /** @type {Record<string,CurrencyNetwork>} */
                const chains = {};
                for (const chain of item.chains) {
                  const network = formatNetworkName(chain.chain);
                  if (
                    !network ||
                  chains[network] ||
                  typeof chain.deposit_can !== 'boolean' ||
                  typeof chain.withdraw_can !== 'boolean'
                  ) {
                    throw new Error(`Invalid or duplicate network for ${symbol}`);
                  }
                  chains[network] = {
                    chainName: chain.chain,
                    chainNamePlain: chain.chain,
                    chainNameFormatted: network,
                    depositStatus: chain.deposit_can ? 'ONLINE' : 'OFFLINE',
                    withdrawalStatus: chain.withdraw_can ? 'ONLINE' : 'OFFLINE',
                    status: chain.deposit_can || chain.withdraw_can ? 'ONLINE' : 'OFFLINE',
                    minDeposit: wireNumber(chain.deposit_min, 'deposit_min'),
                    minWithdrawal: wireNumber(chain.withdraw_min, 'withdraw_min'),
                    withdrawalFee: wireNumber(chain.withdraw_fee, 'withdraw_fee'),
                    confirmations: wireNumber(chain.deposit_confirmations, 'deposit_confirmations'),
                  };
                }
                result[symbol] = {
                  symbol,
                  name: item.name,
                  id: symbol,
                  status: item.status === 'active' ? 'ONLINE' : 'OFFLINE',
                  depositEnabled: item.deposits_can,
                  withdrawEnabled: item.withdrawals_can,
                  depositStatus: item.deposits_can ? 'ONLINE' : 'OFFLINE',
                  withdrawalStatus: item.withdrawals_can ? 'ONLINE' : 'OFFLINE',
                  comment: undefined,
                  confirmations: undefined,
                  minWithdraw: undefined,
                  maxWithdraw: undefined,
                  withdrawalFee: undefined,
                  logoUrl: undefined,
                  exchangeAddress: undefined,
                  decimals: undefined,
                  precision: undefined,
                  networks: chains,
                  defaultNetwork: undefined,
                };
              }
              if (!Object.keys(result).length) throw new Error('Empty currency map');
              module.exports.exchangeCurrencies = result;
              log.log(`Qutrade getCurrencies(): loaded ${Object.keys(result).length} currencies`);
              return result;
            },
        ).finally(() => {
          module.exports.currenciesPromise = undefined;
        });
      }
      if (!(await module.exports.currenciesPromise)) return undefined;
    }
    const currencies = /** @type {Currencies} */ (module.exports.exchangeCurrencies);
    return coin ? currencies?.[coin.toUpperCase()] : currencies;
  }

  /** @param {string} coin Asset symbol @returns Cached currency */
  function currencyInfo(coin) {
    const currencies = /** @type {Currencies} */ (module.exports.exchangeCurrencies);
    return typeof coin === 'string' ? currencies?.[coin.toUpperCase()] : undefined;
  }

  /**
   * Read a complete, unpaginated list and reject malformed or duplicated rows atomically
   * @param {string} pair Readable pair
   * @returns {Promise<OpenOrder[]|undefined>} Active orders or verified empty list
   */
  async function getOpenOrders(pair) {
    const names = formatPairName(pair);
    if (!names) return undefined;
    return read(
        `getOpenOrders(${pair})`,
        () => api.openOrders(names.pairPlain),
        (data) => {
          const details = recordOpenOrders(data, names.pairPlain);
          return details.map((order, index) => {
            const row = data[index];
            return {
              orderId: order.orderId,
              symbol: names.pairReadable,
              symbolPlain: names.pairPlain,
              price: order.price,
              side: order.side,
              type: order.type,
              timestamp: order.timestamp,
              amount: order.amount,
              amountExecuted: order.amountExecuted,
              amountLeft: wireNumber(row.unfilled_base_amount, 'unfilled_base_amount'),
              status: order.status,
            };
          });
        },
    );
  }

  /**
   * Record timestamps from every verified open order for later one-second history queries
   * @param {QutradeOrder[]} rows Wire snapshot
   * @param {string} pair Native pair
   * @returns {OrderDetails[]} Normalized open orders
   */
  function recordOpenOrders(rows, pair) {
    const orders = normalizeOrderList(rows, pair, true);
    for (const order of orders) {
      const key = `${pair}:${order.orderId}`;
      knownOrders.set(key, order.timestamp / 1000);
      if (terminalOrders.delete(key)) {
        log.warn(`Qutrade getOpenOrders(${pair}): order ${order.orderId} reappeared as active`);
      }
    }

    return orders;
  }

  /**
   * Share a single in-flight page and retain only validated terminal order details
   * @param {string} pair Native pair
   * @param {number} [since=1] Inclusive lower creation time in seconds
   * @param {number} [until=9999999999] Inclusive upper creation time in seconds
   * @returns {Promise<QutradeOrder[]>} Validated newest-first history page
   */
  async function readHistoryPage(pair, since = 1, until = 9999999999) {
    const window = `${pair}:${since}:${until}`;
    if (!pendingHistoryReads.has(window)) {
      const request = api.orderHistory(pair, since, until, HISTORY_PAGE_SIZE).then((response) => {
        if (response?.result !== 'success') throw new Error(response?.details || 'History request failed');
        const rows = response.payload;
        const details = normalizeOrderList(rows, pair);

        if (rows.length > HISTORY_PAGE_SIZE) throw new Error('Oversized history page');
        let previous = until;
        for (const row of rows) {
          if (row.timestamp_create > previous || row.timestamp_create < since) {
            throw new Error('History response violates requested bounds or newest-first ordering');
          }
          previous = row.timestamp_create;
        }

        for (const order of details) {
          const key = `${pair}:${order.orderId}`;
          if (order.status === 'filled' || order.status === 'cancelled') {
            terminalOrders.set(key, order);
          } else {
            knownOrders.set(key, order.timestamp / 1000);
          }
        }

        return rows;
      }).finally(() => {
        pendingHistoryReads.delete(window);
      });

      pendingHistoryReads.set(window, request);
    }

    return pendingHistoryReads.get(window);
  }

  /**
   * Preserve disjoint scan ranges so a gap above old coverage can be filled across lookups
   * @param {string} pair Native pair
   * @param {number} oldest Inclusive continuation boundary, or zero after exhausting history
   * @param {number} newest Highest covered creation second
   * @returns {void}
   */
  function recordHistoryCoverage(pair, oldest, newest) {
    const ranges = historyCoverage.get(pair) || [];
    const remaining = [];

    for (const range of ranges) {
      if (range.newest < oldest || range.oldest > newest) {
        remaining.push(range);
      } else {
        oldest = Math.min(oldest, range.oldest);
        newest = Math.max(newest, range.newest);
      }
    }

    remaining.push({ oldest, newest });
    historyCoverage.set(pair, remaining.sort((a, b) => b.newest - a.newest));
  }

  /**
   * Search newest first, refreshing the head before skipping covered ranges
   * Exhaust the requested range using fresh pages and previously validated coverage.
   * @param {string} pair Native pair
   * @param {string} id Exact exchange order ID
   * @param {number} [since=1] Inclusive lower creation time in seconds
   * @param {number} [until=9999999999] Inclusive upper creation time in seconds
   * @param {boolean} [reuseCoverage=false] Reuse scan progress when the creation time is unavailable
   * @returns {Promise<OrderDetails|undefined>} Order or no match after covering the range; throws on incomplete reads
   */
  async function findHistoricalOrder(pair, id, since = 1, until = 9999999999, reuseCoverage = false) {
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const rows = await readHistoryPage(pair, since, until);
      const match = rows.find((row) => String(row.order_id) === id);
      const exhausted = rows.length < HISTORY_PAGE_SIZE;
      const oldest = exhausted ? 0 : rows.at(-1).timestamp_create;

      const covered = reuseCoverage && !exhausted ?
        historyCoverage.get(pair)?.find((range) => range.oldest < oldest && range.newest >= oldest) :
        undefined;

      if (reuseCoverage && (exhausted || oldest < until)) {
        const newest = page === 0 ? rows[0]?.timestamp_create ?? 0 : until;
        recordHistoryCoverage(pair, oldest, newest);
      }

      if (match) return normalizeOrder(match, pair);
      if (exhausted) return undefined;

      if (covered) {
        const cached = terminalOrders.get(`${pair}:${id}`);
        if (cached) return { ...cached };
        if (covered.oldest === 0) return undefined;

        until = covered.oldest;
        continue;
      }

      if (oldest >= until) throw new Error('History exceeds single-second pagination capacity');
      until = oldest;
    }

    throw new Error(`History search reached its limit of ${MAX_HISTORY_PAGES} pages`);
  }

  /**
   * Find an order without confusing recent-history truncation or failures with absence
   * @param {string|number} orderId Exact integer identifier
   * @param {string} pair Readable/native pair
   * @returns {Promise<OrderDetails|undefined>} All five normalized statuses; failures are undefined
   */
  async function getOrderDetails(orderId, pair) {
    const id = validOrderId(orderId);
    const names = formatPairName(pair);
    if (!id || !names) {
      log.warn(`Qutrade getOrderDetails(${orderId}, ${pair}): invalid order ID or pair`);
      return undefined;
    }

    const key = `${names.pairPlain}:${id}`;
    const cached = terminalOrders.get(key);
    if (cached) return { ...cached };

    try {
      const open = await api.openOrders(names.pairPlain);
      if (open?.result !== 'success') throw new Error('Open-orders request failed');
      const active = recordOpenOrders(open.payload, names.pairPlain).find((row) => row.orderId === id);
      if (active) return active;

      // Open list and history share the same exchange clock in live samples.
      // The create-order acknowledgement uses a different clock, so it is not a lookup bound.
      const knownTime = knownOrders.get(key);
      let historical;
      if (knownTime) {
        historical = await findHistoricalOrder(names.pairPlain, id, knownTime, knownTime);
        if (!historical) {
          const row = (await readHistoryPage(names.pairPlain)).find((item) => String(item.order_id) === id);
          if (row) historical = normalizeOrder(row, names.pairPlain);
        }
      } else {
        historical = await findHistoricalOrder(names.pairPlain, id, 1, 9999999999, true);
      }

      if (historical) return historical;

      // Previously observed orders can be missing during propagation. Never cache or report their absence.
      if (knownOrders.has(key)) {
        log.warn(`Qutrade getOrderDetails(${id}, ${pair}): known order missing from the current snapshots`);
        return undefined;
      }

      const pending = await api.pendingOrders(names.pairPlain);
      if (pending?.result !== 'success' || !Array.isArray(pending.payload)) {
        throw new Error('Invalid pending-order snapshot');
      }
      const ids = new Set();
      for (const row of pending.payload) {
        const pendingId = validOrderId(row?.order_id);
        if (!pendingId || row.pair !== names.pairPlain || ids.has(pendingId)) throw new Error('Invalid pending order');
        ids.add(pendingId);
      }
      if (ids.has(id)) return undefined;

      // Another connector instance may have observed this ID while the pending read was in flight.
      const terminal = terminalOrders.get(key);
      if (terminal) return { ...terminal };
      if (knownOrders.has(key)) return undefined;

      return { orderId: id, status: 'unknown' };
    } catch (error) {
      log.warn(`Error in getOrderDetails(${id}, ${pair}) of trader_qutrade module: ${error}`);
      return undefined;
    }
  }

  /**
   * Cancel by ID with explicit already-canceled semantics; failures never close local orders
   * @param {string|number} orderId Exchange ID
   * @param {QutradeSide} side Expected direction; optional at runtime
   * @param {string} pair Scope used to verify the response
   * @returns {Promise<boolean|undefined>} true just cancelled; false proven terminal; undefined unverified
   */
  async function cancelOrder(orderId, side, pair) {
    const id = validOrderId(orderId);
    const names = formatPairName(pair);
    if (!id || !names || (side !== undefined && !['buy', 'sell'].includes(side))) {
      log.warn(`Qutrade cancelOrder(${orderId}, ${side}, ${pair}): invalid order ID, pair or side`);
      return undefined;
    }
    const key = `${names.pairPlain}:${id}`;
    const pending = pendingCancellations.get(key);
    if (pending) {
      const outcome = await pending;
      return outcome === undefined ? undefined : false;
    }

    const task = cancelVerifiedOrder(id, side, names).finally(() => {
      pendingCancellations.delete(key);
    });
    pendingCancellations.set(key, task);
    return task;
  }

  /**
   * Verify and cancel an order inside its per-ID cancellation queue
   * @param {string} id Validated exchange order ID
   * @param {QutradeSide} side Expected side, if supplied
   * @param {QutradePair} names Requested market
   * @returns {Promise<boolean|undefined>} Confirmed cancellation outcome
   */
  async function cancelVerifiedOrder(id, side, names) {
    const pair = names.pairReadable;
    // Live Qutrade repeats 'canceled' instead of the documented 'already_canceled'.
    // Verify the pre-state so a repeated request does not masquerade as a new cancellation.
    const before = await getOrderDetails(id, pair);
    if (!before || (side && before.side && before.side !== side)) {
      log.warn(`Qutrade cancelOrder(${id}, ${side}, ${pair}): pre-cancellation state or side could not be verified`);
      return undefined;
    }

    if (['filled', 'cancelled', 'unknown'].includes(before.status)) {
      log.log(`Qutrade cancelOrder(${id}, ${side}, ${pair}): nothing to cancel (state ${before.status})`);
      return false;
    }

    let response;
    try {
      response = await api.cancelOrders([id]);
    } catch (error) {
      log.warn(`API request cancelOrder(${id}, ${side}, ${pair}) of trader_qutrade module failed: ${error}`);
      return undefined;
    }

    try {
      // Exact live-verified v2 absence response. Generic HTTP 400 and auth errors do not prove absence.
      if (
        response?.result === 'error' &&
        response.code === 400 &&
        response.details === `Order with order_id ${id} does not exist.`
      ) {
        return false;
      }
      if (response?.result !== 'success') throw new Error(response?.details || 'Invalid cancellation envelope');
      const data = response.payload;
      if (!Array.isArray(data) || data.length !== 1) throw new Error('Cancellation must identify exactly one order');
      const row = data[0];
      if (validOrderId(row?.order_id) !== id || row.pair !== names.pairPlain || (side && row.side !== side)) {
        throw new Error('Cancellation identity mismatch');
      }
      const details = normalizeOrder(
          { ...row, status: row.status === 'already_canceled' ? 'canceled' : row.status },
          names.pairPlain,
      );
      if (details.status === 'cancelled' || details.status === 'filled') {
        terminalOrders.set(`${names.pairPlain}:${id}`, details);
        log.log(`Qutrade cancelOrder(${id}, ${side}, ${pair}): ${row.status}`);
        return row.status === 'canceled';
      }
      throw new Error('Cancellation did not confirm a terminal state');
    } catch (error) {
      log.warn(`Error while processing cancelOrder(${id}, ${side}, ${pair}) of trader_qutrade module: ${error}`);
      return undefined;
    }
  }

  /**
   * Use the native bulk endpoint with mandatory pair scope and verify its resulting open list
   * @param {string} pair Readable pair
   * @param {QutradeSide} [side] Optional side filter
   * @returns {Promise<boolean|undefined>} true only after all scoped open orders are gone
   */
  async function cancelAllOrders(pair, side) {
    const names = formatPairName(pair);
    if (!names || (side !== undefined && !['buy', 'sell'].includes(side))) {
      log.warn(`Qutrade cancelAllOrders(${pair}, ${side}): invalid pair or side`);
      return undefined;
    }
    const cancelled = await read(
        `cancelAllOrders(${pair}, ${side})`,
        () => api.cancelAllOrders(names.pairPlain, side),
        (data) => {
          const details = normalizeOrderList(data, names.pairPlain);
          if (details.some((row) => row.status !== 'cancelled' || (side && row.side !== side))) {
            throw new Error('Bulk cancellation returned unexpected state or side');
          }
          return details;
        },
    );
    if (!cancelled) return undefined;

    const remaining = await getOpenOrders(pair);
    if (!remaining || remaining.some((row) => !side || row.side === side)) {
      log.warn(`Qutrade cancelAllOrders(${pair}, ${side}): unable to verify that scoped orders are gone`);
      return undefined;
    }

    for (const details of cancelled) {
      terminalOrders.set(`${names.pairPlain}:${details.orderId}`, details);
    }

    log.log(
        `Qutrade cancelAllOrders(${pair}, ${side}): verified ${cancelled.length} cancellations and no remaining scoped orders`,
    );
    return true;
  }

  /**
   * Recover an uncertain submission by its unique label; never resubmit a mutation
   * @param {SubmissionEvent} event Original durable intent
   * @param {string} [acknowledgedId] Unverified identity from the placement response
   * @returns {Promise<OrderPlacement>} Recovered ID or explicit uncertainty with journal reference
   */
  async function recoverSubmission(event, acknowledgedId) {
    const names = formatPairName(event.pair);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await api.openOrders(names.pairPlain);
        if (response?.result !== 'success') throw new Error('Recovery open-orders read failed');
        recordOpenOrders(response.payload, names.pairPlain);
        const matches = response.payload.filter((row) => row.label === event.clientOrderId);
        if (matches.length > 1) throw new Error('Duplicate submission label');
        // Reconciliation only needs the latest history page, never a deep history scan.
        const row = matches[0] ||
          (await readHistoryPage(names.pairPlain)).find((item) => item.label === event.clientOrderId);
        if (row) {
          const details = normalizeOrder(row, names.pairPlain);
          const differences = acknowledgementMismatches(row, names.pairPlain, event);
          if (hasIdentityMismatch(differences)) throw new Error(`Recovery intent mismatch: ${differences.join(', ')}`);

          knownOrders.set(`${names.pairPlain}:${details.orderId}`, row.timestamp_create);
          if (differences.length) {
            const message = `Qutrade recovered order ${details.orderId} on ${event.pair} by label ${event.clientOrderId}, with mismatched ${differences.join(', ')}.`;
            log.error(message);
            saveSubmission({ ...event, state: 'uncertain', orderId: details.orderId });
            return { orderId: details.orderId, clientOrderId: event.clientOrderId, message };
          }

          const message = `Qutrade recovered ${event.side} order ${details.orderId} on ${event.pair} using label ${event.clientOrderId}`;
          log.info(message);
          saveSubmission({ ...event, state: 'recovered', orderId: details.orderId });

          return { orderId: details.orderId, clientOrderId: event.clientOrderId, message };
        }
      } catch (error) {
        log.warn(`Error in recoverSubmission(${event.clientOrderId}) of trader_qutrade module: ${error}`);
      }
      if (attempt < 2) await utils.pauseAsync(1000 * (attempt + 1));
    }
    if (!acknowledgedId) saveSubmission({ ...event, state: 'uncertain' });
    const message = `Qutrade could not verify the ${event.side} ${event.type.toLowerCase()} order on ${event.pair}. ` +
      `Reconcile journal label ${event.clientOrderId}${acknowledgedId ? ` and reported ID ${acknowledgedId}` : ''} before replacing it.`;
    log.error(message);
    return { clientOrderId: event.clientOrderId, isSubmissionUncertain: true, message };
  }

  /**
   * Preserve reconciliation evidence without losing a confirmed acknowledgement on storage failure
   * @param {SubmissionEvent} event Journal entry
   * @returns {void}
   */
  function saveSubmission(event) {
    try {
      const options = event.state === 'uncertain' ?
        { stream: 'uncertain' } :
        { rotation: SUBMISSION_JOURNAL_ROTATION };
      appendSubmissionEvent('qutrade', accountReference, event, undefined, options);
    } catch (error) {
      log.error(`Error saving Qutrade ${event.state} submission ${event.clientOrderId}: ${error}`);
    }
  }

  /**
   * Reuse recently validated market limits across consecutive placements
   * @param {string} pair Native pair
   * @returns {Promise<{market:QutradeMarketInfo,row:QutradeMarket,expiresAt:number}>} Placement rules and reference rates
   */
  async function getPlacementMarket(pair) {
    const cached = placementMarkets.get(pair);
    if (cached?.expiresAt > Date.now()) return cached;

    const response = await api.markets(pair);
    const row = response?.payload?.[pair];
    if (response?.result !== 'success' || !row) throw new Error('Market metadata unavailable');

    const market = normalizeMarket(pair, row);
    const snapshot = { market, row, expiresAt: Date.now() + PLACEMENT_MARKET_TTL_MS };
    placementMarkets.set(pair, snapshot);

    const markets = /** @type {QutradeMarkets} */ (module.exports.exchangeMarkets);
    if (markets) markets[pair] = market;

    return snapshot;
  }

  /**
   * Report the submitted fields that a placement acknowledgement contradicts
   * @param {QutradeOrder} row Exchange acknowledgement
   * @param {string} pair Native pair
   * @param {SubmissionEvent} event Submitted intent
   * @returns {string[]} Names of mismatched fields
   */
  function acknowledgementMismatches(row, pair, event) {
    const differences = [];
    if (row.pair !== pair) differences.push('pair');
    if (row.side !== event.side) differences.push('side');
    if (row.type !== event.type.toLowerCase()) differences.push('type');
    if (row.label && row.label !== event.clientOrderId) differences.push('label');
    if (event.quantity && Number(row.requested_base_amount) !== Number(event.quantity)) differences.push('base amount');
    if (event.quoteQuantity && Number(row.requested_quote_amount) !== Number(event.quoteQuantity)) differences.push('quote amount');
    if (event.price && Number(row.requested_price) !== Number(event.price)) differences.push('price');
    return differences;
  }

  /**
   * Separate contradictory order identity from deviations in acknowledged economics
   * @param {string[]} differences Acknowledgement field names
   * @returns {boolean} Whether the response may refer to a different order
   */
  function hasIdentityMismatch(differences) {
    return differences.some((field) => ['pair', 'side', 'type', 'label'].includes(field));
  }

  /**
   * Place one validated limit/market order, journaling its label before HTTP submission
   * Quote-sized market orders are native, including market sells. Labels are not idempotency keys.
   * @param {QutradeSide} side buy or sell
   * @param {string} pair Readable/native pair
   * @param {number} price Limit price; absent for market orders
   * @param {number} coin1Amount Base amount; omit to use quote amount
   * @param {0|1} [limit=1] 1 limit, 0 market
   * @param {number} [coin2Amount] Quote budget/target
   * @returns {Promise<OrderPlacement|undefined>} Exchange ID, refusal or explicit uncertain submission
   */
  async function placeOrder(side, pair, price, coin1Amount, limit = 1, coin2Amount) {
    /** @type {SubmissionEvent} */
    let event;
    let names;
    let base;
    let quote;
    let normalizedPrice;
    try {
      names = formatPairName(pair);
      if (!names || !['buy', 'sell'].includes(side) || ![0, 1].includes(limit)) {
        throw new Error('Invalid pair, side or order type');
      }
      for (const value of [coin1Amount, coin2Amount]) {
        if (value !== undefined && value !== null && !utils.isPositiveNumber(value)) {
          throw new Error('Amounts must be finite positive numbers');
        }
      }
      if (!coin1Amount && !coin2Amount) throw new Error('Supply a base or quote amount');
      if (!limit && price !== undefined && price !== null) {
        throw new Error('Market orders must not carry a limit price');
      }
      if (!limit && coin1Amount && coin2Amount) throw new Error('Market orders require exactly one amount');
      if (limit && !utils.isPositiveNumber(price)) throw new Error('Limit price must be a finite positive number');

      const { market, row } = await getPlacementMarket(names.pairPlain);

      if (limit) {
        normalizedPrice = utils.quantizeToStep(price, market.coin2Precision, 0, side === 'buy' ? 'floor' : 'ceil');
        const bandMin = side === 'buy' ? market.minPriceBuy : market.minPriceSell;
        const bandMax = side === 'buy' ? market.maxPriceBuy : market.maxPriceSell;
        if (+normalizedPrice < bandMin || +normalizedPrice > bandMax) {
          placementMarkets.delete(names.pairPlain);
          throw new Error(`Price ${normalizedPrice} outside the ${side} band ${bandMin}–${bandMax} ${market.coin2}`);
        }
        const desiredBase = coin1Amount || coin2Amount / +normalizedPrice;
        base = utils.quantizeToStep(desiredBase, market.coin1Precision);
        // A quote-only limit order must stay within the requested budget after conversion.
        if (!coin1Amount && +base * +normalizedPrice > coin2Amount) {
          base = utils.quantizeToStep(Math.max(0, +base - market.coin1Precision), market.coin1Precision);
        }

        if (coin1Amount && coin2Amount && side === 'buy' && +base * +normalizedPrice > coin2Amount * (1 + Number.EPSILON)) {
          throw new Error(`Normalized buy notional exceeds the supplied budget of ${coin2Amount} ${market.coin2}`);
        }
      } else if (coin1Amount) {
        base = utils.quantizeToStep(coin1Amount, market.coin1Precision);
      } else {
        if (!market.quoteAmountPrecision) throw new Error('Exchange reports no usable quote amount step');
        quote = utils.quantizeToStep(coin2Amount, market.quoteAmountPrecision);
      }

      if (base !== undefined && (!+base || +base < market.coin1MinAmount)) {
        throw new Error(`Base amount ${base} ${market.coin1} is below the minimum ${market.coin1MinAmount}`);
      }

      const rate = row[side === 'buy' ? 'ask' : 'bid'];
      const estimatePrice = limit ? +normalizedPrice : wireNumber(rate, 'market reference price', true);
      const quoteValue = quote !== undefined ? +quote : +base * estimatePrice;
      if (quoteValue < market.coin2MinAmount || quoteValue <= 0) {
        throw new Error(`Notional ${quoteValue} ${market.coin2} is below the minimum ${market.coin2MinAmount}`);
      }

      if (quote !== undefined && +quote / estimatePrice < market.coin1MinAmount) {
        throw new Error(`Estimated base amount is below the minimum ${market.coin1MinAmount} ${market.coin1}`);
      }

      event = {
        state: 'pending',
        clientOrderId: `adm${crypto.randomBytes(11).toString('hex')}`,
        pair: names.pairReadable,
        side,
        type: limit ? 'LIMIT' : 'MARKET',
        price: normalizedPrice,
        quantity: base,
        quoteQuantity: quote,
      };
      appendSubmissionEvent('qutrade', accountReference, event, undefined, { rotation: SUBMISSION_JOURNAL_ROTATION });
    } catch (error) {
      const message = `Unable to place Qutrade ${side} ${limit ? 'limit' : 'market'} order on ${pair}: ${error instanceof Error ? error.message : error}`;
      log.warn(message);
      return { message };
    }

    const amount = base ? `${base} ${names.coin1}` : `${quote} ${names.coin2}`;
    const intent = `${side} ${limit ? 'limit' : 'market'} order on ${names.pairReadable} (${amount}` +
      `${normalizedPrice ? ` at ${normalizedPrice}` : ''}, label ${event.clientOrderId})`;

    try {
      const response = await api.createOrder(
          names.pairPlain,
          side,
        limit ? 'limit' : 'market',
        base,
        quote,
        normalizedPrice,
        event.clientOrderId,
      );
      if (response?.result === 'error') {
        saveSubmission({ ...event, state: 'rejected' });
        const reason = response.details || response.message || 'No exchange details';
        if (response.code === 400 && /price/i.test(reason)) placementMarkets.delete(names.pairPlain);
        const message = `Qutrade refused ${intent}: ${reason}`;
        log.warn(message);
        return { message };
      }

      const row = response?.payload;
      const id = validOrderId(row?.order_id);
      if (!id) throw new Error('Placement acknowledgement is missing a valid order ID');

      const differences = acknowledgementMismatches(row, names.pairPlain, event);
      const key = `${names.pairPlain}:${id}`;
      if (differences.length) {
        const message = `Qutrade acknowledged order ${id} for ${intent} with mismatched ${differences.join(', ')}. Verify the order before replacing it.`;
        log.error(message);
        // A mismatched pair, side, type or label cannot safely be booked as the submitted order.
        saveSubmission({ ...event, state: 'uncertain', orderId: id });
        if (hasIdentityMismatch(differences)) {
          return recoverSubmission(event, id);
        }

        if (!knownOrders.has(key)) knownOrders.set(key, undefined);
        return { orderId: id, clientOrderId: event.clientOrderId, message };
      }

      // A live sell ACK reported 'filled' with zero executions and omitted the label.
      // The signed request's matching identity proves placement. Lifecycle reads prove status.
      if (!knownOrders.has(key)) knownOrders.set(key, undefined);
      if (!row.label || (row.status === 'filled' && Number(row.filled_base_amount) === 0)) {
        log.warn(
            `Qutrade create_order ${id} (${side} ${names.pairReadable}): label or state is unreliable; verify via order reads`,
        );
      }
      saveSubmission({ ...event, state: 'acknowledged', orderId: id });

      const message =
        `Qutrade placed ${side} ${limit ? 'limit' : 'market'} order ${id} on ${names.pairReadable}` +
        ` (${base ? `${base} ${names.coin1}` : `${quote} ${names.coin2}`}${normalizedPrice ? ` at ${normalizedPrice}` : ''})`;
      log.info(message);
      return { orderId: id, clientOrderId: event.clientOrderId, message };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof QutradeAPI.QutradeRequestError && !error.uncertain) {
        saveSubmission({ ...event, state: 'rejected' });
        const message = `Qutrade refused ${intent}: ${reason}`;
        log.warn(message);
        return { message };
      }

      log.warn(`Qutrade could not confirm ${intent}: ${reason}. Reconciling by label.`);
      return recoverSubmission(event);
    }
  }

  /**
   * Get fresh ticker data; Qutrade does not publish 24h high/low in this endpoint
   * @param {string} pair Readable/native pair
   * @returns {Promise<Rates|undefined>} Current ticker with unavailable extrema left undefined
   */
  async function getRates(pair) {
    const names = formatPairName(pair);
    if (!names) return undefined;
    return read(
        `getRates(${pair})`,
        () => api.markets(names.pairPlain),
        (data) => {
          const row = data?.[names.pairPlain];
          return {
            ask: wireNumber(row?.ask, 'ask'),
            bid: wireNumber(row?.bid, 'bid'),
            last: wireNumber(row?.last, 'last'),
            volume: wireNumber(row?.base_volume, 'base_volume'),
            volumeInCoin2: wireNumber(row?.quote_volume, 'quote_volume'),
            high: undefined,
            low: undefined,
          };
        },
    );
  }

  /**
   * Read the maximum 100 aggregated levels per side supported by Qutrade
   * @param {string} pair Readable/native pair
   * @param {number} [limit=100] 1–100 levels
   * @returns {Promise<Depth|undefined>} Sorted validated order book
   */
  async function getOrderBook(pair, limit = 100) {
    const names = formatPairName(pair);
    if (!names || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      log.warn(`Qutrade getOrderBook(${pair}, ${limit}): invalid pair or depth limit (1–100)`);
      return undefined;
    }
    return read(
        `getOrderBook(${pair}, ${limit})`,
        () => api.orderBook(names.pairPlain, limit),
        (data) => {
          const row = data?.[names.pairPlain];
          if (!Array.isArray(row?.bids) || !Array.isArray(row?.asks)) throw new Error('Invalid order book');
          /** @param {[string,string][]} levels Price/quantity levels @param {'buy'|'sell'} side Direction @returns Normalized levels */
          const normalize = (levels, side) =>
            levels.map((level) => {
              if (!Array.isArray(level) || level.length !== 2) throw new Error('Invalid order-book level');
              return {
                price: wireNumber(level[0], 'price', true),
                amount: wireNumber(level[1], 'amount', true),
                count: 1,
                side,
              };
            });
          return {
            bids: normalize(row.bids, 'buy').sort((a, b) => b.price - a.price),
            asks: normalize(row.asks, 'sell').sort((a, b) => a.price - b.price),
          };
        },
    );
  }

  /**
   * Return public executions; never substitute the account's private fills
   * @param {string} pair Readable/native pair
   * @param {number} [limit=300] 1–1000 trades
   * @returns {Promise<Trades|undefined>} Chronological public executions
   */
  async function getTradesHistory(pair, limit = 300) {
    const names = formatPairName(pair);
    if (!names || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      log.warn(`Qutrade getTradesHistory(${pair}, ${limit}): invalid pair or trade limit (1–1000)`);
      return undefined;
    }
    return read(
        `getTradesHistory(${pair}, ${limit})`,
        () => api.trades(names.pairPlain, limit),
        (data) => {
          if (!Array.isArray(data)) throw new Error('Invalid public trade list');
          const ids = new Set();
          return data
              .map((row) => {
                const id = validOrderId(row.id);
                if (!id || ids.has(id) || !['buy', 'sell'].includes(row.side)) throw new Error('Invalid public trade');
                ids.add(id);
                return {
                  tradeId: id,
                  side: row.side,
                  date: wireTimestamp(row.timestamp),
                  price: wireNumber(row.price, 'trade price', true),
                  coin1Amount: wireNumber(row.base_amount, 'base_amount', true),
                  coin2Amount: wireNumber(row.quote_amount, 'quote_amount', true),
                };
              })
              .sort((a, b) => a.date - b.date);
        },
    );
  }

  /**
   * Read native candles with server-side time bounds; unsupported intervals return undefined
   * @param {string} pair Readable/native pair
   * @param {string} [timeframe='15m'] Native interval: 15m, 1h, 1d, 1w or calendar 1M
   * @param {number} [since] Inclusive opening timestamp in milliseconds
   * @param {number} [limit=1000] 1–1000 candles
   * @param {boolean} [excludeLastPartialCandle=true] Exclude the still-forming interval
   * @returns {Promise<Candles|undefined>} Chronological native OHLCV without invented gaps
   */
  async function getCandlesHistory(pair, timeframe = '15m', since, limit = 1000, excludeLastPartialCandle = true) {
    const names = formatPairName(pair);
    if (
      !names ||
      !Object.hasOwn(TIMEFRAMES, timeframe) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000 ||
      (since !== undefined && (!Number.isSafeInteger(since) || since < 1000)) ||
      typeof excludeLastPartialCandle !== 'boolean'
    ) {
      log.warn(`Qutrade getCandlesHistory(${pair}, ${timeframe}, ${since}, ${limit}): invalid request. Supported intervals: ${Object.keys(TIMEFRAMES).join(', ')}`);
      return undefined;
    }
    if (!marketInfo(pair)) await getMarkets();
    const market = marketInfo(pair);
    if (!market) return undefined;
    const now = Date.now();
    return read(
        `getCandlesHistory(${pair}, ${timeframe}, ${since}, ${limit})`,
        () =>
          api.candles(
              names.pairPlain,
              TIMEFRAMES[timeframe],
          since === undefined ? 1 : Math.ceil(since / 1000),
          Math.floor(now / 1000),
          Math.min(1000, limit + (excludeLastPartialCandle ? 1 : 0)),
          ),
        (data) => {
          if (!Array.isArray(data)) throw new Error('Invalid candle list');
          const seen = new Set();
          const candles = data
              .map((row) => {
                const tsOpen = wireTimestamp(row.timestamp);
                if ((since !== undefined && tsOpen < since) || tsOpen > now || seen.has(tsOpen)) {
                  throw new Error('Invalid candle time');
                }
                seen.add(tsOpen);
                const date = new Date(tsOpen);
                const tsClose =
              timeframe === '1M' ?
                Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) :
                tsOpen + INTERVALS[timeframe];
                const [open, high, low, close] = ['open', 'high', 'low', 'close'].map(
                    (key) => +wireNumber(row[key], `candle ${key}`, true).toFixed(market.coin2Decimals),
                );
                if (low > Math.min(open, close) || high < Math.max(open, close) || low > high) {
                  throw new Error('Invalid OHLC');
                }
                return {
                  tsOpen,
                  tsClose,
                  date: date.toISOString(),
                  open,
                  high,
                  low,
                  close,
                  baseVolume: wireNumber(row.base_volume, 'candle base_volume'),
                  quoteVolumeCalc: wireNumber(row.quote_volume, 'candle quote_volume'),
                  source: /** @type {const} */ ('native'),
                  exchange: 'qutrade',
                  pair: names.pairReadable,
                  timeframe,
                };
              })
              .filter((row) => !excludeLastPartialCandle || row.tsClose <= now);
          return candles.sort((a, b) => a.tsOpen - b.tsOpen).slice(-limit);
        },
    );
  }

  /** @returns Capability flags reflecting implemented and documented v2 endpoints */
  function features() {
    return {
      getMarkets: true,
      getCurrencies: true,
      supportCoinNetworks: true,
      getRates: true,
      getOrderBook: true,
      getTradesHistory: true,
      getCandlesHistory: true,
      placeMarketOrder: true,
      allowAmountForMarketBuy: true,
      allowAmountForMarketSell: true,
      amountForMarketOrderNecessary: false,
      getAccounts: false,
      getTradingFees: false,
      getAccountTradeVolume: false,
      getDepositAddress: true,
      createDepositAddressWithWebsiteOnly: true,
      getFundHistory: false,
      getFundHistoryImplemented: false,
      getWithdrawalById: false,
      supportTransferBetweenAccounts: false,
      accountTypes: ['spot'],
      tradingAccountType: 'spot',
      socketSupport: false,
      socketPullSupport: false,
      socketEnabled: false,
      isDemo: false,
      selfTradeProhibited: false,
      apiProcessingDelayMs: API_PROCESSING_DELAY_MS,
      marketDataSource: 'candles',
      candleTimeframes: Object.keys(TIMEFRAMES),
    };
  }

  /**
   * Qutrade v2 exposes no account-info endpoint
   * @returns {Promise<undefined>} Unsupported; never synthesize an exchange account ID
   */
  async function getAccounts() {
    return undefined;
  }

  /**
   * Qutrade v2 exposes no aggregate account-volume endpoint
   * @returns {Promise<undefined>} Unsupported; market-wide volume is not personal volume
   */
  async function getVolume() {
    return undefined;
  }

  /**
   * Qutrade v2 exposes no trading-fee endpoint; withdrawal fees are in currencies
   * @param {string} [coinOrPair] Requested asset/pair
   * @returns {Promise<undefined>} Unsupported; do not invent an account-specific fee rate
   */
  async function getFees(coinOrPair) {
    return undefined;
  }

  /**
   * Read generated deposit addresses; Qutrade does not generate addresses through this API
   * @param {string} coin Asset symbol
   * @returns {Promise<Addresses|undefined>} Validated addresses or undefined on failure
   */
  async function getDepositAddress(coin) {
    if (typeof coin !== 'string' || !/^[A-Z0-9]+$/i.test(coin)) {
      log.warn('Qutrade getDepositAddress: invalid currency selector');
      return undefined;
    }

    const currency = coin.toUpperCase();
    return read(
        `getDepositAddress(${currency})`,
        () => api.depositAddresses(currency),
        (data) => {
          assertRecord(data, 'deposit-address map');
          if (Object.keys(data).some((symbol) => symbol !== currency)) {
            throw new Error('Unexpected currency in deposit-address response');
          }

          const rows = data[currency];
          if (rows === undefined && !Object.keys(data).length) return [];
          if (!Array.isArray(rows)) throw new Error('Invalid deposit-address list');

          const seen = new Set();
          return rows.map((row) => {
            const network = formatNetworkName(row?.chain);
            if (
              !network ||
            seen.has(network) ||
            typeof row.address !== 'string' ||
            !row.address.trim() ||
            (row.memo !== undefined && row.memo !== null && typeof row.memo !== 'string')
            ) {
              throw new Error('Invalid or duplicate deposit-address record');
            }

            seen.add(network);
            return { network, address: row.address, memo: row.memo ?? undefined };
          });
        },
    );
  }

  /**
   * Get main spot-wallet balances; funds in pools or orders are unavailable for trading
   * @param {boolean} [nonzero=true] Omit empty balances
   * @param {string} [accountType='spot'] Only spot is supported
   * @returns {Promise<Balances|undefined>} Validated balances
   */
  async function getBalances(nonzero = true, accountType = 'spot') {
    if (typeof nonzero !== 'boolean' || accountType !== 'spot') {
      log.warn(`Qutrade getBalances(${nonzero}, ${accountType}): expected a boolean filter and the spot wallet`);
      return undefined;
    }

    return read(
        `getBalances(${nonzero}, ${accountType})`,
        () => api.balances(nonzero),
        (data) => {
          assertRecord(data, 'balances');
          return Object.entries(data)
              .map(([code, row]) => {
                const total = wireNumber(row.total, 'total');
                const free = wireNumber(row.available, 'available');
                if (free > total) throw new Error('Available balance exceeds total');
                return { code, total, free, freezed: +(total - free).toPrecision(15) };
              })
              .filter((row) => !nonzero || row.total > 0);
        },
    );
  }

  if (loadMarket) {
    void getMarkets();
    void getCurrencies();
  }

  return {
    get markets() {
      return module.exports.exchangeMarkets;
    },
    get currencies() {
      return module.exports.exchangeCurrencies;
    },
    getMarkets,
    marketInfo,
    getCurrencies,
    currencyInfo,
    features,
    getBalances,
    getOpenOrders,
    getOrderDetails,
    cancelOrder,
    cancelAllOrders,
    placeOrder,
    getRates,
    getOrderBook,
    getTradesHistory,
    getCandlesHistory,
    getAccounts,
    getVolume,
    getFees,
    getDepositAddress,
  };
};

/** @type {QutradeMarkets|undefined} */
module.exports.exchangeMarkets = undefined;
/** @type {Currencies|undefined} */
module.exports.exchangeCurrencies = undefined;
/** @type {Promise<QutradeMarkets|undefined>|undefined} */
module.exports.marketsPromise = undefined;
/** @type {Promise<Currencies|undefined>|undefined} */
module.exports.currenciesPromise = undefined;

/** @param {unknown} value Wire object @param {string} name Diagnostic field @returns {void} Throws for invalid records */
function assertRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid Qutrade ${name}`);
}

/**
 * Validate a Qutrade monetary field without coercing null, blanks or booleans to zero
 * @param {unknown} value Wire decimal
 * @param {string} name Wire field name
 * @param {boolean} [positive=false] Require a nonzero value
 * @returns {number} Finite validated value
 */
function wireNumber(value, name, positive = false) {
  if (
    !['number', 'string'].includes(typeof value) ||
    (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value)) ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0 ||
    (positive && !Number(value))
  ) {
    throw new Error(`Invalid Qutrade ${name}`);
  }
  return Number(value);
}

/** @param {unknown} value Seconds @returns {number} Milliseconds, rejecting unsafe or invalid times */
function wireTimestamp(value) {
  const seconds = wireNumber(value, 'timestamp', true);
  if (!Number.isSafeInteger(seconds) || seconds > 9999999999) throw new Error('Invalid Qutrade timestamp');
  return seconds * 1000;
}

/** @param {unknown} value Integer exchange ID @returns {string|undefined} Exact ID, never a rounded JS integer */
function validOrderId(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return undefined;
  return typeof value === 'string' || typeof value === 'number' ?
    /^[1-9]\d*$/.test(String(value)) ?
      String(value) :
      undefined :
    undefined;
}

/** @param {string} pair Readable/native/compact pair @returns {QutradePair|undefined} Validated pair components */
function formatPairName(pair) {
  if (typeof pair !== 'string') return undefined;
  const normalized = pair.trim().toUpperCase();
  const match = /^([A-Z0-9]+)[/_-]([A-Z0-9]+)$/.exec(normalized);
  if (!match) {
    const markets = Object.values(module.exports.exchangeMarkets || {}).filter(
        (row) => row.coin1 + row.coin2 === normalized,
    );
    return markets.length === 1 ? formatPairName(markets[0].pairPlain) : undefined;
  }
  return {
    coin1: match[1],
    coin2: match[2],
    pairPlain: `${match[1]}_${match[2]}`,
    pairReadable: `${match[1]}/${match[2]}`,
  };
}

/** @param {string} name Qutrade chain name @returns {string|undefined} Canonical network or retained exchange code */
function formatNetworkName(name) {
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const plain = name.toUpperCase();
  const aliases = {
    ETH: 'ERC20',
    ETHEREUM: 'ERC20',
    TRX: 'TRC20',
    TRON: 'TRC20',
    BSC: 'BEP20',
    SOLANA: 'SOL',
  };
  const code = aliases[plain] || plain;
  return networks[code]?.code || code;
}

/** @param {string} symbol Native symbol @param {QutradeMarket} row Wire rules @returns {QutradeMarketInfo} Validated market */
function normalizeMarket(symbol, row) {
  const pair = formatPairName(symbol);
  if (!pair || pair.pairPlain !== symbol || !row) throw new Error('Invalid Qutrade market symbol');
  for (const decimals of [row.base_decimal_amount, row.decimal_price, row.quote_decimal_amount]) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('Invalid Qutrade decimals');
  }
  const amountStep = wireNumber(row.base_step_amount, 'base_step_amount', true);
  const priceStep = wireNumber(row.step_price, 'step_price', true);
  // Live BTC/ETH markets can report quote_step_amount='0' despite nonzero decimal precision.
  // Preserve their base-sized trading rules, but do not guess a quote-sized market-order grid.
  const quoteStep = wireNumber(row.quote_step_amount, 'quote_step_amount');
  const minPriceBuy = wireNumber(row.min_price_buy, 'min_price_buy', true);
  const maxPriceBuy = wireNumber(row.max_price_buy, 'max_price_buy', true);
  const minPriceSell = wireNumber(row.min_price_sell, 'min_price_sell', true);
  const maxPriceSell = wireNumber(row.max_price_sell, 'max_price_sell', true);
  if (maxPriceBuy < minPriceBuy || maxPriceSell < minPriceSell) throw new Error('Inverted Qutrade price band');
  return {
    ...pair,
    coin1Decimals: row.base_decimal_amount,
    coin2Decimals: row.decimal_price,
    coin1Precision: amountStep,
    coin2Precision: priceStep,
    pricePrecision: priceStep,
    priceDecimals: row.decimal_price,
    quoteAmountDecimals: row.quote_decimal_amount,
    quoteAmountPrecision: quoteStep || undefined,
    coin1MinAmount: wireNumber(row.base_min_amount, 'base_min_amount', true),
    coin1MaxAmount: null,
    coin2MinAmount: wireNumber(row.quote_min_amount, 'quote_min_amount', true),
    coin2MaxAmount: null,
    coin2MinPrice: Math.min(minPriceBuy, minPriceSell),
    coin2MaxPrice: Math.max(maxPriceBuy, maxPriceSell),
    minPriceBuy,
    maxPriceBuy,
    minPriceSell,
    maxPriceSell,
    minTrade: wireNumber(row.quote_min_amount, 'quote_min_amount', true),
    status: 'ONLINE',
  };
}

/**
 * Normalize explicit execution quantities; quote-sized markets have no original base target
 * @param {QutradeOrder} row Full wire order
 * @param {string} pair Expected native pair
 * @returns {OrderDetails} Verified details
 */
function normalizeOrder(row, pair) {
  const id = validOrderId(row?.order_id);
  const status = Object.hasOwn(ORDER_STATUSES, row?.status) ? ORDER_STATUSES[row.status] : undefined;
  const names = formatPairName(row?.pair);
  if (
    !id ||
    !status ||
    !names ||
    names.pairPlain !== pair ||
    !['buy', 'sell'].includes(row.side) ||
    !['limit', 'market', 'stop_limit', 'stop_market'].includes(row.type)
  ) {
    throw new Error('Invalid order identity, type or state');
  }

  const filled = wireNumber(row.filled_base_amount, 'filled_base_amount');
  const filledQuote = wireNumber(row.filled_quote_amount, 'filled_quote_amount');
  const baseTarget =
    row.requested_base_amount === null || row.requested_base_amount === undefined ?
      undefined :
      wireNumber(row.requested_base_amount, 'requested_base_amount', true);
  const quoteTarget =
    row.requested_quote_amount === null || row.requested_quote_amount === undefined ?
      undefined :
      wireNumber(row.requested_quote_amount, 'requested_quote_amount', true);
  const limit = row.type === 'limit' || row.type === 'stop_limit';
  const price = limit ?
    wireNumber(row.requested_price, 'requested_price', true) :
    row.average_price === null ?
      0 :
      wireNumber(row.average_price, 'average_price');

  if (baseTarget === undefined && (limit || quoteTarget === undefined)) throw new Error('Missing order target');

  const tolerance = Math.max(1e-12, (baseTarget || filled) * 1e-10);
  if (baseTarget !== undefined && filled > baseTarget + tolerance) throw new Error('Execution exceeds base target');
  if (row.status === 'opened' && (filled !== 0 || filledQuote !== 0)) throw new Error('Opened order has fills');
  if (row.status === 'filling' && (filled <= 0 || filledQuote <= 0)) throw new Error('Partial order has no fills');
  if (row.status === 'filled' && (filled <= 0 || filledQuote <= 0)) throw new Error('Filled order has no execution');
  if (baseTarget !== undefined && row.unfilled_base_amount !== null && row.unfilled_base_amount !== undefined) {
    const left = wireNumber(row.unfilled_base_amount, 'unfilled_base_amount');
    if (row.status !== 'canceled' && Math.abs(baseTarget - filled - left) > tolerance) {
      throw new Error('Contradictory remaining quantity');
    }
    if (row.status === 'filled' && left > tolerance) throw new Error('Filled order retains base remainder');
  }

  const timestamp = wireTimestamp(row.timestamp_create);
  const updateTimestamp = wireTimestamp(row.timestamp_update);
  if (updateTimestamp < timestamp || !Number.isInteger(row.trades_count) || row.trades_count < 0) {
    throw new Error('Invalid order metadata');
  }

  return {
    orderId: id,
    status,
    pairPlain: pair,
    pairReadable: names.pairReadable,
    side: row.side,
    type: row.type,
    price,
    amount: baseTarget ?? filled,
    amountExecuted: filled,
    volume: quoteTarget ?? (limit ? baseTarget * price : filledQuote),
    volumeExecuted: filledQuote,
    timestamp,
    updateTimestamp,
    tradesCount: row.trades_count,
  };
}

/** @param {QutradeOrder[]} rows Wire snapshot @param {string} pair Expected pair @param {boolean} [active=false] Require active states @returns {OrderDetails[]} Normalize atomically */
function normalizeOrderList(rows, pair, active = false) {
  if (!Array.isArray(rows)) throw new Error('Invalid Qutrade order list');
  const ids = new Set();
  return rows.map((row) => {
    const order = normalizeOrder(row, pair);
    if (ids.has(order.orderId)) throw new Error(`Duplicate order ID ${order.orderId}`);
    if (
      active &&
      (!['new', 'part_filled'].includes(order.status) ||
        !wireNumber(row.unfilled_base_amount, 'unfilled_base_amount', true) ||
        !wireNumber(row.requested_base_amount, 'requested_base_amount', true))
    ) {
      throw new Error(`Open-order snapshot contains non-active or unquantifiable order ${order.orderId}`);
    }
    ids.add(order.orderId);
    return order;
  });
}
