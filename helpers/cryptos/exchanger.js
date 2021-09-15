const config = require('../../modules/configReader');
const log = require('../log');
const constants = require('../const');
const utils = require('../utils');
const adm_utils = require('./adm_utils');

module.exports = {

  currencies: undefined,

  /**
   * Returns rate for from/to
   * @param {String} from Like 'ADM'
   * @param {String} to Like 'ETH'
   * @return {Number} or NaN or undefined
   */
  getRate(from, to) {
    try {
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
  convertCryptos(from, to, amount = 1, considerExchangerFee = false) {
    try {
      from = from.toUpperCase();
      to = to.toUpperCase();
      let rate = this.getRate(from, to);
      let networkFee = 0;
      if (considerExchangerFee) {
        rate *= 1 - config['exchange_fee_' + from] / 100;
        networkFee = this[to].FEE;
        if (this.isERC20(to)) {
          networkFee = this.convertCryptos('ETH', to, networkFee).outAmount;
        }
      };
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

  ADM: new adm_utils(),
};

module.exports.updateCryptoRates();

setInterval(() => {
  module.exports.updateCryptoRates();
}, constants.UPDATE_CRYPTO_RATES_INVERVAL);
