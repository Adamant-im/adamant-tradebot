const MongoClient = require('mongodb').MongoClient;
const mongoClient = new MongoClient('mongodb://localhost:27017/', { useNewUrlParser: true, useUnifiedTopology: true });
const model = require('../helpers/dbModel');

const collections = {};

mongoClient.connect((err, client) => {
  if (err) {
    throw (err);
  }
  const db = client.db('tradebotdb');
  collections.db = db;
  collections.systemDb = model(db.collection('systems'));
  collections.incomingTxsDb = model(db.collection('incomingtxs'));
  collections.ordersDb = model(db.collection('orders'));
});

module.exports = collections;
