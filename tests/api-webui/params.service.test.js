'use strict';

/* global jest, describe, test, expect, beforeEach, afterEach */

const tradeParamsState = {
  mm_isActive: true,
  mm_Policy: 'optimal',
  mm_minAmount: 1,
  mm_maxAmount: 2,
  mm_intervalUnitUI: 'min',
  mm_minInterval: 60_000,
  mm_maxInterval: 120_000,
  mm_buyPercent: 0.5,
  mm_isTraderActive: false,
  mm_traderObLimitPercent: 0,
  mm_isOrderBookActive: false,
  mm_orderBookOrdersCount: 10,
  mm_orderBookMaxOrderPercent: 100,
  mm_isLiquidityActive: false,
  mm_liquiditySpreadPercent: 1,
  mm_liquiditySpreadPercentMin: 0,
  mm_liquiditySellAmount: 1,
  mm_liquidityBuyQuoteAmount: 100,
  mm_liquidityTrend: 'middle',
  mm_liquiditySpreadSupport: false,
  mm_priceWatcherMidPriceInSourceCoin: 0,
  mm_isPriceWatcherActive: false,
  mm_priceWatcherSource: '#',
  mm_priceWatcherLowPriceInSourceCoin: 0,
  mm_priceWatcherHighPriceInSourceCoin: 0,
  mm_priceWatcherDeviationPercent: 1,
  mm_priceWatcherSourcePolicy: 'smart',
  mm_priceWatcherAction: 'prevent',
  mm_isPriceMakerActive: false,
  mm_priceMakerInitiator: '',
  mm_isCleanerActive: false,
  mm_cleanerPolicy: 'minimumSpread',
  mm_isFundBalancerActive: false,
  mm_isAntigapActive: false,
  mm_antigapMaxOrderPercent: 100,
  mm_isPriceSupportActive: false,
  mm_priceSupportLowPrice: 0,
  mm_isBalanceWatcherActive: false,
  mm_isLadderActive: false,
  mm_ladderAmount: 0,
  mm_ladderAmountCoin: 'USDT',
  mm_ladderCount: 10,
  mm_ladderPriceStepPercent: 1,
  mm_ladderMidPrice: 0,
  mm_ladderMidPriceType: 'auto',
  mm_ladderAmountGain: 0,
  mm_ladderSellAmountAdjPercent: 0,
  mm_ladderBuyAmountAdjPercent: 0,
  mm_ladderSellPriceAdjPercent: 0,
  mm_ladderBuyPriceAdjPercent: 0,
  mm_ladderAutoAmountAdj: false,
  mm_isQuoteHunterActive: false,
  mm_quoteHunterPolicy: 'dump',
  mm_quoteHunterMaxOrderDumpPercent: 2,
  mm_quoteHunterMax1hDumpPercent: 1,
  mm_quoteHunterMax24hDumpPercent: 3,
  mm_isVolatilityActive: false,
  mm_volatilityRate: 'normal',
  mm_isVolumeVolatilityActive: false,
  mm_isPriceChangeVolumeActive: false,
  mm_isBalanceEqualizerActive: false,
  mm_balanceEqualizerStrategy: 'market',
  mm_balanceEqualizerMaxSlippagePercent: 1,
  mm_isSpreadMaintainerActive: false,
  mm_isOrderNotifierActive: false,
  mm_orderNotifierAmount: 0,
  mm_orderNotifierAmountPriority: 0,
  mm_orderNotifierAmountCoin: '',
  t_isTwapActive: false,
};

jest.mock('../../modules/configReader', () => ({
  exchange: 'binance',
  coin1: 'ETH',
  coin2: 'USDT',
  pair: 'ETH/USDT',
  apikey2: false,
  nice_chart: { enabled: true, failedRequestsBeforeFallback: 3 },
  sniper_bot_watcher: { sbwEnabled: true, safeModeThreshold: 3, resetThreshold: 10 },
  configFile: '../config.default.jsonc',
}));

jest.mock('../../trade/settings/tradeParams_binance', () => tradeParamsState, { virtual: true });

jest.mock('../../modules/commandTxs', () => ({
  commands: {
    saveConfig: jest.fn(),
    amount: jest.fn(() => ({})),
    interval: jest.fn(() => ({})),
    buypercent: jest.fn(() => ({})),
    enable: jest.fn(async () => ({ isError: false, msgSendBack: 'ok' })),
  },
}));

