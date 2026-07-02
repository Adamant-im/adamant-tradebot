'use strict';

/**
 * `mm doctor` — diagnose installation, config, MongoDB, exchange API, and runtime.
 *
 * Exit codes:
 * - `0` — all checks OK
 * - `1` — at least one FAILED check
 * - `2` — WARNING only (no FAILED)
 * - `3` — reserved for CLI errors (thrown in bin/mm.js)
 *
 * @module modules/mm/commands/doctor
 * @typedef {import('types/bot/mm').MmContext} MmContext
 * @typedef {import('types/bot/mm').MmCheckStatus} CheckStatus
 * @typedef {import('types/bot/mm').MmDoctorSection} DoctorSection
 * @typedef {import('types/bot/mm').MmParsedArgs} MmParsedArgs
 */

const fs = require('fs');
const path = require('path');
const { AdamantApi } = require('adamant-api');
const { createContext, isInsideDocker } = require('../context');
const configUtil = require('../config-util');
const shell = require('../shell');
const pm2 = require('../pm2');
const terminal = require('../terminal');
const { formatBytes } = require('../process-status');
const { parseDbConfig, probeMongo } = require('../mongo-probe');
const os = require('os');

/**
 * Rolls up multiple check statuses into a single section status.
 *
 * FAILED beats WARNING; all SKIPPED yields SKIPPED.
 *
 * @param {CheckStatus[]} statuses Individual check results
 * @returns {CheckStatus} Aggregated status
 */
function aggregateStatus(statuses) {
  if (statuses.includes('FAILED')) {
    return 'FAILED';
  }
  if (statuses.includes('WARNING')) {
    return 'WARNING';
  }
  if (statuses.every((s) => s === 'SKIPPED')) {
    return 'SKIPPED';
  }
  return 'OK';
}

/**
 * @param {MmContext} ctx
 * @returns {Promise<DoctorSection>}
 */
async function checkInstallation(ctx) {
  /** @type {CheckStatus[]} */
  const statuses = [];
  /** @type {string[]} */
  const messages = [];
  /** @type {string[]} */
  const fixes = [];

  const nodeVersion = process.version;
  const required = 22;
  const major = Number(nodeVersion.slice(1).split('.')[0]);
  if (major >= required) {
    statuses.push('OK');
  } else {
    statuses.push('FAILED');
    messages.push(`Node.js ${nodeVersion} found, but >=${required} is required.`);
    fixes.push(`Install Node.js ${required} or newer.`);
  }

  if (fs.existsSync(path.join(ctx.packageRoot, 'node_modules'))) {
    statuses.push('OK');
  } else {
    statuses.push('WARNING');
    messages.push('Dependencies may not be installed (node_modules missing).');
    fixes.push('Run: npm install');
  }

  if (ctx.mode === 'docker') {
    if (isInsideDocker()) {
      statuses.push('OK');
      messages.push('Docker stack is managed on the host via ./mm.');
    } else {
      if (!shell.commandExists('docker')) {
        statuses.push('FAILED');
        messages.push('Docker is not installed.');
        fixes.push('Install Docker.');
      } else {
        statuses.push('OK');
      }

      if (!shell.getDockerComposeCommand()) {
        statuses.push('FAILED');
        messages.push('Docker Compose is not available.');
        fixes.push('Install Docker Compose.');
      } else {
        statuses.push('OK');
      }

      if (!ctx.composeFile) {
        statuses.push('FAILED');
        messages.push('docker/docker-compose.yml not found.');
        fixes.push('Run ./mm init from the project directory.');
      } else {
        statuses.push('OK');
      }
    }
  }

  return { status: aggregateStatus(statuses), messages, fixes };
}

/**
 * @param {MmContext} ctx
 * @returns {Promise<DoctorSection>}
 */
