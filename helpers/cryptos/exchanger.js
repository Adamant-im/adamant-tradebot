'use strict';

/**
 * Crypto rate lookup, conversion, and market-making volume helpers.
 *
 * Rates are fetched from the ADAMANT Infoservice and cached in memory.
 * Missing configured coins can use a separate exchange spot ticker fallback.
 * The module also parses extended pair strings and estimates MM trade volumes.
 *
 * @module helpers/cryptos/exchanger
 */

const config = require('../../modules/configReader');
const tradeParams = require('../../trade/settings/tradeParams_' + config.exchange);
const orderUtils = require('../../trade/orderUtils');
const log = require('../log');
const constants = require('../const');
const utils = require('../utils');

/**
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/exchanger.d.js').CryptoRatesMap} CryptoRatesMap
 * @typedef {import('types/bot/exchanger.d.js').ConvertCryptosResult} ConvertCryptosResult
 * @typedef {import('types/bot/exchanger.d.js').ParsedPairInfo} ParsedPairInfo
 * @typedef {import('types/bot/exchanger.d.js').Coin1VolumeEstimate} Coin1VolumeEstimate
 * @typedef {import('types/bot/exchanger.d.js').ExchangerModule} ExchangerModule
 * @typedef {import('types/bot/exchanger.d.js').FallbackRateInfo} FallbackRateInfo
 * @typedef {import('types/rates.d.js').RatesResult} RatesResult
 */

/** @type {import('axios').AxiosInstance} */
// @ts-ignore axios is a callable instance
const axios = require('axios');

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

log.log(`Module ${moduleName} is loaded.`);

// Fallback data must remain separate from the authoritative Infoservice snapshot.
const fallbackConfig = config.coin_price_fallback;
let infoserviceConfirmed = false;
/** @type {boolean | undefined} */
let baseMissing;
let quoteMissing = false;
let fallbackGeneration = 0;
let spotMarketChecked = false;
let spotMarketUnavailable = false;
/** @type {'request' | 'ticker' | 'metadata' | 'timeout' | undefined} */
let fallbackFailure;
const STARTUP_RATES_TIMEOUT_MS = 15_000;
const FALLBACK_REFRESH_TIMEOUT_MS = constants.UPDATE_CRYPTO_RATES_INTERVAL;
const FALLBACK_STALE_MS = 5 * constants.MINUTE;
let staleFallbackWarned = false;
const fallbackState = {
  active: false,
  pairPrice: undefined,
  ratesTs: 0,
  priceSource: undefined,
};
/** @type {Promise<void> | undefined} */
let ratesUpdatePromise;
/** @type {Promise<void> | undefined} */
let infoserviceUpdatePromise;
/** @type {Promise<void> | undefined} */
let fallbackUpdatePromise;
/** @type {Promise<void> | undefined} */
let startupSyncPromise;

/**
 * Checks exact pair components, including the first map key, without symbol-prefix matches.
 *
 * @param {string} coin Currency symbol
 * @returns {boolean} Whether Infoservice lists a valid ticker containing the coin
 */
function hasInfoserviceTicker(coin) {
  return Object.entries(exchanger.currencies || {}).some(([pair, rate]) =>
    utils.isPositiveNumber(rate) && pair.split('/').includes(coin));
}

/**
 * Resolves a USD price using only Infoservice, without invoking fallback recursively.
 *
 * @param {string} coin Currency symbol
 * @returns {number | undefined} Positive finite USD rate when available
 */
function getInfoserviceUsdRate(coin) {
  if (coin === 'USD') return 1;

  const direct = exchanger.currencies?.[`${coin}/USD`];
  if (utils.isPositiveNumber(direct)) return direct;

  const reverse = exchanger.currencies?.[`USD/${coin}`];
  if (utils.isPositiveNumber(reverse) && utils.isPositiveNumber(1 / reverse)) return 1 / reverse;
}

/**
 * Returns the configured quote's USD price, with stablecoin parity as a last resort.
 *
 * @returns {number | undefined} USD price of one quote coin
 */
function getQuoteUsdRate() {
  return getInfoserviceUsdRate(config.coin2) ?? (utils.isStableCoin(config.coin2) ? 1 : undefined);
}

