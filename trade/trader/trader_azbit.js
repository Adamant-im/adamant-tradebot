// @ts-check
'use strict';

/**
 * @typedef {import('../../types/azbit/api.d.js').AzbitOrder} AzbitOrder
 * @typedef {import('../../types/azbit/api.d.js').AzbitError} AzbitError
 * @typedef {import('../../types/markets.d.js').MarketsResult} Markets
 * @typedef {import('../../types/order-info.d.js').Result} OrderDetails
 * @typedef {import('../../types/orders.d.js').ResultItem} OpenOrder
 * @typedef {import('../../types/candles.d.js').CandlesResult} Candles
 * @typedef {import('../api/azbit_api').AzbitLogger} AzbitLogger
 * @typedef {import('../../types/markets.d.js').ResultItem} Market
 * @typedef {import('../../types/azbit/api.d.js').AzbitAccount} AzbitAccount
 * @typedef {import('../../types/assets.d.js').ResultItem} Balance
 * @typedef {import('../../types/azbit/api.d.js').AzbitBalance} AzbitBalance
 * @typedef {import('../../types/order-place.d.js').Result} OrderPlacement
 * @typedef {import('../../types/rates.d.js').RatesResult} RatesResult
 * @typedef {import('../../types/depth.d.js').DepthResult} DepthResult
 * @typedef {import('../../types/trades.d.js').TradesResult} TradesResult
 * @typedef {import('../../types/azbit/api.d.js').AzbitCommissions} AzbitCommissions
 * @typedef {import('../../types/order-info.d.js').OrderStatus} OrderStatus
 * @typedef {import('../../types/currencies.d.js').CurrenciesResult} Currencies
 * @typedef {import('../../types/currencies.d.js').ResultItem} Currency
 * @typedef {import('../../types/currencies.d.js').CurrenciesNetworkItem} CurrencyNetwork
 * @typedef {import('../../types/feerates.d.js').Result} FeeRates
 */

const Azbit = require('../api/azbit_api');
const utils = require('../../helpers/utils');
const config = require('../../modules/configReader');

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
// Cache only a bounded recent set of terminal order IDs: it lets repeated cancelOrder() calls return false
// without restoring the expensive GET-before-DELETE flow, while preventing an indefinitely running bot from retaining every historical ID.
const MAX_TERMINAL_ORDER_IDS = 10000;
// Azbit documents these fields as int32 without a maximum. The bot represents prices and amounts as JS Numbers,
// and its truncation helper supports 0–18 decimal places, so this is an adapter limit rather than an exchange limit.
const MAX_SUPPORTED_DECIMALS = 18;
// modules/marketHistory.js requests a 30-day window of 5m candles, that is 8640 base intervals,
// and falls back to nothing when a connector exposes getCandlesHistory() but refuses the request.
const MAX_CANDLES = 10000;
const ACTIVE_ORDER_STATUSES = new Set(['new', 'part_filled']);
const NETWORK_ALIASES = {
  ETH: 'ERC20',
  TRX: 'TRC20',
  BNB: 'BEP20',
  POL: 'MATIC',
  AETH: 'ARBITRUM',
};
const TIMEFRAMES = {
  '1m': ['minute', 60000],
  '3m': ['minutes3', 180000],
  '5m': ['minutes5', 300000],
  '15m': ['minutes15', 900000],
  '30m': ['minutes30', 1800000],
  '1h': ['hour', 3600000],
  '4h': ['hour4', 14400000],
  '1d': ['day', 86400000],
};

/**
 * Create a spot REST adapter for the main Azbit trading wallet
 * Funding and isolated UTA selection are not exposed by the documented spot balance/order routes.
 * @param {string} apiKey Public API key
 * @param {string} secretKey Private HMAC key
 * @param {string} pwd Unused compatibility password
 * @param {AzbitLogger} log Application logger
 * @param {boolean} [publicOnly] Disable private requests
 * @param {boolean} [loadMarket] Preload shared public metadata
 * @param {boolean} [useSocket] Unused; REST only
 * @param {boolean} [useSocketPull] Unused; REST only
 * @param {number} [accountNo] Bot credential slot, not an Azbit UTA ID
 * @param {string} [coin1] Default base asset
 * @param {string} [coin2] Default quote asset
 * @returns Bot-compatible spot methods
 */
