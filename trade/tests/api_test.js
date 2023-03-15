const config = require('../../modules/configReader');
const log = require('../../helpers/log');
const traderapi = require('../trader_' + config.exchange)(config.apikey, config.apisecret, config.apipassword, log);

async function isOrderOpen(pair, orderId) {
  let result = false;
  const orders = await traderapi.getOpenOrders(pair);
  console.log('orders: ' + JSON.stringify(orders));
  orders.forEach((order) => {
    console.log('order.orderId: ' + order.orderId + ' orderId: ' + orderId);
    if (order.orderId === orderId) {
      console.log('equal');
      result = true;
    }
  });
  return result;
}


module.exports = {
  readableModuleName: 'Api-Test',

  run() {
    this.iteration();
  },



  async iteration() {
    console.log('Test is runned!');

    const balances = await traderapi.getBalances();
    console.log('balances: ' + JSON.stringify(balances));

    const pair_azbit = 'DOGE_USDT';
    const pair_readable = pair_azbit.replace('_', '/');
    /*
      Placing order, check in open and delete
      orderType, pair, price, coin1amount
     */
    const order = await traderapi.placeOrder('buy', pair_readable, 0.05, 200);
    if (order?.orderId !== undefined) {
      console.log('Placed orderId: ' + order.orderId);
      while (! await isOrderOpen(pair_azbit, order.orderId)) {
        await new Promise(r => setTimeout(r, 1000));
      }
      const cancelOr = await traderapi.cancelOrder(order.orderId);
      console.log('cancelOr: ' + JSON.stringify(cancelOr));
    }
    /*

    const markets = traderapi.marketInfo('DOGE/USDT');
    console.log('markets: ' + JSON.stringify(markets));
    */

    /*
    const orders = await traderapi.getOpenOrders('DOGE_USDT');
    console.log('orders: ' + JSON.stringify(orders));
    */


    /*


    */

    /*
    const cancelOr = await traderapi.cancelOrder('4b288d92-c1d3-4d4e-8f50-afdd274f4246');
    console.log('cancelOr: ' + JSON.stringify(cancelOr));*/
    /*

    const cancelAll = await traderapi.cancelAllOrders(pair_azbit);
    console.log('cancelAll: ' + cancelAll);



    // Ticker
    const rates = await traderapi.getRates('ETH_BTC');
    console.log('rates: ' + JSON.stringify(rates));

    const ob = await traderapi.getOrderBook('ETH_BTC');
    console.log('ob: ' + JSON.stringify(ob));

    const history = await traderapi.getTradesHistory('ETH_BTC');
    console.log('thistory: ' + JSON.stringify(history));

    const deposit_addr = await traderapi.getDepositAddress('ETH');
    console.log('deposit_addr: ' + JSON.stringify(deposit_addr));

    const fees = await traderapi.getFees();
    console.log('fees: ' + JSON.stringify(fees));

    const curr = await traderapi.getCurrencies();
    console.log('currencies: ' + JSON.stringify(curr));

*/

  },
};
