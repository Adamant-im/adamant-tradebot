const notify = require('./helpers/notify');
const db = require('./modules/DB');
const checker = require('./modules/checkerTransactions');
const doClearDB = process.argv.includes('clear_db');
const config = require('./modules/configReader');
const txParser = require('./modules/incomingTxsParser');

// Socket connection
const api = require('./modules/api');
api.socket.initSocket({ socket: config.socket, wsType: config.ws_type, onNewMessage: txParser, admAddress: config.address });

setTimeout(init, 5000);

function init() {
  require('./server');
  try {
    if (doClearDB) {
      console.log('Clearing database…');
      db.systemDb.db.drop();
      db.incomingTxsDb.db.drop();
      db.ordersDb.db.drop();
      notify(`*${config.notifyName}: database cleared*. Manually stop the Bot now.`, 'info');
    } else {
      checker();
      require('./trade/mm_trader').run();
      require('./trade/mm_orderbook_builder').run();
      require('./trade/mm_liquidity_provider').run();
      require('./trade/mm_price_watcher').run();
      // require('./trade/mm_orderbook_builder').test();
      notify(`*${config.notifyName} started* for address _${config.address}_ (ver. ${config.version}).`, 'info');
    }
  } catch (e) {
    notify(`${config.notifyName} is not started. Error: ${e}`, 'error');
    process.exit(1);
  }
}
