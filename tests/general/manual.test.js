
const utils = require('../../helpers/utils');
const config = require('../../modules/configReader');
const log = require('../../helpers/log');

module.exports = {
  readableModuleName: 'Manual tests',

  async test_general() {
    console.log('==');
    console.log('========================== Testing general features');
    console.log('==');

    const orderUtils = require('../../trade/orderUtils');
    const orderCollector = require('../../trade/orderCollector');

    // Testing DB
    // ==

    // const db = require('../../modules/DB');
    // const { ordersDb } = db;
    // const order = await ordersDb.findOne({
    //   _id: 'orderId',
    // });

    // Testing orderUtils.parseMarket
    // ==

    // console.log(orderUtils.parseMarket('ADM/USDT', 'Azbit'));
    // setTimeout(() => {
    //   console.log(orderUtils.parseMarket('ADM/USDT', 'Azbit'));
    // }, 3000);

    // console.log(orderUtils.parseMarket('BTCUSDT'));
    // setTimeout(() => {
    //   console.log(orderUtils.parseMarket('BTCUSDT', 'Bybit'));
    // }, 3000);

    // Testing order book info calculation
    // getOrderBookInfo(orderBookInput, customSpreadPercent, targetPrice, placedAmount, openOrders, moduleName)
    // See also `utils.test.js`
    // ==

    // const traderapi = require('../../trade/trader_' + config.exchange)(
    //   config.apikey,
    //   config.apisecret,
    //   config.apipassword,
    //   log,
    //   undefined,
    //   undefined,
    //   config.exchange_socket,
    //   config.exchange_socket_pull,
    // );

    // const customSpreadPercent = 7;
    // const targetPrice = 0.000027;
    // const placedAmount = 100;
    // const ob = await traderapi.getOrderBook(config.pair);
    // const openOrders = await traderapi.getOpenOrders(config.pair);
    // const obInfo = await utils.getOrderBookInfo(ob, customSpreadPercent, targetPrice, placedAmount, openOrders, 'Test-orderBookInfo');

    // Testing cached functions
    // ==

    // console.log(await orderUtils.getOpenOrdersCached('ADMUSDT', this.readableModuleName));
    // console.log(await orderUtils.getOpenOrdersCached('BTCUSDT', this.readableModuleName));
    // console.log(await orderUtils.getOpenOrdersCached('ADM/USDT', this.readableModuleName));
    // console.log(await orderUtils.getOpenOrdersCached('KCS/USDT', this.readableModuleName));

    // console.log(await orderUtils.getOrderBookCached('ADMUSDT', this.readableModuleName));
    // console.log(await orderUtils.getOrderBookCached('BTCUSDT', this.readableModuleName));
    // console.log(await orderUtils.getOrderBookCached('ADM/USDT', this.readableModuleName));
    // console.log(await orderUtils.getOrderBookCached('KCS/USDT', this.readableModuleName));

    // console.log(await orderUtils.getBalancesCached(true, this.readableModuleName));
    // console.log(await orderUtils.getBalancesCached(true, this.readableModuleName, false, 'FUND'));
    // console.log(await orderUtils.getBalancesCached(true, this.readableModuleName, false, 'SPOT'));
    // console.log(await orderUtils.getBalancesCached(true, this.readableModuleName, false, 'CONTRACT'));

    // Testing order collector: Single order cancellation
    // ==

    // const cancellation = await orderCollector.clearOrderById(
    //     'order-id', 'KCS/USDT', undefined, this.readableModuleName, 'Test reason');
    // console.log(cancellation);

    // const cancellation2 = await orderCollector.clearOrderById(
    //     'order-id', 'ADM/USDT', undefined, this.readableModuleName, 'Test reason');
    // console.log(cancellation2);

    // const cancellation3 = await orderCollector.clearOrderById(
    //     '1749707202668793088', 'KCS/USDT', undefined, this.readableModuleName, 'Test reason');
    // console.log(cancellation3);

    // const cancellation4 = await orderCollector.clearOrderById(
    //     'order-id', 'BTCUSDT', undefined, this.readableModuleName, 'Test reason');
    // console.log(cancellation4);

    // const cancellation5 = await orderCollector.clearOrderById(
    //     'order-id', 'ADMUSDT', undefined, this.readableModuleName, 'Test reason');
    // console.log(cancellation5);

    // const cancellation6 = await orderCollector.clearOrderById(
    //     '5a60fedc-c67f-45bd-bb61-13f81ade67c3', 'BTCUSDT', undefined, this.readableModuleName, 'Test reason');
    // console.log(cancellation6);

    // Testing order collector: Multiple order cancellation
    // ==

    // console.log(await orderCollector.clearUnknownOrders('ADM/USDT', false, undefined, this.readableModuleName));
    // console.log(await orderCollector.clearUnknownOrders('KCS/USDT', false, undefined, this.readableModuleName));

    // console.log(await orderCollector.clearUnknownOrders('ADMUSDT', false, undefined, this.readableModuleName));
    // console.log(await orderCollector.clearUnknownOrders('BTCUSDT', false, undefined, this.readableModuleName));

    // console.log(await orderCollector.clearLocalOrders('all', 'ADM/USDT', false, undefined, undefined, this.readableModuleName));
    // console.log(await orderCollector.clearLocalOrders('all', 'KCS/USDT', false, undefined, undefined, this.readableModuleName));

    // console.log(await orderCollector.clearLocalOrders('all', 'ADMUSDT', false, undefined, undefined, this.readableModuleName));
    // console.log(await orderCollector.clearLocalOrders('all', 'BTCUSDT', false, undefined, undefined, this.readableModuleName));

    // console.log(await orderCollector.clearAllOrders('ADM/USDT', false, undefined, this.readableModuleName, 'All orders'));
    // console.log(await orderCollector.clearAllOrders('KCS/USDT', false, undefined, this.readableModuleName, 'All orders'));

    // console.log(await orderCollector.clearAllOrders('ADMUSDT', false, undefined, this.readableModuleName, 'All orders'));
    // console.log(await orderCollector.clearAllOrders('BTCUSDT', false, undefined, this.readableModuleName, 'All orders'));

    // Additional order collector functions
    // ==

    // console.log(orderCollector.getPurposeList());
  },

  async test_spot() {
    console.log('==');
    console.log('========================== Testing SPOT API');
    console.log('==');

    const traderapi = require('../../trade/trader_' + config.exchange)(
      config.apikey,
      config.apisecret,
      config.apipassword,
      log,
      undefined,
      undefined,
      config.exchange_socket,
      config.exchange_socket_pull,
    );

    // const traderapi2 = require('../../trade/trader_azbit')(
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
    // console.log(await traderapi.marketInfo('ETH/USDT'));
    // console.log(await traderapi.currencyInfo('ETH'));
    // console.log(await traderapi.features());
    // console.log(utils.getFullObjectString(await traderapi.marketInfo('ETH/USDT')));

    // Testing getRates, getOrderBook, getTradesHistory
    // ==

    // console.log(await traderapi.getRates('ETH/USDT'));
    // console.log(await traderapi.getRates('DMD/BTC'));
    // console.log(await traderapi.getRates('ADM/BTC'));

    // const ob = await traderapi.getOrderBook('KCS/USDT');
    // console.log(ob);

    // const req = await traderapi.getTradesHistory('kcs/usdt');
    // console.log(req);

    // Testing getBalances for different wallet types
    // ==

    // console.log(await traderapi.getBalances());

    // console.log(await traderapi.getBalances(false, 'FUND'));
    // console.log(await traderapi.getBalances(false, 'SPOT'));
    // console.log(await traderapi.getBalances(false, 'UNIFIED'));
    // console.log(await traderapi.getBalances(false, 'CONTRACT'));
    // console.log(await traderapi.getBalances(false, 'funding'));
    // console.log(await traderapi.getBalances(false, 'FULL'));

    // Bybit-demo
    // console.log(await traderapi.getBalances(false));
    // console.log(await traderapi.getBalancesWallet(false, 'UNIFIED'));

    // Testing getFees
    // ==

    // console.log(await traderapi.getFees('ADM/USDT'));
    // console.log(await traderapi.getFees('BTC/USDT'));

    // console.log(await traderapi.getFees('ADM'));
    // console.log(await traderapi.getFees('BTC'));
    // console.log(await traderapi.getFees());

    // Testing placing orders and receiving order details
    // ==

    // side, pair, price, coin1Amount, limit = 1, coin2Amount
    // console.log(await traderapi.placeOrder('sell', 'adm/USDT', 9001, 0.00006, 1, undefined));


    // console.log(await traderapi.placeOrder('sell', 'eth/USDT', 4001, 0.002, 1, undefined));
    // console.log(await traderapi.placeOrder('buy', 'eth/USDT', 2000, 0.003, 1, undefined));


    // console.log(await traderapi.placeOrder('sell', 'eth/USDT', 4006, undefined, 1, 6));
    // console.log(await traderapi.placeOrder('buy', 'eth/USDT', 2005, undefined, 1, 7));


    // console.log(await traderapi.placeOrder('sell', 'eth/USDT', null, 0.002, 0, undefined));
    // console.log(await traderapi.placeOrder('buy', 'eth/USDT', null, 0.003, 0, undefined));

    // console.log(await traderapi.placeOrder('sell', 'eth/USDT', null, undefined, 0, 6));
    // console.log(await traderapi.placeOrder('buy', 'eth/USDT', null, undefined, 0, 7));

    // For testing part_filled orders, we place two orders in a spread
    // ETH/USDT is an example, but it is not the best choice as this pair generally has many trades and price changes often
    // The first order is 'ask'; we sell ETH for 20 USDT. The second is 'bid'; we buy ETH for 15 USDT.
    // Expected result: The first one is part_filled (total: 20 USDT, filled: 15 USDT), and the second one is filled (total: 15 USDT, filled: 15 USDT).
    // Ensure you have enough both amount and quote coin balances

    const testOrderPrice = 0.02877; // Setting a limit price, assuming the current highest bid and lowest ask are 3500–3505. Adjust it according to the current price to place an order in the spread.
    const testOrderMarket = 'eth/USDT';

    // const ob = (await traderapi.getOrderBook(testOrderMarket));
    // const ask = ob.asks[0];
    // const bid = ob.bids[0];
    // ask.volume = ask.amount * ask.price
    // console.log(ask)
    // console.log(bid)

    // let price;
    // if (ask.price - bid.price > 0.00001) {
    //   price = (ask.price + bid.price)/2;
    

    // const partFilledOrder = await traderapi.placeOrder('buy', testOrderMarket, testOrderPrice, undefined, 1, 0.00015);
    // const filledOrder2 = await traderapi.placeOrder('sell', testOrderMarket, testOrderPrice, undefined, 1, 0.00011);

    // const constants = require('../../helpers/const');
    // const pauseMs = traderapi.features().apiProcessingDelayMs ?? constants.DEFAULT_API_PROCESSING_DELAY_MS;
    // await utils.pauseAsync(pauseMs, `Testing: ${pauseMs} msec pause to ensure the ${config.exchangeName}'s matching engine processed the orders…`);

    // console.log(await traderapi.getOpenOrders(testOrderMarket));

    // console.log(await traderapi.getOrderDetails(partFilledOrder.orderId, testOrderMarket)); // Details for the part_filled order
    // console.log(await traderapi.getOrderDetails(filledOrder2.orderId, testOrderMarket)); // Details for the filled order

    // Testing getting non-existent order details
    // ==

    // console.log(await traderapi.getOrderDetails('800766246155244032', testOrderMarket));
    // console.log(await traderapi.getOrderDetails('119353984789', testOrderMarket));
    // console.log(await traderapi.getOrderDetails('65707c1285a72b0007ee2cbd2', testOrderMarket));
    // console.log(await traderapi.getOrderDetails('123-any-order-number', testOrderMarket));
    // console.log(await traderapi.getOrderDetails(undefined, testOrderMarket));
    // console.log(await traderapi.getOrderDetails(new Object('69a5840cb1c933a2dc2f7254'), testOrderMarket));

    // Testing getting specific order details
    // ==

    // console.log(await traderapi.getOrderDetails('2651312191280327576', testOrderMarket)); // Market buy, filled
    // console.log(await traderapi.getOrderDetails('2651309287882428462', testOrderMarket)); // Market sell, filled
    // console.log(await traderapi.getOrderDetails('520388644166052224', testOrderMarket)); // Limit, new
    // console.log(await traderapi.getOrderDetails('520388757223329536', testOrderMarket)); // Limit, filled
    // console.log(await traderapi.getOrderDetails('520378034036363008', testOrderMarket)); // Limit, cancelled

    // spot2 (Bybit-SPOT)
    // console.log(await traderapi.getOrderDetails('1747151858289641984', testOrderMarket)); // Market, closed
    // console.log(await traderapi.getOrderDetails('1747153155747252736', testOrderMarket)); // Limit, opened

    // main1 (Bybit-UNIFIED)
    // console.log(await traderapi.getOrderDetails('1747154971318819328', testOrderMarket)); // Market, closed
    // console.log(await traderapi.getOrderDetails('1747155223102888448', testOrderMarket)); // Limit, opened

    // Testing getOpenOrders
    // ==

    // console.log(await traderapi.getOpenOrders('ADM/USDT'));
    // console.log(await traderapi.getOpenOrders('KCS/USDT'));
    // console.log(await traderapi.getOpenOrders('BTC/USDT'));

    // Testing canceling an order by ID
    // ==

    // const orderCollector = require('../../trade/orderCollector');
    // const cancellation = await orderCollector.clearOrderById(
    //     'order id', config.pair, undefined, 'Testing', 'Sample reason', undefined, traderapi);
    // console.log(cancellation);

    // Testing canceling an order by ID
    // ==

    // console.log(await traderapi.cancelOrder('12609cf4-fca5-43ed-b0ea-b40fb48d3b0d', undefined, testOrderMarket));
    // console.log(await traderapi.cancelOrder('69a5840cb1c933a2dc2f7254', undefined, testOrderMarket));
    // console.log(await traderapi.cancelOrder(new Object('69a5840cb1c933a2dc2f7254'), undefined, testOrderMarket));
    // console.log(await traderapi.cancelOrder('ODM54B-5CJUX-RSUKCK', undefined, testOrderMarket));
    // console.log(await traderapi.cancelOrder(119354495120, undefined, testOrderMarket));
    // console.log(await traderapi.cancelOrder('520378034036363008', undefined, testOrderMarket));
    // console.log(await traderapi.cancelOrder(undefined, undefined, testOrderMarket));

    // console.log(await traderapi.getOrderDetails('504813802', testOrderMarket)); // Market, closed
    // console.log(await traderapi.getOrderDetails('38540808443', testOrderMarket)); // Limit, opened

    // console.log(await traderapi.cancelOrder('504813802', undefined, testOrderMarket)); // Cancelling filled order
    // console.log(await traderapi.cancelOrder('504813793', undefined, testOrderMarket)); // Cancelling already cancelled order
    // console.log(await traderapi.cancelOrder('0', undefined, testOrderMarket)); // Cancelling active order
    // console.log(await traderapi.cancelOrder(0, undefined, testOrderMarket)); // Cancelling active order
    // console.log(await traderapi.cancelOrder('', undefined, testOrderMarket)); // Cancelling active order

    // Testing canceling all orders
    // ==

    // console.log(await traderapi.cancelAllOrders('DOGE/USDT'));
    // console.log(await traderapi.cancelAllOrders('ADM/USDT'));
    // console.log(await traderapi.cancelAllOrders('KCS/USDT'));
    // console.log(await traderapi.cancelAllOrders('ETH/USDT'));

    // Testing candles
    // ==

    // console.log(await traderapi.getCandlesHistory('eth/usdt', '15m', 12345, undefined, true));
    // console.log(await traderapi.getCandlesHistory('eth/usdt', '15m', 1759765859000, undefined, true));
    // console.log(await traderapi.getCandlesHistory('eth/usdt', '15m', undefined, undefined, false));

    // Testing withdrawals and history
    // ==

    // console.log(await traderapi.getDepositAddress('eth'));
    // console.log(await traderapi.getDepositAddress('adm'));
    // console.log(await traderapi.getDepositAddress(''));

    // console.log(await traderapi.getDepositHistory('eth', 3));
    // console.log(await traderapi.getDepositHistory('adm', 3));
    // console.log(await traderapi.getDepositHistory('', 4));

    // console.log(await traderapi.getWithdrawalHistory('eth', 3));
    // console.log(await traderapi.getWithdrawalHistory('adm', 3));
    // console.log(await traderapi.getWithdrawalHistory('', 4));

    // console.log(await traderapi.getWithdrawalById(''));
    // console.log(await traderapi.getWithdrawalById(undefined));
    // console.log(await traderapi.getWithdrawalById('72587756'));
    // console.log(await traderapi.getWithdrawalById('c3a75cae67db4041b4a08367e62f34d7'));

    // console.log(await traderapi.transfer(undefined, 'spot', 'futures', 1));
    // console.log(await traderapi.transfer('usdt', 'spot', 'futures', 1));
    // console.log(await traderapi.withdraw('0x1ff6C30A0585886a210aDd383800C208AD1694D4', 0.123, 'usdt', undefined, 'matic'));
  },

  async test_perpetual() {
    console.log('==');
    console.log('========================== Testing PERPETUAL API');
    console.log('==');

    const perpetualApi = require('../../modules/perpetualApi')();

    // Testing contract list and perpetual features
    // ==

    // console.log(await perpetualApi.instrumentInfo('BTCUSDT'));
    // console.log(await perpetualApi.features());

    // Testing getTickerInfo, getOrderBook, getPublicTradeHistory, getOpenInterest, getLongShortRatio, getRiskLimit
    // ==

    // console.log(await perpetualApi.getTickerInfo('ADMUSDT'));
    // console.log(await perpetualApi.getTickerInfo('BTCUSDT'));

    // const req = await perpetualApi.getOrderBook('BTCUSDT');
    // console.log(req);

    // const req = await perpetualApi.getPublicTradeHistory('BTCUSDT');
    // console.log(req);

    // const req = await perpetualApi.getOpenInterest('BTCUSDT');
    // console.log(req);

    // const req = await perpetualApi.getLongShortRatio('BTCUSDT');
    // console.log(req);

    // const req = await perpetualApi.getRiskLimit('BTCUSDT');
    // console.log(req);

    // Testing placing orders and receiving order details
    // ==

      // orderSide,
      // symbol,
      // price,
      // contractQty,
      // orderType,
      // reduceOnly = false,
      // takeProfitPrice,
      // stopLossPrice,
      // timeInForce = 'GTC',
      // smpType = 'NONE',

    // console.log(await perpetualApi.placeOrder('sell', 'ETHUSDT', null, 2, 'market', false));
    // console.log(await perpetualApi.placeOrder('buy', 'ETHUSDT', 3000, 1, 'limit', false, 3100, 2999));
    // console.log(await perpetualApi.placeOrder('buy', 'BTCUSDT', 61000, 0.1, 'limit'));
    // console.log(await perpetualApi.placeOrder('buy', 'BTCUSDT', 106000, 0.1, 'limit'));

    // For testing part_filled orders, we place two orders in a spread
    // ETH/USDT is an example, but it is not the best choice as this pair generally has many trades and price changes often
    // The first order is 'ask'; we sell ETH for 20 USDT. The second is 'bid'; we buy ETH for 15 USDT.
    // Expected result: The first one is part_filled (total: 20 USDT, filled: 15 USDT), and the second one is filled (total: 15 USDT, filled: 15 USDT).
    // Ensure you have enough both amount and quote coin balances

    // const testOrderPrice = 3501.11; // Setting a limit price, assuming the current highest bid and lowest ask are 3500–3505. Adjust it according to the current price to place an order in the spread.
    // const testOrderMarket = 'BTCUSDT';

    // const partFilledOrder = await traderapi.placeOrder('sell', testOrderMarket, testOrderPrice, undefined, 1, 20);
    // const filledOrder2 = await traderapi.placeOrder('buy', testOrderMarket, testOrderPrice, undefined, 1, 15);

    // console.log(await perpetualApi.getOpenOrders(testOrderMarket));
    // console.log(await perpetualApi.getOpenOrders('ADMUSDT'));
    // console.log(await perpetualApi.getOpenOrders('BTCUSDT'));

    // console.log(await perpetualApi.getOrderDetails(partFilledOrder.orderId, testOrderMarket)); // Details for the part_filled order
    // console.log(await perpetualApi.getOrderDetails(filledOrder2.orderId, testOrderMarket)); // Details for the filled order

    // Testing getting non-existent order details
    // ==

    // console.log(await perpetualApi.getOrderDetails(119354495120, testOrderMarket));
    // console.log(await perpetualApi.getOrderDetails('119353984789', testOrderMarket));
    // console.log(await perpetualApi.getOrderDetails('65707c1285a72b0007ee2cbd2', testOrderMarket));
    // console.log(await perpetualApi.getOrderDetails('123-any-order-number', testOrderMarket));
    // console.log(await perpetualApi.getOrderDetails(undefined, testOrderMarket));

    // Testing getting specific order details
    // ==

    // console.log(await perpetualApi.getOrderDetails('7140011911', testOrderMarket)); // TP

    // console.log(await perpetualApi.getOrderDetails('7139992955', testOrderMarket)); // Limit, new,. -> Cancelled
    // console.log(await perpetualApi.getOrderDetails('7140000858', testOrderMarket)); // Limit, new

    // console.log(await perpetualApi.getOrderDetails('38521884843', testOrderMarket)); // Limit, cancelled

    // console.log(await perpetualApi.getOrderDetails('7144909635', testOrderMarket)); // Market buy, filled
    // console.log(await perpetualApi.getOrderDetails('38522406188', testOrderMarket)); // Market sell, filled

    // console.log(await perpetualApi.getOrderDetails('38522422386', testOrderMarket)); // Limit, filled

    // console.log(await perpetualApi.getOrderDetails('38523448836', testOrderMarket)); // Limit sell, opened quote
    // console.log(await perpetualApi.getOrderDetails('38523473710', testOrderMarket)); // Market sell, filled quote

    // Testing canceling an order by ID
    // ==

    // const orderCollector = require('../../trade/orderCollector');
    // const cancellation = await orderCollector.clearOrderById(
    //     '9593948483', 'BTCUSDT', undefined, 'Testing', 'Sample reason', undefined, perpetualApi);
    // console.log(cancellation);

    // Testing canceling an order by ID
    // ==

    // console.log(await perpetualApi.cancelOrder('12609cf4-fca5-43ed-b0ea-b40fb48d3b0d', testOrderMarket));
    // console.log(await perpetualApi.cancelOrder('ODM54B-5CJUX-RSUKCK', testOrderMarket));
    // console.log(await perpetualApi.cancelOrder(119354495120, testOrderMarket));
    // console.log(await perpetualApi.cancelOrder('119354495120', testOrderMarket));
    // console.log(await perpetualApi.cancelOrder(undefined, testOrderMarket));

    // console.log(await perpetualApi.cancelOrder('cb3407f7-eb8a-4fc7-b370-68d60bc1f959', testOrderMarket));

    // Testing canceling all orders
    // ==

    // console.log(await perpetualApi.cancelAllOrders('ADMUSDT'));
    // console.log(await perpetualApi.cancelAllOrders('ETHUSDT'));

    // Testing receiving positions
    // ==

    // console.log(await perpetualApi.getPositions('ADMUSDT'));
    // console.log(await perpetualApi.getPositions('BTCUSDT'));

    // Testing closing positions
    // ==

    // console.log(await perpetualApi.closePosition('ADMUSDT'));
    // console.log(await perpetualApi.closePosition('ETHUSDT'));

    // Testing setLeverage, switchMarginMode, switchPositionMode
    // ==

    // console.log(await perpetualApi.setLeverage('ADMUSDT', 50));
    // console.log(await perpetualApi.setLeverage('ETHUSDT', 50));
    // console.log(await perpetualApi.setLeverage('ETHUSDT', 0));
    // console.log(await perpetualApi.setLeverage('ETHUSDT', -1));
    // console.log(await perpetualApi.setLeverage('ETHUSDT', 500));
    // console.log(await perpetualApi.setLeverage('ETHUSDT', 80));

    // console.log(await perpetualApi.switchMarginMode('ADMUSDT', 'isolated', 50));
    // console.log(await perpetualApi.switchMarginMode('ETHUSDT', 'crossed', 50));

    // console.log(await perpetualApi.switchPositionMode('ADMUSDT', 'oneway'));
    // console.log(await perpetualApi.switchPositionMode('BTCUSDT', 'oneway'));

    // Testing setTakeProfitStopLoss
    // ==

    // console.log(await perpetualApi.setTakeProfitStopLoss('ADMUSDT', 60000, 50000));
    // console.log(await perpetualApi.setTakeProfitStopLoss('BTCUSDT', 60000, 50000));

    // Testing getBalances for "contract" wallet
    // ==

    // console.log(await perpetualApi.getBalances(true, 'full'));

    // Testing getFees
    // ==

    // console.log(await perpetualApi.getFees('ADMUSDT'));
    // console.log(await perpetualApi.getFees('BTCUUUUDT'));
    // console.log(await perpetualApi.getFees('BTCUSDT'));

    // console.log(await perpetualApi.getFees('ADM'));
    // console.log(await perpetualApi.getFees('BTC'));

    // console.log(await perpetualApi.getFees('BTC/USDT'));
},

  async test_dex_public() {
    console.log('==');
    console.log('========================== Testing DEX public API');
    console.log('==');

    // Testing DEX UniswapV2
    // ==

    // const DEX = 'dex_uniswapv2';
    // const dexPair = 'UNI/LINK'; // https://app.uniswap.org/explore/pools/ethereum/0x9b2662DC8b80B0fE79310AD316b943CB5Bb15e8b
    // const traderApiDex = require('../../trade/trader_' + DEX)(undefined, undefined, undefined, log);

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
    // const traderApiDex = require('../../trade/trader_' + DEX)(undefined, undefined, undefined, log);

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
    // this.test_general();
    // this.test_spot();
    // this.test_perpetual();
    // this.test_dex_public();
  },
}
