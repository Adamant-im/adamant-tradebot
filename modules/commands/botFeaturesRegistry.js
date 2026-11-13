'use strict';

/**
 * Static registry of `/enable` and `/disable` feature metadata.
 *
 * Kept in a dependency-free module so WebUI API (`api/lib/capabilities.js`) and
 * command handlers (`modules/commands/features.js`) share one source of truth without
 * loading the full command context.
 *
 * @module modules/commands/botFeaturesRegistry
 * @typedef {import('types/bot/commandTxs.d.js').BotFeaturesRegistry} BotFeaturesRegistry
 */

// Broader than orderCollector.orderPurposes because not all features have their own order purpose.
/** @type {BotFeaturesRegistry} */
const botFeatures = {
  t: {
    description: 'making trading volume',
    module: '../../trade/features/mm_trader',
    tradeParamActiveName: 'mm_isTraderActive',
    perpetual: false,
  },
  ob: {
    description: 'dynamic order book building',
    module: '../../trade/features/mm_orderbook_builder',
    tradeParamActiveName: 'mm_isOrderBookActive',
    perpetual: false,
  },
  liq: {
    description: 'liquidity and spread maintenance',
    module: '../../trade/features/mm_liquidity_provider',
    tradeParamActiveName: 'mm_isLiquidityActive',
    perpetual: false,
  },
  pw: {
    description: 'price watching',
    module: '../../trade/features/mm_price_watcher',
    tradeParamActiveName: 'mm_isPriceWatcherActive',
    perpetual: false,
  },
};

module.exports = {
  botFeatures,
};
