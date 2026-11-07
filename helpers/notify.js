'use strict';

/**
 * Multi-channel notifier: Slack, ADAMANT, Telegram, email, and Discord.
 * Channels and recipients are configured in `configReader`.
 *
 * @module helpers/notify
 */

const config = require('../modules/configReader');
const log = require('./log');
const utils = require('./utils');

/**
 * @typedef {import('types/bot/general.d.js').NotifyFunction} NotifyFunction
 * @typedef {import('types/bot/helpers.d.js').NotifyLevel} NotifyLevel
 * @typedef {import('types/bot/telegramBot.d.js').TelegramSendMessageParams} TelegramSendMessageParams
 * @typedef {import('axios').AxiosInstance} AxiosInstance
 */

/** @type {AxiosInstance} */
// @ts-ignore axios default export is a callable instance
const axios = require('axios');

const adamantApi = require('../modules/adamantApi');

const emailer = utils.softRequire('./emailer', __filename);

const {
  adamant_notify = [],
  adamant_notify_priority = [],
  slack = [],
  slack_priority = [],
  email_notify = [],
  email_priority = [],
  email_notify_enabled,
  telegram = [],
  telegram_priority = [],
  telegramBotToken,
  discord_notify = [],
  discord_notify_priority = [],
} = config;

const telegramBot = utils.createTelegramBotApi(telegramBotToken);

/** @type {Record<NotifyLevel, string>} */
const slackColors = {
  error: '#FF0000',
  warn: '#FFFF00',
  info: '#00FF00',
  log: '#FFFFFF',
};

/** @type {Record<NotifyLevel, string>} */
const telegramColorPrefixes = {
  info: '🟩',
  warn: '🟨',
  error: '🟥',
  log: '⬜️',
};

/** @type {Record<NotifyLevel, string>} */
const discordColors = {
  error: '16711680',
  warn: '16776960',
  info: '65280',
  log: '16777215',
};

/**
 * Whether a config list entry is set (placeholders like `""` are treated as empty).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyConfigValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  return Boolean(value);
}

/**
 * Default-config examples such as `https://discord.com/api/webhooks/...`
 * and `https://hooks.slack.com/services/..` — not real destinations.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isExamplePlaceholder(value) {
  return typeof value === 'string' && /\.{2,}\/?$/.test(value.trim());
}

/**
 * Webhook URL that is long enough to attempt a POST. Empty, example, and
 * truncated values are skipped without logging.
 *
 * @param {unknown} value
 * @param {number} minLength
 * @returns {string | null}
 */
function usableWebhookUrl(value, minLength) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || isExamplePlaceholder(url) || url.length <= minLength) return null;
  return url;
}

/**
 * Sends a notification to configured channels and always logs the message locally.
 *
 * @type {NotifyFunction}
 */
module.exports = (messageText, type, silent_mode = false, isPriority = false) => {
  const paramString = `messageText: '${messageText}', type: ${type}, silent_mode: ${String(silent_mode)}, isPriority: ${String(isPriority)}`;

  try {
    const prefix = isPriority ? '[Attention] ' : '';
    const message = `${prefix}${messageText}`;

    if (!silent_mode || isPriority) {
      log[type](`/Logging notify message/ ${removeMarkdown(message)}`);

      const webTerminal = utils.softRequire('../api/services/messages', __filename);
      if (webTerminal && typeof webTerminal.appendNotifyMessage === 'function') {
        webTerminal.appendNotifyMessage(type, message).catch((error) => {
          log.warn(`Notifier: Failed to append WebUI terminal message. ${error}`);
        });
      }

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
          const slackUrl = usableWebhookUrl(slackApp, 34);
          if (!slackUrl) return;

          axios.post(slackUrl, params)
              .catch((error) => {
                log.warn(`Notifier: Slack request failed for message '${removeMarkdown(message)}'. ${error}`);
              });
        });
      }

      const adamantAddresses = isPriority ?
        [...adamant_notify, ...adamant_notify_priority] :
        adamant_notify;

      if (adamantAddresses.length) {
        adamantAddresses.forEach((admAddress) => {
          if (!isNonEmptyConfigValue(admAddress) || !utils.isAdmAddress(admAddress)) return;
          if (!config.hasAdmPassphrase) return;

          const mdMessage = makeBoldForMarkdown(message);

          const api = adamantApi();
          api.sendMessage(config.passPhrase, admAddress, `${type}| ${mdMessage}`).then((response) => {
            if (!response.success) {
              const detail = 'errorMessage' in response ? ` ${response.errorMessage}` : '';
              log.warn(`Notifier: Failed to send ADAMANT message to ${admAddress}.${detail}`);
            }
          });
        });
      }

      const telegramChatIds = isPriority ?
        [...telegram, ...telegram_priority] :
        telegram;

      if (telegramBotToken && utils.isTelegramBotModuleAvailable() && Array.isArray(telegramChatIds) && telegramChatIds.length) {
        sendTelegramMessages(type, telegramChatIds, message);
      }

      if (email_notify_enabled && emailer) {
        const emailAddresses = isPriority ?
          [...email_notify, ...email_priority] :
          email_notify;

        emailer.notify({
          emailAddresses,
          isPriority,
          type,
          message,
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
          const discordUrl = usableWebhookUrl(discordKey, 36);
          if (!discordUrl) return;

          axios.post(discordUrl, params)
              .catch((error) => {
                log.warn(`Notifier: Discord request failed for message '${removeMarkdown(message)}'. ${error}`);
              });
        });
      }
    } else {
      log[type](`/No notification, Silent mode, Logging only/ ${removeMarkdown(message)}`);
    }
  } catch (e) {
    log.error(`Notifier: Error while processing notification (${paramString}). ${e}`);
  }
};

