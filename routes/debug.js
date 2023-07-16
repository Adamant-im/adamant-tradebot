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
  tb.find().toArray()
      .then((result) => {
        res.json({
          result,
          success: true,
        });
      })
      .catch((err) => {
        res.json({
          err,
          success: false,
        });
      });
});

module.exports = router;
