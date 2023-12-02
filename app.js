const notify = require('./helpers/notify');
const db = require('./modules/DB');
const doClearDB = process.argv.includes('clear_db');
const config = require('./modules/configReader');
const { initApi } = require('./routes/init');

// Socket connection
if (config.passPhrase) {
  const api = require('./modules/api');
  const txParser = require('./modules/incomingTxsParser');

  api.socket.initSocket({ socket: config.socket, wsType: config.ws_type, onNewMessage: txParser, admAddress: config.address });
}

setTimeout(init, 5000);

function init() {
  try {
    if (config.api?.port) {
      initApi();
    }
    if (doClearDB) {
      console.log('Clearing database…');
      db.systemDb.db.drop();
      db.incomingTxsDb.db.drop();
      db.ordersDb.db.drop();
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
    notify(`${config.notifyName} is not started. Error: ${e}`, 'error');
    process.exit(1);
  }
}
