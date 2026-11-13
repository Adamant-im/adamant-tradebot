'use strict';

/**
 * Builds WebUI capability metadata: installed MM modules, `/enable` feature codes, and exchange flags.
 *
 * Module availability follows the same rule as `modules/commands/features.js`:
 * optional `trade/features/mm_*.js` files are checked on disk (same paths as `getFeatureModule()`
 * / `utils.softRequire()` in command handlers) so trimmed OSS builds expose missing
 *
 * @module api/lib/capabilities
 * @typedef {import('types/webui-api/bot.d.js').WebUiCapabilities} WebUiCapabilities
 * @typedef {import('types/webui-api/bot.d.js').WebUiModuleCapability} WebUiModuleCapability
 * @typedef {import('types/webui-api/bot.d.js').WebUiFeatureCapability} WebUiFeatureCapability
 * @typedef {import('types/bot/commandTxs.d.js').BotFeatureDefinition} BotFeatureDefinition
 */

const fs = require('fs');
const path = require('path');

const config = require('../../modules/configReader');
const { botFeatures } = require('../../modules/commands/botFeaturesRegistry');
const { isPriceSupportActive } = require('../../helpers/priceSupport');

/**
 * Same behaviour as `helpers/utils.capitalize` — kept local so this module
 * does not pull `utils` into lightweight API paths.
 *
 * @param {string} [str='']
 * @returns {string}
 */
function capitalize(str = '') {
  if (!str) {
    return '';
  }
  return str[0].toUpperCase() + str.slice(1);
}

const TRADE_FEATURES_DIR = path.join(__dirname, '../../trade/features');
const COMMANDS_DIR = path.join(__dirname, '../../modules/commands');

/** Relative `softRequire` base used by both command handlers and this module. */
const TRADE_MODULE_PREFIX = '../../trade/features/';

/**
 * Registry of installable MM modules and their WebUI capability metadata.
 *
 * `featureKey` matches {@link botFeatures} / `commandTxs` identifiers where applicable.
 * Modules without a command feature (Nice Chart, TWAP file-only helpers, …) omit `featureKey`.
 *
 * @type {Record<string, {
 *   id: string,
 *   featureKey?: string,
 *   label: string,
 *   tradeParamActiveName?: string,
 *   requires?: string,
 *   perpetual?: boolean
 * }>}
 */
const MM_MODULE_REGISTRY = {
  mm_trader: {
    id: 'trader',
    featureKey: 't',
    label: 'Trading volume',
    tradeParamActiveName: 'mm_isTraderActive',
    perpetual: true,
  },
  mm_orderbook_builder: {
    id: 'orderbook_builder',
    featureKey: 'ob',
    label: 'Dynamic order book building',
    tradeParamActiveName: 'mm_isOrderBookActive',
    perpetual: true,
  },
  mm_liquidity_provider: {
    id: 'liquidity_provider',
    featureKey: 'liq',
    label: 'Liquidity and spread maintenance',
    tradeParamActiveName: 'mm_isLiquidityActive',
  },
  mm_price_watcher: {
    id: 'price_watcher',
    featureKey: 'pw',
    label: 'Price watching',
    tradeParamActiveName: 'mm_isPriceWatcherActive',
  },
  mm_price_maker: {
    id: 'price_maker',
    featureKey: 'pmv',
    label: 'Price maker',
    tradeParamActiveName: 'mm_isPriceChangeVolumeActive',
  },
  mm_cleaner: {
    id: 'cleaner',
    featureKey: 'cl',
    label: 'Order book cleaner',
    tradeParamActiveName: 'mm_isCleanerActive',
  },
  mm_fund_balancer: {
    id: 'fund_balancer',
    featureKey: 'fb',
    label: '2-key trading fund balancer',
    tradeParamActiveName: 'mm_isFundBalancerActive',
    requires: 'mm_isTraderActive',
  },
  mm_antigap: {
    id: 'antigap',
    featureKey: 'ag',
    label: 'Order book anti-gap',
    tradeParamActiveName: 'mm_isAntigapActive',
  },
  mm_ladder: {
    id: 'ladder',
    featureKey: 'ld',
    label: 'Ladder/grid trading',
    tradeParamActiveName: 'mm_isLadderActive',
  },
  mm_twap: {
    id: 'twap',
    label: 'TWAP orders',
    tradeParamActiveName: 't_isTwapActive',
  },
  mm_volume_volatility: {
    id: 'volume_volatility',
    featureKey: 'vv',
    label: 'Volume volatility',
    tradeParamActiveName: 'mm_isVolumeVolatilityActive',
    requires: 'mm_isTraderActive',
  },
  mm_volatility_chart: {
    id: 'volatility_chart',
    featureKey: 'vc',
    label: 'Volatility chart',
    tradeParamActiveName: 'mm_isVolatilityActive',
    requires: 'mm_isTraderActive',
  },
  mm_balance_watcher: {
    id: 'balance_watcher',
    featureKey: 'bw',
    label: 'Balance watching',
    tradeParamActiveName: 'mm_isBalanceWatcherActive',
  },
  mm_quote_hunter: {
    id: 'quote_hunter',
    featureKey: 'qh',
    label: 'Quote hunter',
    tradeParamActiveName: 'mm_isQuoteHunterActive',
  },
  mm_spread_maintainer: {
    id: 'spread_maintainer',
    featureKey: 'sm',
    label: 'Spread maintainer',
    tradeParamActiveName: 'mm_isSpreadMaintainerActive',
  },
  mm_balance_equalizer: {
    id: 'balance_equalizer',
    featureKey: 'be',
    label: 'Balance equalizer',
    tradeParamActiveName: 'mm_isBalanceEqualizerActive',
  },
  mm_order_notifier: {
    id: 'order_notifier',
    featureKey: 'on',
    label: 'Order notifier',
    tradeParamActiveName: 'mm_isOrderNotifierActive',
    perpetual: true,
  },
  mm_nice_chart: {
    id: 'nice_chart',
    label: 'Nice Chart',
  },
  mm_fund_supplier: {
    id: 'fund_supplier',
    label: 'Fund supplier',
  },
  mm_liquidity_ss: {
    id: 'liquidity_ss',
    label: 'Spread support',
  },
  mm_liquidity_safe: {
    id: 'liquidity_safe',
    label: 'Safe liquidity',
  },
  mm_orderbook_spread: {
    id: 'orderbook_spread',
    label: 'Order book spread',
  },
  mm_trader_sbw: {
    id: 'trader_sbw',
    label: 'Sniper bot watcher',
  },
};