module.exports = (
    apiKey, secretKey, pwd, log, publicOnly = false, loadMarket = true,
    useSocket = false, useSocketPull = false, accountNo = 0, coin1 = config.coin1, coin2 = config.coin2,
) => {
  const client = Azbit();
  const terminalOrderIds = new Set();
  client.setConfig('https://data.azbit.com', apiKey, secretKey, pwd, log, publicOnly);

  /**
   * Separate request failures from invalid payloads; neither becomes empty success
   * @template T,R
   * @param {string} method Method and non-secret parameters for logging
   * @param {() => Promise<T | AzbitError>} request Raw endpoint operation
   * @param {(data: T) => R} normalize Strict response conversion
   * @returns {Promise<R | undefined>} Normalized result or retryable absence of evidence
   */
  async function read(method, request, normalize) {
    let data;
    try {
      data = await request();
    } catch (error) {
      log.warn(`API request ${method} of trader_azbit.js failed: ${errorMessage(error)}`);
      return undefined;
    }

    try {
      if (isError(data)) throw new Error(data.azbitErrorInfo);

      return normalize(/** @type {T} */ (data));
    } catch (error) {
      log.warn(`Error while processing ${method} of trader_azbit.js: ${errorMessage(error)}`);
      return undefined;
    }
  }

  /**
   * Remember locally proven terminal orders so repeated cancellation stays one-request on the hot path
   * @param {string} orderId Exchange GUID
   * @returns {void}
   */
  function rememberTerminalOrder(orderId) {
    const identity = orderId.toLowerCase();

    terminalOrderIds.delete(identity);
    terminalOrderIds.add(identity);

    if (terminalOrderIds.size > MAX_TERMINAL_ORDER_IDS) {
      terminalOrderIds.delete(terminalOrderIds.values().next().value);
    }
  }

  /**
   * Fetch/cache market rules, sharing an in-flight request across concurrent callers
   * @param {string} [pair] Pair with /, - or _ separator, or an unambiguous cached compact symbol
   * @returns {Promise<Markets | Market | undefined>} All markets or one market
   */
  async function getMarkets(pair) {
    if (!module.exports.exchangeMarkets) {
      if (!module.exports.marketsPromise) {
        module.exports.marketsPromise = read('getMarkets()', () => client.markets(), (data) => {
          if (!Array.isArray(data) || !data.length) {
            throw new Error(`Invalid market list — expected a non-empty array, received ${describeValue(data)}`);
          }
          /** @type {Markets} */
          const result = {};
          const seenPairs = new Set();

          for (const item of data) {
            const names = formatPairName(item?.code);

            if (!names) throw new Error(`Invalid market pair ${describeValue(item?.code)}`);

            const pairIdentity = names.pairPlain.toUpperCase();
            const coin1Decimals = integer(
                item.digitsAmount, 0, MAX_SUPPORTED_DECIMALS, `digitsAmount for market ${describeValue(item.code)}`);
            const coin2Decimals = integer(
                item.digitsPrice, 0, MAX_SUPPORTED_DECIMALS, `digitsPrice for market ${describeValue(item.code)}`);

            if (seenPairs.has(pairIdentity)) {
              throw new Error(`Duplicate market pair ${describeValue(item.code)} after case normalization to ${describeValue(pairIdentity)}`);
            }

            seenPairs.add(pairIdentity);

            result[item.code] = {
              ...names,
              pairPlain: item.code,
              coin1Decimals,
              coin2Decimals,
              coin1Precision: utils.getPrecision(coin1Decimals),
              coin2Precision: utils.getPrecision(coin2Decimals),
              coin1MinAmount: numeric(item.minBaseAmount, false, `minBaseAmount for market ${describeValue(item.code)}`),
              coin2MinAmount: numeric(item.minQuoteAmount, false, `minQuoteAmount for market ${describeValue(item.code)}`),
              coin1MaxAmount: null,
              coin2MaxAmount: null,
              coin2MinPrice: null,
              coin2MaxPrice: null,
              minTrade: numeric(item.minQuoteAmount, false, `minQuoteAmount for market ${describeValue(item.code)}`),
              status: 'ONLINE',
            };
          }
          module.exports.exchangeMarkets = result;
          return result;
        }).finally(() => {
          module.exports.marketsPromise = undefined;
        });
      }

      await module.exports.marketsPromise;
    }

    return pair === undefined ? module.exports.exchangeMarkets : marketInfo(pair);
  }

  /**
   * Get cached rules without starting an asynchronous request
   * @param {string} pair Native, readable, or unambiguous compact pair
   * @returns {Market | undefined} Cached market rules
   */
  function marketInfo(pair) {
    const names = formatPairName(pair);
    const markets = module.exports.exchangeMarkets;
    return names && markets ? markets[names.pairPlain] : undefined;
  }

  /**
   * Read detailed currency metadata and per-network withdrawal terms from Azbit's official API2 service
   * @param {string} [coin] Optional currency code
   * @param {boolean} [forceUpdate] Ignore the shared cache and refresh public metadata
   * @returns {Promise<Currencies | Currency | undefined>} All currencies or one currency
   */
  async function getCurrencies(coin, forceUpdate = false) {
    if (forceUpdate) module.exports.exchangeCurrencies = undefined;

    if (!module.exports.exchangeCurrencies) {
      if (!module.exports.currenciesPromise) {
        module.exports.currenciesPromise = read('getCurrencies()', async () => {
          const [currencies, commissions] = await Promise.all([
            client.getCurrenciesDetails(),
            client.getNetworkCommissions(),
          ]);

          if (isError(currencies)) return currencies;
          if (isError(commissions)) return commissions;

          return {
            currencies,
            commissions,
          };
        }, (data) => {
          if (!data || !Array.isArray(data.currencies) || !data.currencies.length || !Array.isArray(data.commissions)) {
            throw new Error(`Invalid detailed currency response — currencies ${describeValue(data?.currencies)}, commissions ${describeValue(data?.commissions)}`);
          }

          const feesByCurrency = new Map();

          for (const [commissionIndex, item] of data.commissions.entries()) {
            if (typeof item?.currencyCode !== 'string' || !item.currencyCode) {
              throw new Error(`Invalid network commission at index ${commissionIndex} — currencyCode ${describeValue(item?.currencyCode)}`);
            }
            if (!Array.isArray(item.chainCommissions)) {
              throw new Error(`Invalid network commission for ${describeValue(item.currencyCode)} — chainCommissions ${describeValue(item.chainCommissions)}`);
            }

            const commissionSymbol = item.currencyCode.toUpperCase();

            if (feesByCurrency.has(commissionSymbol)) {
              throw new Error(`Duplicate network commissions for currency ${describeValue(item.currencyCode)}`);
            }

            feesByCurrency.set(commissionSymbol, item.chainCommissions);
          }

          /** @type {Currencies} */
          const result = {};
          for (const [currencyIndex, item] of data.currencies.entries()) {
            const invalidFields = [];

            if (typeof item?.code !== 'string' || !/^[^\s/]+$/.test(item.code)) invalidFields.push('code');
            if (typeof item?.value !== 'string' || !item.value) invalidFields.push('value');
            if (typeof item?.isHalted !== 'boolean') invalidFields.push('isHalted');
            if (typeof item?.isFiat !== 'boolean') invalidFields.push('isFiat');
            if (typeof item?.isFuturesOnlyCurrency !== 'boolean') invalidFields.push('isFuturesOnlyCurrency');
            if (typeof item?.allowDeposits !== 'boolean') invalidFields.push('allowDeposits');
            if (typeof item?.allowWithdrawals !== 'boolean') invalidFields.push('allowWithdrawals');
            if (!Array.isArray(item?.currencyChains)) invalidFields.push('currencyChains');
            if (invalidFields.length) {
              throw new Error(`Invalid currency ${describeValue(item?.code)} at index ${currencyIndex} — invalid fields ${invalidFields.join(', ')}`);
            }

            const symbol = item.code.toUpperCase();
            const digits = integer(item.digits, 0, MAX_SUPPORTED_DECIMALS, `digits for currency ${describeValue(item.code)}`);

            if (result[symbol]) throw new Error(`Duplicate currency ${describeValue(item.code)} after normalization to ${describeValue(symbol)}`);

            const status = item.isHalted ? 'OFFLINE' : 'ONLINE';
            const depositStatus = !item.isHalted && item.allowDeposits ? 'ONLINE' : 'OFFLINE';
            const withdrawalStatus = !item.isHalted && item.allowWithdrawals ? 'ONLINE' : 'OFFLINE';
            const confirmations = item.networkConfirmations || null;
            const chainFees = feesByCurrency.get(symbol) || [];
            const seenChains = new Set();
            /** @type {Record<string, CurrencyNetwork>} */
            const networks = {};

            for (const [chainIndex, chain] of item.currencyChains.entries()) {
              const chainName = chain?.chainName || chain?.displayName;
              const chainId = integer(
                  chain?.chainId, 0, Number.MAX_SAFE_INTEGER,
                  `chainId for currency ${describeValue(symbol)} at chain index ${chainIndex}`,
              );

              if (!chainName) {
                throw new Error(`Invalid chain name for currency ${describeValue(symbol)} at chain index ${chainIndex}`);
              }
              if (seenChains.has(chainId)) {
                throw new Error(`Duplicate chain ID ${chainId} for currency ${describeValue(symbol)}`);
              }

              seenChains.add(chainId);

              const matchingFees = chainFees.filter((fee, feeIndex) => integer(
                  fee.chainId, 0, Number.MAX_SAFE_INTEGER,
                  `commission chainId for currency ${describeValue(symbol)} at index ${feeIndex}`,
              ) === chainId);

              if (matchingFees.length > 1) {
                throw new Error(`Duplicate chain commission for currency ${describeValue(symbol)}, chain ${describeValue(chainName)} (${chainId}) — found ${matchingFees.length}`);
              }

              const fee = matchingFees[0];
              let minimalWithdrawal = null;

              if (fee) {
                minimalWithdrawal = numeric(
                    fee.minimalWithdrawal, false,
                    `minimalWithdrawal for currency ${describeValue(symbol)}, chain ${describeValue(chainName)}`,
                );
                numeric(
                    fee.depositFee, false,
                    `depositFee for currency ${describeValue(symbol)}, chain ${describeValue(chainName)}`,
                );

                if (typeof fee.withdrawalFee !== 'string' || !/^(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(fee.withdrawalFee)) {
                  throw new Error(`Invalid withdrawalFee ${describeValue(fee.withdrawalFee)} for currency ${describeValue(symbol)}, chain ${describeValue(chainName)}`);
                }
              }

              const network = NETWORK_ALIASES[chainName] || chain.displayName || chainName;

              networks[network] = {
                symbol,
                status,
                depositStatus,
                withdrawalStatus,
                confirmations,
                withdrawalFee: fee ? (fee.withdrawalFee.endsWith('%') ? fee.withdrawalFee : Number(fee.withdrawalFee)) : null,
                withdrawalFeeCurrency: fee?.withdrawalFeeCurrency || symbol,
                minWithdrawal: minimalWithdrawal,
                maxWithdrawal: null,
                minDeposit: null,
                decimals: digits,
                precision: utils.getPrecision(digits),
                chainName: chain.displayName || chainName,
                chainNameFormatted: network,
                chainNamePlain: chainName,
                contractAddress: chain.contractAddress || null,
              };
            }

            const networkValues = Object.values(networks);
            result[symbol] = {
              symbol,
              name: item.value,
              type: item.isFiat ? 'fiat' : 'crypto',
              status,
              depositStatus,
              withdrawalStatus,
              comment: item.isFuturesOnlyCurrency ? 'Futures only' : null,
              confirmations,
              depositEnabled: item.allowDeposits,
              id: symbol,
              maxWithdraw: null,
              minWithdraw: networkValues.length === 1 ? networkValues[0].minWithdrawal : null,
              withdrawEnabled: item.allowWithdrawals,
              withdrawalFee: networkValues.length === 1 ? networkValues[0].withdrawalFee : null,
              withdrawalFeeCurrency: networkValues.length === 1 ? networkValues[0].withdrawalFeeCurrency : symbol,
              logoUrl: null,
              exchangeAddress: null,
              decimals: digits,
              precision: utils.getPrecision(digits),
              networks,
              defaultNetwork: networkValues.length === 1 ? Object.keys(networks)[0] : null,
            };
          }

          module.exports.exchangeCurrencies = result;

          return module.exports.exchangeCurrencies;
        }).finally(() => {
          module.exports.currenciesPromise = undefined;
        });
      }

      await module.exports.currenciesPromise;
    }

    return coin === undefined ? module.exports.exchangeCurrencies : currencyInfo(coin);
  }

  /**
   * Read cached currency metadata
   * @param {string} coin Currency code
   * @returns {Currency | undefined} Cached currency metadata
   */
  function currencyInfo(coin) {
    const currencies = module.exports.exchangeCurrencies;

    return typeof coin === 'string' && currencies ? currencies[coin.toUpperCase()] : undefined;
  }

  /**
   * Describe implemented capabilities, with unsupported account routing explicitly excluded
   * @returns Capability flags; processing delay is a measured sampling bound, not an exchange SLA
   */
  function features() {
    return {
      getMarkets: true,
      getCurrencies: true,
      getDepositAddress: true,
      supportCoinNetworks: true,
      createDepositAddressWithWebsiteOnly: false,
      getTradingFees: true,
      placeMarketOrder: false,
      allowAmountForMarketBuy: false,
      allowAmountForMarketSell: false,
      amountForMarketOrderNecessary: false,
      selfTradeProhibited: false,
      getFundHistory: true,
      getFundHistoryImplemented: false,
      supportTransferBetweenAccounts: false,
      accountTypes: ['unified'],
      tradingAccountType: 'unified',
      socketSupport: false,
      socketPullSupport: false,
      socketEnabled: false,
      getCandlesHistory: true,
      marketDataSource: 'candles',
      isDemo: false,
      // September 2026 live runs passed with no added sleep, including matches and concurrent cancellation.
      // Network RTT still applies; dontTrustApi and explicit reconciliation remain necessary.
      dontTrustApi: true,
      apiProcessingDelayMs: 0,
    };
  }

  /**
   * List actual UTA identities and margin metadata without summing them into spot funds
   * @returns {Promise<AzbitAccount[] | undefined>} Raw UTA records
   */
  async function getAccounts() {
    return read('getAccounts()', () => client.getAccounts(), (data) => {
      if (!Array.isArray(data)) {
        throw new Error(`Invalid UTA account list — expected an array, received ${describeValue(data)}`);
      }

      return data.map((account, index) => {
        const invalidFields = [];

        if (typeof account?.id !== 'string' || !UUID.test(account.id)) invalidFields.push('id');
        if (typeof account?.accountType !== 'string' || !account.accountType) invalidFields.push('accountType');
        if (typeof account?.currencyCode !== 'string' || !account.currencyCode) invalidFields.push('currencyCode');
        if (invalidFields.length) {
          throw new Error(`Invalid UTA account ${describeValue(account?.id)} at index ${index} — invalid fields ${invalidFields.join(', ')}`);
        }

        return {
          ...account,
          balance: numeric(account.balance, false, `balance for UTA account ${describeValue(account.id)}`),
          usedMargin: numeric(account.usedMargin, false, `usedMargin for UTA account ${describeValue(account.id)}`),
          blockedCopyTradingBalance: numeric(
              account.blockedCopyTradingBalance, false,
              `blockedCopyTradingBalance for UTA account ${describeValue(account.id)}`,
          ),
        };
      });
    });
  }

  /**
   * Read the main spot wallet, combining the union of available and order-blocked assets
   * REST does not expose a funding selector. Reject funding/sub-account requests instead of returning another wallet.
   * @param {boolean} [nonzero] Exclude assets with zero total
   * @param {string} [accountType] unified (default); spot/main are legacy aliases for the same main wallet
   * @returns {Promise<Balance[] | undefined>} Available, frozen and total balances
   */
  async function getBalances(nonzero = true, accountType = 'unified') {
    if (typeof nonzero !== 'boolean' || typeof accountType !== 'string' ||
      !['unified', 'spot', 'main'].includes(accountType.toLowerCase())) {
      log.warn(`trader_azbit.js getBalances(nonzero=${describeValue(nonzero)}, accountType=${describeValue(accountType)}) rejected — ` +
        'Azbit REST supports only the main spot/unified wallet');
      return undefined;
    }

    return read('getBalances()', () => client.getBalances(), (data) => {
      if (!data || !Array.isArray(data.balances) || !Array.isArray(data.balancesBlockedInOrder)) {
        throw new Error(`Invalid balance response — balances ${describeValue(data?.balances)}, balancesBlockedInOrder ${describeValue(data?.balancesBlockedInOrder)}`);
      }

      const result = new Map();

      for (const [field, items] of [['free', data.balances], ['freezed', data.balancesBlockedInOrder]]) {
        const seen = new Set();

        for (const [index, item] of /** @type {AzbitBalance[]} */ (items).entries()) {
          if (typeof item?.currencyCode !== 'string' || !item.currencyCode) {
            throw new Error(`Invalid currencyCode ${describeValue(item?.currencyCode)} in ${field} balance at index ${index}`);
          }
          const code = item.currencyCode.toUpperCase();

          if (seen.has(code)) throw new Error(`Duplicate ${field} balance for currency ${describeValue(code)}`);

          seen.add(code);

          const balance = result.get(code) || {
            code,
            free: 0,
            freezed: 0,
            total: 0,
            accountType: 'unified',
          };

          balance[/** @type {string} */ (field)] = numeric(
              item.amount, false, `${field} balance amount for currency ${describeValue(code)}`);
          result.set(code, balance);
        }
      }

      return [...result.values()].map((item) => ({ ...item, total: item.free + item.freezed }))
          .filter((item) => !nonzero || item.total > 0);
    });
  }

  /**
   * Read all active orders with one pair-scoped request
   * Malformed, terminal, duplicate and cross-pair rows invalidate the response. This deliberately rejects
   * the whole snapshot if an order becomes terminal during the read instead of manufacturing a false empty list.
   * @param {string} pair Pair to query
   * @returns {Promise<OpenOrder[] | undefined>} Validated active-order list or unavailable response
   */
  async function getOpenOrders(pair) {
    const market = marketInfo(pair);

    if (!market) return undefined;

    return read(`getOpenOrders(${market.pairReadable})`, () => client.getOrders(market.pairPlain, 'active'), (data) => {
      if (!Array.isArray(data)) {
        throw new Error(`Invalid active order list for ${describeValue(market.pairPlain)} — expected an array, received ${describeValue(data)}`);
      }

      const seen = new Set();

      return data.map((row) => {
        const order = normalizeOrder(row, market.pairPlain);
        const orderIdentity = order.orderId.toLowerCase();

        if (!ACTIVE_ORDER_STATUSES.has(order.status)) {
          throw new Error(`Active-order response contains ${order.status} order ${order.orderId}`);
        }

        if (seen.has(orderIdentity)) {
          throw new Error(`Active-order response contains duplicate order ${order.orderId}`);
        }

        seen.add(orderIdentity);
        terminalOrderIds.delete(orderIdentity);

        return {
          orderId: order.orderId,
          symbol: order.pairReadable,
          symbolPlain: order.pairPlain,
          price: order.price,
          side: order.side,
          type: 'limit',
          timestamp: order.timestamp,
          amount: order.amount,
          amountExecuted: order.amountExecuted,
          amountLeft: order.amount - order.amountExecuted,
          status: order.status,
        };
      });
    });
  }

  /**
   * Read and validate one order; only a definite not-found response becomes unknown
   * Azbit currently answers some missing GUIDs with a generic HTTP 400: that is unavailable evidence,
   * not proof of absence. Authentication, malformed payloads and server failures return undefined.
   * @param {string} orderId Exchange GUID; malformed IDs are unknown without a network request
   * @param {string} [pair] Expected pair; cross-pair responses are rejected
   * @returns {Promise<OrderDetails | undefined>} Five-state order details or unavailable evidence
   */
  async function getOrderDetails(orderId, pair) {
    if (typeof orderId !== 'string' || !UUID.test(orderId)) return { orderId, status: 'unknown' };

    const names = pair === undefined ? undefined : formatPairName(pair);

    if (pair !== undefined && !names) return undefined;

    return read(`getOrderDetails(${orderId})`, async () => {
      const data = await client.getOrderDeals(orderId);

      if (isError(data) && (data.httpStatus === 404 || data.logicError === 'OrderNotFound')) return { missing: true };

      return data;
    }, (data) => {
      if ('missing' in data) {
        rememberTerminalOrder(orderId);
        return { orderId, status: /** @type {const} */ ('unknown') };
      }

      const result = normalizeOrder(data, names?.pairPlain);

      if (result.orderId.toLowerCase() !== orderId.toLowerCase()) {
        throw new Error(`Order ID mismatch — requested ${describeValue(orderId)}, received ${describeValue(result.orderId)}`);
      }

      if (['filled', 'cancelled', 'unknown'].includes(result.status)) rememberTerminalOrder(orderId);
      else terminalOrderIds.delete(orderId.toLowerCase());

      return result;
    });
  }

  /**
   * Cancel one order with one exchange request on the normal path
   * Azbit may acknowledge an already-terminal order with succeeded:true, so a first-ever call cannot always
   * distinguish that race. Locally remembered terminal details and prior successful cancellations return false.
   * @param {string} orderId Exchange GUID
   * @param {string} [side] Unused compatibility parameter
   * @param {string} [pair] Optional logging context; not required by the endpoint
   * @returns {Promise<boolean | undefined>} true on acknowledgement, false on not-found, undefined on other failures
   */
  async function cancelOrder(orderId, side, pair) {
    if (typeof orderId !== 'string' || !UUID.test(orderId)) return false;

    if (terminalOrderIds.has(orderId.toLowerCase())) return false;

    return read(`cancelOrder(${orderId})`, async () => {
      const data = await client.cancelOrder(orderId);

      if (isError(data) && data.logicError === 'OrderNotFound') return { succeeded: false };

      return data;
    }, (data) => {
      if (!data || typeof data.succeeded !== 'boolean') {
        throw new Error(`Invalid cancellation acknowledgement for order ${describeValue(orderId)} — succeeded ${describeValue(data?.succeeded)}`);
      }

      rememberTerminalOrder(orderId);
      return data.succeeded;
    });
  }

  /**
   * Cancel every spot order on one validated pair through Azbit's bulk route
   * @param {string} pair Pair to cancel; omission never means all markets
   * @returns {Promise<boolean | undefined>} HTTP acknowledgement; query orders after processing delay to confirm visibility
   */
  async function cancelAllOrders(pair) {
    const market = marketInfo(pair);

    if (!market) return undefined;

    return read(`cancelAllOrders(${market.pairReadable})`, () => client.cancelAllOrders(market.pairPlain), (data) => {
      if (data !== true) {
        throw new Error(`Unexpected bulk cancellation response for ${describeValue(market.pairPlain)} — expected true, received ${describeValue(data)}`);
      }

      return true;
    });
  }

  /**
   * Place a validated limit order, truncating precision without exceeding the supplied quantity/budget
   * Current Azbit routes ignore the advertised isMarket property, so market orders remain disabled.
   * @param {'buy'|'sell'} side Order direction
   * @param {string} pair Pair to trade
   * @param {number} price Positive quote price
   * @param {number | null} [coin1Amount] Base quantity; takes precedence when both amounts are supplied
   * @param {number} [limit] Only 1 is supported; 0 (market) is rejected locally
   * @param {number | null} [coin2Amount] Quote budget, used only when base quantity is omitted
   * @returns {Promise<OrderPlacement | undefined>} Order ID/message or unavailable submission outcome
   */
  async function placeOrder(side, pair, price, coin1Amount, limit = 1, coin2Amount) {
    const market = marketInfo(pair);

    /**
     * Return a final placement rejection in the shape consumed by orderUtils and manual commands
     * @param {string} message User-facing explanation
     * @returns {OrderPlacement} Failed placement result
     */
    const rejectOrder = (message) => {
      log.warn(message);
      return { orderId: false, message };
    };

    if (!market) {
      return rejectOrder(`Unable to place an order on Azbit exchange. I don't have info about market ${pair}.`);
    }
    if (!['buy', 'sell'].includes(side)) {
      return rejectOrder(`Unable to place an order on Azbit exchange. Unsupported order side ${describeValue(side)}; expected "buy" or "sell".`);
    }
    if (limit !== 1) {
      return rejectOrder(`Unable to place an order on Azbit exchange. Unsupported limit flag ${describeValue(limit)}; Azbit supports limit orders only.`);
    }

    let normalizedPrice;
    try {
      normalizedPrice = utils.truncateDecimals(
          numeric(price, true, `order price for ${describeValue(market.pairPlain)}`), market.coin2Decimals);
    } catch {
      return rejectOrder(`Unable to place an order on Azbit exchange. Invalid order price ${describeValue(price)} for ${market.pairReadable}.`);
    }

    if (!normalizedPrice) {
      return rejectOrder(`Unable to place an order on Azbit exchange. After truncating to ${market.coin2Decimals} decimal places, ` +
        `the order price is ${normalizedPrice}; expected a positive value.`);
    }

    const usesQuoteAmount = coin1Amount === undefined || coin1Amount === null;
    let normalizedAmount;
    try {
      // Bot modules pass null for the amount they don't use, e.g. placeOrder(side, pair, price, coin1Amount, 1, null).
      // Only the quantity that actually sizes the order is validated; the unused one is neither read nor trusted.
      const amount = usesQuoteAmount ?
        numeric(coin2Amount, true, `order quote volume for ${describeValue(market.pairPlain)}`) / normalizedPrice :
        numeric(coin1Amount, true, `order base amount for ${describeValue(market.pairPlain)}`);
      normalizedAmount = utils.truncateDecimals(amount, market.coin1Decimals);
    } catch {
      const field = usesQuoteAmount ? 'volume' : 'amount';
      const value = usesQuoteAmount ? coin2Amount : coin1Amount;

      return rejectOrder(`Unable to place an order on Azbit exchange. Invalid order ${field} ${describeValue(value)} for ${market.pairReadable}.`);
    }

    if (!normalizedAmount) {
      return rejectOrder(`Unable to place an order on Azbit exchange. After truncating to ${market.coin1Decimals} decimal places, ` +
        `the order amount is ${normalizedAmount}; expected a positive value.`);
    }
    if (normalizedAmount < market.coin1MinAmount) {
      return rejectOrder(`Unable to place an order on Azbit exchange. Order amount ${normalizedAmount} ${market.coin1} is less than minimum ${market.coin1MinAmount} ${market.coin1} on ${market.pairReadable} pair.`);
    }

    const notional = utils.truncateDecimals(normalizedAmount * normalizedPrice, market.coin2Decimals);

    if (notional < market.coin2MinAmount) {
      return rejectOrder(`Unable to place an order on Azbit exchange. Order volume ${notional} ${market.coin2} is less than minimum ${market.coin2MinAmount} ${market.coin2} on ${market.pairReadable} pair.`);
    }

    const output = `${side} ${normalizedAmount} ${market.coin1} at ${normalizedPrice} ${market.coin2}`;
    let data;

    try {
      data = await client.addOrder(market.pairPlain, normalizedAmount, normalizedPrice, side);
    } catch (error) {
      log.warn(`trader_azbit.js placeOrder(${output}) request failed — ${errorMessage(error)}`);
      return undefined;
    }

    if (isError(data)) {
      return rejectOrder(`Unable to place order to ${output}. Exchange rejected the request — ` +
        `${utils.trimAny(data.azbitErrorInfo, ' .')}. Check parameters and balances.`);
    }
    if (!data || data.succeeded !== true || typeof data.data?.id !== 'string' || !UUID.test(data.data.id)) {
      return rejectOrder(`Unable to place order to ${output}. Invalid creation acknowledgement — ` +
        `succeeded ${describeValue(data?.succeeded)}, order ID ${describeValue(data?.data?.id)}.`);
    }

    const orderId = data.data.id;

    return {
      orderId,
      message: `Placed ${output}. Order Id: ${orderId}.`,
    };
  }

  /**
   * Read the rolling ticker; volume24h is quote turnover in the live API, contrary to its schema description
   * @param {string} pair Market pair
   * @returns {Promise<RatesResult | undefined>} Rates; base volume is a last-price estimate
   */
  async function getRates(pair) {
    const market = marketInfo(pair);

    if (!market) return undefined;

    return read(`getRates(${pair})`, () => client.ticker(market.pairPlain), (data) => {
      if (!Array.isArray(data) || data.length !== 1 || data[0]?.currencyPairCode !== market.pairPlain) {
        throw new Error(`Invalid ticker for ${describeValue(market.pairPlain)} — rows ${Array.isArray(data) ? data.length : describeValue(data)}, ` +
          `response pair ${describeValue(Array.isArray(data) ? data[0]?.currencyPairCode : undefined)}`);
      }

      const ticker = data[0];
      const last = numeric(ticker.price, true, `ticker price for ${describeValue(market.pairPlain)}`);
      const turnover = numeric(ticker.volume24h, false, `ticker volume24h for ${describeValue(market.pairPlain)}`);

      return {
        ask: numeric(ticker.askPrice, false, `ticker askPrice for ${describeValue(market.pairPlain)}`),
        bid: numeric(ticker.bidPrice, false, `ticker bidPrice for ${describeValue(market.pairPlain)}`),
        last,
        high: numeric(ticker.high24h, false, `ticker high24h for ${describeValue(market.pairPlain)}`),
        low: numeric(ticker.low24h, false, `ticker low24h for ${describeValue(market.pairPlain)}`),
        volume: turnover / last,
        volumeInCoin2: turnover,
      };
    });
  }

  /**
   * Read up to 40 levels per side; reject invalid sides and amounts
   * @param {string} pair Market pair
   * @param {number} [limit] Positive depth per side, capped by the exchange at 40
   * @returns {Promise<DepthResult | undefined>} Sorted bids and asks
   */
  async function getOrderBook(pair, limit = 40) {
    const market = marketInfo(pair);

    if (!market || !Number.isInteger(limit) || limit <= 0) return undefined;

    return read(`getOrderBook(${pair})`, () => client.orderBook(market.pairPlain), (data) => {
      if (!Array.isArray(data)) {
        throw new Error(`Invalid order book for ${describeValue(market.pairPlain)} — expected an array, received ${describeValue(data)}`);
      }

      const result = { bids: [], asks: [] };

      for (const [index, item] of data.entries()) {
        if (typeof item?.isBid !== 'boolean') {
          throw new Error(`Invalid order book side ${describeValue(item?.isBid)} for ${describeValue(market.pairPlain)} at index ${index}`);
        }

        result[item.isBid ? 'bids' : 'asks'].push({
          price: numeric(item.price, true, `order book price for ${describeValue(market.pairPlain)} at index ${index}`),
          amount: numeric(item.amount, true, `order book amount for ${describeValue(market.pairPlain)} at index ${index}`),
          count: 1,
          side: item.isBid ? 'buy' : 'sell',
        });
      }

      result.bids.sort((a, b) => b.price - a.price);
      result.asks.sort((a, b) => a.price - b.price);

      return {
        bids: result.bids.slice(0, limit),
        asks: result.asks.slice(0, limit),
      };
    });
  }

  /**
   * Read public trades in ascending time order
   * @param {string} pair Market pair
   * @param {number} [limit] 1–200 trades; larger requests are capped at 200
   * @returns {Promise<TradesResult | undefined>} Public market executions
   */
  async function getTradesHistory(pair, limit = 200) {
    const market = marketInfo(pair);

    if (!market || !Number.isInteger(limit) || limit <= 0) return undefined;

    return read(`getTradesHistory(${pair})`, () => client.getTradesHistory(market.pairPlain, Math.min(limit, 200)), (data) => {
      if (!Array.isArray(data)) {
        throw new Error(`Invalid public trade list for ${describeValue(market.pairPlain)} — expected an array, received ${describeValue(data)}`);
      }

      const result = data.map((item, index) => {
        if (typeof item?.isBuy !== 'boolean' || item.currencyPairCode !== market.pairPlain || typeof item.id !== 'string') {
          throw new Error(`Invalid public trade ${describeValue(item?.id)} at index ${index} — pair ${describeValue(item?.currencyPairCode)}, ` +
            `isBuy ${describeValue(item?.isBuy)}, expected pair ${describeValue(market.pairPlain)}`);
        }

        const price = numeric(item.price, true, `price for public trade ${describeValue(item.id)}`);
        const amount = numeric(item.volume, true, `volume for public trade ${describeValue(item.id)}`);

        return {
          coin1Amount: amount,
          coin2Amount: amount * price,
          price,
          date: utils.parseUtcTimestamp(item.dealDateUtc),
          side: item.isBuy ? /** @type {const} */ ('buy') : /** @type {const} */ ('sell'),
          tradeId: item.id,
        };
      });

      return result.sort((a, b) => a.date - b.date).slice(-limit);
    });
  }

  /**
   * Read native sparse OHLCV with server-side since filtering and exclusive close timestamps
   * Without since, request the latest limit intervals; gaps remain gaps. Empty intervals are never invented.
   * Azbit uses the previous close as open and may exclude it from min/max; include all four prices in the normalized range.
   * A zero-open artifact is repaired from the first public trade within that candle; unavailable or incomplete tape fails safely.
   * @param {string} pair Market pair
   * @param {string} timeframe 1m, 3m, 5m, 15m, 30m, 1h, 4h or 1d
   * @param {number} [since] Inclusive UTC epoch milliseconds; unsupported/invalid inputs fail locally
   * @param {number} [limit] Maximum 1–10000 candles, covering the bot's 30-day 5m analysis window
   * @param {boolean} [excludeLastPartialCandle] Drop any candle whose interval has not closed
   * @returns {Promise<Candles | undefined>} Native candles, oldest first, or unavailable evidence
   */
  async function getCandlesHistory(pair, timeframe, since, limit = 1000, excludeLastPartialCandle = true) {
    const market = marketInfo(pair);
    const entry = Object.hasOwn(TIMEFRAMES, timeframe) ? TIMEFRAMES[timeframe] : undefined;
    const now = Date.now();

    if (!market || !entry || !Number.isInteger(limit) || limit < 1 || limit > MAX_CANDLES ||
      typeof excludeLastPartialCandle !== 'boolean' || (since !== undefined &&
      (!Number.isSafeInteger(since) || since < 0 || since > now))) return undefined;

    const [interval, duration] = entry;
    const step = Number(duration);
    const start = since ?? Math.max(0, Math.floor(now / step) * step - limit * step);
    const end = since === undefined ? now : Math.min(now, start + limit * step);

    return read(`getCandlesHistory(${pair}, ${timeframe})`,
        async () => {
          const data = await client.getCandlesHistory(
              market.pairPlain, String(interval), new Date(start).toISOString(), new Date(end).toISOString());

          if (!Array.isArray(data)) return data;

          for (const [candleIndex, candle] of data.entries()) {
            if (numeric(candle?.open, false, `open for candle at index ${candleIndex}`) !== 0) continue;

            // Azbit sometimes emits a zero open for the first candle in a sparse range.
            // Recover the actual first trade rather than inventing a price or drawing a zero-price wick.
            const from = utils.parseUtcTimestamp(candle?.date);
            let earliest;
            let previousOldest = Infinity;

            // Page 21 is a sentinel: a full twentieth page may be the exact end of the interval.
            // Only another full page proves that the bounded recovery cannot verify the earliest trade.
            for (let page = 1; page <= 21; page++) {
              const trades = await client.getTradesHistory(market.pairPlain, 200, page,
                  new Date(from).toISOString(), new Date(from + step - 1).toISOString());

              if (!Array.isArray(trades)) {
                throw new Error(`Unable to recover zero-open candle ${describeValue(candle.date)} for ${describeValue(market.pairPlain)} — ` +
                  `trade page ${page} is ${describeValue(trades)}`);
              }

              for (const [tradeIndex, trade] of trades.entries()) {
                const time = utils.parseUtcTimestamp(trade?.dealDateUtc);

                if (trade?.currencyPairCode !== market.pairPlain || time < from || time >= from + step) {
                  throw new Error(`Invalid recovery trade ${describeValue(trade?.id)} at page ${page}, index ${tradeIndex} — ` +
                    `pair ${describeValue(trade?.currencyPairCode)}, time ${describeValue(trade?.dealDateUtc)}, ` +
                    `expected ${describeValue(market.pairPlain)} within ${new Date(from).toISOString()}–${new Date(from + step).toISOString()}`);
                }
                if (!earliest || time < earliest.time) {
                  earliest = {
                    time,
                    price: numeric(trade.price, true, `price for recovery trade ${describeValue(trade.id)}`),
                  };
                }
              }

              if (trades.length < 200) break;
              if (page === 21 || !earliest || earliest.time >= previousOldest) {
                throw new Error(`Incomplete candle trade pagination for ${describeValue(market.pairPlain)} at ${describeValue(candle.date)} — ` +
                  `page ${page}, earliest ${earliest ? new Date(earliest.time).toISOString() : 'missing'}, ` +
                  `previous oldest ${Number.isFinite(previousOldest) ? new Date(previousOldest).toISOString() : 'missing'}`);
              }

              previousOldest = earliest.time;
            }

            if (!earliest) {
              throw new Error(`Zero-open candle ${describeValue(candle.date)} for ${describeValue(market.pairPlain)} has no public trade in its interval`);
            }

            candle.open = earliest.price;
          }

          return data;
        },
        (data) => {
          if (!Array.isArray(data)) {
            throw new Error(`Invalid candle list for ${describeValue(market.pairPlain)} — expected an array, received ${describeValue(data)}`);
          }

          const seen = new Set();

          const result = data.map((item, index) => {
            const tsOpen = utils.parseUtcTimestamp(item?.date);

            if (seen.has(tsOpen)) {
              throw new Error(`Duplicate candle timestamp ${describeValue(item.date)} for ${describeValue(market.pairPlain)} at index ${index}`);
            }

            seen.add(tsOpen);

            const candleContext = `candle ${describeValue(item.date)} for ${describeValue(market.pairPlain)}`;
            const open = +numeric(item.open, true, `open for ${candleContext}`).toFixed(market.coin2Decimals);
            const close = +numeric(item.close, true, `close for ${candleContext}`).toFixed(market.coin2Decimals);
            const max = +numeric(item.max, true, `max for ${candleContext}`).toFixed(market.coin2Decimals);
            const min = +numeric(item.min, true, `min for ${candleContext}`).toFixed(market.coin2Decimals);

            if (min > max) throw new Error(`Reversed range for ${candleContext} — min ${min}, max ${max}`);

            const baseVolume = numeric(item.volume, false, `volume for ${candleContext}`);
            const quoteVolumeCalc = numeric(item.volumeBase, false, `volumeBase for ${candleContext}`);

            return {
              tsOpen,
              tsClose: tsOpen + step,
              date: new Date(tsOpen).toISOString(),
              open,
              close,
              high: Math.max(open, close, max),
              low: Math.min(open, close, min),
              baseVolume,
              quoteVolumeCalc,
              vwp: baseVolume ? quoteVolumeCalc / baseVolume : close,
              trades: null,
              source: /** @type {const} */ ('native'),
            };
          }).filter((item) => item.tsOpen >= start && item.tsOpen <= end &&
            (!excludeLastPartialCandle || item.tsClose <= now)).sort((a, b) => a.tsOpen - b.tsOpen);

          return since === undefined ? result.slice(-limit) : result.slice(0, limit);
        });
  }

  /**
   * Read deposit addresses and preserve memos; resolve numeric chain IDs through the public dictionary
   * @param {string} coin Currency code
   * @returns {Promise<Array<{network: string, address: string, memo?: string}> | undefined>} Available deposit destinations
   */
  async function getDepositAddress(coin) {
    if (typeof coin !== 'string' || !coin.trim()) return undefined;

    const requestedCoin = coin.trim();
    const currency = await getCurrencies(requestedCoin);
    const currencyCode = currency?.symbol || requestedCoin.toUpperCase();

    const chains = await read('getChains()', () => client.getChains(), (data) => {
      if (!Array.isArray(data)) {
        throw new Error(`Invalid chain dictionary — expected an array, received ${describeValue(data)}`);
      }

      return new Map(data.map((item, index) => {
        if (typeof item?.name !== 'string' || !item.name) {
          throw new Error(`Invalid chain name ${describeValue(item?.name)} at index ${index}`);
        }

        return [integer(item.code, 0, Number.MAX_SAFE_INTEGER, `chain code for ${describeValue(item.name)}`), item.name];
      }));
    });

    if (!chains) return undefined;

    return read(`getDepositAddress(${currencyCode})`, () => client.getDepositAddress(String(currencyCode)), (data) => {
      if (!Array.isArray(data)) {
        throw new Error(`Invalid deposit address list for ${describeValue(currencyCode)} — expected an array, received ${describeValue(data)}`);
      }

      return data.map((item, index) => {
        const chain = item?.chainName || chains.get(item?.chain);

        if (!chain || typeof item?.address !== 'string' || !item.address) {
          throw new Error(`Invalid deposit address for ${describeValue(currencyCode)} at index ${index} — ` +
            `chain ${describeValue(item?.chainName || item?.chain)}, address ${typeof item?.address === 'string' && item.address ? 'present' : 'missing'}`);
        }

        return {
          network: NETWORK_ALIASES[chain] || chain,
          address: item.address,
          memo: item.addressMemo || undefined,
        };
      });
    });
  }

  /**
   * Read the raw account-specific currency commission schedule for diagnostics and safe rate normalization
   * @returns {Promise<AzbitCommissions | undefined>} Exchange-native fee information
   */
  async function getCommissionInfo() {
    return read('getCommissionInfo()', () => client.getFees(), (data) => {
      const hasCommissions = data?.commissions !== null && data?.commissions !== undefined;

      if (!data || (hasCommissions && !Array.isArray(data.commissions)) || typeof data.userNoTradeCommissions !== 'boolean') {
        throw new Error(`Invalid fee response — commissions ${describeValue(data?.commissions)}, ` +
          `userNoTradeCommissions ${describeValue(data?.userNoTradeCommissions)}`);
      }

      const commissions = (data.commissions || []).map((fee, index) => {
        if (typeof fee?.currencyCode !== 'string' || !fee.currencyCode || typeof fee.commissionTypeCode !== 'string' ||
          !fee.commissionTypeCode) {
          throw new Error(`Invalid fee row at index ${index} — currencyCode ${describeValue(fee?.currencyCode)}, ` +
            `commissionTypeCode ${describeValue(fee?.commissionTypeCode)}`);
        }

        return {
          ...fee,
          percent: numeric(fee.percent, false, `percent for fee row ${index}, currency ${describeValue(fee.currencyCode)}`),
          minimum: numeric(fee.minimum, false, `minimum for fee row ${index}, currency ${describeValue(fee.currencyCode)}`),
        };
      });

      return {
        ...data,
        commissions: hasCommissions ? commissions : data.commissions,
      };
    });
  }

  /**
   * Normalize Azbit's buy/maker and sell/taker commission schedule
   * Azbit commission code 3 is the buy/maker rate and code 4 is the sell/taker rate.
   * @param {string} [coinOrPair] Requested fee scope
   * @returns {Promise<FeeRates | undefined>} Safe maker/taker-equivalent rates
   */
  async function getFees(coinOrPair) {
    if (typeof coinOrPair !== 'string' || !coinOrPair) return undefined;

    const [markets, info] = await Promise.all([getMarkets(), getCommissionInfo()]);

    if (!markets || !info) return undefined;

    const requestedPair = formatPairName(coinOrPair);
    const requestedCoin = requestedPair ? undefined : coinOrPair.toUpperCase();
    const selected = Object.values(markets).filter((market) => requestedPair ?
      market.pairPlain === requestedPair.pairPlain : market.coin1 === requestedCoin);

    if (!selected.length) return [];

    return selected.flatMap((market) => {
      if (info.userNoTradeCommissions) {
        return [{
          pair: market.pairPlain,
          makerRate: 0,
          takerRate: 0,
        }];
      }

      const rows = (info.commissions || []).filter((fee) => fee.currencyCode.toUpperCase() === market.coin1 &&
        ['3', '4'].includes(fee.commissionTypeCode));
      const buy = rows.filter((fee) => fee.commissionTypeCode === '3');
      const sell = rows.filter((fee) => fee.commissionTypeCode === '4');

      if (buy.length !== 1 || sell.length !== 1) {
        log.warn(`trader_azbit.js getFees(${market.pairPlain}) response incomplete — expected one buy/code-3 and one ` +
          `sell/code-4 commission row, received buy ${buy.length}, sell ${sell.length}, matching rows ${rows.length}`);
        return [];
      }

      return [{
        pair: market.pairPlain,
        makerRate: buy[0].percent / 100,
        takerRate: sell[0].percent / 100,
      }];
    });
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
    currenciesInfo: currencyInfo,
    features,
    getAccounts,
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
    getDepositAddress,
    getFees,
  };
};

/** @type {Markets | undefined} */
module.exports.exchangeMarkets = undefined;
/** @type {Promise<Markets | undefined> | undefined} */
module.exports.marketsPromise = undefined;
/** @type {Currencies | undefined} */
module.exports.exchangeCurrencies = undefined;
/** @type {Promise<Currencies | undefined> | undefined} */
module.exports.currenciesPromise = undefined;

/**
 * Recognize the low-level final-error envelope
 * @param {unknown} data Raw payload
 * @returns {data is AzbitError} Whether data is an exchange rejection
 */
function isError(data) {
  return !!data && typeof data === 'object' && 'azbitErrorInfo' in data;
}

/**
 * Format a scalar or payload shape for diagnostics without dumping full response objects
 * @param {unknown} value Value to describe
 * @returns {string} Bounded non-secret diagnostic text
 */
function describeValue(value) {
  if (typeof value === 'string') {
    const bounded = value.length > 120 ? value.slice(0, 117) + '...' : value;
    return JSON.stringify(bounded);
  }
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return `array(length ${value.length})`;

  return typeof value;
}

/**
 * Remove the redundant `Error:` prefix when embedding a caught exception in an already-labelled log line
 * @param {unknown} error Caught value
 * @returns {string} Error message or safe value description
 */
function errorMessage(error) {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ?
    error.message : describeValue(error);

  return message.length > 500 ? message.slice(0, 497) + '...' : message;
}

/**
 * Validate numeric Azbit fields, accepting finite decimal strings from legacy serializers
 * @param {unknown} value Raw numeric field
 * @param {boolean} [positive] Require strictly positive values
 * @param {string} [field] Field context for diagnostics
 * @returns {number} Finite nonnegative number
 */
function numeric(value, positive = false, field = 'numeric field') {
  const normalized = typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : value;

  if (typeof normalized !== 'number' || !Number.isFinite(normalized) ||
    (positive ? normalized <= 0 : normalized < 0)) {
    throw new Error(`Invalid ${field} — received ${describeValue(value)}, ` +
      `expected a finite ${positive ? 'positive' : 'nonnegative'} number`);
  }

  return normalized;
}

/**
 * Validate an integer field after applying the same numeric-string compatibility
 * @param {unknown} value Raw integer field
 * @param {number} [minimum] Inclusive lower bound
 * @param {number} [maximum] Inclusive upper bound
 * @param {string} [field] Field context for diagnostics
 * @returns {number} Validated integer
 */
function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER, field = 'integer field') {
  const normalized = numeric(value, false, field);

  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new Error(`Invalid ${field} — received ${describeValue(value)}, expected an integer from ${minimum} to ${maximum}`);
  }

  return normalized;
}

