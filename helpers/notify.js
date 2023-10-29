const axios = require('axios');
const config = require('../modules/configReader');
const log = require('./log');
const api = require('../modules/api');

const {
  adamant_notify = [],
  adamant_notify_priority = [],
  slack = [],
  slack_priority = [],
  discord_notify = [],
  discord_notify_priority = [],
} = config;

const slackColors = {
  error: '#FF0000',
  warn: '#FFFF00',
  info: '#00FF00',
  log: '#FFFFFF',
};

const discordColors = {
  error: '16711680',
  warn: '16776960',
  info: '65280',
  log: '16777215',
};

/**
 * Notify to channels, which set in config
 * @param {String} messageText Notification message, may include markdown
 * @param {String} type error < warn < info < log
 * @param {Boolean} silent_mode If true, only priority notification will be sent. only logging
 * @param {Boolean} isPriority Priority notifications have special channels
 */
module.exports = (messageText, type, silent_mode = false, isPriority = false) => {
  const paramString = `messageText: '${messageText}', type: ${type}, silent_mode: ${String(silent_mode)}, isPriority: ${String(isPriority)}`;

  try {
    const prefix = isPriority ? '[Attention] ' : '';
    const message = `${prefix}${messageText}`;

    if (!silent_mode || isPriority) {
      log[type](`/Logging notify message/ ${removeMarkdown(message)}`);

      const slackKeys = isPriority ?
        [...slack, ...slack_priority] :
        slack;

      if (slackKeys.length) {
        const params = {
          attachments: [{
            fallback: message,
            color: slackColors[type],
            text: makeBoldForSlack(message),
            mrkdwn_in: ['text'],
          }],
        };

        slackKeys.forEach((slackApp) => {
          if (typeof slackApp === 'string' && slackApp.length > 34) {
            axios.post(slackApp, params)
                .catch((error) => {
                  log.warn(`Notifier: Request to Slack with message ${message} failed. ${error}.`);
                });
          }
        });
      }

      const adamantAddresses = isPriority ?
        [...adamant_notify, ...adamant_notify_priority] :
        adamant_notify;

      if (adamantAddresses.length) {
        adamantAddresses.forEach((admAddress) => {
          if (typeof admAddress === 'string' && admAddress.length > 5 && admAddress.startsWith('U') && config.passPhrase && config.passPhrase.length > 30) {
            const mdMessage = makeBoldForMarkdown(message);
            api.sendMessage(config.passPhrase, admAddress, `${type}| ${mdMessage}`).then((response) => {
              if (!response.success) {
                log.warn(`Notifier: Failed to send notification message '${mdMessage}' to ${admAddress}. ${response.errorMessage}.`);
              }
            });
          }
        });
      }

      const discordKeys = isPriority ?
        [...discord_notify, ...discord_notify_priority] :
        discord_notify;

      if (discordKeys.length) {
        const params = {
          embeds: [
            {
              color: discordColors[type],
              description: makeBoldForDiscord(message),
            },
          ],
        };
        discordKeys.forEach((discordKey) => {
          if (typeof discordKey === 'string' && discordKey.length > 36) {
            axios.post(discordKey, params)
                .catch((error) => {
                  log.log(`Request to Discord with message ${message} failed. ${error}.`);
                });
          }
        });
      }
    } else {
      log[type](`/No notification, Silent mode, Logging only/ ${removeMarkdown(message)}`);
    }
  } catch (e) {
    log.error(`Notifier: Error while processing a notification with params ${paramString}. ${e}`);
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

function makeBoldForDiscord(text) {
  return singleAsteriskToDouble(text);
}