async function checkConfig(ctx) {
  /** @type {CheckStatus[]} */
  const statuses = [];
  /** @type {string[]} */
  const messages = [];
  /** @type {string[]} */
  const fixes = [];

  const defaultConfig = configUtil.loadDefaultConfig(ctx.packageRoot);
  const userConfig = configUtil.loadUserConfig(ctx.configPath);

  if (!userConfig) {
    return {
      status: 'FAILED',
      messages: [`Config file not found: ${terminal.formatUserPath(ctx, ctx.configPath)}`],
      fixes: ['Run: mm init'],
    };
  }

  statuses.push('OK');

  const exchange = String(userConfig.exchange || '');
  const pair = String(userConfig.pair || '');
  const exchanges = defaultConfig.exchanges;

  if (!exchange || !Array.isArray(exchanges) || !exchanges.includes(exchange)) {
    statuses.push('FAILED');
    messages.push(`Unknown or missing exchange: ${exchange || '(empty)'}`);
    fixes.push('Run: mm config exchange');
  } else if (!configUtil.exchangeConnectorExists(exchange, ctx.packageRoot)) {
    statuses.push('FAILED');
    messages.push(`Connector files missing for exchange ${exchange}.`);
  } else {
    statuses.push('OK');
  }

  if (!configUtil.isValidPair(pair)) {
    statuses.push('FAILED');
    messages.push(`Invalid trading pair: ${pair || '(empty)'}`);
    fixes.push('Run: mm config pair');
  } else {
    statuses.push('OK');
  }

  if (!userConfig.apikey || !userConfig.apisecret) {
    statuses.push('FAILED');
    messages.push('API key or API secret is empty.');
    fixes.push('Run: mm config apikey / mm config apisecret');
  } else {
    statuses.push('OK');
  }

  const phrase = String(userConfig.passPhrase || '');
  if (!configUtil.isPassphrase(phrase)) {
    statuses.push('FAILED');
    messages.push('Invalid ADAMANT passphrase.');
    fixes.push('Run: mm config passPhrase');
  } else {
    statuses.push('OK');
    const address = configUtil.getAddressFromPassphrase(phrase);
    if (address) {
      try {
        const admNodes = Array.isArray(userConfig.node_ADM) ?
          userConfig.node_ADM :
          (Array.isArray(defaultConfig.node_ADM) ? defaultConfig.node_ADM : []);
        const api = new AdamantApi({ nodes: admNodes.map(String) });
        const balance = await api.getAccountBalance(address);
        if (balance.success) {
          const adm = Number(balance.balance) / 1e8;
          if (adm === 0) {
            statuses.push('WARNING');
            messages.push(`Bot ADM address ${address} has zero balance. Top up ~5 ADM via https://adamant.im/#trade-adm`);
          } else if (adm < 1) {
            statuses.push('WARNING');
            messages.push(`Bot ADM address ${address} balance is low (${adm.toFixed(4)} ADM). Consider topping up.`);
          }
        }
      } catch {
        statuses.push('WARNING');
        messages.push('Could not verify bot ADM balance.');
      }
    }
  }

  const admins = Array.isArray(userConfig.admin_accounts) ? userConfig.admin_accounts : [];
  const validAdmins = admins.filter((a) => configUtil.isAdmAddress(String(a)));

  if (!validAdmins.length) {
    statuses.push('WARNING');
    messages.push('No valid manager ADM addresses in admin_accounts.');
    fixes.push('Create one at https://adm.im and set: mm config admin_accounts');
  } else {
    statuses.push('OK');
    try {
      const admNodes = Array.isArray(userConfig.node_ADM) ?
        userConfig.node_ADM :
        (Array.isArray(defaultConfig.node_ADM) ? defaultConfig.node_ADM : []);
      const api = new AdamantApi({ nodes: admNodes.map(String) });
      for (const admin of validAdmins) {
        const balance = await api.getAccountBalance(String(admin));
        if (balance.success) {
          const adm = Number(balance.balance) / 1e8;
          if (adm === 0) {
            statuses.push('WARNING');
            messages.push(`Manager ${admin} has zero ADM balance. Top up ~5 ADM via https://adamant.im/#trade-adm`);
          } else if (adm < 1) {
            statuses.push('WARNING');
            messages.push(`Manager ${admin} balance is low (${adm.toFixed(4)} ADM). Consider topping up.`);
          }
        }
      }
    } catch {
      statuses.push('WARNING');
      messages.push('Could not verify manager ADM balances.');
    }
  }

  return { status: aggregateStatus(statuses), messages, fixes };
}

