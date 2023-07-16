const { Router } = require('express');
const db = require('../modules/DB');

const router = new Router();

router.get('/db', (req, res) => {
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

module.exports = router;