/**
 * Extracts the configured ticker price, using mid when last is unavailable.
 *
 * @param {RatesResult | undefined} rates Normalized spot ticker
 * @returns {number | undefined} Positive finite pair price
 */
function getTickerPrice(rates) {
  if (!rates) return;

  const source = fallbackConfig.priceSource;
  if (source !== 'mid' && utils.isPositiveNumber(rates[source])) return rates[source];

  if ((source === 'last' || source === 'mid') &&
      utils.isPositiveNumber(rates.bid) && utils.isPositiveNumber(rates.ask)) {
    // Halving first also avoids overflow for large finite prices.
    const mid = rates.bid / 2 + rates.ask / 2;
    if (utils.isPositiveNumber(mid)) return mid;
  }
}

/**
 * Accepts a valid ticker without discarding the previous observation on failure.
 *
 * @param {RatesResult | undefined} rates Normalized spot ticker
 * @param {number} timestamp Observation timestamp from the shared cache
 * @returns {boolean} Whether the ticker supplied a usable USD price
 */
function applyFallbackTicker(rates, timestamp) {
  const pairPrice = getTickerPrice(rates);
  if (!utils.isPositiveNumber(pairPrice) || !utils.isPositiveNumber(pairPrice * getQuoteUsdRate())) return false;

  const firstPrice = !utils.isPositiveNumber(fallbackState.pairPrice);
  const fresh = Date.now() >= timestamp && Date.now() - timestamp < FALLBACK_STALE_MS;
  const recovered = Boolean(fallbackFailure) || (staleFallbackWarned && fresh);
  fallbackState.pairPrice = pairPrice;
  fallbackState.ratesTs = timestamp;
  fallbackState.priceSource = fallbackConfig.priceSource === 'last' && !utils.isPositiveNumber(rates.last) ?
    'mid' : fallbackConfig.priceSource;
  fallbackFailure = undefined;
  if (fresh) staleFallbackWarned = false;

  if (firstPrice || recovered) {
    log.info(`${moduleName}/applyFallbackTicker: ${recovered ? 'Recovered exchange ticker pricing. ' : ''}Using ${config.exchangeName} ${config.pair} ${fallbackState.priceSource} ${utils.toFixedMeaningful(pairPrice)} (~${utils.toFixedMeaningful(pairPrice * getQuoteUsdRate())} USD) as the ${config.coin1} price until Infoservice provides its USD rate.`);
  }
  warnIfFallbackStale();
  return true;
}

/**
 * Warns once when retained fallback pricing is older than five minutes.
 * Fresh observations reset the warning, while failures keep the original timestamp.
 *
 * @returns {void}
 */
function warnIfFallbackStale() {
  if (!fallbackState.active || !utils.isPositiveNumber(fallbackState.pairPrice) || staleFallbackWarned) return;

  if (Date.now() - fallbackState.ratesTs >= FALLBACK_STALE_MS) {
    staleFallbackWarned = true;
    log.warn(`${moduleName}/warnIfFallbackStale: The ${config.coin1} fallback price from ${config.exchangeName} ${config.pair} was last updated ${utils.timeAgoString(fallbackState.ratesTs)} (at least 5 minutes old). Continuing to use the last valid observation while refreshes retry.`);
  }
}

/**
 * Updates fallback eligibility and logs availability changes once per transition.
 * Called only after a confirmed, non-empty Infoservice response.
 *
 * @returns {void}
 */
