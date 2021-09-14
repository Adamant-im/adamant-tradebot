const config = require('./configReader');
const log = require('../helpers/log');
module.exports = require('adamant-api')({passPhrase: config.passPhrase, node: config.node_ADM, logLevel: 'warn'}, log);