/**
 * Parse pair delimiters or resolve compact symbols through the actual market cache
 * @param {string} pair Pair supplied by caller or exchange
 * @returns {{pairPlain: string, pairReadable: string, coin1: string, coin2: string} | undefined} Pair names
 */
function formatPairName(pair) {
  if (typeof pair !== 'string') return undefined;

  const upper = pair.toUpperCase();
  const matches = Object.values(module.exports.exchangeMarkets || {}).filter((item) =>
    [item.pairPlain.toUpperCase(), item.pairReadable, item.coin1 + item.coin2].includes(upper));

  if (matches.length === 1) {
    const { pairPlain, pairReadable, coin1, coin2 } = matches[0];

    return {
      pairPlain,
      pairReadable,
      coin1,
      coin2,
    };
  }

  let parts = upper.split(upper.includes('/') ? '/' : upper.includes('_') ? '_' : '-');

  if (parts.length === 1) {
    if (matches.length !== 1) return undefined;

    parts = [matches[0].coin1, matches[0].coin2];
  }

  if (parts.length !== 2 || parts.some((part) => !/^[A-Z0-9][A-Z0-9.-]*$/.test(part))) return undefined;

  const [coin1, coin2] = parts;

  return {
    pairPlain: `${coin1}_${coin2}`,
    pairReadable: `${coin1}/${coin2}`,
    coin1,
    coin2,
  };
}

