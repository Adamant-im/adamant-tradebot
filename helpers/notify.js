const request = require('request');
const config = require('../modules/configReader');
const log = require('./log');
const api = require('../modules/api');
const {
	adamant_notify,
	slack
} = config;


module.exports = (message, type, silent_mode = false) => {
	try {

		log[type](message.replace(/\*/g, '').replace(/_/g, ''));

		if (!silent_mode) {
			
			if (!slack && !adamant_notify) {
				return;
			}
			let color;
			switch (type) {
			case ('error'):
				color = '#FF0000';
				break;
			case ('warn'):
				color = '#FFFF00';
				break;
			case ('info'):
				color = '#00FF00';
				break;
			case ('log'):
				color = '#FFFFFF';
				break;
			}
			const opts = {
				uri: slack,
				method: 'POST',
				json: true,
				timeout: 10000,
				body: {
					'attachments': [{
						'fallback': message,
						'color': color,
						'text': message,
						'mrkdwn_in': ['text']
					}]
				}
			};
			if (slack && slack.length > 34) {
				request(opts)
				.on('error', function(err) {
					log.log(`Request to Slack with message ${message} failed. ${err}.`);
				});
			}
			if (adamant_notify && adamant_notify.length > 5 && adamant_notify.startsWith('U') && config.passPhrase && config.passPhrase.length > 30) {
				api.send(config.passPhrase, adamant_notify, `${type}| ${message.replace(/\*/g, '**')}`, 'message');
			}
		}

	} catch (e) {
		log.error('Notifier error: ' + e);
	}
};