jest.mock('../../modules/mm/config-util', () => ({
  updateConfigKey: jest.fn(),
  updateConfigNestedKeys: jest.fn(),
}));

jest.mock('../../helpers/log', () => ({
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../helpers/cryptos/exchanger', () => ({
  convertCryptos: (from, to, amount) => ({ outAmount: from === to ? amount : 0 }),
}));

jest.mock('../../trade/orderUtils', () => ({
  parseMarket: () => ({ coin1Decimals: 8, coin2Decimals: 8 }),
}));

const { getCurrentParams, setParams } = require('../../api/services/params');
const tradeParams = require('../../trade/settings/tradeParams_binance');
const { commands } = require('../../modules/commandTxs');
const { updateConfigKey, updateConfigNestedKeys } = require('../../modules/mm/config-util');
const config = require('../../modules/configReader');
const log = require('../../helpers/log');

/**
 * Jest mock of a production export (tsc sees the real function type).
 *
 * @param {(...args: any[]) => any} fn
 * @returns {jest.Mock}
 */
function asMock(fn) {
  return /** @type {jest.Mock} */ (fn);
}

/**
 * First argv token of each `/enable` call (`ld`, `liq`, `ob`, …).
 *
 * @returns {string[]}
 */
function enabledModules() {
  return asMock(commands.enable).mock.calls.map(([argv]) => argv[0]);
}

describe('params service mm.isActive', () => {
  beforeEach(() => {
    tradeParams.mm_isActive = true;
  });

  /**
   * @param {boolean} isActive
   * @returns {Promise<void>}
   */
  async function putIsActive(isActive) {
    const snapshot = getCurrentParams();
    snapshot.mm.isActive = isActive;
    await setParams(snapshot);
  }

  test('PUT snapshot with mm.isActive false stops market-making', async () => {
    await putIsActive(false);
    expect(getCurrentParams().mm.isActive).toBe(false);
    expect(tradeParams.mm_isActive).toBe(false);
  });

  test('PUT snapshot with mm.isActive true starts market-making', async () => {
    tradeParams.mm_isActive = false;
    await putIsActive(true);
    expect(getCurrentParams().mm.isActive).toBe(true);
    expect(tradeParams.mm_isActive).toBe(true);
  });

  test('round-trip false then true persists both transitions', async () => {
    await putIsActive(false);
    expect(tradeParams.mm_isActive).toBe(false);
    await putIsActive(true);
    expect(tradeParams.mm_isActive).toBe(true);
  });

  test('PUT mm.isActive true from false stamps mm_generalInitTs', async () => {
    tradeParams.mm_isActive = false;
    tradeParams.mm_generalInitTs = 0;
    const before = Date.now();
    await putIsActive(true);
    expect(tradeParams.mm_generalInitTs).toBeGreaterThanOrEqual(before);
    expect(tradeParams.mm_generalRestartTs).toBe(tradeParams.mm_generalInitTs);
  });

  test('PUT mm.isActive true when already active does not restamp mm_generalInitTs', async () => {
    tradeParams.mm_isActive = true;
    tradeParams.mm_Policy = 'optimal';
    tradeParams.mm_generalInitTs = 123;
    tradeParams.mm_generalRestartTs = 123;
    const snapshot = getCurrentParams();
    snapshot.mm.strategy = 'spread';
    await setParams(snapshot);
    expect(tradeParams.mm_isActive).toBe(true);
    expect(tradeParams.mm_generalInitTs).toBe(123);
    expect(tradeParams.mm_generalRestartTs).toBe(123);
    tradeParams.mm_Policy = 'optimal';
  });
});