/**
 * Normalize an Azbit order with status/amount consistency checks shared by list and detail reads
 * @param {AzbitOrder} row Raw order; deprecated amount also includes the cancelled remainder after cancellation
 * @param {string} [expectedPair] Pair scope to enforce
 * @returns {OrderDetails} Validated order with cumulative execution and quote value
 */
function normalizeOrder(row, expectedPair) {
  const invalidFields = [];

  if (!row || typeof row.id !== 'string' || !UUID.test(row.id)) invalidFields.push('id');
  if (!row || typeof row.isBid !== 'boolean') invalidFields.push('isBid');
  if (!row || typeof row.isCanceled !== 'boolean') invalidFields.push('isCanceled');
  if (invalidFields.length) {
    throw new Error(`Invalid order ${describeValue(row?.id)} — invalid fields ${invalidFields.join(', ')}`);
  }

  const pair = formatPairName(row.currencyPairCode);

  if (!pair || expectedPair && pair.pairPlain !== expectedPair) {
    const expectation = expectedPair === undefined ? 'a valid native market pair' : describeValue(expectedPair);
    throw new Error(`Order pair mismatch for order ${describeValue(row.id)} — received ${describeValue(row.currencyPairCode)}, ` +
      `expected ${expectation}`);
  }

  const canceled = row.isCanceled || row.status === 'Canceled' || row.status === 'Cancelled';

  if (canceled && row.amountExecuted === undefined) {
    // The terminal state is reliable, but legacy amount includes the cancelled remainder and cannot prove a fill.
    // Return a final unknown result instead of a transient failure that fillsEngine would retry forever.
    return {
      orderId: row.id,
      pairPlain: pair.pairPlain,
      pairReadable: pair.pairReadable,
      status: 'unknown',
    };
  }

  const orderContext = `order ${describeValue(row.id)}`;
  const amount = numeric(row.initialAmount, true, `initialAmount for ${orderContext}`);
  const executed = numeric(
      row.amountExecuted === undefined ? row.amount : row.amountExecuted, false,
      `${row.amountExecuted === undefined ? 'legacy amount' : 'amountExecuted'} for ${orderContext}`,
  );
  const price = numeric(row.price, true, `price for ${orderContext}`);
  const remaining = row.remainingAmount === undefined ? undefined :
    numeric(row.remainingAmount, false, `remainingAmount for ${orderContext}`);

  // remainingAmount is the active remainder: cancellation sets it to zero even after a partial fill.
  if (executed > amount || remaining !== undefined &&
    !(canceled && remaining === 0) &&
    Math.abs(remaining - (amount - executed)) > Math.max(1e-10, amount * 1e-12)) {
    throw new Error(`Inconsistent execution amounts for ${orderContext} — initial ${amount}, executed ${executed}, ` +
      `remaining ${describeValue(remaining)}, canceled ${canceled}`);
  }

  /** @type {OrderStatus} */
  let status;

  if (canceled) status = 'cancelled';
  else if (row.status === 'Completed' && executed === amount) status = 'filled';
  else if (row.status === 'PartiallyCompleted' && executed > 0 && executed < amount) status = 'part_filled';
  else if (row.status === 'Created' && executed === 0) status = 'new';
  else throw new Error(`Unknown or inconsistent status ${describeValue(row.status)} for ${orderContext} — executed ${executed} of ${amount}`);

  let volumeExecuted = executed * price;
  let tradesCount = null;

  if (row.deals !== undefined) {
    if (!Array.isArray(row.deals)) {
      throw new Error(`Invalid deals for ${orderContext} — expected an array, received ${describeValue(row.deals)}`);
    }

    if (row.deals.length) {
      let fillAmount = 0;
      let fillQuote = 0;

      for (const [index, deal] of row.deals.entries()) {
        if (deal.currencyPairCode !== pair.pairPlain) {
          throw new Error(`Fill pair mismatch for ${orderContext} at deal index ${index} — received ` +
            `${describeValue(deal.currencyPairCode)}, expected ${describeValue(pair.pairPlain)}`);
        }

        const volume = numeric(deal.volume, true, `volume for ${orderContext}, deal index ${index}`);

        fillAmount += volume;
        fillQuote += volume * numeric(deal.price, true, `price for ${orderContext}, deal index ${index}`);
      }

      if (Math.abs(fillAmount - executed) <= Math.max(1e-10, amount * 1e-12)) {
        volumeExecuted = fillQuote;
        tradesCount = row.deals.length;
      }
    } else if (executed === 0) tradesCount = 0;
  }

  return {
    orderId: row.id,
    pairPlain: pair.pairPlain,
    pairReadable: pair.pairReadable,
    price,
    amount,
    amountExecuted: executed,
    volume: numeric(row.quoteAmount, false, `quoteAmount for ${orderContext}`),
    volumeExecuted,
    side: row.isBid ? 'buy' : 'sell',
    type: 'limit',
    timestamp: utils.parseUtcTimestamp(row.date),
    status,
    tradesCount,
  };
}
