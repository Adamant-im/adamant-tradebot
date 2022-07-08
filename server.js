/**
 * @description http watched DB tables
 */

const express = require('express');
const app = express();
const config = require('./modules/configReader');
const log = require('./helpers/log');
const port = config.debug_api;
const db = require('./modules/DB');

if (port) {

  app.get('/db', (req, res) => {
    const tb = db[req.query.tb].db;
    if (!tb) {
      res.json({
        err: 'tb not find',
      });
      return;
    }
    tb.find().toArray((err, data) => {
      if (err) {
        res.json({
          success: false,
          err,
        });
        return;
      }
      res.json({
        success: true,
        result: data,
      });
    });
  });

  app.listen(port, () => log.info(`${config.notifyName} debug server is listening on http://localhost:${port}. F. e., http://localhost:${port}/db?tb=systemDb.`));

}