/**
 * Sends a message to one or more Telegram chats.
 *
 * @param {NotifyLevel} type Notification severity
 * @param {(string | number)[]} telegramChatIds Numeric IDs or `@username` strings
 * @param {string} message Notification text; may include Markdown
 */
function sendTelegramMessages(type, telegramChatIds, message) {
  const mdMessage = utils.escapeMarkdownTelegram(makeBoldForMarkdown(message));
  const colorPrefix = telegramColorPrefixes[type];

  const params = /** @type {TelegramSendMessageParams} */ ({
    text: `${colorPrefix} ${mdMessage}`,
    parse_mode: 'MarkdownV2',
  });

  telegramChatIds.forEach((telegramChatId) => {
    if (!isNonEmptyConfigValue(telegramChatId)) return;
    if (!(utils.isInteger(telegramChatId) || typeof telegramChatId === 'string')) return;

    params.chat_id = normalizeTelegramChatId(telegramChatId);

    telegramBot
        .sendMessage(params)
        .catch((error) => {
          if (error.response) {
            const {
              description,
              error_code,
            } = error.response.data;

            log.warn(`Notifier: Failed to send Telegram message to ${telegramChatId} (code ${error_code}). ${description}`);
          } else {
            log.warn(`Notifier: Failed to send Telegram message to ${telegramChatId}. ${error}`);
          }
        });
  });
}

/**
 * Converts `**bold**` markers to `*bold*` (Slack/Telegram style).
 *
 * @param {string} text
 * @returns {string}
 */
function doubleAsterisksToSingle(text) {
  return text.replace(/\*\*([^*]+)\*\*/g, '*$1*');
}

/**
 * Converts `*bold*` markers to `**bold**` (Discord/Markdown style).
 *
 * @param {string} text
 * @returns {string}
 */
function singleAsteriskToDouble(text) {
  return text.replace(/\*([^*]+)\*/g, '**$1**');
}

/**
 * Normalizes bold markers to Markdown `**…**` form.
 *
 * @param {string} text
 * @returns {string}
 */
function makeBoldForMarkdown(text) {
  return singleAsteriskToDouble(doubleAsterisksToSingle(text));
}

/**
 * Normalizes bold markers to Slack `*…*` form.
 *
 * @param {string} text
 * @returns {string}
 */
function makeBoldForSlack(text) {
  return doubleAsterisksToSingle(text);
}

/**
 * Normalizes bold markers to Discord `**…**` form.
 *
 * @param {string} text
 * @returns {string}
 */
function makeBoldForDiscord(text) {
  return singleAsteriskToDouble(doubleAsterisksToSingle(text));
}

/**
 * Strips Markdown bold/italic markers for plain-text logging.
 *
 * @param {string} text
 * @returns {string}
 */
function removeMarkdown(text) {
  return text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_/g, '');
}

/**
 * Normalizes a Telegram chat id: numeric strings stay as-is, usernames get an `@` prefix.
 *
 * @param {string | number} id
 * @returns {string | number}
 */
function normalizeTelegramChatId(id) {
  if (typeof id === 'number') return id;
  if (typeof id !== 'string') return id;

  // Numeric IDs stored as strings, including negative group/channel ids (e.g. -100758545812)
  if (/^-?\d+$/.test(id.trim())) return id.trim();

  return id.startsWith('@') ? id : `@${id}`;
}
