// @ts-check
'use strict';

/** @typedef {import('../../trade/trader/trader_qutrade').QutradeMarketInfo} QutradeMarketInfo */
const { createHarness } = require('./qutrade_live_support');
const h = createHarness('live');
const { trader, pair } = h;
const assert = require('node:assert/strict');

/** @returns {Promise<void>} Baseline all-method and order-lifecycle validation */
async function main() {
  const market = await h.check('Market metadata and pair formats', async () => {
    await trader.getMarkets();
    const value = trader.marketInfo(pair);
    assert(value);
    assert.equal(value.coin1Decimals, 3);
    assert.equal(value.coin2Decimals, 5);
    assert.deepEqual(trader.marketInfo('CHESS_USDT'), value);
    assert.deepEqual(trader.marketInfo('CHESSUSDT'), value);
    return value;
  });
  await h.check('Currency metadata and networks', async () => {
    const value = await trader.getCurrencies('USDT');
    assert(value);
    assert(trader.currencyInfo('CHESS'));
    return value;
  });
  await h.check('Deposit addresses for USDT and CHESS', async () => {
    const results = {};
    for (const coin of ['USDT', 'CHESS']) {
      const addresses = await trader.getDepositAddress(coin);
      assert(Array.isArray(addresses), `No verified deposit-address response for ${coin}`);
      results[coin] = addresses.map(({ network, address, memo }) => ({
        network,
        hasAddress: Boolean(address),
        hasMemo: Boolean(memo),
      }));
      if (!addresses.length) h.report.warnings.push(`No pre-generated ${coin} deposit addresses in this account`);
    }
    return results;
  });
  await h.check('Balances with and without zero filtering', async () => {
    const value = await trader.getBalances();
    assert(value.some((b) => b.code === 'CHESS' && b.free >= 8));
    assert((await trader.getBalances(false)).length >= value.length);
    return value;
  });
  await h.check('Fresh rates and sorted order book', async () => {
    const rates = await trader.getRates(pair),
      book = await trader.getOrderBook(pair);
    assert(rates.ask > rates.bid);
    assert(book.asks.length && book.bids.length);
    assert(book.asks.every((v, i, a) => !i || v.price >= a[i - 1].price));
    assert(book.bids.every((v, i, a) => !i || v.price <= a[i - 1].price));
    return { rates, bids: book.bids.slice(0, 3), asks: book.asks.slice(0, 3) };
  });
  await h.check('Public trade history', async () => {
    const trades = await trader.getTradesHistory(pair, 20);
    assert(Array.isArray(trades) && trades.length);
    assert(trades.every((v, i, a) => !i || v.date >= a[i - 1].date));
    return trades.slice(-3);
  });
  for (const frame of ['15m', '1h', '1d', '1w', '1M']) {
    await h.check(`Native candles ${frame}, since and partial exclusion`, async () => {
      const candles = await trader.getCandlesHistory(pair, frame, undefined, 10, false);
      assert(Array.isArray(candles) && candles.length);
      const since = candles[0].tsOpen;
      const bounded = await trader.getCandlesHistory(pair, frame, since, 10, true);
      assert(Array.isArray(bounded));
      assert(bounded.every((c) => c.tsOpen >= since && c.tsClose <= Date.now()));
      return { recent: candles.slice(-2), bounded: bounded.slice(-2) };
    });
  }
  await h.check('Unsupported capabilities return undefined without fabricated data', async () => {
    assert.equal(await trader.getAccounts(), undefined);
    assert.equal(await trader.getVolume(), undefined);
    assert.equal(await trader.getFees(), undefined);
    assert.equal(await trader.getCandlesHistory(pair, '1m'), undefined);
    return trader.features();
  });
  await h.check('Initial open orders are empty', async () => {
    const orders = await trader.getOpenOrders(pair);
    assert.deepEqual(orders, []);
    return orders;
  });
  await h.check('Unknown order and nonexistent cancellation', async () => {
    const details = await trader.getOrderDetails('999999999', pair);
    assert.equal(details?.status, 'unknown');
    assert.equal(await trader.cancelOrder('999999999', 'buy', pair), false);
    return details;
  });
  await h.check('Concurrent signed reads respect endpoint pacing without blocking depth', async () => {
    const start = h.report.requests.length;
    const [first, second, balances, depth] = await Promise.all([
      h.raw.openOrders('CHESS_USDT'),
      h.raw.openOrders('CHESS_USDT'),
      h.raw.balances(),
      trader.getOrderBook(pair),
    ]);
    assert.equal(first.result, 'success');
    assert.equal(second.result, 'success');
    assert.equal(balances.result, 'success');
    assert(depth?.bids.length && depth.asks.length);

    const requests = h.report.requests.slice(start);
    const open = requests.filter(({ endpoint }) => endpoint === '/open_orders');
    const signed = requests.filter(({ endpoint }) => endpoint !== '/depth');
    assert.equal(open.length, 2);
    assert.equal(signed.length, 3);
    assert(signed.every((request, i) => !i || request.startedAt >= signed[i - 1].finishedAt));
    assert(open[1].startedAt - open[0].finishedAt >= 1100);
    assert(requests.find(({ endpoint }) => endpoint === '/depth').startedAt < open[1].startedAt);
    return requests.map(({ endpoint, startedAt, finishedAt, httpStatus }) => ({
      endpoint, startedAt, finishedAt, httpStatus,
    }));
  });
  if (!h.tradeEnabled) {
    h.report.warnings.push('Mutation checks skipped: --trade was not supplied');
    return;
  }

  for (const side of /** @type {const} */ (['buy', 'sell'])) {
    for (const amountMode of ['base', 'quote']) {
      await h.checkTrade(`Limit ${side} by ${amountMode}; new, cancel, repeated cancel`, async () => {
        const rates = await trader.getRates(pair);
        const price = Number((side === 'buy' ? rates.bid * 0.8 : rates.ask * 1.2).toFixed(market.coin2Decimals));
        const started = Date.now();
        const id = await h.place(
          side,
          price,
          amountMode === 'base' ? 2.5 : undefined,
          1,
          amountMode === 'quote' ? 0.16 : undefined,
        );
        const acknowledged = Date.now();
        await h.pause();
        const details = await h.details(id, 'new');
        const listed = await trader.getOpenOrders(pair);
        assert(listed.some((o) => o.orderId === id));
        h.report.timings.push({
          phase: 'placement',
          id,
          extraSleepMs: h.API_DELAY,
          submitToAckMs: acknowledged - started,
          ackToAgreementMs: Date.now() - acknowledged,
        });
        assert.equal(await trader.cancelOrder(id, side, pair), true);
        await h.pause();
        const cancelled = await h.details(id, 'cancelled', true);
        assert.equal(cancelled.amountExecuted, 0);
        assert.equal(await trader.cancelOrder(id, side, pair), false);
        assert(!(await trader.getOpenOrders(pair)).some((o) => o.orderId === id));
        return { id, new: details, cancelled };
      });
    }
  }

  for (const makerSide of /** @type {const} */ (['sell', 'buy'])) {
    await h.checkTrade(`Matching ${makerSide} maker: new → part_filled → filled`, async () => {
      const rates = await trader.getRates(pair);
      const price = Number(((rates.ask + rates.bid) / 2).toFixed(market.coin2Decimals));
      assert(price > rates.bid && price < rates.ask, 'Need a free tick inside the spread');
      const id = await h.place(makerSide, price, 6);
      await h.pause();
      await h.details(id, 'new');
      const takerSide = makerSide === 'sell' ? 'buy' : 'sell';
      const partialTaker = await h.place(takerSide, price, 2);
      await h.pause();
      const partial = await h.details(id, 'part_filled');
      assert.equal(partial.amountExecuted, 2);
      await h.details(partialTaker, 'filled');
      const opened = await trader.getOpenOrders(pair);
      assert.equal(opened.find((o) => o.orderId === id)?.amountLeft, 4);
      const finalTaker = await h.place(takerSide, price, 4);
      await h.pause();
      const filled = await h.details(id, 'filled');
      assert.equal(filled.amountExecuted, 6);
      await h.details(finalTaker, 'filled');
      assert(!(await trader.getOpenOrders(pair)).some((o) => o.orderId === id));
      return { id, partial, filled };
    });
  }

  for (const side of /** @type {const} */ (['buy', 'sell'])) {
    for (const mode of ['base', 'quote']) {
      await h.checkTrade(`Market ${side} by ${mode}`, async () => {
        const id = await h.place(
          side,
          undefined,
          mode === 'base' ? 2.1 : undefined,
          0,
          mode === 'quote' ? 0.13 : undefined,
        );
        await h.pause();
        const details = await h.details(id, 'filled');
        assert(details.amountExecuted > 0 && details.volumeExecuted > 0);
        return details;
      });
    }
  }
  await h.checkTrade('Native bulk cancellation and empty repeated cancellation', async () => {
    const rates = await trader.getRates(pair);
    const price = Number((rates.bid * 0.8).toFixed(market.coin2Decimals));
    const ids = await Promise.all([h.place('buy', price, 2.5), h.place('buy', price - market.coin2Precision, 2.5)]);
    await h.pause();
    assert.equal((await trader.getOpenOrders(pair)).length, 2);
    assert.equal(await trader.cancelAllOrders(pair), true);
    await h.pause();
    for (const id of ids) await h.details(id, 'cancelled', true);
    assert.equal(await trader.cancelAllOrders(pair), true);
    return ids;
  });
}

main()
  .catch((error) => {
    console.error(String(error));
    process.exitCode = 1;
  })
  .finally(() => h.finish());
