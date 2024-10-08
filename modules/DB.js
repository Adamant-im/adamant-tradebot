const log = require('../helpers/log');
const MongoClient = require('mongodb').MongoClient;
const mongoClient = new MongoClient('mongodb://127.0.0.1:27017/', { serverSelectionTimeoutMS: 3000 });
const model = require('../helpers/dbModel');
const config = require('./configReader');

const dbName = 'tradebotdb';
const collections = {};

mongoClient.connect()
    .then((client) => {
      const db = client.db(dbName);

      collections.db = db;

      const incomingTxsCollection = db.collection('incomingtxs');
      incomingTxsCollection.createIndex([['date', 1], ['senderId', 1]]);

      const ordersCollection = db.collection('orders');
      ordersCollection.createIndex([['isProcessed', 1], ['purpose', 1]]);
      ordersCollection.createIndex([['pair', 1], ['exchange', 1]]);

      const fillsCollection = db.collection('fills');
      fillsCollection.createIndex([['isProcessed', 1], ['purpose', 1]]);
      fillsCollection.createIndex([['pair', 1], ['exchange', 1]]);

      collections.fillsDb = model(fillsCollection);
      collections.ordersDb = model(ordersCollection);
      collections.incomingTxsDb = model(incomingTxsCollection);
      collections.systemDb = model(db.collection('systems'));

      log.log(`${config.notifyName} successfully connected to '${dbName}' MongoDB.`);
    })
    .catch((error) => {
      log.error(`Unable to connect to MongoDB: ${error}`);
      process.exit(-1);
    });

module.exports = collections;
