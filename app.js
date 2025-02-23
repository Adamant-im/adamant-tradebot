const config = require('./modules/configReader');
const db = require('./modules/DB');

// It may take up to a second to create trading params file 'tradeParams_{exchange}.js' from the default one
setTimeout(initServices, 1000);
// It may take up to a 5 seconds to get exchange markets and Infoservice rates
setTimeout(startModules, 5000);

function initServices() {
  try {
    // Socket connection
    if (config.passPhrase) {
      const api = require('./modules/api');
      const txParser = require('./modules/incomingTxsParser');

      if (config.socket) {
        api.initSocket({ wsType: config.ws_type, admAddress: config.address });
        api.socket.on(txParser);
      }
    }

    // Debug and health API init
    const { initApi } = require('./routes/init');
    if (config.api?.port) {
      initApi();
    }
  } catch (e) {
    console.error(`${config.notifyName} is not started. ${e}`);
    process.exit(1);
  }
}

function startModules() {
  try {
    const notify = require('./helpers/notify');

    if (config.doClearDB) {
      console.log(`${config.notifyName}: Clearing database…`);

      db.systemDb.db.drop();
      db.incomingTxsDb.db.drop();
      db.incomingTgTxsDb.db.drop();
      db.incomingCLITxsDb.db.drop();
      db.ordersDb.db.drop();
      db.fillsDb.db.drop();
      db.webTerminalMessages.drop();

      console.log(`${config.notifyName}: Database cleared. Manually stop the Bot now.`);
    } else {
      if (config.passPhrase) {
        const checker = require('./modules/checkerTransactions');
        checker();
      }

      require('./trade/mm_trader').run();
      require('./trade/mm_orderbook_builder').run();
      require('./trade/mm_liquidity_provider').run();
      require('./trade/mm_price_watcher').run();

      if (config.dev) {
        require('./trade/tests/manual.test').run();
      }

      const addressInfo = config.address ? ` for address _${config.address}_` : ' in CLI mode';
      notify(`${config.notifyName} *started*${addressInfo} (${config.projectBranch}, v${config.version}).`, 'info');
    }
  } catch (e) {
    console.error(`${config.notifyName} is not started. ${e}`);
    process.exit(1);
  }
}