/**
 * @param {MmContext} ctx
 * @param {Record<string, unknown>} userConfig
 * @returns {Promise<DoctorSection>}
 */
async function checkMongo(ctx, userConfig) {
  /** @type {string[]} */
  const messages = [];
  /** @type {string[]} */
  const fixes = [
    'Start MongoDB',
    'Or run: docker compose up -d mongo',
    'Or update db.url with: mm config db.url',
  ];

  try {
    const result = await probeMongo(ctx, userConfig, { writeProbe: true });
    let sizeText = '';

    if (typeof result.dataSize === 'number') {
      sizeText = `, size ~${Math.round(result.dataSize / 1024 / 1024)} MB`;
    } else if (result.statsError?.includes('dbStats') || result.statsError?.includes('API Version')) {
      sizeText = ' (database size check skipped: MongoDB strict API v1 does not allow dbStats)';
    } else if (result.statsError) {
      sizeText = ` (could not read database size: ${result.statsError})`;
    }

    const viaDocker = result.viaDockerExec ? ' via Docker' : '';
    messages.push(`Connected to ${result.url}, database ${result.name}${viaDocker}${sizeText}`);
    return { status: 'OK', messages, fixes: [] };
  } catch (error) {
    const { url, name } = parseDbConfig(userConfig);
    messages.push(`Could not connect to ${url}`);
    messages.push(String(error instanceof Error ? error.message : error));
    messages.push('');
    messages.push('Possible reasons:');
    messages.push('- MongoDB is not running');
    messages.push('- Wrong db.url in config');
    messages.push('- Docker service is not started');
    messages.push('- Firewall or network issue');
    messages.push(`- Database name: ${name}`);
    return { status: 'FAILED', messages, fixes };
  }
}

/**
 * Clears a cached CommonJS module so trader state is fresh for doctor probes.
 *
 * @param {string} modulePath Absolute path to module file
 */
function clearCachedModule(modulePath) {
  try {
    const resolved = require.resolve(modulePath);
    if (require.cache[resolved]) {
      delete require.cache[resolved];
    }
  } catch {
    // Module was not loaded yet.
  }
}

/**
 * Probes exchange markets using connector-specific APIs (getMarkets or marketInfo).
 *
 * @param {string} traderPath Absolute path to trader module
 * @param {Record<string, unknown>} trader Trader instance
 * @param {string} pair Trading pair
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function probeExchangeMarkets(traderPath, trader, pair) {
  const normalizedPair = configUtil.normalizePair(pair);

  if (typeof trader.getMarkets === 'function') {
    const result = await Promise.resolve(trader.getMarkets(normalizedPair));
    if (result && typeof result === 'object' && 'message' in result && result.message) {
      return { ok: false, message: String(result.message) };
    }
    return { ok: Boolean(result), message: result ? undefined : 'getMarkets returned no data' };
  }

  if (typeof trader.marketInfo === 'function') {
    const traderModule = require(traderPath);
    const deadline = Date.now() + 20000;

    while (Date.now() < deadline) {
      const info = trader.marketInfo(normalizedPair);
      if (info && !(info && typeof info === 'object' && 'message' in info && info.message)) {
        return { ok: true };
      }

      const markets = traderModule.exchangeMarkets;
      if (markets && Object.keys(markets).length > 0) {
        const plainPair = normalizedPair.replace('/', '_');
        if (markets[plainPair] || markets[normalizedPair]) {
          return { ok: true };
        }

        return { ok: false, message: `Pair ${normalizedPair} not found on exchange` };
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return { ok: false, message: 'Timed out waiting for exchange markets to load' };
  }

  return { ok: false, message: 'Exchange connector does not support market probes' };
}

/**
 * @param {MmContext} ctx
 * @param {Record<string, unknown>} userConfig
 * @returns {Promise<DoctorSection>}
 */
