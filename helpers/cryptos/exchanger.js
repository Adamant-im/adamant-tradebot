'use strict';

/**
 * Crypto rate lookup, conversion, and market-making volume helpers.
 *
 * Rates are fetched from the ADAMANT Infoservice and cached in memory.
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
 */

/** @type {import('axios').AxiosInstance} */
// @ts-ignore axios is a callable instance
const axios = require('axios');

const moduleId = /** @type {NodeJS.Module} */ (module).id;
const moduleName = utils.getModuleName(moduleId);

log.log(`Module ${moduleName} is loaded.`);

/** @type {ExchangerModule} */
const exchanger = {
  /** @type {CryptoRatesMap | undefined} */
  currencies: undefined,
  markets: {},

  /**
   * Fetches global crypto rates from Infoservice and stores them in `this.currencies`.
   *
   * @returns {Promise<void>}
   */
  async updateCryptoRates() {
    const url = `${config.infoservice}/get`;

    try {
      const response = await axios.get(url, {});
      const rates = response.data?.result;

      if (rates) {
        this.currencies = rates;
        log.debug(`${moduleName}/updateCryptoRates: Updated crypto rates (${Object.keys(rates).length} pairs) from ${url}.`);
        return;
      }

      log.warn(`${moduleName}/updateCryptoRates: Request to ${url} succeeded but returned no rates.`);
    } catch (error) {
      const axiosError = /** @type {import('axios').AxiosError} */ (error);
      log.warn(`${moduleName}/updateCryptoRates: Request to ${url} failed with ${axiosError?.response?.status ?? 'no'} status code, ${String(error)}${axiosError?.response?.data ? '. Message: ' + String(axiosError.response.data).trim() : ''}.`);
    }
  },

  /**
   * Returns the price of one unit of `from` expressed in `to`.
   * Example: `getRate('ADM', 'USDT')` may return `0.03` for 1 ADM = 0.03 USDT.
   *
   * Resolution order:
   * 1. Direct ticker `from/to`
   * 2. Reverse ticker `to/from`
   * 3. Cross-rate via `/USD` prices
   *
   * @param {string} from Source currency symbol, e.g. `ADM`
   * @param {string} to Target currency symbol, e.g. `USDT`
   * @returns {number | undefined} Exchange rate, `1` for identical currencies, or `undefined` when unavailable
   */
  getRate(from, to) {
    try {
      if (!from || !to) return;
      if (from === to) return 1; // 1 USDT = 1 USDT

      let price = this.currencies?.[from + '/' + to] || 1 / this.currencies?.[to + '/' + from];

      if (!price) {
        // No direct or reverse ticker — derive the rate from USD quotes.
        const priceFrom = this.currencies?.[from + '/USD'];
        const priceTo = this.currencies?.[to + '/USD'];
        price = priceFrom / priceTo;
      }

      if (!price && !config.isDemoAccount) {
        // Be quite
        // log.warn(`Unable to calculate the ${from} price in ${to}. CurrencyInfo likely does not provide rates for one of these currencies.`);
        return;
      }

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
   * Checks whether Infoservice exposes at least one ticker containing the coin.
   *
   * @param {string} coin Currency symbol, e.g. `ADM`
   * @returns {boolean}
   */
  hasTicker(coin) {
    // Object.keys().toString() yields `KEY1,KEY2,...`, so we can search for `,COIN/` or `/COIN`.
    const pairs = Object.keys(this.currencies || {}).toString();
    return pairs.includes(',' + coin + '/') || pairs.includes('/' + coin);
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