function updateFallbackAvailability() {
  const missing = getInfoserviceUsdRate(config.coin1) === undefined;

  if (missing && baseMissing !== true) {
    log.warn(`${moduleName}/updateCryptoRates: Infoservice has no USD rate for ${config.coin1}. Exchange ticker fallback is ${fallbackConfig.enabled ? 'enabled' : 'disabled'}.`);
  } else if (!missing && baseMissing === true) {
    log.info(`${moduleName}/updateCryptoRates: Infoservice now provides a USD rate for ${config.coin1}; recovered Infoservice pricing${fallbackState.active ? ' and deactivated exchange ticker fallback' : ''}.`);
  }
  baseMissing = missing;

  const missingQuote = missing && fallbackConfig.enabled && !utils.isPositiveNumber(getQuoteUsdRate());
  if (missingQuote && !quoteMissing) {
    log.warn(`${moduleName}/updateCryptoRates: Infoservice has no USD rate for non-stable quote ${config.coin2}; ${config.pair} fallback remains inactive.`);
  }
  if (quoteMissing && !missingQuote && missing && fallbackConfig.enabled && !spotMarketUnavailable) {
    log.info(`${moduleName}/updateCryptoRates: Infoservice recovered the ${config.coin2}/USD quote rate; ${config.pair} exchange ticker fallback is eligible again.`);
  }
  quoteMissing = missingQuote;
  const active = missing && fallbackConfig.enabled && !missingQuote && !spotMarketUnavailable;
  if (active !== fallbackState.active) fallbackGeneration++;
  fallbackState.active = active;

  if (!active) {
    fallbackState.pairPrice = undefined;
    fallbackState.ratesTs = 0;
    fallbackState.priceSource = undefined;
    fallbackFailure = undefined;
    staleFallbackWarned = false;
  }
}

/**
 * Checks authoritative spot metadata once when the connector exposes it.
 * Missing or failed metadata loads remain retryable, rather than declaring a market absent.
 *
 * @param {AbortSignal} signal Refresh cancellation signal
 * @returns {Promise<boolean>} Whether spot fallback can attempt a ticker request
 */
async function checkFallbackSpotMarket(signal) {
  if (spotMarketUnavailable) return false;
  if (spotMarketChecked) return true;

  const market = orderUtils.parseMarket(config.pair, undefined, true);
  if (!market) return true;
  if (!market.marketInfoSupported) {
    spotMarketChecked = true;
    return true;
  }

  const api = market.exchangeApi;
  if (typeof api?.getMarkets !== 'function' || typeof api?.marketInfo !== 'function') return true;

  const markets = await api.getMarkets();
  if (signal.aborted) return false;
  if (!markets || typeof markets !== 'object' || Array.isArray(markets) || !Object.keys(markets).length) {
    reportFallbackFailure('metadata', `Spot market metadata unavailable for ${config.pair} on ${config.exchangeName}; retrying on the next refresh.`);
    return false;
  }

  const marketInfo = await api.marketInfo(config.pair);
  if (signal.aborted) return false;
  spotMarketChecked = true;
  if (marketInfo) return true;

  spotMarketUnavailable = true;
  updateFallbackAvailability();
  log.warn(`${moduleName}/checkFallbackSpotMarket: ${config.exchangeName} does not list spot market ${config.pair}; exchange ticker fallback is inactive until restart. Perpetual tickers are not substituted for spot prices.`);
  return false;
}

/**
 * Logs fallback failures once per failure category until a valid observation recovers pricing.
 *
 * @param {'request' | 'ticker' | 'metadata' | 'timeout'} kind Refresh failure category
 * @param {string} details Request error or rejected ticker values
 * @returns {void}
 */
function reportFallbackFailure(kind, details) {
  if (fallbackFailure === kind) return;
  fallbackFailure = kind;
  log.warn(`${moduleName}/refreshFallbackRate: ${details} Retaining the previous fallback rate if available.`);
}

/**
 * Bounds metadata and ticker refreshes to one update interval, allowing later attempts to retry.
 * Canceled results cannot change pricing, market eligibility, or the shared ticker cache.
 *
 * @returns {Promise<void>}
 */