async function checkExchangeApi(ctx, userConfig) {
  const exchange = String(userConfig.exchange || '').toLowerCase();
  const pair = String(userConfig.pair || '');

  if (!userConfig.apikey || !userConfig.apisecret ||
      !configUtil.exchangeConnectorExists(String(userConfig.exchange), ctx.packageRoot)) {
    return { status: 'SKIPPED', messages: ['Exchange API checks skipped due to config issues.'], fixes: [] };
  }

  /** Minimal logger for trader modules */
  const log = {
    log() {},
    info() {},
    warn() {},
    error() {},
    debug() {},
    trace() {},
  };

  const traderPath = path.join(ctx.packageRoot, 'trade', `trader_${exchange}`);
  clearCachedModule(traderPath);
  clearCachedModule(path.join(ctx.packageRoot, 'modules/configReader'));

  try {
    process.env.MM_CONFIG_PATH = ctx.configPath;
    const traderFactory = require(traderPath);
    const trader = traderFactory(
        String(userConfig.apikey),
        String(userConfig.apisecret),
        String(userConfig.apipassword || ''),
        log,
        undefined,
        undefined,
        false,
        false,
    );

    const markets = await probeExchangeMarkets(traderPath, trader, pair);
    if (!markets.ok) {
      return {
        status: 'FAILED',
        messages: [`getMarkets failed: ${markets.message || 'unknown error'}`],
        fixes: ['Verify API credentials and exchange status.'],
      };
    }

    if (typeof trader.getBalances !== 'function') {
      return { status: 'OK', messages: [`Exchange ${exchange} API reachable for ${pair}.`], fixes: [] };
    }

    const balances = await trader.getBalances(false);
    if (!balances || balances.message) {
      return {
        status: 'WARNING',
        messages: [`getBalances failed: ${balances?.message || 'unknown error'}`],
        fixes: ['Check API key permissions on the exchange.'],
      };
    }

    return { status: 'OK', messages: [`Exchange ${exchange} API reachable for ${pair}.`], fixes: [] };
  } catch (error) {
    return {
      status: 'FAILED',
      messages: [String(error instanceof Error ? error.message : error)],
      fixes: ['Verify exchange, API keys, and network connectivity.'],
    };
  }
}

/**
 * @param {MmContext} ctx
 * @param {{ preflight?: boolean }} [options]
 * @returns {Promise<DoctorSection>}
 */
async function checkRuntime(ctx, options = {}) {
  if (options.preflight || process.env.MM_PREFLIGHT === '1') {
    return { status: 'SKIPPED', messages: [], fixes: [] };
  }

  /** @type {CheckStatus[]} */
  const statuses = [];
  /** @type {string[]} */
  const messages = [];

  if (ctx.mode === 'docker') {
    const docker = require('../docker');
    const running = await docker.isServiceRunning(ctx, ctx.composeService);
    statuses.push(running ? 'OK' : 'WARNING');
    if (!running) {
      messages.push('Bot process is not running. Start it with ./mm on.');
    }
  } else {
    try {
      const proc = await pm2.getProcess(ctx.pm2ProcessName);
      const desc = pm2.describeProcess(proc);
      statuses.push(desc.running ? 'OK' : 'WARNING');
      if (!desc.running) {
        messages.push('Bot process is not running.');
      }
      if (desc.restarts && desc.restarts > 5) {
        statuses.push('WARNING');
        messages.push(`High restart count: ${desc.restarts}`);
      }
    } catch {
      statuses.push('WARNING');
      messages.push('Could not query PM2 process status.');
    } finally {
      pm2.disconnect();
    }
  }

  const free = os.freemem();
  const total = os.totalmem();
  const memoryThreshold = 256 * 1024 * 1024;
  if (free < memoryThreshold) {
    statuses.push('WARNING');
    messages.push(
        `Low available system memory: ${formatBytes(free)} free of ${formatBytes(total)} total ` +
        `(threshold: ${formatBytes(memoryThreshold)}).`,
    );
  }

  return { status: aggregateStatus(statuses), messages, fixes: [] };
}

/**
 * Runs all doctor checks and returns section results with an exit code.
 *
 * @param {MmContext} ctx Runtime context
 * @returns {Promise<{ code: number, sections: Record<string, DoctorSection>, failed: number, warnings: number }>}
 */
