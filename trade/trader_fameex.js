const FameEXApi = require('./api/fameex_api');
const utils = require('../helpers/utils');
const networks = require('../helpers/cryptos/networks');

/**
 * API endpoints:
 * https://api.fameex.com
 */
const apiServer = 'https://api.fameex.com';
const exchangeName = 'FameEX';

module.exports = (
    apiKey,
    secretKey,
    pwd,
    log,
    publicOnly = false,
    loadMarket = true,
) => {
  const fameEXApiClient = FameEXApi();
  fameEXApiClient.setConfig(apiServer, apiKey, secretKey, pwd, log, publicOnly);

  // Fulfill markets and currencies on initialization
  if (loadMarket) {
    getCurrencies();
    getMarkets();
  }

  /**
   * Get info on all currencies
   * @param {String} coin
   * @param {Boolean} forceUpdate Update currencies to refresh parameters
   * @returns {Promise<unknown>|*}
   */
  function getCurrencies(coin, forceUpdate = false) {
    if (module.exports.gettingCurrencies) return;
    if (module.exports.exchangeCurrencies && !forceUpdate) return module.exports.exchangeCurrencies[coin];

    module.exports.gettingCurrencies = true;

    return new Promise((resolve) => {
      Promise.all([
        fameEXApiClient.currencies(),
        fameEXApiClient.currenciesWithNetwork(),
      ])
          .then(([currenciesData, currenciesWithNetworks]) => {
            try {
              const result = {};

              const currencies = currenciesData.data;

              const networksByCurrency = currenciesWithNetworks.data.list.reduce((acc, data) => {
                const currencyNetworks = Object.keys(data.currencyDetail).map(formatNetworkName);

                return acc.set(data.currency.toUpperCase(), currencyNetworks);
              }, new Map());

              for (const coin in currencies) {
                // Returned data is not full and doesn't include decimals, precision, min amounts, etc
                const currency = currencies[coin];

                result[currency.name.toUpperCase()] = {
                  symbol: currency.name.toUpperCase(),
                  name: currency.name.toUpperCase(),
                  status: undefined,
                  comment: undefined,
                  confirmations: undefined,
                  withdrawalFee: undefined,
                  minWithdraw: +currency.min_withdraw,
                  maxWithdraw: +currency.max_withdraw,
                  logoUrl: undefined,
                  exchangeAddress: undefined,
                  decimals: undefined,
                  precision: undefined,
                  networks: networksByCurrency.get(currency.name.toUpperCase()),
                  defaultNetwork: undefined,
                  withdrawEnabled: currency.can_withdraw,
                  depositEnabled: currency.can_deposit,
                  id: currency.unified_cryptoasset_id,
                };
              }

              if (Object.keys(result).length > 0) {
                module.exports.exchangeCurrencies = result;
                log.log(`${forceUpdate ? 'Updated' : 'Received'} info about ${Object.keys(result).length} currencies on ${exchangeName} exchange.`);
              }

              module.exports.gettingCurrencies = false;
              resolve(result);
            } catch (error) {
              log.warn(`Error while processing getCurrencies() request: ${error}`);
              resolve(undefined);
            }
          }).catch((error) => {
            log.warn(`API request getCurrencies() of ${utils.getModuleName(module.id)} module failed. ${error}`);
            resolve(undefined);
          }).finally(() => {
            module.exports.gettingCurrencies = false;
          });
    });
  }

  /**
   * Get info on all markets
   * @param {String} pair In classic format as BTC/USDT. If markets are already cached, get info for the pair.
   * @returns {Promise<unknown>|*}
   */
  function getMarkets(pair) {
    const paramString = `pair: ${pair}`;

    if (module.exports.gettingMarkets) return;
    if (module.exports.exchangeMarkets) return module.exports.exchangeMarkets[pair];

    module.exports.gettingMarkets = true;

    return new Promise((resolve) => {
      fameEXApiClient.markets().then((markets) => {
        try {
          const result = markets.data.reduce((acc, market) => {
            const pair = deformatPairName(market.pair);

            acc[pair.pairReadable] = {
              pairReadable: pair.pairReadable,
              pairPlain: pair.pairPlain,
              coin1: pair.coin1,
              coin2: pair.coin2,
              coin1Decimals: market.amountPrecision,
              coin2Decimals: market.pricePrecision,
              coin1Precision: utils.getPrecision(market.amountPrecision),
              coin2Precision: utils.getPrecision(market.pricePrecision),
              coin1MinAmount: null,
              coin1MaxAmount: null,
              coin2MinPrice: null,
              coin2MaxPrice: null,
              minTrade: null,
              status: null,
            };

            return acc;
          }, {});

          if (Object.keys(result).length > 0) {
            module.exports.exchangeMarkets = result;
            log.log(`Received info about ${Object.keys(result).length} markets on ${exchangeName} exchange.`);
          }

          module.exports.gettingMarkets = false;
          resolve(result);
        } catch (error) {
          log.warn(`Error while processing getMarkets(${paramString}) request: ${error}`);
          resolve(undefined);
        }
      }).catch((error) => {
        log.warn(`API request getMarkets() of ${utils.getModuleName(module.id)} module failed. ${error}`);
        resolve(undefined);
      }).finally(() => {
        module.exports.gettingMarkets = false;
      });
    });
  }
};
/**
 * Returns network name in classic format
 * @param {String} network
 * @returns {String}
 */
function formatNetworkName(network) {
  return networks[network?.toUpperCase()]?.code ?? network;
}

/**
 * Returns pair in classic format like BTC/USDT
 * @param pair Pair in FameEX format BTC_USDT or BTC-USDT or BTC/USDT
 * @returns {Object}
 */
function deformatPairName(pair) {
  pair = pair?.toUpperCase();
  const [coin1, coin2] = pair.split(/[\-\_\/]/);

  return {
    pair: `${coin1}/${coin2}`,
    pairReadable: `${coin1}/${coin2}`,
    pairPlain: `${coin1}_${coin2}`,
    coin1,
    coin2,
  };
}
