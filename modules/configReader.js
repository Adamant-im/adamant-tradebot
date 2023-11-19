const jsonminify = require('jsonminify');
const fs = require('fs');
const path = require('path');
const keys = require('adamant-api/src/helpers/keys');
const isDev = process.argv.includes('dev');
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
    isRequired: true,
  },
  node_ADM: {
    type: Array,
    isRequired: true,
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
  let configFile;

  if (isDev || process.env.JEST_WORKER_ID) {
    configFile = '../config.test.jsonc';
  } else {
    if (fs.existsSync(path.join(__dirname, '../config.jsonc'))) {
      configFile = '../config.jsonc';
    } else {
      configFile = '../config.default.jsonc';
    }
  }

  // __dirname = ./modules
  config = JSON.parse(jsonminify(fs.readFileSync(path.join(__dirname, configFile), 'utf-8')));

  if (config.passPhrase?.length < 35) {
    config.passPhrase = undefined;
  }

  if (!config.cli) {
    if (process.env.CLI_MODE_ENABLED) {
      exit('TradeBot CLI is disabled in the config.');
    }

    if (!config.passPhrase) {
      exit('Bot\'s config is wrong. ADAMANT passPhrase is invalid.');
    }

    if (!config.node_ADM) {
      exit('Bot\'s config is wrong. ADM nodes are not set. Cannot start the Bot.');
    }
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
      keyPair = keys.createKeypairFromPassPhrase(config.passPhrase);
    } catch (e) {
      exit(`Bot's config is wrong. Invalid passPhrase. Error: ${e}. Cannot start the Bot.`);
    }

    address = keys.createAddressFromPublicKey(keyPair.publicKey);
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

  console.info(`${config.notifyName} successfully read the config-file '${configFile}'${isDev ? ' (dev)' : ''}.`);
} catch (e) {
  exit('Error reading config: ' + e);
}

function exit(msg) {
  console.error(msg);
  process.exit(-1);
}

config.isDev = isDev;
module.exports = config;
