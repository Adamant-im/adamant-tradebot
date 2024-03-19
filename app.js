const config = require('./modules/configReader');
const db = require('./modules/DB');
const doClearDB = process.argv.includes('clear_db');

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

      api.socket.initSocket({ socket: config.socket, wsType: config.ws_type, onNewMessage: txParser, admAddress: config.address });
    }

    // Debug and health API init
    const { initApi } = require('./routes/init');
    if (config.api?.port) {
      initApi();
    }
  } catch (e) {
    console.error(`${config.notifyName} is not started. Error: ${e}`);
    process.exit(1);
  }
}

function startModules() {
  try {
    const notify = require('./helpers/notify');

    if (doClearDB) {
      console.log('Clearing database…');

      db.systemDb.db.drop();
      db.incomingTxsDb.db.drop();
      db.ordersDb.db.drop();
      db.fillsDb.db.drop();

      notify(`*${config.notifyName}: database cleared*. Manually stop the Bot now.`, 'info');
    } else {
      if (config.passPhrase) {
        const checker = require('./modules/checkerTransactions');
        checker();
      }

      require('./trade/mm_trader').run();
      require('./trade/mm_orderbook_builder').run();
      require('./trade/mm_liquidity_provider').run();
      require('./trade/mm_price_watcher').run();
      // require('./trade/mm_orderbook_builder').test();

      const addressInfo = config.address ? ` for address _${config.address}_` : ' in CLI mode';
      notify(`${config.notifyName} *started*${addressInfo} (${config.projectBranch}, v${config.version}).`, 'info');
    }
  } catch (e) {
    console.error(`${config.notifyName} is not started. Error: ${e}`);
    process.exit(1);
  }
}
