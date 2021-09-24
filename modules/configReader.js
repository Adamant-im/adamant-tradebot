const jsonminify = require('jsonminify');
const fs = require('fs');
const keys = require('adamant-api/helpers/keys');
const isDev = process.argv.includes('dev');
let config = {};

// Validate config fields
const fields = {
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
    isRequired: true,
  },
  bot_name: {
    type: String,
    default: null,
  },
  adamant_notify: {
    type: Array,
    default: [],
  },
  slack: {
    type: Array,
    default: [],
  },
  silent_mode: {
    type: Boolean,
    default: false,
  },
  log_level: {
    type: String,
    default: 'log',
  },
  welcome_string: {
    type: String,
    default: 'Hello 😊. This is a stub. I have nothing to say. Please check my config.',
  },
};

try {

  if (isDev) {
    config = JSON.parse(jsonminify(fs.readFileSync('./config.test', 'utf-8')));
  } else {
    config = JSON.parse(jsonminify(fs.readFileSync('./config.json', 'utf-8')));
  }

  if (!config.node_ADM) {
    exit(`Bot's config is wrong. ADM nodes are not set. Cannot start the Bot.`);
  }
  if (!config.passPhrase || config.passPhrase.length < 35) {
    exit(`Bot's config is wrong. Set an ADAMANT passPhrase to manage the Bot.`);
  }

  let keyPair;
  try {
    keyPair = keys.createKeypairFromPassPhrase(config.passPhrase);
  } catch (e) {
    exit(`Bot's config is wrong. Invalid passPhrase. Error: ${e}. Cannot start the Bot.`);
  }
  const address = keys.createAddressFromPublicKey(keyPair.publicKey);
  config.keyPair = keyPair;
  config.publicKey = keyPair.publicKey.toString('hex');
  config.address = address;
  config.notifyName = `${config.bot_name} (${config.address})`;
  config.version = require('../package.json').version;

  config.supported_exchanges = config.exchanges.join(', ');
  config.exchangeName = config.exchange;
  config.exchange = config.exchangeName.toLowerCase();
  config.pair = config.pair.toUpperCase();
  config.coin1 = config.pair.split('/')[0].trim();
  config.coin2 = config.pair.split('/')[1].trim();

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

  console.info(`The bot ${address} successfully read a config-file${isDev ? ' (dev)' : ''}.`);

} catch (e) {
  exit('Error reading config: ' + e);
}

function exit(msg) {
  console.error(msg);
  process.exit(-1);
}

config.isDev = isDev;
module.exports = config;
