const config = require('./configReader');
module.exports = require('./trade/' + config.exchange)(config.apikey, config.apisecret, config.apipassword);
