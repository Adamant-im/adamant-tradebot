const log = require('../helpers/log');
const MongoClient = require('mongodb').MongoClient;
const mongoClient = new MongoClient('mongodb://localhost:27017/', { useNewUrlParser: true, useUnifiedTopology: true, serverSelectionTimeoutMS: 3000 });
const model = require('../helpers/dbModel');
const config = require('./configReader');

const collections = {};

mongoClient.connect((error, client) => {

  if (error) {
    log.error(`Unable to connect to MongoBD, ` + error);
    process.exit(-1);
  }
  const db = client.db('tradebotdb');
  collections.db = db;
  collections.systemDb = model(db.collection('systems'));
  collections.incomingTxsDb = model(db.collection('incomingtxs'));
  collections.ordersDb = model(db.collection('orders'));
  log.log(`${config.notifyName} successfully connected to 'tradebotdb' MongoDB.`);

});

module.exports = collections;