function refreshFallbackRate() {
  if (fallbackUpdatePromise) return fallbackUpdatePromise;
  const generation = fallbackGeneration;
  const controller = new AbortController();
  const { signal } = controller;
  let timer;

  const work = (async () => {
    try {
      if (!await checkFallbackSpotMarket(signal) || signal.aborted ||
          !fallbackState.active || generation !== fallbackGeneration) return;

      const rates = await orderUtils.getRatesCached(config.pair, 'exchanger', false, fallbackConfig.cacheMs, signal);
      if (signal.aborted || !fallbackState.active || generation !== fallbackGeneration) return;

      if (rates === undefined) {
        reportFallbackFailure('request', `Ticker request for ${config.pair} on ${config.exchangeName} failed.`);
        return;
      }

      const cached = orderUtils.peekCachedMarket(config.pair, fallbackConfig.cacheMs);
      const observation = cached.rates ?? rates;
      if (!applyFallbackTicker(observation, cached.ratesTs ?? Date.now())) {
        reportFallbackFailure('ticker', `Unusable ${fallbackConfig.priceSource} ticker for ${config.pair} on ${config.exchangeName}: last=${observation.last}, bid=${observation.bid}, ask=${observation.ask}.`);
      }
    } catch (error) {
      if (!signal.aborted && fallbackState.active && generation === fallbackGeneration) {
        reportFallbackFailure('request', `Ticker refresh for ${config.pair} on ${config.exchangeName} failed. ${error}`);
      }
    }
  })();
  /** @type {Promise<void>} */
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      if (fallbackState.active && generation === fallbackGeneration) {
        reportFallbackFailure('timeout', `Fallback refresh for ${config.pair} on ${config.exchangeName} exceeded ${FALLBACK_REFRESH_TIMEOUT_MS} ms; retrying on a later refresh.`);
      }
      warnIfFallbackStale();
      resolve();
    }, FALLBACK_REFRESH_TIMEOUT_MS);
  });

  fallbackUpdatePromise = Promise.race([work, deadline]).finally(() => {
    clearTimeout(timer);
    fallbackUpdatePromise = undefined;
  });

  return fallbackUpdatePromise;
}

/**
 * Resolves USD rates synchronously and picks up newer tickers between periodic refreshes.
 *
 * @param {string} coin Currency symbol
 * @returns {number | undefined} Positive finite USD price
 */
function getUsdRate(coin) {
  const infoserviceRate = getInfoserviceUsdRate(coin);
  if (infoserviceRate !== undefined) return infoserviceRate;

  if (!infoserviceConfirmed || !fallbackConfig.enabled) return;

  if (coin === config.coin1 && fallbackState.active) {
    const cached = orderUtils.peekCachedMarket(config.pair, fallbackConfig.cacheMs);
    if (cached.ratesTs > fallbackState.ratesTs) {
      applyFallbackTicker(cached.rates, cached.ratesTs);
    }

    warnIfFallbackStale();
    const usdRate = fallbackState.pairPrice * getQuoteUsdRate();
    if (utils.isPositiveNumber(usdRate)) return usdRate;
  }

  if (utils.isStableCoin(coin)) {
    const isFallbackQuote = coin === config.coin2 && fallbackState.active;
    if (isFallbackQuote || !hasInfoserviceTicker(coin)) return 1;
  }
}