/**
 * Returns whether a trade module file is present in this build.
 *
 * Uses the same relative paths as {@link botFeatures} and `getFeatureModule()` in
 * `modules/commands/features.js`. Command handlers load via `utils.softRequire()`;
 * here we only check disk presence so WebUI API stays lightweight and does not pull
 * the full command context at startup.
 *
 * @param {string | undefined} modulePath Relative path such as `../../trade/features/mm_trader`
 * @returns {boolean}
 */
function isTradeModuleAvailable(modulePath) {
  if (!modulePath) {
    return true;
  }

  const moduleFile = path.resolve(__dirname, `${modulePath}.js`);
  return fs.existsSync(moduleFile);
}

/**
 * Returns whether an optional command pack exists (`modules/commands/<name>.js`).
 *
 * Used for Transfer / Withdraw (`assets`) and other trimmed-build command files.
 *
 * @param {string} name Basename without `.js`, e.g. `assets`
 * @returns {boolean}
 */
function isCommandModuleAvailable(name) {
  return fs.existsSync(path.join(COMMANDS_DIR, `${name}.js`));
}

/**
 * Order-purpose keys from `orderCollector`, plus `ld2` and `unk`.
 * WebUI uses this for Close orders / Orders query dropdowns.
 *
 * @returns {Array<{ key: string, label: string }>}
 */
