const axios = require('axios');
const config = require('../modules/configReader');
const log = require('./log');
const api = require('../modules/api');
const {
  adamant_notify,
  slack,
} = config;

module.exports = (message, type, silent_mode = false) => {

  try {

    log[type](removeMarkdown(message));

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

      const params = {
        'attachments': [{
          'fallback': message,
          'color': color,
          'text': makeBoldForSlack(message),
          'mrkdwn_in': ['text'],
        }],
      };

      if (slack && slack.length > 34) {
        axios.post(slack, params)
            .catch(function(error) {
              log.log(`Request to Slack with message ${message} failed. ${error}.`);
            });
      }
      if (adamant_notify && adamant_notify.length > 5 && adamant_notify.startsWith('U') && config.passPhrase && config.passPhrase.length > 30) {
        const mdMessage = makeBoldForMarkdown(message);
        api.sendMessage(config.passPhrase, adamant_notify, `${type}| ${mdMessage}`).then((response) => {
          if (!response.success) {
            log.warn(`Failed to send notification message '${mdMessage}' to ${adamant_notify}. ${response.errorMessage}.`);
          }
        });
      }

    }

  } catch (e) {
    log.error('Notifier error: ' + e);
  }

};

function removeMarkdown(text) {
  return doubleAsterisksToSingle(text).replace(/([_*]\b|\b[_*])/g, '');
}

function doubleAsterisksToSingle(text) {
  return text.replace(/(\*\*\b|\b\*\*)/g, '*');
}

function singleAsteriskToDouble(text) {
  return text.replace(/(\*\b|\b\*)/g, '**');
}

function makeBoldForMarkdown(text) {
  return singleAsteriskToDouble(doubleAsterisksToSingle(text));
}

function makeBoldForSlack(text) {
  return doubleAsterisksToSingle(text);
}