/** @type {ExchangerModule} */
const exchanger = {
  /** @type {CryptoRatesMap | undefined} */
  currencies: undefined,
  markets: {},

  /**
   * Refreshes Infoservice and eligible exchange fallback rates with in-flight deduplication.
   * Invalid or failed Infoservice responses retain the last confirmed availability state.
   *
   * @returns {Promise<void>}
   */
  updateCryptoRates() {
    if (infoserviceUpdatePromise) return ratesUpdatePromise;

    infoserviceUpdatePromise = (async () => {
      const url = `${config.infoservice}/get`;

      try {
        const response = await axios.get(url, { timeout: 10_000 });
        const rates = response.data?.result;
        const plainObject = rates && typeof rates === 'object' &&
          (Object.getPrototypeOf(rates) === Object.prototype || Object.getPrototypeOf(rates) === null);

        if (response.data?.success !== false && plainObject && Object.keys(rates).length > 0) {
          this.currencies = rates;
          infoserviceConfirmed = true;
          updateFallbackAvailability();
          log.debug(`${moduleName}/updateCryptoRates: Updated crypto rates (${Object.keys(rates).length} pairs) from ${url}.`);
        } else {
          log.warn(`${moduleName}/updateCryptoRates: Request to ${url} returned unsuccessful or empty rates.`);
        }
      } catch (error) {
        const axiosError = /** @type {import('axios').AxiosError} */ (error);
        log.warn(`${moduleName}/updateCryptoRates: Request to ${url} failed with ${axiosError?.response?.status ?? 'no'} status code, ${String(error)}${axiosError?.response?.data ? '. Message: ' + String(axiosError.response.data).trim() : ''}.`);
      }
    })().finally(() => {
      infoserviceUpdatePromise = undefined;
    });

    ratesUpdatePromise = infoserviceUpdatePromise.then(async () => {
      warnIfFallbackStale();
      if (fallbackState.active && !fallbackUpdatePromise) await refreshFallbackRate();
    });
    return ratesUpdatePromise;
  },

  /**
   * Waits for the initial Infoservice request and retries an unpopulated fallback after
   * connector metadata warmup. Startup waits at most 15 seconds; background updates continue.
   * Repeated startup calls share the same synchronization.
   *
   * @returns {Promise<void>}
   */
  syncStartupRates() {
    if (!startupSyncPromise) {
      const syncWork = (async () => {
        await ratesUpdatePromise;
        if (fallbackState.active && !utils.isPositiveNumber(fallbackState.pairPrice)) {
          await refreshFallbackRate();
        }
      })();
      let timer;
      /** @type {Promise<void>} */
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
          log.warn(`${moduleName}/syncStartupRates: Rate synchronization exceeded ${STARTUP_RATES_TIMEOUT_MS} ms; starting modules with available rates. Background refreshes continue.`);
          resolve();
        }, STARTUP_RATES_TIMEOUT_MS);
      });
      startupSyncPromise = Promise.race([syncWork, deadline]).finally(() => clearTimeout(timer));
    }

    return startupSyncPromise;
  },

  /**
   * Reports the source and USD price of an active fallback without modifying Infoservice data.
   *
   * @param {string} coin Currency symbol
   * @returns {FallbackRateInfo | undefined} Exchange observation or stablecoin parity assumption
   */
  getFallbackRateInfo(coin) {
    const usdRate = getUsdRate(coin);
    if (!utils.isPositiveNumber(usdRate) || getInfoserviceUsdRate(coin) !== undefined) return;

    if (coin === config.coin1 && fallbackState.active && utils.isPositiveNumber(fallbackState.pairPrice)) {
      return {
        source: 'exchange',
        usdRate,
        pair: config.pair,
        exchange: config.exchangeName,
        priceSource: fallbackState.priceSource,
        timestamp: fallbackState.ratesTs,
      };
    }

    if (infoserviceConfirmed && fallbackConfig.enabled && utils.isStableCoin(coin)) {
      return { source: 'stablecoin', usdRate };
    }
  },

  /**
   * Returns the price of one unit of `from` expressed in `to`.
   * Example: `getRate('ADM', 'USDT')` may return `0.03` for 1 ADM = 0.03 USDT.
   *
   * Resolution order:
   * 1. Direct ticker `from/to`
   * 2. Reverse ticker `to/from`
   * 3. Cross-rate via Infoservice USD prices or eligible exchange/stablecoin fallback
   *
   * @param {string} from Source currency symbol, e.g. `ADM`
   * @param {string} to Target currency symbol, e.g. `USDT`
   * @returns {number | undefined} Exchange rate, `1` for identical currencies, or `undefined` when unavailable
   */
  getRate(from, to) {
    try {
      if (!from || !to) return;
      if (from === to) return 1; // 1 USDT = 1 USDT

      const direct = this.currencies?.[`${from}/${to}`];
      if (utils.isPositiveNumber(direct)) return direct;

      const reverse = this.currencies?.[`${to}/${from}`];
      if (utils.isPositiveNumber(reverse) && utils.isPositiveNumber(1 / reverse)) return 1 / reverse;

      const price = getUsdRate(from) / getUsdRate(to);
      if (!utils.isPositiveNumber(price)) return;

      return price;
    } catch (e) {
      log.error(`${moduleName}/getRate: Unable to calculate the ${from} price in ${to}. ${e}`);
    }
  },

  /**
   * Converts an amount from one cryptocurrency into another.
   *
   * @param {string} from Source currency symbol
   * @param {string} to Target currency symbol
   * @param {number} [amount=1] Amount of the source currency
   * @param {boolean} [considerExchangerFee=false] Whether to deduct exchanger fees (ADAMANT Exchanger bot)
   * @param {number} [specificRate] Optional override rate instead of the global Infoservice rate
   * @param {boolean} [validateSpecificRate=true] Whether to reject overrides that differ too much from the global rate
   * @returns {ConvertCryptosResult}
   */
  convertCryptos(from, to, amount = 1, considerExchangerFee = false, specificRate, validateSpecificRate = true) {
    const ALLOWED_GLOBAL_RATE_DIFFERENCE_PERCENT = 20;

    try {
      from = from.toUpperCase();
      to = to.toUpperCase();

      let rate = this.getRate(from, to);

      if (utils.isPositiveNumber(specificRate)) {
        if (validateSpecificRate) {
          const rateDifferencePercent = utils.numbersDifferencePercent(rate, specificRate);

          if (rateDifferencePercent > ALLOWED_GLOBAL_RATE_DIFFERENCE_PERCENT) {
            log.warn(`${moduleName}/convertCryptos: Specific ${from}/${to} rate ${specificRate} differs too much from the global rate ${rate} (${rateDifferencePercent.toFixed(2)}%). Refusing to convert.`);

            return {
              outAmount: NaN,
              exchangePrice: NaN,
            };
          }
        }

        rate = specificRate;
      }

      let networkFee = 0;
      if (considerExchangerFee) {
        rate *= 1 - config['exchange_fee_' + from] / 100;
        networkFee = this[to].FEE;
        if (typeof this.isERC20 === 'function' && this.isERC20(to)) {
          networkFee = this.convertCryptos('ETH', to, networkFee).outAmount;
        }
      }

      const value = rate * amount - networkFee;

      return {
        outAmount: value,
        exchangePrice: rate,
      };
    } catch (e) {
      log.error(`${moduleName}/convertCryptos: Unable to convert ${amount} ${from} into ${to}. ${e}`);

      return {
        outAmount: NaN,
        exchangePrice: NaN,
      };
    }
  },

  /**
   * Checks whether a currency symbol is treated as fiat by Infoservice helpers.
   *
   * @param {string} coin Currency symbol
   * @returns {boolean}
   */
  isFiat(coin) {
    return ['USD', 'RUB', 'EUR', 'CNY', 'JPY', 'KRW'].includes(coin);
  },

  /**
   * Checks exact Infoservice symbols and usable exchange/stablecoin fallback rates.
   *
   * @param {string} coin Currency symbol, e.g. `ADM`
   * @returns {boolean}
   */
  hasTicker(coin) {
    return coin === 'USD' || hasInfoserviceTicker(coin) || Boolean(this.getFallbackRateInfo(coin));
  },

  /**
   * Parses a pair string that may also include exchange, account, and project suffixes.
   *
   * Supported examples:
   * - `ADM/USDT`
   * - `ADM/USDT@Bittrex`
   * - `ADM/USDT@Bittrex-acc1`
   * - `ADM/USDT@Bittrex-acc1 TradeBot`
   * - `ADM/USDT@Bittrex-acc1+TradeBot`
   *
   * @param {string} pair Full pair string
   * @returns {ParsedPairInfo}
   */
  parsePair(pair) {
    let baseCoin; let quoteCoin; let exchange; let account; let project;

    if (pair.includes(' ')) {
      [pair, project] = pair.split(' ');
    } else if (pair.includes('+')) {
      [pair, project] = pair.split('+');
    }

    if (pair.includes('-')) {
      [pair, account] = pair.split('-');
    }

    if (pair.includes('@')) {
      [pair, exchange] = pair.split('@');
    }

    if (pair.includes('_')) {
      [baseCoin, quoteCoin] = pair.split('_');
    } else if (pair.includes('/')) {
      [baseCoin, quoteCoin] = pair.split('/');
    }

    return {
      pair,
      baseCoin,
      quoteCoin,
      exchange,
      account,
      project,
    };
  },

  /**
   * Estimates the current daily market-making volume from trade params.
   *
   * Uses the midpoint of min/max amount and min/max interval, then converts
   * the resulting coin1 volume into several reference currencies.
   *
   * @param {number} [maxAmount] Optional override for `tradeParams.mm_maxAmount`
   * @returns {Coin1VolumeEstimate | undefined}
   */
  estimateCurrentDailyTradeVolume(maxAmount) {
    try {
      maxAmount = maxAmount || tradeParams.mm_maxAmount;

      const midAmount = (tradeParams.mm_minAmount + maxAmount) / 2;
      const midInterval = (tradeParams.mm_minInterval + tradeParams.mm_maxInterval) / 2;
      const dailyTrades = constants.DAY / midInterval;
      const dailyVolumeCoin1 = midAmount * dailyTrades;

      return this.calcCoin1AmountInOtherCoins(dailyVolumeCoin1);
    } catch (e) {
      log.error(`${moduleName}/estimateCurrentDailyTradeVolume: ${e}`);
    }
  },

  /**
   * Converts a coin1 amount into coin1, coin2, USD, USDT, and BTC equivalents.
   *
   * @param {number} coin1Amount Amount in the configured base coin
   * @returns {Coin1VolumeEstimate | undefined}
   */
  calcCoin1AmountInOtherCoins(coin1Amount) {
    try {
      return {
        coin1: coin1Amount,
        coin2: this.convertCryptos(config.coin1, config.coin2, coin1Amount).outAmount,
        USD: this.convertCryptos(config.coin1, 'USD', coin1Amount).outAmount,
        USDT: this.convertCryptos(config.coin1, 'USDT', coin1Amount).outAmount,
        BTC: this.convertCryptos(config.coin1, 'BTC', coin1Amount).outAmount,
      };
    } catch (e) {
      log.error(`${moduleName}/calcCoin1AmountInOtherCoins: ${e}`);
    }
  },

  /**
   * Calculates `mm_maxAmount` from a target daily coin1 volume.
   *
   * `mm_minInterval`, `mm_maxInterval`, and `mm_minAmount` are kept unchanged.
   *
   * @param {number} dailyVolumeCoin1 Target daily volume in coin1
   * @returns {number | undefined} New `tradeParams.mm_maxAmount`, or `undefined` when invalid
   */
  calcMaxAmountFromDailyTradeVolume(dailyVolumeCoin1) {
    try {
      const midInterval = (tradeParams.mm_minInterval + tradeParams.mm_maxInterval) / 2;
      const dailyTrades = constants.DAY / midInterval;
      const new_mm_maxAmount = (2 * dailyVolumeCoin1 / dailyTrades) - tradeParams.mm_minAmount;
      return utils.isPositiveNumber(new_mm_maxAmount) ? new_mm_maxAmount : undefined;
    } catch (e) {
      log.error(`${moduleName}/calcMaxAmountFromDailyTradeVolume: ${e}`);
    }
  },

  /**
   * Builds a human-readable volume change string.
   *
   * Example: `from 1 366.33663366 ADM (100 USDT) to 3 445.54455446 ADM (300 USDT)`.
   * Uses default trading pair/contract
   *
   * @param {Coin1VolumeEstimate} oldVolume Volume before the update
   * @param {Coin1VolumeEstimate} newVolume Volume after the update
   * @returns {string | undefined}
   */
  getVolumeChangeInfoString(oldVolume, newVolume) {
    try {
      return `from ${this.getVolumeInfoString(oldVolume)} to ${this.getVolumeInfoString(newVolume)}`;
    } catch (e) {
      log.error(`${moduleName}/getVolumeChangeInfoString: ${e}`);
    }
  },

  /**
   * Builds a human-readable volume string for the configured default pair.
   *
   * @param {Coin1VolumeEstimate} volume Volume estimate in coin1 and coin2
   * @returns {string | undefined}
   */
  getVolumeInfoString(volume) {
    const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(config.defaultPair));
    const { coin1, coin2, coin1Decimals, coin2DecimalsForStable } = formattedPair;

    try {
      return `${utils.formatNumber(volume.coin1.toFixed(coin1Decimals), true)} ${coin1} (${utils.formatNumber(volume.coin2.toFixed(coin2DecimalsForStable), true)} ${coin2})`;
    } catch (e) {
      log.error(`${moduleName}/getVolumeInfoString: ${e}`);
    }
  },
};

module.exports = exchanger;

module.exports.updateCryptoRates();

setInterval(() => {
  module.exports.updateCryptoRates();
}, constants.UPDATE_CRYPTO_RATES_INTERVAL);
