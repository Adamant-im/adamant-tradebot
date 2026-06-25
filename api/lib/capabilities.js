'use strict';

/**
 * @module api/lib/capabilities
 * @typedef {import('types/webui-api/bot.d.js').WebUiCapabilities} WebUiCapabilities
 * @typedef {import('types/webui-api/bot.d.js').WebUiModuleCapability} WebUiModuleCapability
 */

const fs = require('fs');
const path = require('path');

const config = require('../../modules/configReader');

const TRADE_DIR = path.join(__dirname, '../../trade');

/**
 * Registry of installable MM modules and their WebUI capability metadata.
 * `featureKey` matches `commandTxs` feature identifiers where applicable.
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
    label: 'Price maker',
    tradeParamActiveName: 'mm_isPriceMakerActive',
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
    label: 'Liquidity SS',
  },
  mm_liquidity_safe: {
    id: 'liquidity_safe',
    label: 'Liquidity safe',
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
 * Lists basenames of `trade/mm_*.js` files present in the repository.
 * Open-source builds may ship fewer files than `-me`; WebUI adapts to the list.
 *
 * @returns {string[]} Module names without `.js` extension
 */
function listInstalledMmModules() {
  return fs.readdirSync(TRADE_DIR)
      .filter((name) => name.startsWith('mm_') && name.endsWith('.js'))
      .map((name) => name.replace(/\.js$/, ''));
}

/**
 * Resolves whether an MM module is currently active in trade params.
 *
 * @param {string} moduleName Module basename without `.js`
 * @param {typeof MM_MODULE_REGISTRY[string]} meta Registry metadata
 * @param {Record<string, unknown>} tradeParams Exchange-specific trade params object
 * @returns {boolean | null} `null` when active state is not tracked via trade params
 */
function resolveModuleActive(moduleName, meta, tradeParams) {
  // Nice Chart follows global config, not a `mm_is*` trade param.
  if (moduleName === 'mm_nice_chart') {
    return config.nice_chart?.enabled !== false;
  }

  if (!meta.tradeParamActiveName) {
    return null;
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
 * Builds capability descriptors for installed MM modules and exchange connector flags.
 *
 * @param {Record<string, unknown>} [exchangeFeatures={}] Result of `trader.features(pair)`
 * @returns {WebUiCapabilities}
 */
function getBotCapabilities(exchangeFeatures = {}) {
  const tradeParams = require('../../trade/settings/tradeParams_' + config.exchange);
  const installed = listInstalledMmModules();

  const modules = installed.map((moduleName) => {
    const meta = MM_MODULE_REGISTRY[moduleName] || {
      id: moduleName.replace(/^mm_/, ''),
      label: moduleName.replace(/^mm_/, '').replace(/_/g, ' '),
    };

    return {
      id: meta.id,
      file: moduleName,
      featureKey: meta.featureKey,
      label: meta.label,
      installed: true,
      active: resolveModuleActive(moduleName, meta, tradeParams),
      perpetual: meta.perpetual,
    };
  });

  return {
    modules,
    exchangeFeatures,
  };
}

module.exports = {
  MM_MODULE_REGISTRY,
  listInstalledMmModules,
  getBotCapabilities,
};
