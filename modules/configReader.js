const jsonminify = require('jsonminify');
const fs = require('fs');
const path = require('path');
const { createKeypairFromPassphrase, createAddressFromPublicKey } = require('adamant-api');

let config = {};

// Validate config fields
const fields = {
  cli: {
    type: Boolean,
    default: false,
  },
  secret_key: {
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
  exchange: {
    type: String,
    isRequired: true,
  },
  pair: {
    type: String,
    isRequired: true,
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
    default: false,
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
  webui_accounts: {
    type: Array,
    default: [],
  },
  webui: {
    type: Number,
  },
  welcome_string: {
    type: String,
    default: 'Hello 😊. This is a stub. I have nothing to say. Please check my config.',
  },
  api: {
    type: Object,
    default: {},
  },
  com_server: {
    type: String,
    default: false,
  },
  com_server_secret_key: {
    type: String,
  },
  amount_to_confirm_usd: {
    type: Number,
    default: 1000,
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
  // Determine dev, doClearDB and configCustom args/params
  const dev =
      config.dev ||
      process.argv.includes('dev') ||
      process.argv.includes('test') ||
      process.env.DEV === 'true';

  const doClearDB = process.argv.includes('clear_db');
  const configCustom = process.argv.find((arg) => !arg.includes('/') && arg !== 'clear_db');

  // Determine which config file to use
  let configFile;

  const configFileDefault = '../config.default.jsonc';
  const configFileMain = `../config.jsonc`;

  if (configCustom) {
    configFile = `../config.${configCustom}.jsonc`;
  } else {
    const configExists = fs.existsSync(path.join(__dirname, configFileMain));

    configFile = configExists ? configFileMain : configFileDefault;
  }

  console.log(`Config reader: Reading the config-file '${configFile}'${dev ? ' (dev)' : ''}…`);

  // __dirname = ./modules
  config = JSON.parse(jsonminify(fs.readFileSync(path.join(__dirname, configFile), 'utf-8')));

  config.dev = dev;
  config.doClearDB = doClearDB;
  config.configFile = configFile;

  if (config.passPhrase?.length < 35) {
    config.passPhrase = undefined;
  }

  const isCliEnabled = config.cli;
  const isTgEnabled = config.manageTelegramBotToken;

  if (!isCliEnabled && !isTgEnabled) {
    if (!config.passPhrase) {
      exit('Bot\'s config is wrong. ADAMANT passPhrase is invalid.');
    }

    if (!config.node_ADM) {
      exit('Bot\'s config is wrong. ADM nodes are not set. Cannot start the Bot.');
    }
  }

  if (process.env.CLI_MODE_ENABLED && !isCliEnabled) {
    exit('You are running the bot in CLI mode, but it\'s disabled in the config.');
  }


  let keyPair;
  let address;
  let cliString;

  config.name = require('../package.json').name;
  config.version = require('../package.json').version;

  const pathParts = __dirname.split(path.sep);
  config.projectNamePlain = pathParts[pathParts.length - 2];

  if (config.project_name) {
    config.projectName = config.project_name;
  } else {
    config.projectName = config.projectNamePlain
        .replace(' ', '-')
        .replace('adamant-', '')
        .replace('tradebot', 'TradeBot')
        .replace('coinoptimus', 'CoinOptimus');
  }

  const { exec } = require('child_process');
  exec('git rev-parse --abbrev-ref HEAD', (err, stdout, stderr) => {
    config.projectBranch = stdout.trim();
  });

  config.pair = config.pair.toUpperCase();
  config.coin1 = config.pair.split('/')[0].trim();
  config.coin2 = config.pair.split('/')[1].trim();

  config.supported_exchanges = config.exchanges.join(', ');
  config.exchangeName = config.exchange;
  config.exchange = config.exchangeName.toLowerCase();

  config.file = 'tradeParams_' + config.exchange + '.js';
  config.fileWithPath = './trade/settings/' + config.file;

  config.email_notify_enabled =
      (config.email_notify?.length || config.email_notify_priority?.length) &&
      config.email_smtp?.auth?.username &&
      config.email_smtp?.auth?.password;

  config.bot_id = `${config.pair}@${config.exchangeName}`;

  if (config.account) {
    config.bot_id += `-${config.account}`;
  }

  config.bot_id += ` ${config.projectName}`;

  if (!config.bot_name) {
    config.bot_name = config.bot_id;
  }

  config.welcome_string = config.welcome_string.replace('{bot_name}', config.bot_name);

  if (config.passPhrase) {
    try {
      keyPair = createKeypairFromPassphrase(config.passPhrase);
    } catch (e) {
      exit(`Bot's config is wrong. Invalid passPhrase. Error: ${e}. Cannot start the Bot.`);
    }

    address = createAddressFromPublicKey(keyPair.publicKey);
    config.keyPair = keyPair;
    config.publicKey = keyPair.publicKey.toString('hex');
    config.address = address;
    cliString = process.env.CLI_MODE_ENABLED ? ', CLI mode' : '';
    config.notifyName = `${config.bot_name} (${config.address}${cliString})`;
  } else {
    cliString = process.env.CLI_MODE_ENABLED ? ' (CLI mode)' : '';
    config.notifyName = `${config.bot_name}${cliString}`;
  }

  Object.keys(fields).forEach((f) => {
    if (!config[f] && fields[f].isRequired) {
      exit(`Bot's ${address} config is wrong. Field _${f}_ is not valid. Cannot start Bot.`);
    } else if (!config[f] && config[f] !== 0 && fields[f].default) {
      config[f] = fields[f].default;
    }
    if (config[f] && fields[f].type !== config[f].__proto__.constructor) {
      exit(`Bot's ${address} config is wrong. Field type _${f}_ is not valid, expected type is _${fields[f].type.name}_. Cannot start Bot.`);
    }
  });

  config.fund_supplier.coins.forEach((coin) => {
    coin.coin = coin.coin?.toUpperCase();
    coin.sources.forEach((source) => {
      source = source?.toUpperCase();
    });
  });

  console.info(`${config.notifyName} successfully read the config-file '${configFile}'${dev ? ' (dev)' : ''}.`);

  // Create tradeParams for exchange
  const exchangeTradeParams = path.join(__dirname, '.' + config.fileWithPath);
  const defaultTradeParams = path.join(__dirname, '../trade/settings/tradeParams_Default.js');

  if (fs.existsSync(exchangeTradeParams)) {
    console.log(`The trading params file '${config.file}' already exists.`);
  } else {
    fs.copyFile(defaultTradeParams, exchangeTradeParams, (error) => {
      if (error) {
        exit(`Error while creating the trading params file '${config.file}': ${error}`);
      }

      console.info(`The trading params file '${config.file}' created from the default one.`);
    });
  }
} catch (e) {
  exit(`Error reading config: ${e}`);
}

function exit(msg) {
  console.error(`Config reader: ${msg}`);
  process.exit(-1);
}

module.exports = config;
