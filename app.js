/**
 * Application bootstrap: DB warmup, services (ADM, Telegram, WebUI, ComServer), trading modules.
 *
 * @typedef {import('types/bot/db.d.js').DbModule} DbModule
 * @typedef {import('types/bot/adamant.d.js').ParseAdmTx} ParseAdmTx
 * @typedef {import('adamant-api').WsType} AdamantWsType
 * @typedef {import('adamant-api').AnyTransactionHandler} AdamantAnyTransactionHandler
 * @typedef {`U${string}`} AdamantAddress
 * @typedef {Parameters<import('adamant-api').AdamantApi['initSocket']>[0]} AdamantInitSocketOptions
 */

const config = require('./modules/configReader');
const log = require('./helpers/log');
const db = /** @type {DbModule} */ (/** @type {unknown} */ (require('./modules/DB')));
const utils = require('./helpers/utils');
const { delay, warmUpConnectorData } = require('./modules/startupWarmup.js');

const INIT_SERVICES_DELAY_MS = 1000;

// Bootstrap the whole application:
// 1. Wait for DB connection + migrations
// 2. Then start services and trading modules
bootstrap().catch((error) => {
  log.error(`${config.notifyName} failed to start. ${error}`);
  process.exit(1);
});

async function bootstrap() {
  // Wait until MongoDB is connected and migrations are done
  if (db.ready && typeof db.ready.then === 'function') {
    await db.ready;
  }

  // It may take up to a second to create trading params file 'tradeParams_{exchange}.js' from the default one
  await delay(INIT_SERVICES_DELAY_MS);
  initServices();

  await warmUpConnectorData();
  startModules();
}

function initServices() {
  try {
    // Watch ADM transactions to receive commands
    if (config.hasAdmPassphrase) {
      const adamantApi = require('./modules/adamantApi');
      const api = adamantApi();
      const txParser = require('./modules/admTxParser');

      if (config.socket) {
        api.initSocket(/** @type {AdamantInitSocketOptions} */ ({
          wsType: /** @type {AdamantWsType} */ (config.ws_type),
          admAddress: /** @type {AdamantAddress} */ (config.address),
          direction: 'incoming',
        }));
        api.socket.on(/** @type {AdamantAnyTransactionHandler} */ (/** @type {ParseAdmTx} */ (txParser)));
      }
    }

    // Debug and health API init
    const { initApi } = require('./routes/init');
    if (config.api?.port) {
      initApi().catch((error) => {
        log.error(`${config.notifyName}: Debug API failed to start. ${error}`);
        process.exit(1);
      });
    }

    // Optional: telegramBot/index.js — incoming Telegram management commands
    const telegramBotModule = utils.softRequire('./telegramBot/index', __filename);

    if (telegramBotModule) {
      telegramBotModule.start();
    } else if (config.manageTelegramBotToken) {
      log.warn(
          `${config.notifyName}: manageTelegramBotToken is set, but telegramBot/ is not included in this build.`,
      );
    }

    // Private WebUI API starts when `config.private_webui` is a positive port (see config.default.jsonc).
    if (require('./api/lib/webuiConfig').isPrivateWebUiApiEnabled(config.private_webui)) {
      const webuiApi = require('./api/server');
      webuiApi.start().catch((error) => {
        log.error(`${config.notifyName}: WebUI API failed to start. ${error}`);
        process.exit(1);
      });
    }

    // Optional: modules/botInterchange.js — connect only when ComServer is enabled and the module exists
    const botInterchangeModule = utils.softRequire('./modules/botInterchange', __filename);
    const botInterchange = botInterchangeModule?.botInterchange;

    if (config.com_server && botInterchange) {
      botInterchange.connect();
      botInterchange.initHandlers();
    }
  } catch (e) {
    log.error(`${config.notifyName} is not started. ${e}`);
    process.exit(1);
  }
}

function startModules() {
  try {
    const notify = require('./helpers/notify');

    if (config.doClearDB) {
      log.log(`${config.notifyName}: Clearing database…`);

      db.systemDb.db.drop();
      db.incomingTxsDb.db.drop();
      db.incomingTgTxsDb.db.drop();
      db.incomingCLITxsDb.db.drop();
      db.ordersDb.db.drop();
      db.fillsDb.db.drop();
      db.webTerminalMessages.drop();
      db.balancesHistory.drop();

      log.log(`${config.notifyName}: Database cleared. Manually stop the Bot now.`);
    } else {
      checkInactivityPeriod();

      if (config.hasAdmPassphrase) {
        const checker = require('./modules/admTxChecker');
        checker();
      }

      require('./trade/mm_trader').run();
      require('./trade/mm_orderbook_builder').run();
      require('./trade/mm_liquidity_provider').run();
      require('./trade/mm_price_watcher').run();

      if (config.dev) {
        require('./tests/general/manual.test').run();
      }

      notify(`${config.notifyName} *started* | ${config.projectBranch}, v${config.version}.`, 'info');
    }
  } catch (e) {
    log.error(`${config.notifyName} failed to start. ${e}`);
    process.exit(1);
  }
}

/**
 * Checks inactivity based on the heartbeat timestamp.
 * If inactivity exceeds config.pauseAfterInactivity (smart time), pauses all operations.
 */
function checkInactivityPeriod() {
  const fs = require('fs');
  const commandTxs = require('./modules/commandTxs');

  try {
    if (!fs.existsSync(log.HEARTBEAT_FILE_PATH)) {
      return; // Heartbeat never created yet
    }

    const lastHeartbeatTs = Number(fs.readFileSync(log.HEARTBEAT_FILE_PATH, 'utf8'));
    const pauseAfterInactivitySmartTime = utils.parseSmartTime(config.pauseAfterInactivity);

    if (!utils.isPositiveInteger(lastHeartbeatTs) || !pauseAfterInactivitySmartTime.isTime) return;

    const pauseAfterInactivityTs = pauseAfterInactivitySmartTime.msecs;

    const now = Date.now();
    const inactiveForTs = now - lastHeartbeatTs;

    if (inactiveForTs > pauseAfterInactivityTs) {
      let details = `The bot was offline for ${utils.timestampInDaysHoursMins(inactiveForTs)}.`;
      details += ` As a precaution, it is now paused as a safety measure`;

      commandTxs.commands.emergencyStop('Bootstrap', details);
    }
  } catch (e) {
    log.error(`${config.notifyName} failed to check inactivity period. ${e}`);
  }
}