function listOrderPurposes() {
  try {
    const orderCollector = require('../../trade/orderCollector');
    const entries = Object.entries(orderCollector.orderPurposes || {}).map(([key, label]) => ({
      key,
      label: String(label),
    }));
    // Ladder 2 is stored as purpose `ld` + moduleIndex 2. Keep it out of
    // `orderCollector.orderPurposes` (parsePurpose / ordersByPurpose) and list
    // it here so WebUI filters can select `ld2`.
    const ldIndex = entries.findIndex((item) => item.key === 'ld');
    if (ldIndex >= 0 && !entries.some((item) => item.key === 'ld2')) {
      entries.splice(ldIndex + 1, 0, { key: 'ld2', label: 'Ladder' });
    }
    if (!entries.some((item) => item.key === 'unk')) {
      entries.push({ key: 'unk', label: 'Unknown order' });
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Converts a `botFeatures` module path to a `trade/features/mm_*.js` basename.
 *
 * @param {string | undefined} modulePath Relative path from {@link botFeatures}
 * @returns {string | undefined} Basename without extension, e.g. `mm_trader`
 */
function modulePathToBasename(modulePath) {
  if (!modulePath) {
    return undefined;
  }

  return path.basename(modulePath).replace(/\.js$/, '');
}

/**
 * Lists basenames of `trade/features/mm_*.js` files present on disk in this build.
 *
 * Open-source and trimmed `-me` builds may ship fewer files; WebUI adapts to the list.
 * Use {@link isTradeModuleAvailable} for loadability — a file can exist but fail to load.
 *
 * @returns {string[]} Module names without `.js` extension
 */
function listInstalledMmModules() {
  return fs.readdirSync(TRADE_FEATURES_DIR)
      .filter((name) => name.startsWith('mm_') && name.endsWith('.js'))
      .map((name) => name.replace(/\.js$/, ''));
}

/**
 * Resolves whether an MM module is currently active in trade params.
 *
 * @param {string} moduleName Module basename without `.js`, e.g. `mm_trader`
 * @param {typeof MM_MODULE_REGISTRY[string]} meta Registry metadata
 * @param {Record<string, unknown>} tradeParams Exchange-specific trade params object
 * @returns {boolean | null} `null` when active state is not tracked via trade params
 */
function resolveModuleActive(moduleName, meta, tradeParams) {
  const modulePath = `${TRADE_MODULE_PREFIX}${moduleName}`;
  const modulePresent = isTradeModuleAvailable(modulePath);

  // Nice Chart and Sniper Bot Watcher follow global config, not `mm_is*` trade params.
  if (moduleName === 'mm_nice_chart') {
    return modulePresent && config.nice_chart?.enabled !== false;
  }

  if (moduleName === 'mm_trader_sbw') {
    return modulePresent && config.sniper_bot_watcher?.sbwEnabled !== false;
  }

  if (!meta.tradeParamActiveName) {
    return null;
  }

  if (!modulePresent) {
    return false;
  }

  const activeValue = tradeParams[meta.tradeParamActiveName];
  if (activeValue === undefined) {
    return null;
  }

  if (meta.requires) {
    const requiredActive = tradeParams[meta.requires];
    return Boolean(activeValue && requiredActive);
  }

  return Boolean(activeValue);
}

/**
 * Resolves whether a command feature is active from trade params.
 *
 * When `requires` is set (e.g. volatility chart needs trader), both flags must be truthy.
 *
 * @param {BotFeatureDefinition} featureDef Entry from {@link botFeatures}
 * @param {Record<string, unknown>} tradeParams Exchange-specific trade params object
 * @returns {boolean | null} `null` when the active param is absent from this exchange profile
 */
function resolveFeatureActive(featureDef, tradeParams) {
  if (featureDef.tradeParamActiveName === 'mm_isPriceSupportActive') {
    return isPriceSupportActive(tradeParams);
  }

  const activeValue = tradeParams[featureDef.tradeParamActiveName];
  if (activeValue === undefined) {
    return null;
  }

  if (featureDef.requires) {
    const requiredActive = tradeParams[featureDef.requires];
    return Boolean(activeValue && requiredActive);
  }

  return Boolean(activeValue);
}

/**
 * Builds capability descriptors for `/enable` feature codes (`t`, `ob`, `liq`, …).
 *
 * Every known feature is listed; `moduleAvailable` is `false` when the backing
 * `trade/features/mm_*.js` file is omitted from the build (same rule as `/enable` validation).
 *
 * @param {Record<string, unknown>} tradeParams Exchange-specific trade params object
 * @returns {WebUiFeatureCapability[]}
 */
function buildFeatureCapabilities(tradeParams) {
  return Object.entries(botFeatures).map(([featureKey, featureDef]) => {
    const file = modulePathToBasename(featureDef.module);

    return {
      featureKey,
      description: capitalize(featureDef.description),
      file,
      moduleAvailable: isTradeModuleAvailable(featureDef.module),
      active: resolveFeatureActive(featureDef, tradeParams),
      perpetual: featureDef.perpetual,
      requires: featureDef.requires,
    };
  });
}

/**
 * Builds capability descriptors for installed `trade/features/mm_*.js` modules.
 *
 * @param {Record<string, unknown>} tradeParams Exchange-specific trade params object
 * @returns {WebUiModuleCapability[]}
 */
function buildModuleCapabilities(tradeParams) {
  const installed = listInstalledMmModules();

  return installed.map((moduleName) => {
    const meta = MM_MODULE_REGISTRY[moduleName] || {
      id: moduleName.replace(/^mm_/, ''),
      label: moduleName.replace(/^mm_/, '').replace(/_/g, ' '),
    };

    const modulePath = `${TRADE_MODULE_PREFIX}${moduleName}`;

    return {
      id: meta.id,
      file: moduleName,
      featureKey: meta.featureKey,
      label: meta.label,
      installed: true,
      moduleAvailable: isTradeModuleAvailable(modulePath),
      active: resolveModuleActive(moduleName, meta, tradeParams),
      perpetual: meta.perpetual,
    };
  });
}

/**
 * Builds capability descriptors for installed MM modules, command features, and exchange flags.
 *
 * Called on every `GET /api/v1/bot` (not cached at startup) so file-based availability
 * reflects the current build without restart.
 *
 * @param {Record<string, unknown>} [exchangeFeatures={}] Result of `trader.features(pair)`
 * @returns {WebUiCapabilities}
 */
function getBotCapabilities(exchangeFeatures = {}) {
  const tradeParams = require('../../trade/settings/tradeParams_' + config.exchange);

  return {
    modules: buildModuleCapabilities(tradeParams),
    features: buildFeatureCapabilities(tradeParams),
    exchangeFeatures,
    commandModules: {
      assets: isCommandModuleAvailable('assets'),
      twap: isCommandModuleAvailable('twap'),
      make: isCommandModuleAvailable('make'),
    },
    orderPurposes: listOrderPurposes(),
  };
}

module.exports = {
  MM_MODULE_REGISTRY,
  isTradeModuleAvailable,
  isCommandModuleAvailable,
  listInstalledMmModules,
  getBotCapabilities,
};
