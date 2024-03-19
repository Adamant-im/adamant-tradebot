const config = require('../../modules/configReader');
const tradeParams = require('../../trade/settings/tradeParams_' + config.exchange);
const orderUtils = require('../../trade/orderUtils');
const log = require('../log');
const constants = require('../const');
const utils = require('../utils');
const axios = require('axios');
const adm_utils = require('./adm_utils');

module.exports = {

  currencies: undefined,
  markets: {},

  /**
   * Fetches global crypto rates from InfoService
   * And stores them in this.currencies
   */
  async updateCryptoRates() {
    const url = config.infoservice + '/get';
    const rates = await axios.get(url, {})
        .then((response) => {
          return response.data ? response.data.result : undefined;
        })
        .catch((error) => {
          log.warn(`Unable to fetch crypto rates in updateCryptoRates() of ${utils.getModuleName(module.id)} module. Request to ${url} failed with ${error.response ? error.response.status : undefined} status code, ${error.toString()}${error.response && error.response.data ? '. Message: ' + error.response.data.toString().trim() : ''}.`);
        });

    if (rates) {
      this.currencies = rates;
    } else {
      log.warn(`Unable to fetch crypto rates in updateCryptoRates() of ${utils.getModuleName(module.id)} module. Request was successful, but got unexpected results: ` + rates);
    }
  },

  /**
   * Returns rate for from/to
   * @param {String} from Like 'ADM'
   * @param {String} to Like 'ETH'
   * @return {Number} or NaN or undefined
   */
  getRate(from, to) {
    try {
      if (from && to && from === to) return 1; // 1 USD = 1 USD
      let price = this.currencies[from + '/' + to] || 1 / this.currencies[to + '/' + from];
      if (!price) {
        // We don't have direct or reverse rate, calculate it from /USD rates
        const priceFrom = this.currencies[from + '/USD'];
        const priceTo = this.currencies[to + '/USD'];
        price = priceFrom / priceTo;
      }
      return price;
    } catch (e) {
      log.error(`Unable to calculate price of ${from} in ${to} in getPrice() of ${utils.getModuleName(module.id)} module: ` + e);
    }
  },

  /**
   * Returns value of amount 'from' currency in 'to' currency
   * @param {String} from Like 'ADM'
   * @param {String} to Like 'ETH'
   * @param {Number} amount Amount of 'from' currency
   * @param {Boolean} considerExchangerFee If false, do direct market calculation.
      * If true, deduct the exchanger's and blockchain fees
   * @return {Number|Number} or { NaN, NaN }
   */
  convertCryptos(from, to, amount = 1, considerExchangerFee = false, specificRate) {
    try {
      const ALLOWED_GLOBAL_RATE_DIFFERENCE_PERCENT = 20;
      from = from.toUpperCase();
      to = to.toUpperCase();
      let rate = this.getRate(from, to);
      if (utils.isPositiveNumber(specificRate)) {
        const rateDifferencePercent = utils.numbersDifferencePercent(rate, specificRate);
        if (rateDifferencePercent > ALLOWED_GLOBAL_RATE_DIFFERENCE_PERCENT) {
          log.warn(`Specific and calculated ${from}/${to} rates differs too much: ${specificRate.toFixed(8)} and ${rate.toFixed(8)} (${rateDifferencePercent.toFixed(2)}%). Refusing to convert.`);
          return {
            outAmount: NaN,
            exchangePrice: NaN,
          };
        }
        rate = specificRate;
      }
      let networkFee = 0;
      if (considerExchangerFee) {
        rate *= 1 - config['exchange_fee_' + from] / 100;
        networkFee = this[to].FEE;
        if (this.isERC20(to)) {
          networkFee = this.convertCryptos('ETH', to, networkFee).outAmount;
        }
      }
      const value = rate * +amount - networkFee;
      return {
        outAmount: +value.toFixed(constants.PRECISION_DECIMALS),
        exchangePrice: +rate.toFixed(constants.PRECISION_DECIMALS),
      };
    } catch (e) {
      log.error(`Unable to calculate ${amount} ${from} in ${to} in convertCryptos() of ${utils.getModuleName(module.id)} module: ` + e);
      return {
        outAmount: NaN,
        exchangePrice: NaN,
      };
    }
  },

  isFiat(coin) {
    return ['USD', 'RUB', 'EUR', 'CNY', 'JPY', 'KRW'].includes(coin);
  },

  /**
   * Returns if coin has ticker like COIN/OTHERCOIN or OTHERCOIN/COIN in InfoService
   * @param {String} coin Like 'ADM'
   * @return {Boolean}
   */
  hasTicker(coin) {
    const pairs = Object.keys(this.currencies).toString();
    return pairs.includes(',' + coin + '/') || pairs.includes('/' + coin);
  },

  /**
   * Parses a pair, exchange, account and project name from full pair string
   * @param {string} pair A pair or a pair with an exchange, account and project name.
   * Examples:
   *   - ADM/USDT
   *   - ADM/USDT@Bittrex
   *   - ADM/USDT@Bittrex-acc1
   *   - ADM/USDT@Bittrex-acc1 TradeBot
   *   - ADM/USDT@Bittrex-acc1+TradeBot
   * @return {Object}
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
   * Estimates daily mm trading volume according to tradeParams
   * @param maxAmount If to override tradeParams.mm_maxAmount
   * @return {Object} Estimate mm trade volume in coin1, coin2, USD, USDT and BTC
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
      log.error(`Error in estimateCurrentDailyTradeVolume() of ${utils.getModuleName(module.id)} module: ` + e);
    }
  },

  /**
   * Calculates coin1 amount in coin1, coin2, USD, USDT and BTC
   * @param coin1Amount Amount in coin1
   * @return {Object}
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
      log.error(`Error in calcCoin1AmountInOtherCoins() of ${utils.getModuleName(module.id)} module: ` + e);
    }
  },

  /**
   * Calculates mm_maxAmount from mm trade volume.
   * mm_minInterval, mm_maxInterval and mm_minAmount will stay the same
   * @return {Number} New tradeParams.mm_maxAmount
   */
  calcMaxAmountFromDailyTradeVolume(dailyVolumeCoin1) {
    try {
      const midInterval = (tradeParams.mm_minInterval + tradeParams.mm_maxInterval) / 2;
      const dailyTrades = constants.DAY / midInterval;
      const new_mm_maxAmount = (2 * dailyVolumeCoin1 / dailyTrades) - tradeParams.mm_minAmount;
      return utils.isPositiveNumber(new_mm_maxAmount) ? new_mm_maxAmount : undefined;
    } catch (e) {
      log.error(`Error in calcMaxAmountFromDailyTradeVolume() of ${utils.getModuleName(module.id)} module: ` + e);
    }
  },

  /**
   * Creates volume change infoString
   * @return {String}
   */
  getVolumeChangeInfoString(oldVolume, newVolume) {
    try {
      const coin1Decimals = orderUtils.parseMarket(config.pair).coin1Decimals;
      const coin2Decimals = orderUtils.parseMarket(config.pair).coin2Decimals;

      let infoString = `from ${utils.formatNumber(oldVolume.coin1.toFixed(coin1Decimals), true)} ${config.coin1} (${utils.formatNumber(oldVolume.coin2.toFixed(coin2Decimals), true)} ${config.coin2})`;
      infoString += ` to ${utils.formatNumber(newVolume.coin1.toFixed(coin1Decimals), true)} ${config.coin1} (${utils.formatNumber(newVolume.coin2.toFixed(coin2Decimals), true)} ${config.coin2})`;

      return infoString;
    } catch (e) {
      log.error(`Error in getVolumeChangeInfoString() of ${utils.getModuleName(module.id)} module: ` + e);
    }
  },

  ADM: new adm_utils(),
};

module.exports.updateCryptoRates();

setInterval(() => {
  module.exports.updateCryptoRates();
}, constants.UPDATE_CRYPTO_RATES_INTERVAL);
