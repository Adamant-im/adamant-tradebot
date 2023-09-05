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
          .then(([currencies, currenciesWithNetworks]) => {
            try {
              const result = {};

              const netowrksByCurrency = currenciesWithNetworks.list.reduce((acc, data) => {
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
                  networks: netowrksByCurrency,
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
};
/**
 * Returns network name in classic format
 * @param {String} network
 * @returns {String}
 */
function formatNetworkName(network) {
  return networks[network?.toUpperCase()]?.code ?? network;
}
