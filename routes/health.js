const { Router } = require('express');

const router = new Router();

router.get('/ping', (req, res) => {
  res.status(200).send({ timestamp: Date.now() });
});

module.exports = router;