async function collectDoctorReport(ctx, options = {}) {
  const installation = await checkInstallation(ctx);
  const userConfig = configUtil.loadUserConfig(ctx.configPath);
  const config = userConfig ? await checkConfig(ctx) : { status: /** @type {CheckStatus} */ ('FAILED'), messages: ['Config missing.'], fixes: ['mm init'] };
  const mongo = userConfig ? await checkMongo(ctx, userConfig) : { status: /** @type {CheckStatus} */ ('SKIPPED'), messages: [], fixes: [] };
  const exchange = userConfig ? await checkExchangeApi(ctx, userConfig) : { status: /** @type {CheckStatus} */ ('SKIPPED'), messages: [], fixes: [] };
  const runtime = await checkRuntime(ctx, options);
  const logs = { status: /** @type {CheckStatus} */ ('OK'), messages: [], fixes: [] };

  const sections = {
    Installation: installation,
    Config: config,
    MongoDB: mongo,
    'Exchange API': exchange,
    Runtime: runtime,
    Logs: logs,
  };

  const failed = Object.values(sections).filter((s) => s.status === 'FAILED').length;
  const warnings = Object.values(sections).filter((s) => s.status === 'WARNING').length;
  const code = failed > 0 ? 1 : warnings > 0 ? 2 : 0;

  return { code, sections, failed, warnings };
}

/**
 * Runs all doctor sections and prints or JSON-serializes the report.
 *
 * @overload
 * @param {MmContext} ctx Runtime context
 * @param {{ report: true, json?: boolean, silent?: boolean }} options `report` returns full report object
 * @returns {Promise<{ code: number, sections: Record<string, DoctorSection> }>}
 */
/**
 * @overload
 * @param {MmContext} ctx Runtime context
 * @param {{ json?: boolean, silent?: boolean, report?: false }} [options]
 * @returns {Promise<number>} Exit code per doctor specification
 */
/**
 * @param {MmContext} ctx Runtime context
 * @param {{ json?: boolean, silent?: boolean, report?: boolean }} [options] `silent` suppresses human output (used by status)
 * @returns {Promise<number | { code: number, sections: Record<string, DoctorSection> }>}
 */
async function runDoctor(ctx, options = {}) {
  const { code, sections, failed, warnings } = await collectDoctorReport(ctx, options);

  if (options.json) {
    console.log(JSON.stringify({ sections, failed, warnings }, null, 2));
  } else if (!options.silent) {
    console.log(`${terminal.formatTitle(ctx.version, 'Doctor')}\n`);
    for (const [name, section] of Object.entries(sections)) {
      console.log(`${terminal.bold(name)}: ${terminal.formatStatus(section.status)}`);
    }

    if (failed || warnings) {
      console.log(`\n${terminal.bold('Problems found')}: ${terminal.red(String(failed))} failed, ${terminal.yellow(String(warnings))} warning${warnings === 1 ? '' : 's'}`);
      for (const section of Object.values(sections)) {
        if (section.status === 'FAILED') {
          console.log(`\n${terminal.red('FAILED')}:`);
          section.messages.forEach((m) => console.log(terminal.formatUserFacing(ctx, m)));
          if (section.fixes.length) {
            console.log(terminal.yellow('Suggested fix:'));
            section.fixes.forEach((f) => console.log(terminal.highlightUserFacing(ctx, `- ${f}`)));
          }
        } else if (section.status === 'WARNING' && section.messages.length) {
          console.log(`\n${terminal.yellow('WARNING')}:`);
          section.messages.forEach((m) => console.log(terminal.formatUserFacing(ctx, m)));
          if (section.fixes.length) {
            console.log(terminal.yellow('Suggested fix:'));
            section.fixes.forEach((f) => console.log(terminal.highlightUserFacing(ctx, `- ${f}`)));
          }
        }
      }
    }

    console.log('');
  }

  if (options.report) {
    return { code, sections };
  }

  return code;
}

/**
 * CLI handler for `mm doctor`.
 *
 * @param {MmParsedArgs} args Parsed CLI arguments
 * @returns {Promise<number>} Process exit code
 */
async function doctor(args) {
  const ctx = createContext({ mode: args.mode, workDir: args.workDir });
  const result = await runDoctor(ctx, { json: args.json });
  return /** @type {number} */ (result);
}

module.exports = { doctor, runDoctor };
