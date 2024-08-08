
const utils = require('../../helpers/utils');
const config = require('../../modules/configReader');
const log = require('../../helpers/log');

module.exports = {
  readableModuleName: 'Manual tests',

  async test_general() {
    // console.log('==');
    // console.log('========================== Testing general features');
    // console.log('==');

    // const db = require('../../modules/DB');
    // const { ordersDb } = db;
    // const order = await ordersDb.findOne({
    //   _id: 'orderId',
    // });

    // const orderUtils = require('../orderUtils');
    // setTimeout(() => {
    //   const traderapi = require('../trader_' + 'azbit')(config.apikey, config.apisecret, config.apipassword, log);
    //   console.log(orderUtils.parseMarket('ADM/USDT', 'azbit'));
    // }, 3000);
  },

  async test_spot() {
    console.log('==');
    console.log('========================== Testing SPOT API');
    console.log('==');

    const traderapi = require('../trader_' + config.exchange)(
      config.apikey,
      config.apisecret,
      config.apipassword,
      log,
      undefined,
      undefined,
      config.exchange_socket,
      config.exchange_socket_pull,
    );
    
    // const traderapi2 = require('../trader_azbit')(
    //   config.apikey,
    //   config.apisecret,
    //   config.apipassword,
    //   log,
    //   undefined,
    //   undefined,
    //   config.exchange_socket,
    //   config.exchange_socket_pull,
    // );

    // Testing exchange markets, pairs and features
    // ==

    // console.log(await traderapi.markets);
    // console.log(await traderapi.currencies);
    // console.log(await traderapi.marketInfo('ADM/USDT'));
    // console.log(await traderapi.currencyInfo('KCS'));
    // console.log(await traderapi.features());

    // Testing getRates, getOrderBook, getTradesHistory
    // ==

    // console.log(await traderapi.getRates('KCS/BTC'));
    // console.log(await traderapi.getRates('ADM/BTC'));

    // const ob = await traderapi.getOrderBook('KCS/USDT');
    // console.log(ob);

    // const req = await traderapi.getTradesHistory('kcs/btc');
    // console.log(req);


    // Testing placing orders and receiving order details
    // ==

    // console.log(await traderapi.placeOrder('sell', 'KCS/BTC', null, 1, 0));

    // For testing part_filled orders, we place two orders in a spread
    // ETH/USDT is an example, but it is not the best choice as this pair generally has many trades and price changes often
    // The first order is 'ask'; we sell ETH for 20 USDT. The second is 'bid'; we buy ETH for 15 USDT.
    // Expected result: The first one is part_filled (total: 20 USDT, filled: 15 USDT), and the second one is filled (total: 15 USDT, filled: 15 USDT).
    // Ensure you have enough both amount and quote coin balances

    // const testOrderPrice = 3501.11; // Setting a limit price, assuming the current highest bid and lowest ask are 3500–3505. Adjust it according to the current price to place an order in the spread.
    // const testOrderMarket = 'ETH/USDT';

    // const partFilledOrder = await traderapi.placeOrder('sell', testOrderMarket, testOrderPrice, undefined, 1, 20);
    // const filledOrder2 = await traderapi.placeOrder('buy', testOrderMarket, testOrderPrice, undefined, 1, 15);
    
    // console.log(await traderapi.getOpenOrders(testOrderMarket));

    // console.log(await traderapi.getOrderDetails(partFilledOrder.orderId, testOrderMarket)); // Details for the part_filled order
    // console.log(await traderapi.getOrderDetails(filledOrder2.orderId, testOrderMarket)); // Details for the filled order

    // Testing getting non-existent order details
    // ==

    // console.log(await traderapi.getOrderDetails(119354495120, testOrderMarket));
    // console.log(await traderapi.getOrderDetails('119353984789', testOrderMarket));
    // console.log(await traderapi.getOrderDetails('65707c1285a72b0007ee2cbd2', testOrderMarket));
    // console.log(await traderapi.getOrderDetails('123-any-order-number', testOrderMarket));
    // console.log(await traderapi.getOrderDetails(undefined, testOrderMarket));

    // Testing getting specific order details
    // ==

    // console.log(await traderapi.getOrderDetails('65708f9e011c360007ad8129', testOrderMarket));

    // Testing canceling an order by ID
    // ==

    // const orderCollector = require('../orderCollector');
    // const cancellation = await orderCollector.clearOrderById(
    //     'order id', config.pair, undefined, 'Testing', 'Sample reason', undefined, traderapi);
    // console.log(cancellation);

    // Testing canceling an order by ID
    // ==

    // console.log(await traderapi.cancelOrder('12609cf4-fca5-43ed-b0ea-b40fb48d3b0d', undefined, testOrderMarket));
    // console.log(await traderapi.cancelOrder('ODM54B-5CJUX-RSUKCK', undefined, testOrderMarket));
    // console.log(await traderapi.cancelOrder(119354495120, undefined, testOrderMarket));
    // console.log(await traderapi.cancelOrder('119354495120', undefined, testOrderMarket));
    // console.log(await traderapi.cancelOrder(undefined, undefined, testOrderMarket));

    // console.log(await traderapi.cancelOrder('65708d8189f58f0007182278', undefined, testOrderMarket));

    // Testing canceling all orders
    // ==

    // console.log(await traderapi.cancelAllOrders('DOGE/USDT'));
    // console.log(await traderapi.cancelAllOrders('ADM/USDT'));
    // console.log(await traderapi.cancelAllOrders('KCS/BTC'));
  },

  async test_dex_public() {
    // console.log('==');
    // console.log('========================== Testing DEX public API');
    // console.log('==');

    // Testing DEX UniswapV2
    // ==

    // const DEX = 'dex_uniswapv2';
    // const dexPair = 'UNI/LINK'; // https://app.uniswap.org/explore/pools/ethereum/0x9b2662DC8b80B0fE79310AD316b943CB5Bb15e8b
    // const traderApiDex = require('../trader_' + DEX)(undefined, undefined, undefined, log);

    // setTimeout(async () => {
    //   console.log(`${dexPair}@${DEX} market info:`);
    //   console.log(traderApiDex.marketInfo(dexPair));

    //   console.log(`${dexPair}@${DEX} current rates:`);
    //   console.log(await traderApiDex.getRates(dexPair));

    //   console.log(`${dexPair}@${DEX} ~order book:`);
    //   console.log(await traderApiDex.getOrderBook(dexPair));

    //   const trades = await traderApiDex.getTradesHistory(dexPair); // Object[]
    //   const latestTrades = trades.slice(-5);
    //   console.log(`${dexPair}@${DEX} latest ${latestTrades.length} of ${trades.length} received trades:`);
    //   console.log(latestTrades);
    // }, 6000);

    // Testing DEX UniswapV3
    // ==

    // Low liquidity pairs are marked with yellow circle.
    // These pairs are not recommended for trading.
    // They may return `NaN/Infinity` price values in `getRates()` and `getOrderBook()` methods.
    // 🟡 WBTC/USDT 1% https://info.uniswap.org/pairs#/pools/0x5a59e4e647a3acc42b01715f3a1d271c1f7e7aeb
    // 🟢 WBTC/USDT 0.3% https://info.uniswap.org/pairs#/pools/0x9db9e0e53058c89e5b94e29621a205198648425b
    // 🟡 WBTC/USDT 0.05% https://info.uniswap.org/pairs#/pools/0x56534741cd8b152df6d48adf7ac51f75169a83b2
  
    // const DEX = 'dex_uniswapv3';
    // const dexPair = 'WBTC/USDT';
    // const traderApiDex = require('../trader_' + DEX)(undefined, undefined, undefined, log);
  
    // setTimeout(async () => {
    //   console.log(`${dexPair}@${DEX} (1%) market info:`);
    //   console.log(traderApiDex.marketInfo(dexPair, 1));
    //
    //   console.log(`${dexPair}@${DEX} (0.3%) market info:`);
    //   console.log(traderApiDex.marketInfo(dexPair, 0.3));
    //
    //   console.log(`${dexPair}@${DEX} (1%) current rates:`);
    //   console.log(await traderApiDex.getRates(dexPair, 1));
    //
    //   console.log(`${dexPair}@${DEX} (0.3%) current rates:`);
    //   console.log(await traderApiDex.getRates(dexPair, 0.3));
    //
    //   console.log(`${dexPair}@${DEX} (1%) ~order book:`);
    //   console.log(await traderApiDex.getOrderBook(dexPair, 1));
    //
    //   console.log(`${dexPair}@${DEX} (0.3%) ~order book:`);
    //   console.log(await traderApiDex.getOrderBook(dexPair, 0.3));
    //
    //   console.log(`${dexPair}@${DEX} fees:`);
    //   console.log(await traderApiDex.getFees(dexPair));
    //
    //   console.log(`UNI/*@${DEX} fees:`);
    //   console.log(await traderApiDex.getFees('UNI'));
    //
    //   const trades = await traderApiDex.getTradesHistory(dexPair, undefined, undefined, 1);
    //   const latestTrades = trades.slice(-5);
    //   console.log(`${dexPair}@${DEX} (1%) latest ${latestTrades.length} of ${trades.length} received trades:`);
    //   console.log(latestTrades);
    //
    //   const trades2 = await traderApiDex.getTradesHistory(dexPair, undefined, undefined, 0.3);
    //   const latestTrades2 = trades2.slice(-5);
    //   console.log(`${dexPair}@${DEX} (0.3%) latest ${latestTrades2.length} of ${trades2.length} received trades:`);
    //   console.log(latestTrades2);
    // }, 12000);
  },

  run() {
    this.test_general();
    this.test_spot();
    this.test_dex_public();
  },
}