describe('params service PUT slice isolation', () => {
  beforeEach(() => {
    asMock(commands.enable).mockClear();
    asMock(commands.amount).mockClear();
    asMock(commands.interval).mockClear();
    asMock(commands.buypercent).mockClear();
    asMock(updateConfigKey).mockClear();
    asMock(updateConfigNestedKeys).mockClear();
    asMock(log.log).mockClear();

    tradeParams.mm_isLiquidityActive = true;
    tradeParams.mm_liquiditySpreadPercent = 1;
    tradeParams.mm_isOrderBookActive = true;
    tradeParams.mm_orderBookOrdersCount = 10;
    tradeParams.mm_isAntigapActive = true;
    tradeParams.mm_isPriceWatcherActive = true;
    tradeParams.mm_priceWatcherSource = 'binance';
    tradeParams.mm_isCleanerActive = true;
    tradeParams.mm_isLadderActive = true;
    tradeParams.mm_ladderAmount = 100;
    tradeParams.mm_ladderMidPrice = 1.2345;
    tradeParams.mm_ladderMidPriceType = 'Calculated';
    tradeParams.mm_ladderPriceStepPercent = 1;
    tradeParams.mm_ladderReInit = false;
    tradeParams.mm_isLadderActive2 = true;
    tradeParams.mm_ladderAmount2 = 50;
    tradeParams.mm_ladderMidPrice2 = 2.5;
    tradeParams.mm_ladderMidPriceType2 = 'Calculated';
  });

  afterEach(() => {
    tradeParams.mm_isLiquidityActive = false;
    tradeParams.mm_isOrderBookActive = false;
    tradeParams.mm_isAntigapActive = false;
    tradeParams.mm_isPriceWatcherActive = false;
    tradeParams.mm_priceWatcherSource = '#';
    tradeParams.mm_isCleanerActive = false;
    tradeParams.mm_isLadderActive = false;
    tradeParams.mm_ladderAmount = 0;
    tradeParams.mm_ladderMidPrice = 0;
    tradeParams.mm_ladderMidPriceType = 'auto';
    tradeParams.mm_ladderPriceStepPercent = 1;
    tradeParams.mm_isLadderActive2 = false;
    tradeParams.mm_ladderAmount2 = 0;
    tradeParams.mm_ladderMidPrice2 = 0;
    tradeParams.mm_ladderMidPriceType2 = 'auto';
    tradeParams.mm_priceWatcherMidPriceInSourceCoin = 0;
    tradeParams.mm_priceWatcherLowPriceInSourceCoin = 0;
    tradeParams.mm_priceWatcherHighPriceInSourceCoin = 0;
    tradeParams.mm_priceWatcherDeviationPercent = 1;
    tradeParams.mm_priceSupportLowPrice = 0;
    tradeParams.mm_isPriceSupportActive = false;
    tradeParams.mm_orderNotifierAmount = 0;
    tradeParams.mm_orderNotifierAmountPriority = 0;
    tradeParams.mm_orderNotifierAmountCoin = '';
    config.nice_chart.enabled = true;
    config.nice_chart.failedRequestsBeforeFallback = 3;
    config.sniper_bot_watcher.sbwEnabled = true;
    config.sniper_bot_watcher.safeModeThreshold = 3;
    config.sniper_bot_watcher.resetThreshold = 10;
  });

  test('changing liquidity does not re-enable other modules or rewrite auto ladder mid', async () => {
    const snapshot = getCurrentParams();
    snapshot.liquiditySpread.spread = 2;
    snapshot.ladder.midPrice = 0;
    snapshot.ladder2.midPrice = 0;

    await setParams(snapshot);

    expect(enabledModules()).toEqual(['liq']);
    expect(tradeParams.mm_liquiditySpreadPercent).toBe(2);
    expect(tradeParams.mm_ladderMidPrice).toBe(1.2345);
    expect(tradeParams.mm_ladderMidPriceType).toBe('Calculated');
    expect(tradeParams.mm_ladderMidPrice2).toBe(2.5);
    expect(tradeParams.mm_ladderReInit).toBe(false);
    expect(tradeParams.mm_orderBookOrdersCount).toBe(10);
    expect(tradeParams.mm_isOrderBookActive).toBe(true);
    expect(tradeParams.mm_isPriceWatcherActive).toBe(true);
    expect(tradeParams.mm_isCleanerActive).toBe(true);
    expect(updateConfigKey).not.toHaveBeenCalled();
    expect(updateConfigNestedKeys).not.toHaveBeenCalled();
  });

  test('WebUI PW defaults do not re-enable an unchanged range', async () => {
    tradeParams.mm_isPriceWatcherActive = true;
    tradeParams.mm_priceWatcherMidPriceInSourceCoin = 1.5;
    tradeParams.mm_priceWatcherLowPriceInSourceCoin = 1;
    tradeParams.mm_priceWatcherHighPriceInSourceCoin = 2;
    tradeParams.mm_priceWatcherSource = 'USDT';
    const snapshot = getCurrentParams();
    snapshot.liquiditySpread.spread = 2;
    snapshot.priceWatching.policy = 'smart';

    await setParams(snapshot);

    expect(enabledModules()).toEqual(['liq']);
  });

  test('changing ladder step re-enables only that ladder', async () => {
    const snapshot = getCurrentParams();
    snapshot.ladder.stepPercent = 1.5;

    await setParams(snapshot);

    expect(enabledModules()).toEqual(['ld']);
    expect(tradeParams.mm_ladderPriceStepPercent).toBe(1.5);
    expect(tradeParams.mm_isOrderBookActive).toBe(true);
    expect(tradeParams.mm_isLiquidityActive).toBe(true);
  });

  test('changing order-book max orders does not re-enable liquidity or ladder', async () => {
    const snapshot = getCurrentParams();
    snapshot.orderbookBuilding.maxOrders = 24;

    await setParams(snapshot);

    expect(enabledModules()).toEqual(['ob']);
    expect(tradeParams.mm_orderBookOrdersCount).toBe(24);
    expect(tradeParams.mm_liquiditySpreadPercent).toBe(1);
    expect(tradeParams.mm_ladderMidPrice).toBe(1.2345);
  });

  test('disabled orderbook persists maxOrders without /enable', async () => {
    tradeParams.mm_isOrderBookActive = false;
    const snapshot = getCurrentParams();
    snapshot.orderbookBuilding.maxOrders = 24;

    await setParams(snapshot);

    expect(enabledModules()).toEqual([]);
    expect(tradeParams.mm_orderBookOrdersCount).toBe(24);
    expect(tradeParams.mm_isOrderBookActive).toBe(false);
  });

  test('disabled trader PUT does not apply obLimitPercent', async () => {
    tradeParams.mm_isTraderActive = false;
    tradeParams.mm_traderObLimitPercent = 3;
    const snapshot = getCurrentParams();
    snapshot.trader.obLimitPercent = 7;

    await setParams(snapshot);

    expect(enabledModules()).toEqual([]);
    expect(tradeParams.mm_traderObLimitPercent).toBe(3);
    expect(tradeParams.mm_isTraderActive).toBe(false);
  });

  test('amount change with trader enabled does not /enable t', async () => {
    tradeParams.mm_isTraderActive = true;
    const snapshot = getCurrentParams();
    snapshot.amount.to = 9;

    await setParams(snapshot);

    expect(enabledModules()).toEqual([]);
    expect(commands.amount).toHaveBeenCalled();
    expect(tradeParams.mm_isTraderActive).toBe(true);
  });

  test('disabled price watching persists source without /enable', async () => {
    tradeParams.mm_isPriceWatcherActive = false;
    tradeParams.mm_priceWatcherSource = 'kraken';
    const snapshot = getCurrentParams();
    snapshot.priceWatching.source = 'binance';
    snapshot.priceWatching.deviation = 2.5;

    await setParams(snapshot);

    expect(enabledModules()).toEqual([]);
    expect(tradeParams.mm_priceWatcherSource).toBe('ETH/USDT@binance');
    expect(tradeParams.mm_priceWatcherDeviationPercent).toBe(2.5);
    expect(tradeParams.mm_isPriceWatcherActive).toBe(false);
  });

  test('disabled price watching range persists currency, not pair@exchange', async () => {
    tradeParams.mm_isPriceWatcherActive = false;
    const snapshot = getCurrentParams();
    snapshot.priceWatching.type = 'price';
    snapshot.priceWatching.currency = 'USDT';
    snapshot.priceWatching.priceFrom = 1;
    snapshot.priceWatching.priceTo = 2;
    snapshot.priceWatching.source = 'binance';

    await setParams(snapshot);

    expect(enabledModules()).toEqual([]);
    expect(tradeParams.mm_priceWatcherSource).toBe('USDT');
    expect(tradeParams.mm_priceWatcherLowPriceInSourceCoin).toBe(1);
    expect(tradeParams.mm_priceWatcherHighPriceInSourceCoin).toBe(2);
    expect(tradeParams.mm_priceWatcherMidPriceInSourceCoin).toBe(1.5);
    expect(tradeParams.mm_isPriceWatcherActive).toBe(false);
  });

  test('enabled price range bound change still /enable pw', async () => {
    tradeParams.mm_isPriceWatcherActive = true;
    tradeParams.mm_priceWatcherMidPriceInSourceCoin = 1.5;
    tradeParams.mm_priceWatcherLowPriceInSourceCoin = 1;
    tradeParams.mm_priceWatcherHighPriceInSourceCoin = 2;
    tradeParams.mm_priceWatcherSource = 'USDT';
    const snapshot = getCurrentParams();
    snapshot.priceWatching.priceTo = 3;

    await setParams(snapshot);

    expect(enabledModules()).toEqual(['pw']);
    expect(asMock(commands.enable).mock.calls[0][0]).toEqual([
      'pw',
      '1-3',
      'USDT',
      snapshot.priceWatching.action,
      '-y',
    ]);
    expect(tradeParams.mm_priceWatcherHighPriceInSourceCoin).toBe(3);
    expect(tradeParams.mm_isPriceWatcherActive).toBe(true);
  });

  test('enabled price range PUT does not persist when /enable pw rejects', async () => {
    tradeParams.mm_isPriceWatcherActive = true;
    tradeParams.mm_priceWatcherLowPriceInSourceCoin = 1;
    tradeParams.mm_priceWatcherHighPriceInSourceCoin = 2;
    tradeParams.mm_priceWatcherSource = 'USDT';
    asMock(commands.enable).mockResolvedValueOnce({
      isError: true,
      errorField: 'priceWatching',
      msgSendBack: 'Support price 0.5 USDT is greater, than Price watcher\'s lower bound of 0.1 USDT.',
    });
    const snapshot = getCurrentParams();
    snapshot.priceWatching.priceTo = 3;

    await expect(setParams(snapshot)).rejects.toMatchObject({
      statusCode: 400,
      details: { fields: { priceWatching: expect.stringMatching(/Support price/) } },
    });
    expect(tradeParams.mm_priceWatcherHighPriceInSourceCoin).toBe(2);
    expect(tradeParams.mm_isActive).toBe(true);
  });

  test('rejected /enable pw does not start MM from the same PUT', async () => {
    tradeParams.mm_isActive = false;
    tradeParams.mm_isPriceWatcherActive = true;
    tradeParams.mm_priceWatcherLowPriceInSourceCoin = 1;
    tradeParams.mm_priceWatcherHighPriceInSourceCoin = 2;
    tradeParams.mm_priceWatcherSource = 'USDT';
    asMock(commands.enable).mockResolvedValueOnce({
      isError: true,
      errorField: 'priceWatching',
      msgSendBack: 'Support price 0.5 USDT is greater, than Price watcher\'s lower bound of 0.1 USDT.',
    });
    const snapshot = getCurrentParams();
    snapshot.mm.isActive = true;
    snapshot.priceWatching.priceTo = 3;

    await expect(setParams(snapshot)).rejects.toMatchObject({
      statusCode: 400,
      details: { fields: { priceWatching: expect.stringMatching(/Support price/) } },
    });
    expect(tradeParams.mm_isActive).toBe(false);
    expect(tradeParams.mm_priceWatcherHighPriceInSourceCoin).toBe(2);
    tradeParams.mm_isActive = true;
  });

  test('enabled source-follow /enable pw gets PAIR@Exchange', async () => {
    tradeParams.mm_isPriceWatcherActive = false;
    tradeParams.mm_priceWatcherSource = '#';
    const snapshot = getCurrentParams();
    snapshot.priceWatching.type = 'source';
    snapshot.priceWatching.enabled = true;
    snapshot.priceWatching.source = 'kraken';
    snapshot.priceWatching.currency = '';
    snapshot.priceWatching.deviation = 2;
    snapshot.priceWatching.policy = 'smart';

    await setParams(snapshot);

    expect(enabledModules()).toEqual(['pw']);
    expect(asMock(commands.enable).mock.calls[0][0]).toEqual(['pw', 'ETH/USDT@kraken', '2%', 'smart', snapshot.priceWatching.action, '-y']);
  });

  test('enabling a price range still /enable pw', async () => {
    tradeParams.mm_isPriceWatcherActive = false;
    tradeParams.mm_priceWatcherMidPriceInSourceCoin = 0;
    tradeParams.mm_priceWatcherSource = '#';
    const snapshot = getCurrentParams();
    snapshot.priceWatching.type = 'price';
    snapshot.priceWatching.enabled = true;
    snapshot.priceWatching.currency = 'USDT';
    snapshot.priceWatching.priceFrom = 1;
    snapshot.priceWatching.priceTo = 2;
    snapshot.priceWatching.source = '';

    await setParams(snapshot);

    expect(enabledModules()).toEqual(['pw']);
    expect(asMock(commands.enable).mock.calls[0][0]).toEqual(['pw', '1-2', 'USDT', snapshot.priceWatching.action, '-y']);
    expect(tradeParams.mm_priceWatcherHighPriceInSourceCoin).toBe(2);
  });

  test('Nice Chart / SBW persist to config.jsonc and log', async () => {
    const snapshot = getCurrentParams();
    snapshot.niceChart.enabled = false;
    snapshot.sniperBotWatcher.safeModeThreshold = 5;

    await setParams(snapshot);

    expect(enabledModules()).toEqual([]);
    expect(config.nice_chart.enabled).toBe(false);
    expect(config.sniper_bot_watcher.safeModeThreshold).toBe(5);
    expect(updateConfigNestedKeys).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          'nice_chart.enabled': false,
          'sniper_bot_watcher.safeModeThreshold': 5,
        }),
    );
    expect(updateConfigKey).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining('Config nice_chart updated by WebUI-setParams()'));
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining('Config sniper_bot_watcher updated by WebUI-setParams()'));

    config.nice_chart.enabled = true;
    config.sniper_bot_watcher.safeModeThreshold = 3;
  });

  test('GET ladder midPrice is rounded to quote decimals', () => {
    tradeParams.mm_ladderMidPrice = 0.0012189100000000001;
    expect(getCurrentParams().ladder.midPrice).toBe(0.00121891);
  });

  test('disabled support price keeps stored floor', async () => {
    tradeParams.mm_priceSupportLowPrice = 0.5;
    tradeParams.mm_isPriceSupportActive = true;
    const snapshot = getCurrentParams();
    expect(snapshot.supportPrice.enabled).toBe(true);
    expect(snapshot.supportPrice.price).toBe(0.5);

    snapshot.supportPrice.enabled = false;
    await setParams(snapshot);

    expect(enabledModules()).toEqual([]);
    expect(tradeParams.mm_priceSupportLowPrice).toBe(0.5);
    expect(tradeParams.mm_isPriceSupportActive).toBe(false);
    expect(getCurrentParams().supportPrice.enabled).toBe(false);
    expect(getCurrentParams().supportPrice.price).toBe(0.5);
  });

  test('legacy support price without the flag is still enabled', () => {
    delete tradeParams.mm_isPriceSupportActive;
    tradeParams.mm_priceSupportLowPrice = 0.5;
    expect(getCurrentParams().supportPrice.enabled).toBe(true);
    expect(getCurrentParams().supportPrice.price).toBe(0.5);
  });

  test('disabled order notifier keeps typed amount, priority, and coin', async () => {
    const snapshot = getCurrentParams();
    snapshot.orderNotifier = {
      enabled: false,
      amount: 100,
      amountPriority: 200,
      amountCoin: 'USDT',
    };

    await setParams(snapshot);

    expect(enabledModules()).toEqual([]);
    expect(tradeParams.mm_isOrderNotifierActive).toBe(false);
    expect(tradeParams.mm_orderNotifierAmount).toBe(100);
    expect(tradeParams.mm_orderNotifierAmountPriority).toBe(200);
    expect(tradeParams.mm_orderNotifierAmountCoin).toBe('USDT');
    expect(getCurrentParams().orderNotifier).toEqual({
      enabled: false,
      amount: 100,
      amountPriority: 200,
      amountCoin: 'USDT',
    });
  });

  test('GET fund balancer reports stored flag even without apikey2', () => {
    tradeParams.mm_isFundBalancerActive = true;
    expect(getCurrentParams().fundBalancer.enabled).toBe(true);
    tradeParams.mm_isFundBalancerActive = false;
  });

  test('enabling fund balancer without apikey2 fails', async () => {
    const snapshot = getCurrentParams();
    snapshot.fundBalancer.enabled = true;

    await expect(setParams(snapshot)).rejects.toMatchObject({
      statusCode: 400,
      details: { fields: { fundBalancer: expect.stringMatching(/second API key/) } },
    });
    expect(tradeParams.mm_isFundBalancerActive).toBe(false);
    expect(enabledModules()).toEqual([]);
  });
});
