const express = require('express');
const fs = require('fs');
const config = require('../../modules/configReader');
const log = require('../../helpers/log');
const azbitApi = require('../api/azbit_api');

const app = express();

const apiServer = 'https://data.azbit.com';
const azbitClient = azbitApi();
console.log('config: ' + JSON.stringify(config));
azbitClient.setConfig(apiServer, config.apikey, config.apisecret, config.apipassword, log, false)


app.get('/api/balances', async function(request, response){
  const balances = await azbitClient.getBalances();
  console.log('balances:' + JSON.stringify(balances));
  response.send(balances);
});



app.listen(5000, function(){
  console.log('Сервер ожидает подключения...');
});
