/**
 * @description http watched DB tables
 */

const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const config = require('./modules/configReader');
const port = config.api;
const db = require('./modules/DB');

if (port) {
	app.use(bodyParser.json()); // for parsing application/json
	app.use(bodyParser.urlencoded({
		extended: true
	})); // for parsing application/x-www-form-urlencoded

	app.get('/db', (req, res) => {
		const tb = db[req.query.tb].db;
		if (!tb) {
			res.json({
				err: 'tb not find'
			});
			return;
		}
		tb.find().toArray((err, data) => {
			if (err) {
				res.json({
					success: false,
					err
				});
				return;
			}
			res.json({
				success: true,
				result: data
			});
		});
	});

	app.listen(port, () => console.info('Server listening on http://localhost:' + port + '/db?tb=systemDb'));

}
