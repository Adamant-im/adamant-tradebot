const express = require('express');
const fs = require('fs');
const config = require('../../modules/configReader');
const log = require('../../helpers/log');
const azbitApi = require('../api/azbit_api');
const swaggerUi = require('swagger-ui-express');
const path = require('path');

const app = express();
const swaggerFile = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'BREAKTHEVOID_1-AzbitAPI-1.0.0-resolved.json')));

const apiServer = 'https://data.azbit.com';
const azbitClient = azbitApi();
log.log('config: ' + JSON.stringify(config));
azbitClient.setConfig(apiServer, config.apikey, config.apisecret, config.apipassword, log, false)


app.get('/api/balances', async function(request, response){
  const balances = await azbitClient.getBalances();
  log.log('balances:' + JSON.stringify(balances));
  response.send(balances);
});

app.get('/api/orders', async function(request, response){
  const pair = request.query.pair;
  const status = request.query.status;
  const orders = await azbitClient.getOrders(pair, status);
  log.log('orders:' + JSON.stringify(orders));
  response.send(orders);
});

app.delete('/api/orders/:orderId', async function(request, response) {
  const orderId = request.params?.orderId;
  const cancelOrder = await azbitClient.cancelOrder(orderId);
  log.log('cancelOrder: ' + JSON.stringify(cancelOrder));
  response.send(cancelOrder);
});

app.delete('/api/orders', async function(request, response) {
  const pair = request.query?.pair;
  const cancelOrders = await azbitClient.cancelAllOrders(pair);
  log.log('cancelOrders: ' + cancelOrders);
  response.send(cancelOrders);
});

app.get('/api/tickers', async function(request, response) {
  const pair = request.query?.pair;
  const tickers = await azbitClient.ticker(pair);
  log.log('tickers: ' + tickers);
  response.send(tickers);
});

app.get('/api/orderbook', async function(request, response) {
  const pair = request.query?.pair;
  const orderBook = await azbitClient.orderBook(pair);
  log.log('orderBook: ' + JSON.stringify(orderBook));
  response.send(orderBook);
});

app.get('/api/deals', async function(request, response) {
  const pair = request.query?.pair;
  const page = request.query?.page;
  const tradeHistory = await azbitClient.getTradesHistory(pair, page)
  log.log('tradeHistory: ' + JSON.stringify(tradeHistory));
  response.send(tradeHistory)
});

app.get('/api/markets', async function(request, response) {
  const markets = await azbitClient.markets();
  log.log('markets: ' + JSON.stringify(markets));
  response.send(markets);
});

app.get('/api/currencies', async function(request, response) {
  const currencies = await azbitClient.getCurrencies();
  log.log('currencies: ' + JSON.stringify(currencies));
  response.send(currencies);
});

app.get('/api/deposit-address/:coin', async function(request, response) {
  const coin = request.params?.coin;
  const address = await azbitClient.getDepositAddress(coin);
  log.log('address: ' + address);
  response.send(address);
});

app.get('/api/fees', async function(request, response) {
  const fees = await azbitClient.getFees();
  log.log('fees: ' + fees);
  response.send(fees);
});

app.use('/api-doc', swaggerUi.serve, swaggerUi.setup(swaggerFile));


app.listen(5000, function(){
  console.log('Сервер ожидает подключения...');
});
