/**
 * @module modules/configReader
 * @typedef {import('types/bot/configReader.d.js').BotConfig} BotConfig
 */

const jsonminify = require('jsonminify');
const fs = require('fs');
const path = require('path');
const { createKeypairFromPassphrase, createAddressFromPublicKey } = require('adamant-api');

/** @type {BotConfig} */
let config = {};

// Schema used to apply defaults and validate field types after the config file is parsed
const fields = {
  dev: {
    type: Boolean,
    default: false,
  },
  cli: {
    type: Boolean,
    default: false,
  },
  pauseAfterInactivity: {
    type: String,
    default: '6h',
  },
  private_webui_secret_key: {
    type: String,
    default: '',
    isRequired: false,
  },
  passPhrase: {
    type: String,
    isRequired: false,
  },
  manageTelegramBotToken: {
    type: String,
    default: '',
    isRequired: false,
  },
  node_ADM: {
    type: Array,
    isRequired: false,
  },
  infoservice: {
    type: Array,
    default: ['https://info.adamant.im'],
  },
  exchanges: {
    type: Array,
    isRequired: true,
  },
  isDemoAccount: {
    type: Boolean,
    isRequired: false,
    default: false,
  },
  exchange: {
    type: String,
    isRequired: true,
  },
  pair: {
    type: String,
    isRequired: true,
  },
  perpetual: {
    type: String,
    isRequired: false,
    default: '',
  },
  balance_watcher: {
    type: Object,
    default: {
      coin2BalanceThresholdPercent: 25,
      expectedValueThresholdPercent: 10,
      expectedValueThresholdCOIN2: 0,
    },
  },
  sniper_bot_watcher: {
    type: Object,
    default: {
      sbwEnabled: true,
      safeModeThreshold: 3,
      resetThreshold: 10,
    },
  },
  nice_chart: {
    type: Object,
    default: {
      enabled: true,
      failedRequestsBeforeFallback: 3,
    },
  },
  fund_supplier: {
    type: Object,
    default: {
      enabled: false,
      coins: [],
    },
  },
  clearAllOrdersInterval: {
    type: Number,
    default: 0,
  },
  apikey: {
    type: String,
    isRequired: true,
  },
  apisecret: {
    type: String,
    isRequired: true,
  },
  apipassword: {
    type: String,
    default: '',
  },
  perpetual_apikey: {
    type: String,
    isRequired: false,
  },
  perpetual_apisecret: {
    type: String,
    isRequired: false,
  },
  perpetual_apipassword: {
    type: String,
    default: '',
  },
  apikey2: {
    type: String,
    default: '',
  },
  apisecret2: {
    type: String,
    default: '',
  },
  apipassword2: {
    type: String,
    default: '',
  },
  admin_accounts: {
    type: Array,
    default: [],
  },
  admin_telegram: {
    type: Array,
    default: [],
  },
  notify_non_admins: {
    type: Boolean,
    default: false,
  },
  socket: {
    type: Boolean,
    default: true,
  },
  ws_type: {
    type: String,
    default: 'ws',
  },
  bot_name: {
    type: String,
    default: '',
  },
  adamant_notify: {
    type: Array,
    default: [],
  },
  adamant_notify_priority: {
    type: Array,
    default: [],
  },
  slack: {
    type: Array,
    default: [],
  },
  slack_priority: {
    type: Array,
    default: [],
  },
  telegramBotToken: {
    type: String,
    default: '',
    isRequired: false,
  },
  telegram: {
    type: Array,
    default: [],
  },
  telegram_priority: {
    type: Array,
    default: [],
  },
  email_notify: {
    type: Array,
    default: [],
  },
  email_priority: {
    type: Array,
    default: [],
  },
  email_notify_aggregate_min: {
    type: Number,
    default: 0,
  },
  email_smtp: {
    type: Object,
    default: {},
  },
  silent_mode: {
    type: Boolean,
    default: false,
  },
  log_level: {
    type: String,
    default: 'log',
  },
  private_webui: {
    type: Number,
    isRequired: false,
  },
  private_webui_bind_host: {
    type: String,
    default: '127.0.0.1',
    isRequired: false,
  },
  private_webui_allowed_ips: {
    type: Array,
    default: [],
    isRequired: false,
  },
  public_webui: {
    type: String,
    default: '',
    isRequired: false,
  },
  public_webui_license_token: {
    type: String,
    default: '',
    isRequired: false,
  },
  welcome_string: {
    type: String,
    default: 'Hello 😊. This is a stub. I have nothing to say. Please check my config.',
  },
  api: {
    type: Object,
    default: {},
  },
  db: {
    type: Object,
    default: { // Fallback to default MongoDB parameters if the configuration is missing them
      name: 'tradebotdb',
      url: 'mongodb://127.0.0.1:27017/',
      options: {
        serverSelectionTimeoutMS: 3_000,
        serverApi: {
          deprecationErrors: true,
          strict: true,
          version: '1',
        },
      },
    },
  },
  com_server: {
    type: String,
    default: '',
  },
  com_server_secret_key: {
    type: String,
  },
  amount_to_confirm_usd: {
    type: Number,
    default: 1000,
  },
  volumes_thresholds_usd: {
    type: Object,
    default: {
      '🦐': 10,
      '🍤': 50,
      '🐟': 100,
      '🐬': 300,
      '🦈': 1000,
      '🐳': 5000,
      '🐳🐳': 10000,
      '🐳🐳🐳': 50000,
    },
  },
  exchange_socket: {
    type: Boolean,
    default: false,
  },
  exchange_socket_pull: {
    type: Boolean,
    default: false,
  },
};

