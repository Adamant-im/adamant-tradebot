const config = require('../../modules/configReader');
const log = require('../../helpers/log');
const traderapi = require('../trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);

module.exports = {
  readableModuleName: 'Api-Test',

  run() {
    this.iteration();
  },

  async iteration() {
    console.log('Test is runned!');
    const ob = await traderapi.getOrderBook('DOGE/USD');
    console.log('ob: ' + ob);
  }
}
