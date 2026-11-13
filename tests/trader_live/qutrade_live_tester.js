// @ts-check
'use strict';

/** @typedef {import('../../trade/trader/trader_qutrade').QutradeMarketInfo} QutradeMarketInfo */
const assert = require('node:assert/strict');
const { createHarness } = require('./qutrade_live_support');
const h = createHarness('liveTester');
const { trader, pair } = h;

/** @returns {Promise<void>} Adversarial checks and repeated isolated market-making cycles */
async function main() {
  await trader.getMarkets();
  const market = trader.marketInfo(pair);
  assert(market);
  await h.check('Initial isolated account has no open orders', async () => {
    const open = await trader.getOpenOrders(pair);
    assert.deepEqual(open, []);
    return open;
  });
  await h.check('Malformed selectors fail locally without HTTP or mutation', async () => {
    const before = h.report.requests.length;
    assert.equal(await trader.getOpenOrders('CHESS_USDT,BTC_USDT'), undefined);
    assert.equal(await trader.getOrderDetails('../balances', pair), undefined);
    assert.equal(await trader.cancelOrder('3708000', 'buy', 'CHESS_USDT,BTC_USDT'), undefined);
    assert.equal(await trader.cancelAllOrders(pair, /** @type {any} */ ('BUY')), undefined);
    assert.equal(await trader.getBalances(true, 'funding'), undefined);
    assert.equal(await trader.getOrderBook(pair, 101), undefined);
    assert.equal(await trader.getTradesHistory(pair, 0), undefined);
    assert.equal(await trader.getCandlesHistory(pair, '1m'), undefined);
    assert.equal(await trader.getCandlesHistory(pair, '15m', NaN), undefined);
    for (const value of [NaN, Infinity, -1, 0]) {
      const result = await trader.placeOrder('buy', pair, 0.06, value, 1);
      assert(!result?.orderId);
    }
    assert.equal(h.report.requests.length, before);
    return { requestsSent: 0 };
  });
  await h.check('Minimum base, minimum notional and side price bands reject without placement', async () => {
    const before = h.report.orders.length;
    for (const [price, amount] of [
      [0.06, 0.001],
      [0.00001, 2],
      [1, 2],
    ]) {
      const result = await trader.placeOrder('buy', pair, price, amount, 1);
      assert(!result?.orderId);
    }
    assert.equal(h.report.orders.length, before);
    return { mutationsSent: 0 };
  });
  if (!h.tradeEnabled) {
    h.report.warnings.push('Mutation checks skipped: --trade was not supplied');
    return;
  }

  for (let iteration = 0; iteration < 4; iteration++) {
    await h.check(`Single-order consistency sample ${iteration + 1}`, async () => {
      const rates = await trader.getRates(pair);
      const price = Number((rates.bid * 0.8).toFixed(market.coin2Decimals));
      const started = Date.now();
      const id = await h.place('buy', price, 2.5);
      const acknowledged = Date.now();
      await h.pause();
      const details = await h.details(id, 'new');
      const open = await trader.getOpenOrders(pair);
      assert(open.some((row) => row.orderId === id));
      h.report.timings.push({
        phase: 'single place',
        id,
        extraSleepMs: h.API_DELAY,
        submitToAckMs: acknowledged - started,
        ackToAgreementMs: Date.now() - acknowledged,
      });
      const cancelStarted = Date.now();
      assert.equal(await trader.cancelOrder(id, 'buy', pair), true);
      const cancelledAt = Date.now();
      await h.pause();
      const cancelled = await h.details(id, 'cancelled', true);
      assert(!(await trader.getOpenOrders(pair)).some((row) => row.orderId === id));
      h.report.timings.push({
        phase: 'single cancel',
        id,
        extraSleepMs: h.API_DELAY,
        callToAckMs: cancelledAt - cancelStarted,
        ackToAgreementMs: Date.now() - cancelledAt,
        historyCreationShiftMs: cancelled.timestamp - details.timestamp,
      });
      assert.equal(await trader.cancelOrder(id, 'buy', pair), false);
      return { id, new: details, cancelled };
    });
  }

  await h.check('Concurrent placements and reads retain every unique order ID', async () => {
    const rates = await trader.getRates(pair);
    const price = Number((rates.bid * 0.8).toFixed(market.coin2Decimals));
    const ids = await Promise.all([
      h.place('buy', price, 2.5),
      h.place('buy', price - market.coin2Precision, 2.5),
      h.place('buy', price - 2 * market.coin2Precision, 2.5),
    ]);
    const sellPrice = Number((rates.ask * 1.2).toFixed(market.coin2Decimals));
    const oppositeId = await h.place('sell', sellPrice, 2.5);
    const expectedIds = [...ids, oppositeId].sort();
    assert.equal(new Set(expectedIds).size, 4);

    await h.pause();
    const snapshots = await Promise.all([
      trader.getOpenOrders(pair),
      trader.getOpenOrders(pair),
      trader.getOpenOrders(pair),
    ]);
    for (const list of snapshots) assert.deepEqual(list.map((row) => row.orderId).sort(), expectedIds);
    await Promise.all(ids.map((id) => h.details(id, 'new')));

    assert.equal(await trader.cancelAllOrders(pair, 'buy'), true);
    for (const id of ids) await h.details(id, 'cancelled', true);
    assert.deepEqual((await trader.getOpenOrders(pair)).map((row) => row.orderId), [oppositeId]);
    assert.equal(await trader.cancelAllOrders(pair, 'sell'), true);
    await h.details(oppositeId, 'cancelled', true);

    return { ids, oppositeId, snapshots };
  });

  await h.check('Concurrent cancellation of the same ID remains terminal and repeatable', async () => {
    const rates = await trader.getRates(pair);
    const price = Number((rates.bid * 0.8).toFixed(market.coin2Decimals));
    const id = await h.place('buy', price, 2.5);
    await h.pause();
    const results = await Promise.all([trader.cancelOrder(id, 'buy', pair), trader.cancelOrder(id, 'buy', pair)]);
    assert.deepEqual(results, [true, false]);
    await h.details(id, 'cancelled', true);
    assert.equal(await trader.cancelOrder(id, 'buy', pair), false);
    return { id, results };
  });

  for (let cycle = 0; cycle < 3; cycle++) {
    await h.check(`Bounded maker cycle ${cycle + 1}: partial fill → cancel → no unk`, async () => {
      const rates = await trader.getRates(pair);
      const price = Number(((rates.ask + rates.bid) / 2).toFixed(market.coin2Decimals));
      assert(price > rates.bid && price < rates.ask, 'No free tick in spread');
      const maker = await h.place('sell', price, 4);
      await h.pause();
      await h.details(maker, 'new');
      const taker = await h.place('buy', price, 2);
      await h.pause();
      const partial = await h.details(maker, 'part_filled');
      assert.equal(partial.amountExecuted, 2);
      await h.details(taker, 'filled');
      assert.equal(await trader.cancelOrder(maker, 'sell', pair), true);
      await h.pause();
      const cancelled = await h.details(maker, 'cancelled', true);
      assert.equal(cancelled.amountExecuted, 2);
      assert.equal(cancelled.volumeExecuted, partial.volumeExecuted);
      assert.equal(await trader.cancelOrder(taker, 'buy', pair), false);
      const open = await trader.getOpenOrders(pair);
      assert.deepEqual(open, []);
      return { maker, taker, partial, cancelled, open };
    });
  }
  await h.checkTrade('Single crossing sell completely fills a buy maker', async () => {
    const rates = await trader.getRates(pair);
    const price = Number(((rates.ask + rates.bid) / 2).toFixed(market.coin2Decimals));
    assert(price > rates.bid && price < rates.ask, 'No free tick in spread');

    const maker = await h.place('buy', price, 3);
    await h.pause();
    await h.details(maker, 'new');

    const taker = await h.place('sell', price, 3);
    await h.pause();
    const makerDetails = await h.details(maker, 'filled');
    const takerDetails = await h.details(taker, 'filled');
    assert.equal(makerDetails.amountExecuted, 3);
    assert.equal(takerDetails.amountExecuted, 3);
    assert.deepEqual(await trader.getOpenOrders(pair), []);

    return { maker: makerDetails, taker: takerDetails };
  });

  await h.check('Balances remain finite with no locked funds after all cycles', async () => {
    const balances = await trader.getBalances();
    assert(balances);
    for (const balance of balances) {
      assert(balance.free >= 0 && balance.free <= balance.total);
      assert.equal(balance.freezed, 0);
    }
    return balances;
  });
}

main()
  .catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  })
  .finally(() => h.finish());