try {
  // CLI flags: `dev`/`test` enable dev mode; `clear_db` wipes MongoDB on startup
  const dev =
      process.argv.includes('dev') ||
      process.argv.includes('test') ||
      process.env.DEV === 'true';

  const doClearDB = process.argv.includes('clear_db');
  // First argv token that is not a path and not `clear_db` selects `config.<name>.jsonc`
  const configCustom = process.argv.find((arg) => !arg.includes('/') && arg !== 'clear_db');

  let configFile;

  const configFileDefault = '../config.default.jsonc';
  const configFileMain = '../config.jsonc';

  if (configCustom) {
    configFile = `../config.${configCustom}.jsonc`;
  } else {
    const configExists = fs.existsSync(path.join(__dirname, configFileMain));

    configFile = configExists ? configFileMain : configFileDefault;
  }

  console.log(`Config reader: Reading config file '${configFile}'${dev ? ' (dev)' : ''}…`);

  // __dirname = ./modules
  config = JSON.parse(jsonminify(fs.readFileSync(path.join(__dirname, configFile), 'utf-8')));

  config.dev = dev || config.dev;
  config.doClearDB = doClearDB;
  config.configFile = configFile;
  config.configCustom = configCustom;

  config.hasAdmPassphrase = isPassphrase(config.passPhrase);

  const isCliEnabled = config.cli;
  const isTgEnabled = config.manageTelegramBotToken;

  // Without CLI or Telegram management, the bot needs a valid ADM account and nodes
  if (!isCliEnabled && !isTgEnabled) {
    if (!config.hasAdmPassphrase) {
      exit('Bot configuration is incorrect: ADAMANT passphrase is invalid.');
    }

    if (!config.node_ADM) {
      exit('Bot configuration is incorrect: ADM nodes are not set. Cannot start the bot.');
    }
  }

  if (process.env.CLI_INSTANCE && !isCliEnabled) {
    exit('You are running the bot in CLI mode, but CLI is disabled in the config.');
  }

  config.name = require('../package.json').name;
  config.version = require('../package.json').version;

  const pathParts = __dirname.split(path.sep);
  config.projectNamePlain = pathParts[pathParts.length - 2];

  config.projectName = config.project_name || undefined;
  // Derive a display name from the repo folder when `project_name` is not set in config
  config.projectName ??= config.projectNamePlain
      .replace(' ', '-')
      .replace('adamant-', '')
      .replace('tradebot', 'TradeBot')
      .replace('coinoptimus', 'CoinOptimus');

  const { exec } = require('child_process');
  exec('git rev-parse --abbrev-ref HEAD', (err, stdout) => {
    if (!err && stdout) {
      config.projectBranch = stdout.trim();
    }
  });

  config.isDemoAccount = config.isDemoAccount ?? process.env.OVERRIDE_CONFIG_FUNDS === 'demo';

  const pair = config.pair.toUpperCase();

  if (!pair?.includes('/')) {
    exit(`Bot configuration is incorrect. Spot trading pair is invalid: ${config.pair}.`);
  }

  const perpetual = config.perpetual?.toUpperCase();

  if (perpetual) {
    if (perpetual.length < 5) {
      exit(`Bot configuration is incorrect. Perpetual pair is invalid: ${config.perpetual}.`);
    }

    // Perpetual id must match the spot pair without the slash (e.g. ADM/USDT → ADMUSDT)
    if (perpetual !== pair.replace('/', '')) {
      exit(`Bot configuration is incorrect. Perpetual pair ${perpetual} differs from spot pair ${pair}.`);
    }
  }

  config.pair = pair;
  config.perpetual = perpetual;
  config.defaultPair = config.perpetual || config.pair;

  config.coin1 = config.pair.split('/')[0].trim();
  config.coin2 = config.pair.split('/')[1].trim();

  config.supported_exchanges = config.exchanges.join(', ');
  config.exchangeName = config.exchange;
  config.exchange = config.exchangeName.toLowerCase();

  config.file = 'tradeParams_' + config.exchange + '.js';
  config.fileWithPath = './trade/settings/' + config.file;

  config.email_notify_enabled =
      (config.email_notify?.length || config.email_priority?.length) &&
      config.email_smtp?.auth?.username &&
      config.email_smtp?.auth?.password;

  config.bot_id = `${config.defaultPair}@${config.exchangeName}`;
  config.accountFull = `${config.account}@${config.exchangeName}`;

  // Some exchanges (e.g. Kraken) require separate API credentials for contract trading;
  // otherwise reuse spot API keys for perpetual mode
  if (!config.perpetual_apikey) {
    config.perpetual_apikey = config.apikey;
    config.perpetual_apisecret = config.apisecret;
    config.perpetual_apipassword = config.apipassword;
  }

  if (config.account) {
    config.bot_id += `-${config.account}`;
  }

  config.bot_id += ` ${config.projectName}`;

  if (!config.bot_name) {
    config.bot_name = config.bot_id;
  }

  config.welcome_string = config.welcome_string.replace('{bot_name}', config.bot_name);

  let keyPair;
  let address;
  const accounts = [];

  if (config.hasAdmPassphrase) {
    try {
      keyPair = createKeypairFromPassphrase(config.passPhrase);
    } catch (e) {
      exit(`Bot configuration is incorrect. Failed to derive an ADM key pair from the passphrase: ${e}. Cannot start the bot.`);
    }

    address = createAddressFromPublicKey(keyPair.publicKey);
    config.keyPair = keyPair;
    config.publicKey = keyPair.publicKey.toString('hex');
    config.address = address;

    accounts.push(`ADM ${config.address}`);
  }

  if (isTgEnabled) {
    accounts.push(`Telegram`);
  }

  if (process.env.CLI_INSTANCE) {
    accounts.push(`CLI`);
  }

  config.notifyName = `${config.bot_name} (${accounts.join(', ')})`;

  const configOwnerLabel = address || config.notifyName;

  Object.keys(fields).forEach((f) => {
    // JSONC configs use `false` to disable optional numeric/string settings
    if (config[f] === false) {
      if (fields[f].type === Number) {
        config[f] = 0;
      } else if (fields[f].type === String) {
        config[f] = '';
      }
    }

    if (config[f] === undefined && fields[f].isRequired) {
      exit(`Configuration for ${configOwnerLabel} is invalid: required field '${f}' is missing. Cannot start the bot.`);
    } else if (config[f] === undefined && fields[f].default !== undefined) {
      config[f] = fields[f].default;
    }
    if (config[f] !== undefined && fields[f].type !== config[f].__proto__.constructor) {
      exit(
          `Configuration for ${configOwnerLabel} is invalid: field '${f}' has type ` +
          `${config[f].__proto__.constructor.name}, expected ${fields[f].type.name}. Cannot start the bot.`,
      );
    }
  });

  config.fund_supplier.coins.forEach((coin) => {
    coin.coin = coin.coin?.toUpperCase();
    coin.sources = coin.sources?.map((source) => source?.toUpperCase()) || [];
  });

  if (require('../api/lib/webuiConfig').isPrivateWebUiApiEnabled(config.private_webui)) {
    try {
      require('../api/lib/webuiSecurity').assertPrivateWebUiSecretKey(config.private_webui_secret_key);
    } catch (error) {
      exit(error instanceof Error ? error.message : String(error));
    }
  }

  if (config.com_server) {
    try {
      /** Optional helper path — kept in a variable so the IDE does not require the file in trimmed builds. */
      const comServerSecurityModule = '../helpers/comServerSecurity';
      require(comServerSecurityModule).assertComServerSecretKey(config.com_server_secret_key);
    } catch (error) {
      exit(error instanceof Error ? error.message : String(error));
    }
  }

  console.info(`Config reader: ${config.notifyName} successfully loaded '${configFile}'${config.dev ? ' (dev)' : ''}.`);

  // Create tradeParams for exchange (sync — utils/context require the file during module load)
  const exchangeTradeParams = path.join(__dirname, '../trade/settings', config.file);
  const defaultTradeParams = path.join(__dirname, '../trade/settings/tradeParams_Default.js');

  if (fs.existsSync(exchangeTradeParams)) {
    console.log(`Config reader: Trade params file '${config.file}' already exists.`);
  } else {
    try {
      fs.copyFileSync(defaultTradeParams, exchangeTradeParams);
      console.info(`Config reader: Trade params file '${config.file}' was created from the default template.`);
    } catch (error) {
      exit(`Failed to create trade params file '${config.file}'. ${error}`);
    }
  }
} catch (e) {
  exit(`Failed to read config: ${e}`);
}

/**
 * Checks whether the given value is a valid ADAMANT mnemonic passphrase.
 *
 * A valid passphrase contains exactly 12 or 24 whitespace-separated words.
 * Matching is case-insensitive; extra spaces are collapsed.
 *
 * @param {unknown} phrase Value to validate
 * @returns {boolean} `true` when `phrase` looks like a BIP39-style mnemonic
 */
function isPassphrase(phrase) {
  if (typeof phrase !== 'string') {
    return false;
  }

  // Normalize: trim + collapse multiple spaces + lowercase for case-insensitive check
  const words = phrase
      .trim()
      .toLowerCase()
      .split(/\s+/);

  return words.length === 12 || words.length === 24;
}

/**
 * Logs a fatal configuration error and terminates the process.
 *
 * @param {string} msg Human-readable error description
 * @returns {never}
 */
function exit(msg) {
  console.error(`Config reader: ${msg}`);
  process.exit(-1);
}

/** @type {BotConfig} */
module.exports = config;
