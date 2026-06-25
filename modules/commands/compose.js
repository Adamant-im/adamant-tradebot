'use strict';

/**
 * @module modules/commands/compose
 * @typedef {import('types/bot/parsedMarket.d').ParsedMarket} ParsedMarket
 * @typedef {import('types/bot/orderMetrics.d').FillsDbRecord} FillsDbRecord
 * @typedef {import('types/bot/commandTxs.d.js').TraderOrderStatsAgg} TraderOrderStatsAgg
 * @typedef {import('types/bot/commandTxs.d.js').CommandListResult} CommandListResult
 */

const {
  constants, config, tradeParams, traderapi, traderapi2, perpetualApi,
  orderUtils, orderStats, moduleName, utils, exchangerUtils, previousOrders,
} = require('./context');
const { getExchangeRatesInfo } = require('./helpers');

/**
 * Composes an order book depth info string: smart spread, full depth, and ±2% depth lines.
 * Reusable across commands to avoid duplication.
 *
 * @param {string} pairRaw Trading pair
 * @returns {Promise<string>} Three-line order book string, or empty string if unavailable
 */
async function composeOrderBookInfoString(pairRaw) {
  const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pairRaw || config.defaultPair));
  const { pair, coin1, coin2, coin1Decimals, coin2Decimals, coin2DecimalsForStable } = formattedPair;

  const orderBook = await orderUtils.getOrderBookCached(pair, moduleName, false);
  const orderBookInfo = utils.getOrderBookInfo(orderBook);

  if (!orderBook || !orderBookInfo) return '';

  const delta = orderBookInfo.smartAsk - orderBookInfo.smartBid;
  const average = (orderBookInfo.smartAsk + orderBookInfo.smartBid) / 2;
  const deltaPercent = delta / average * 100;

  const bids2 = orderBookInfo.liquidity['percent2'].amountBidsQuote;
  const asks2 = orderBookInfo.liquidity['percent2'].amountAsks;
  const bidsFull = orderBookInfo.liquidity['full'].amountBidsQuote;
  const asksFull = orderBookInfo.liquidity['full'].amountAsks;

  const bidsPercent2 = bids2 / bidsFull * 100;
  const asksPercent2 = asks2 / asksFull * 100;

  // Fair price = quote depth / base depth, i.e., implied exchange rate from order book liquidity
  const fairPrice2 = bids2 / asks2;
  const fairPriceFull = bidsFull / asksFull;

  let result = `Smart bid: ${orderBookInfo.smartBid.toFixed(coin2Decimals)}, smart ask: ${orderBookInfo.smartAsk.toFixed(coin2Decimals)}, smart spread: _${(delta).toFixed(coin2Decimals)}_ ${coin2} (${(deltaPercent).toFixed(2)}%).`;
  result += `\nFull depth (may be limited by exchange API): ${orderBookInfo.liquidity['full'].bidsCount} bids with ${utils.formatNumber(bidsFull.toFixed(coin2DecimalsForStable), true)} ${coin2}`;
  result += ` and ${orderBookInfo.liquidity['full'].asksCount} asks with ${utils.formatNumber(asksFull.toFixed(coin1Decimals), true)} ${coin1}.`;
  if (Number.isFinite(fairPriceFull)) {
    result += ` Fair price: _${utils.formatNumber(fairPriceFull.toFixed(coin2Decimals), true)}_ ${coin2}.`;
  }
  result += `\nDepth ±2%: ${orderBookInfo.liquidity['percent2'].bidsCount} bids with ${utils.formatNumber(bids2.toFixed(coin2DecimalsForStable), true)} ${coin2} (${bidsPercent2.toFixed(2)}%)`;
  result += ` and ${orderBookInfo.liquidity['percent2'].asksCount} asks with ${utils.formatNumber(asks2.toFixed(coin1Decimals), true)} ${coin1} (${asksPercent2.toFixed(2)}%).`;

  if (Number.isFinite(fairPrice2)) {
    result += ` Fair price: _${utils.formatNumber(fairPrice2.toFixed(coin2Decimals), true)}_ ${coin2}.`;
  }

  return result;
}


/**
 * Composes the minimum exchange order string for informational display.
 * Shows exchange-enforced minimums, with "(calculated)" next to values derived from the other side's
 * limit, or "0 {coin1} / 0 {coin2}" when the exchange sets no limits.
 * Always uses the default trading pair since getMinOrderAmount() uses it regardless of input.
 *
 * @returns {string} Min exchange order string
 */
function composeMinExchangeOrderString() {
  const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(config.defaultPair));
  const { coin1, coin2, coin1Decimals, coin2DecimalsForStable, pair, isPerpetual } = formattedPair;

  const minOrderAmount = orderUtils.getMinOrderAmount();
  if (!minOrderAmount) {
    return `Min exchange order: unable to calculate`;
  }

  const api = isPerpetual ? perpetualApi : traderapi;
  const marketInfo = isPerpetual ? api?.instrumentInfo?.(pair) : api?.marketInfo(pair);
  const hasCoin1Min = utils.isPositiveNumber(marketInfo?.coin1MinAmount);
  const hasCoin2Min = utils.isPositiveNumber(marketInfo?.coin2MinAmount);
  const hasExchangeLimit = hasCoin1Min || hasCoin2Min;

  if (!hasExchangeLimit) {
    return `Min exchange order: 0 ${coin1} / 0 ${coin2}`;
  }

  // "(calculated)" marks values derived from the other side's limit, not set directly by the exchange
  const coin1Calculated = hasCoin2Min && !hasCoin1Min ? ' (calculated)' : '';
  const coin2Calculated = hasCoin1Min && !hasCoin2Min ? ' (calculated)' : '';

  return `Min exchange order: ${minOrderAmount.min.toFixed(coin1Decimals)} ${coin1}${coin1Calculated} / ${minOrderAmount.minCoin2.toFixed(coin2DecimalsForStable)} ${coin2}${coin2Calculated}`;
}


/**
 * Composes a full liquidity stats summary for the /orders liq command.
 * Includes depth liquidity, spread support (when available), combined totals,
 * epoch start time, and min exchange order info.
 *
 * @param {string} pairRaw Trading pair string
 * @returns {Promise<string>}
 */
async function composeLiquidityStats(pairRaw) {
  const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pairRaw));
  if (!formattedPair?.isParsed) return '';

  const { pair, coin1, coin2, coin1Decimals, coin2Decimals, coin2DecimalsForStable } = formattedPair;
  const exchange = config.exchange;

  const fillsEngine = utils.softRequire('../../helpers/fillsEngine', __filename);
  const liqProvider = utils.softRequire('../../trade/mm_liquidity_provider');
  const safeLiq = utils.softRequire('../../trade/mm_liquidity_safe');
  const liqSs = utils.softRequire('../../trade/mm_liquidity_ss');

  const hasSafeLiq = !!safeLiq;
  const hasSs = !!liqSs;

  const isLiqActive = tradeParams.mm_isActive && tradeParams.mm_isLiquidityActive;
  const isSsActive = hasSs && tradeParams.mm_isActive && tradeParams.mm_isLiquidityActive && tradeParams.mm_liquiditySpreadSupport;

  const liqDepthStatus = isLiqActive ?
      hasSafeLiq ? 'Enabled with Safe liquidity' : 'Enabled without Safe liquidity' :
      'Disabled';
  const liqSsStatus = isSsActive ? 'Enabled' : 'Disabled';
  const liqTotalStatus = isLiqActive ? 'Enabled' : 'Disabled';

  // Get liqLimits from provider (delegates to safeLiq internally when available)
  const liqLimits = liqProvider?.getLiqLimits() || {
    bidLimit: tradeParams.mm_liquidityBuyQuoteAmount || 0,
    askLimit: tradeParams.mm_liquiditySellAmount || 0,
    bidLimitPercent: 100,
    askLimitPercent: 100,
  };

  // Get all open liq orders from DB (already processed by ordersByPurpose)
  const ordersByPurposeResult = await orderStats.ordersByPurpose(pair, traderapi, true, false);
  const allLiqOrders = ordersByPurposeResult?.['liq']?.allOrders || [];

  // Split depth vs SS orders
  const depthOrders = allLiqOrders.filter((o) => o.subPurpose !== 'ss');
  const ssOrders = allLiqOrders.filter((o) => o.subPurpose === 'ss');

  const depthBuyOrders = depthOrders.filter((o) => o.side === 'buy');
  const depthSellOrders = depthOrders.filter((o) => o.side === 'sell');

  const regularSsOrders = ssOrders.filter((o) => o.subType !== 'mirrored');
  const mirroredSsOrders = ssOrders.filter((o) => o.subType === 'mirrored');
  const regularSsBuyOrders = regularSsOrders.filter((o) => o.side === 'buy');
  const regularSsSellOrders = regularSsOrders.filter((o) => o.side === 'sell');
  const mirroredSsBuyOrders = mirroredSsOrders.filter((o) => o.side === 'buy');
  const mirroredSsSellOrders = mirroredSsOrders.filter((o) => o.side === 'sell');

  // Calculate open order stats (coin1AmountLeft / coin2AmountLeft)
  const depthBuyStats = utils.calculateOrderStats(depthBuyOrders);
  const depthSellStats = utils.calculateOrderStats(depthSellOrders);
  const ssBuyStats = utils.calculateOrderStats([...regularSsBuyOrders, ...mirroredSsBuyOrders]);
  const ssSellStats = utils.calculateOrderStats([...regularSsSellOrders, ...mirroredSsSellOrders]);

  // Get max depth orders per side
  const minOrderAmount = orderUtils.getMinOrderAmount();
  let maxDepthBuy = '-'; let maxDepthSell = '-';
  if (liqProvider?.getMaxDepthOrdersOneSide && minOrderAmount) {
    maxDepthBuy = liqProvider.getMaxDepthOrdersOneSide('buy', minOrderAmount);
    maxDepthSell = liqProvider.getMaxDepthOrdersOneSide('sell', minOrderAmount);
  }

  // Get max SS orders per side
  let maxSsBuy = '-'; let maxSsSell = '-';
  if (liqSs?.getMaxSsOrdersOneSide && minOrderAmount) {
    maxSsBuy = liqSs.getMaxSsOrdersOneSide('buy', minOrderAmount, liqLimits);
    maxSsSell = liqSs.getMaxSsOrdersOneSide('sell', minOrderAmount, liqLimits);
  }

  // Load fill stats for depth and SS sub-buckets, and for the combined general bucket
  const epochTs = tradeParams.mm_liquidityInitTs || 0;

  const depthFillStats = fillsEngine ? await fillsEngine.getStats({
    exchange, pair, purpose: 'liq', subPurpose: 'depth', startTs: epochTs,
  }) : undefined;

  let ssFillStats;
  if (hasSs && fillsEngine) {
    ssFillStats = await fillsEngine.getStats({
      exchange, pair, purpose: 'liq', subPurpose: 'ss', startTs: epochTs,
    });
  }

  // General bucket (no subPurpose) already accumulates all liq fills — no manual combining needed
  const totalFillStats = fillsEngine ? await fillsEngine.getStats({
    exchange, pair, purpose: 'liq', startTs: epochTs,
  }) : undefined;

  /**
   * Builds fill-related table rows (Filled amount, Filled volume, VWAP, MTM PnL).
   * All rows have 4 columns: [label, buy, sell, delta].
   * @param {import('types/bot/orderMetrics.d').FillsEngineStatsResult} stats
   * @returns {Array<string[]>}
   */
  const composeFillRows = (stats) => {
    const buyAmount = stats?.buy?.sumAmount || 0;
    const sellAmount = stats?.sell?.sumAmount || 0;
    const buyQuote = stats?.buy?.sumQuote || 0;
    const sellQuote = stats?.sell?.sumQuote || 0;
    const hasFills = buyAmount > 0 || sellAmount > 0;

    const rows = [];

    rows.push([
      `Filled amount, ${coin1}`,
      hasFills ? `${buyAmount.toFixed(coin1Decimals)}` : '—',
      hasFills ? `${sellAmount.toFixed(coin1Decimals)}` : '—',
      hasFills ? utils.signedNumber(buyAmount - sellAmount, coin1Decimals) : '—',
    ]);

    rows.push([
      `Filled vol, ${coin2}`,
      hasFills ? buyQuote.toFixed(coin2DecimalsForStable) : '—',
      hasFills ? sellQuote.toFixed(coin2DecimalsForStable) : '—',
      hasFills ? utils.signedNumber(sellQuote - buyQuote, coin2DecimalsForStable) : '—',
    ]);

    rows.push([
      `VWAP, ${coin2}`,
      stats.boughtVwap > 0 ? stats.boughtVwap.toFixed(coin2Decimals) : '—',
      stats.soldVwap > 0 ? stats.soldVwap.toFixed(coin2Decimals) : '—',
      stats.hasBothSides ? utils.signedNumber(stats.vwapSpread, coin2Decimals) : '—',
    ]);

    rows.push([
      'MTM PnL',
      '',
      '',
      typeof stats?.pnlQuoteMtm === 'number' ? utils.signedNumber(stats.pnlQuoteMtm, coin2DecimalsForStable) + ' ' + coin2 : '—',
    ]);

    return rows;
  };

  const TABLE_HEADER = ['', 'Buy', 'Sell', 'Delta'];

  let output = '';

  // ── Depth liquidity section

  output += `**Depth liquidity**: _${liqDepthStatus}_.`;

  const spreadMin = tradeParams.mm_liquiditySpreadPercentMin || 0;
  const spreadMax = tradeParams.mm_liquiditySpreadPercent || 0;
  const spreadStr = spreadMin ? `${spreadMin}–${spreadMax}%` : `${spreadMax}%`;
  output += `\n_Params_: Spread ${spreadStr}, ${tradeParams.mm_liquidityTrend || 'middle'}`;

  const depthTableContent = [
    ['Max orders', maxDepthBuy, maxDepthSell, ''],
    ['Opened', depthBuyOrders.length, depthSellOrders.length, ''],
    [`Amount, ${coin1}`, depthBuyStats.bidsTotalAmount.toFixed(coin1Decimals), depthSellStats.asksTotalAmount.toFixed(coin1Decimals), ''],
    [`Volume, ${coin2}`, depthBuyStats.bidsTotalQuoteAmount.toFixed(coin2DecimalsForStable), depthSellStats.asksTotalQuoteAmount.toFixed(coin2DecimalsForStable), ''],
  ];

  if (hasSafeLiq) {
    depthTableContent.push(
        ['Initial liq.', `${(tradeParams.mm_liquidityBuyQuoteAmount || 0).toFixed(coin2DecimalsForStable)} ${coin2}`, `${(tradeParams.mm_liquiditySellAmount || 0).toFixed(coin1Decimals)} ${coin1}`, ''],
        ['Safe liq.', `${(liqLimits.bidLimit || 0).toFixed(coin2DecimalsForStable)} ${coin2}`, `${(liqLimits.askLimit || 0).toFixed(coin1Decimals)} ${coin1}`, ''],
        ['Safe %', `${(liqLimits.bidLimitPercent || 0).toFixed(2)}%`, `${(liqLimits.askLimitPercent || 0).toFixed(2)}%`, ''],
    );
  } else {
    depthTableContent.push(
        ['Base liq.', `${(tradeParams.mm_liquidityBuyQuoteAmount || 0).toFixed(coin2DecimalsForStable)} ${coin2}`, `${(tradeParams.mm_liquiditySellAmount || 0).toFixed(coin1Decimals)} ${coin1}`, ''],
    );
  }

  if (hasSafeLiq) {
    depthTableContent.push(...composeFillRows(depthFillStats));
  }

  output += `\n\`\`\`\n${utils.generateTable(TABLE_HEADER, depthTableContent)}\n\`\`\``;

  // ── Spread support section

  output += `\n\n**Spread support**: _${liqSsStatus}_.`;

  if (hasSs) {
    const ssMaxSpread = constants.LIQUIDITY_SS_MAX_SPREAD_PERCENT;
    output += `\n_Params_: Spread 0–${ssMaxSpread}%`;

    if (minOrderAmount) {
      output += `\nSS min–max order amounts: ${minOrderAmount.minReliable.toFixed(coin1Decimals)}–${minOrderAmount.upperBound.toFixed(coin1Decimals)} ${coin1}`;
    }

    const ssTableContent = [
      ['Max orders', maxSsBuy, maxSsSell, ''],
      ['Opened regular', regularSsBuyOrders.length, regularSsSellOrders.length, ''],
      ['Opened mirrored', mirroredSsBuyOrders.length, mirroredSsSellOrders.length, ''],
      [`Amount, ${coin1}`, ssBuyStats.bidsTotalAmount.toFixed(coin1Decimals), ssSellStats.asksTotalAmount.toFixed(coin1Decimals), ''],
      [`Volume, ${coin2}`, ssBuyStats.bidsTotalQuoteAmount.toFixed(coin2DecimalsForStable), ssSellStats.asksTotalQuoteAmount.toFixed(coin2DecimalsForStable), ''],
    ];

    ssTableContent.push(...composeFillRows(ssFillStats));

    output += `\n\`\`\`\n${utils.generateTable(TABLE_HEADER, ssTableContent)}\n\`\`\``;
  }

  // ── Liquidity total

  if (hasSs) {
    output += `\n\n**Liquidity total**: _${liqTotalStatus}_.`;

    const totalTableContent = composeFillRows(totalFillStats);
    const isNotEmpty = (totalFillStats?.buy?.sumAmount || 0) > 0 || (totalFillStats?.sell?.sumAmount || 0) > 0;

    if (isNotEmpty) {
      output += `\n\`\`\`\n${utils.generateTable(TABLE_HEADER, totalTableContent)}\n\`\`\``;
    } else {
      output += '\nNo filled trades yet.';
    }
  }

  // ── Epoch and limits

  if (epochTs > 0) {
    output += `\n\nEpoch started: ${utils.timeAgoString(epochTs)}`;
  }

  output += `\n${composeMinExchangeOrderString()}`;

  output += `\n\n**Order book information**:`;

  const exchangeRatesInfo = await getExchangeRatesInfo(pair);
  if (exchangeRatesInfo?.spreadString) {
    output += `\n\n${exchangeRatesInfo.spreadString}`;
  }

  const obInfoString = await composeOrderBookInfoString(pair);
  if (obInfoString) {
    output += `\n\n${obInfoString}`;
  }

  return output;
}


/**
 * Composes extended Trader details for /orders t full.
 * Includes recently closed orders and Trader stats since the current Trader epoch.
 *
 * @param {string} pairRaw Trading pair string
 * @returns {Promise<string>}
 */
async function composeTraderOrdersFull(pairRaw) {
  const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pairRaw));
  if (!formattedPair?.isParsed) return '';

  const { pair, coin1, coin2, coin1Decimals, coin2Decimals, coin2DecimalsForStable } = formattedPair;
  const db = require('../DB');
  const ordersDb = db.ordersDb;
  const fillsDb = db.fillsDb;
  const fillsEngine = utils.softRequire('../../helpers/fillsEngine', __filename);

  const now = Date.now();
  const recentWindowMinutes = 15;
  const recentSinceTs = now - (recentWindowMinutes * constants.MINUTE);
  const recentLimit = 20;
  const traderActions = ['executeInOrderBook', 'executeInSpread'];

  // Load fill stats for trader orders since the trader started (mm_traderInitTs) to get an idea of the recent performance
  const epochTs = tradeParams.mm_traderInitTs || 0;
  const statsSinceFilter = epochTs > 0 ? { date: { $gte: epochTs } } : {};

  /** @param {number} value @param {number} total @returns {string} */
  const formatCountShare = (value, total) => {
    if (!total) return `${value} (0.00%)`;
    return `${value} (${((value / total) * 100).toFixed(2)}%)`;
  };

  const recentClosedOrders = await ordersDb.aggregate([
    {
      $match: {
        exchange: config.exchange,
        pair,
        purpose: 't',
        isProcessed: true,
        date: { $gte: recentSinceTs },
        mmOrderAction: { $in: traderActions },
      },
    },
    { $sort: { date: -1 } },
    { $limit: recentLimit },
  ]);

  const recentOrderThirdPartyMap = new Map();
  const orderIdToOwnerId = new Map();
  for (const order of recentClosedOrders) {
    const ownerId = String(order._id);
    recentOrderThirdPartyMap.set(ownerId, { coin1: 0, coin2: 0 });
    orderIdToOwnerId.set(ownerId, ownerId);
    if (order.crossOrderId) {
      orderIdToOwnerId.set(String(order.crossOrderId), ownerId);
    }
  }

  if (orderIdToOwnerId.size > 0) {
    const recentFills = await fillsDb.find({
      exchange: config.exchange,
      pair,
      purpose: 't',
      date: { $gte: recentSinceTs },
    });

    for (const fillRecord of /** @type {FillsDbRecord[]} */ (/** @type {unknown} */ (recentFills))) {
      const allFillOrders = [
        ...(Array.isArray(fillRecord.partlyFilledOrders) ? fillRecord.partlyFilledOrders : []),
        ...(Array.isArray(fillRecord.filledOrders) ? fillRecord.filledOrders : []),
      ];

      for (const fillOrder of allFillOrders) {
        const ownerId = orderIdToOwnerId.get(String(fillOrder.orderId));
        if (!ownerId) continue;

        const acc = recentOrderThirdPartyMap.get(ownerId);
        if (!acc) continue;

        acc.coin1 += Number(fillOrder.coin1AmountFilled) || 0;
        acc.coin2 += Number(fillOrder.coin2AmountFilled) || 0;
      }
    }
  }

  const recentRows = recentClosedOrders.map((order) => {
    const totalFilledAmount = Math.max(Number(order.coin1AmountFilled) || 0, 0);
    const thirdParty = recentOrderThirdPartyMap.get(String(order._id)) || { coin1: 0, coin2: 0 };
    const thirdPartyAmount = Math.min(Math.max(thirdParty.coin1, 0), totalFilledAmount);
    const selfAmount = Math.max(totalFilledAmount - thirdPartyAmount, 0);

    const selfFilledPercent = totalFilledAmount > 0 ? (selfAmount / totalFilledAmount) * 100 : 0;
    const thirdPartyPercent = totalFilledAmount > 0 ? (thirdPartyAmount / totalFilledAmount) * 100 : 0;

    const quoteAmount = Number(order.coin2Amount) || 0;
    const approxUsd = exchangerUtils.convertCryptos(coin2, 'USD', quoteAmount).outAmount;

    return [
      utils.formatDate(new Date(order.date)),
      order.side,
      order.mmOrderAction || '—',
      `${selfFilledPercent.toFixed(2)}%`,
      `${thirdPartyPercent.toFixed(2)}%`,
      (order.isExecutedWithNiceChart === true || order.niceChartRange?.isValid) ? 'Yes' : 'No',
      (Number(order.price) || 0).toFixed(coin2Decimals),
      (Number(order.coin1Amount) || 0).toFixed(coin1Decimals),
      quoteAmount.toFixed(coin2DecimalsForStable),
      Number.isFinite(approxUsd) ? approxUsd.toFixed(2) : '—',
    ];
  });

  const [ordersAgg] = await ordersDb.aggregate([
    {
      $match: {
        exchange: config.exchange,
        pair,
        purpose: 't',
        mmOrderAction: { $in: traderActions },
        ...statsSinceFilter,
      },
    },
    {
      $group: {
        _id: null,
        totalPlaced: { $sum: 1 },
        buyPlaced: { $sum: { $cond: [{ $eq: ['$side', 'buy'] }, 1, 0] } },
        sellPlaced: { $sum: { $cond: [{ $eq: ['$side', 'sell'] }, 1, 0] } },

        totalFilledCount: {
          $sum: { $cond: [{ $gt: [{ $ifNull: ['$coin1AmountFilled', 0] }, 0] }, 1, 0] },
        },
        buyFilledCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$side', 'buy'] }, { $gt: [{ $ifNull: ['$coin1AmountFilled', 0] }, 0] }] },
              1,
              0,
            ],
          },
        },
        sellFilledCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$side', 'sell'] }, { $gt: [{ $ifNull: ['$coin1AmountFilled', 0] }, 0] }] },
              1,
              0,
            ],
          },
        },

        inSpreadTotal: { $sum: { $cond: [{ $eq: ['$mmOrderAction', 'executeInSpread'] }, 1, 0] } },
        inSpreadBuy: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$mmOrderAction', 'executeInSpread'] }, { $eq: ['$side', 'buy'] }] }, 1, 0],
          },
        },
        inSpreadSell: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$mmOrderAction', 'executeInSpread'] }, { $eq: ['$side', 'sell'] }] }, 1, 0],
          },
        },

        inOrderBookTotal: { $sum: { $cond: [{ $eq: ['$mmOrderAction', 'executeInOrderBook'] }, 1, 0] } },
        inOrderBookBuy: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$mmOrderAction', 'executeInOrderBook'] }, { $eq: ['$side', 'buy'] }] }, 1, 0],
          },
        },
        inOrderBookSell: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$mmOrderAction', 'executeInOrderBook'] }, { $eq: ['$side', 'sell'] }] }, 1, 0],
          },
        },

        niceChartTotal: {
          $sum: {
            $cond: [{
              $or: [
                { $eq: [{ $ifNull: ['$isExecutedWithNiceChart', false] }, true] },
                { $eq: [{ $ifNull: ['$niceChartRange.isValid', false] }, true] },
              ],
            }, 1, 0],
          },
        },
        niceChartBuy: {
          $sum: {
            $cond: [{
              $and: [{
                $or: [
                  { $eq: [{ $ifNull: ['$isExecutedWithNiceChart', false] }, true] },
                  { $eq: [{ $ifNull: ['$niceChartRange.isValid', false] }, true] },
                ],
              }, { $eq: ['$side', 'buy'] }],
            }, 1, 0],
          },
        },
        niceChartSell: {
          $sum: {
            $cond: [{
              $and: [{
                $or: [
                  { $eq: [{ $ifNull: ['$isExecutedWithNiceChart', false] }, true] },
                  { $eq: [{ $ifNull: ['$niceChartRange.isValid', false] }, true] },
                ],
              }, { $eq: ['$side', 'sell'] }],
            }, 1, 0],
          },
        },

        buyFilledQuote: {
          $sum: {
            $cond: [{ $eq: ['$side', 'buy'] }, { $max: [{ $ifNull: ['$coin2AmountFilled', 0] }, 0] }, 0],
          },
        },
        sellFilledQuote: {
          $sum: {
            $cond: [{ $eq: ['$side', 'sell'] }, { $max: [{ $ifNull: ['$coin2AmountFilled', 0] }, 0] }, 0],
          },
        },
      },
    },
  ]);

  const tFillStats = fillsEngine ? await fillsEngine.getStats({
    exchange: config.exchange, pair, purpose: 't', startTs: epochTs,
  }) : undefined;

  /** @type {TraderOrderStatsAgg} */
  const stats = /** @type {TraderOrderStatsAgg} */ (ordersAgg || {});
  const totalPlaced = Number(stats.totalPlaced) || 0;

  // Order-based filled quote (includes both self-filled and third-party) — used only for self/third-party % attribution
  const buyFilledQuote = Number(stats.buyFilledQuote) || 0;
  const sellFilledQuote = Number(stats.sellFilledQuote) || 0;

  // Third-party fill amounts from fillsEngine (only recorded when an external counterparty fills a t-order)
  const tpBuyAmount = tFillStats?.buy?.sumAmount || 0;
  const tpSellAmount = tFillStats?.sell?.sumAmount || 0;
  const tpBuyQuote = tFillStats?.buy?.sumQuote || 0;
  const tpSellQuote = tFillStats?.sell?.sumQuote || 0;
  const hasTpFills = tpBuyAmount > 0 || tpSellAmount > 0;

  const thirdPartyTotalQuote = tpBuyQuote + tpSellQuote;
  const totalFilledQuote = buyFilledQuote + sellFilledQuote;
  const selfFilledQuote = Math.max(totalFilledQuote - thirdPartyTotalQuote, 0);
  const selfFilledPercent = totalFilledQuote > 0 ? (selfFilledQuote / totalFilledQuote) * 100 : 0;
  const thirdPartyPercent = totalFilledQuote > 0 ? (thirdPartyTotalQuote / totalFilledQuote) * 100 : 0;

  const statsRows = [
    ['Total placed', `${Number(stats.buyPlaced) || 0}`, `${Number(stats.sellPlaced) || 0}`, `${totalPlaced}`],
    [
      'Total filled',
      `${Number(stats.buyFilledCount) || 0}`,
      `${Number(stats.sellFilledCount) || 0}`,
      formatCountShare(Number(stats.totalFilledCount) || 0, totalPlaced),
    ],
    [
      'In spread',
      `${Number(stats.inSpreadBuy) || 0}`,
      `${Number(stats.inSpreadSell) || 0}`,
      formatCountShare(Number(stats.inSpreadTotal) || 0, totalPlaced),
    ],
    [
      'In orderbook',
      `${Number(stats.inOrderBookBuy) || 0}`,
      `${Number(stats.inOrderBookSell) || 0}`,
      formatCountShare(Number(stats.inOrderBookTotal) || 0, totalPlaced),
    ],
    [
      'Nice chart',
      `${Number(stats.niceChartBuy) || 0}`,
      `${Number(stats.niceChartSell) || 0}`,
      formatCountShare(Number(stats.niceChartTotal) || 0, totalPlaced),
    ],
    ['Self-filled %', '', '', `${selfFilledPercent.toFixed(2)}%`],
    ['Third-party %', '', '', `${thirdPartyPercent.toFixed(2)}%`],
    [
      `Filled t-p amount, ${coin1}`,
      hasTpFills ? tpBuyAmount.toFixed(coin1Decimals) : '—',
      hasTpFills ? tpSellAmount.toFixed(coin1Decimals) : '—',
      hasTpFills ? utils.signedNumber(tpBuyAmount - tpSellAmount, coin1Decimals) : '—',
    ],
    [
      `Filled t-p vol, ${coin2}`,
      hasTpFills ? tpBuyQuote.toFixed(coin2DecimalsForStable) : '—',
      hasTpFills ? tpSellQuote.toFixed(coin2DecimalsForStable) : '—',
      hasTpFills ? utils.signedNumber(tpSellQuote - tpBuyQuote, coin2DecimalsForStable) : '—',
    ],
    [
      `VWAP, ${coin2}`,
      tFillStats.boughtVwap > 0 ? tFillStats.boughtVwap.toFixed(coin2Decimals) : '—',
      tFillStats.soldVwap > 0 ? tFillStats.soldVwap.toFixed(coin2Decimals) : '—',
      tFillStats.hasBothSides ? utils.signedNumber(tFillStats.vwapSpread, coin2Decimals) : '—',
    ],
    [
      'MTM PnL',
      '',
      '',
      typeof tFillStats.pnlQuoteMtm === 'number' ?
        `${utils.signedNumber(tFillStats.pnlQuoteMtm, coin2DecimalsForStable)} ${coin2}` +
          (!utils.isStableCoin(coin2) && Number.isFinite(tFillStats.pnlUsdMtm) ?
            ` (${utils.signedNumber(tFillStats.pnlUsdMtm, 2)} USD)` :
            '') :
        '—',
    ],
  ];

  let output = '';

  const niceChart = utils.softRequire('../../trade/mm_nice_chart');
  const niceChartEnabled = config.nice_chart?.enabled !== false;

  const isTActive = tradeParams.mm_isActive && tradeParams.mm_isTraderActive;
  const isNiceChart = niceChart && niceChartEnabled;
  const tStatus = isTActive ? 'Enabled' : 'Disabled';
  const niceChartStatus = isNiceChart ? 'Enabled' : 'Disabled';

  output += `\n\n**Trader**: _${tStatus}_ with _${tradeParams.mm_Policy}_ policy and ${tradeParams.mm_buyPercent * 100}% probability of buy orders. Nice chart: _${niceChartStatus}_.`;

  let paramString = `The bot trades _${tradeParams.mm_minAmount}–${tradeParams.mm_maxAmount}_ ${coin1}`;
  if (tradeParams.mm_traderObLimitPercent) {
    paramString += ` with executeInOrderBook amount limit _${tradeParams.mm_traderObLimitPercent}%_`;
  }
  const minAmountInSec = Math.round(tradeParams.mm_minInterval / 1000);
  const maxAmountInSec = Math.round(tradeParams.mm_maxInterval / 1000);
  paramString += ` every _${minAmountInSec}–${maxAmountInSec}_ secs.`;
  const currentDailyTradeVolumeString = `~${exchangerUtils.getVolumeInfoString(exchangerUtils.estimateCurrentDailyTradeVolume())}`;
  paramString += ` Estimated daily trading volume: ${currentDailyTradeVolumeString}.`;
  paramString += `\n\n${composeMinExchangeOrderString()}.`;
  output += `\nParams: ${paramString}`;

  output += `\n\n**Recently closed t-orders**: _last ${recentWindowMinutes} minutes, max ${recentLimit}_.`;
  if (recentRows.length) {
    output += `\n\`\`\`\n${utils.generateTable(
        ['Date', 'Side', 'Action', 'Self-filled %', 'Third-party %', 'Nice chart', `Price ${coin2}`, `Amount ${coin1}`, `Quote ${coin2}`, '~USD'],
        recentRows,
    )}\n\`\`\``;
  } else {
    output += '\nNo recently closed t-orders.\n\n';
  }

  if (epochTs > 0) {
    output += `\n**Trader stats** since Epoch started _${utils.timeAgoString(epochTs)}_:\n`;
    output += `\`\`\`\n${utils.generateTable(['', 'Buy', 'Sell', 'Delta · Sum'], statsRows)}\n\`\`\``;
  } else {
    output += `\nNo stats available yet since Epoch has not started.\n\n`;
  }

  return output;
}


/**
 * Helper to compose open order summary for accountNo
 * Stores them and compares to the previous request
 * @param {number} accountNo 0 is for the first trade account, 1 is for the second
 * @param {Object} tx Income ADM transaction for in-chat command
 * @param {string} pairRaw BTC/USDT for spot or BTCUSDT for perpetual
 * @returns {Promise<CommandListResult>} Order summary for an account
 */
async function composeOrderSummary(accountNo = 0, tx = {}, pairRaw) {
  let output = '';

  const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pairRaw));
  const { pair, coin1, coin2, coin1Decimals, coin2Decimals, isPerpetual } = formattedPair;

  const api = isPerpetual ?
      perpetualApi :
      accountNo === 0 ? traderapi : traderapi2;
  const accountNoString = traderapi2 ? ` (account ${accountNo+1})` : '';

  const ordersByPurpose = await orderStats.ordersByPurpose(pair, api);
  const openOrders = await orderUtils.getOpenOrdersCached(pair, moduleName, false, api);

  let diffOrderCountString = '';
  let diffUnkOrderCountString = '';

  if (openOrders) {
    let diff; let sign;

    const prevOpenOrdersCount = previousOrders?.[accountNo]?.[tx.senderId]?.[pair]?.openOrdersCount;

    if (prevOpenOrdersCount) {
      diff = openOrders.length - prevOpenOrdersCount;
      sign = diff > 0 ? '+' : '−';
      diff = Math.abs(diff);
      if (diff) diffOrderCountString = ` (${sign}${diff})`;
    }

    ordersByPurpose.openOrdersCount = openOrders.length;
    ordersByPurpose.unkLength = openOrders.length - ordersByPurpose['all'].allOrders.length;

    const prevUnkOpenOrdersCount = previousOrders?.[accountNo]?.[tx.senderId]?.[pair]?.unkLength;

    if (prevUnkOpenOrdersCount) {
      diff = ordersByPurpose.unkLength - prevUnkOpenOrdersCount;
      sign = diff > 0 ? '+' : '−';
      diff = Math.abs(diff);
      if (diff) diffUnkOrderCountString = ` (${sign}${diff})`;
    }
  } else {
    output = `Unable to receive open orders on ${config.exchangeName} for ${pair}${accountNoString}. Try again.`;
  }

  /**
   * Calculates order count difference by purpose comparing to the previous request
   * @param {string} purpose Purpose of orders to calc order count difference
   * @returns {string}
   */
  const getDiffString = function(purpose) {
    let diff; let sign;
    let diffString = '';

    const prevPurposeOrderCount = previousOrders?.[accountNo]?.[tx.senderId]?.[formattedPair.pair]?.[purpose]?.allOrders.length;
    const curPurposeOrderCount = ordersByPurpose[purpose].allOrders.length;

    if (prevPurposeOrderCount >= 0) {
      diff = curPurposeOrderCount - prevPurposeOrderCount;
      sign = diff > 0 ? '+' : '−';
      diff = Math.abs(diff);
      if (diff) diffString = ` (${sign}${diff})`;
    }

    return diffString;
  };

  /**
   * Creates a string showing amounts for bids and asks aggregated by purpose
   * @param {string} purpose Purpose of orders
   * @returns {string}
   */
  const getAmountsString = function(purpose) {
    let amountsString = '';

    const quote = ordersByPurpose[purpose].buyOrdersQuote;
    const amount = ordersByPurpose[purpose].sellOrdersAmount;

    if (quote || amount) {
      amountsString = ` — ${quote.toFixed(coin2Decimals)} ${coin2} buys & ${amount.toFixed(coin1Decimals)} ${coin1} sells`;
    }
    return amountsString;
  };

  // Compose "Orders in my database"

  if (ordersByPurpose?.['all']?.allOrders?.length > 0) {
    output += '\n\nOrders in my database:';

    Object.keys(ordersByPurpose).forEach((purpose) => { // Handles also indexed purposes like 'ld2'
      if (ordersByPurpose[purpose].purposeName) { // Skip additional fields like ordersByPurpose.openOrdersCount
        const purposeString = `${ordersByPurpose[purpose].purposeName}`;
        const count = ordersByPurpose[purpose].allOrders.length;

        output += `\n${purposeString} _${purpose}_: ${count}${getDiffString(purpose)}${getAmountsString(purpose)},`;
      }
    });

    output = utils.trimAny(output, ',') + '.';
  } else {
    output += '\n\n' + 'No open orders in my database.';
  }

  output += `\n\nOrders which are not in my database (Unknown orders _unk_): ${ordersByPurpose.unkLength}${diffUnkOrderCountString}.`;

  // Store open orders as previous for the new request

  previousOrders[accountNo][tx.senderId] = {};
  previousOrders[accountNo][tx.senderId][formattedPair.pair] = ordersByPurpose;

  return {
    count: openOrders?.length,
    diffOrderCountString,
    output,
  };
}


/**
 * Helper to compose open order details of specific purpose for accountNo
 * @param {number} accountNo 0 is for the first trade account, 1 is for the second
 * @param {string} pairRaw BTC/USDT for spot or BTCUSDT for perpetual
 * @param {string} purpose Purpose of orders to list, e.g., 'ld' or 'man'
 * @param {''|string} moduleIndexString When working with several module instances, e.g., ladder1 and ladder2. Equals to '' for the first instance. Equals to '2' or higher for indexed purposes such as 'ld2', 'ld3', etc.
 * @param {boolean} fullInfo Show full order info, with additional fields, e.g., order date
 * @returns {Promise<CommandListResult>} List of open orders of a specific purpose
 */
async function composeOrdersDetails(accountNo = 0, pairRaw, purpose, moduleIndexString, fullInfo) {
  let output = '';

  const formattedPair = /** @type {ParsedMarket} */ (orderUtils.parseMarket(pairRaw));
  const { pair, coin1Decimals, coin2Decimals, isPerpetual } = formattedPair;

  const api = isPerpetual ?
      perpetualApi :
      accountNo === 0 ? traderapi : traderapi2;

  let ordersByPurpose = await orderStats.ordersByPurpose(pair, api, false, true);
  const purposeIndexed = `${purpose}${moduleIndexString}`; // E.g., 'ld', 'ld2' or 'man'

  // Pick up both buy and sell orders of the specific purpose, e.g., 'man'
  // Object may not exist for indexed module, e.g., ld2
  ordersByPurpose = ordersByPurpose[purposeIndexed]?.allOrders;

  if (ordersByPurpose?.length) {
    ordersByPurpose.sort((a, b) => b.price - a.price);

    for (const order of ordersByPurpose) {
      const amountString = order.coin1Amount?.toFixed(coin1Decimals);
      const quoteString = +order.coin2Amount?.toFixed(coin2Decimals);
      const priceString = order.price?.toFixed(coin2Decimals);

      if (purpose === 'ld') {
        output += `${utils.padTo2Digits(order.ladderIndex)} `;
      }

      output += `${order.side} ${amountString} ${order.coin1} @${priceString} for ${quoteString} ${order.coin2}${order.gainString || ''} `;

      if (order.coin1AmountFilled) {
        const filledPercent = (order.coin1AmountFilled / order.coin1Amount * 100).toFixed(2);
        output += `(${filledPercent}% filled) `;
      }

      if (purpose === 'ld') {
        output += `| ${order.ladderState} `;
      }

      if (fullInfo) {
        if (purpose === 'ld') {
          if (order.ladderNotPlacedReason) {
            output += `(${order.ladderNotPlacedReason}) `;
          }
        }

        if (purpose === 'liq') {
          if (order.subPurpose) {
            output += `| ${order.subPurpose}${order.subType ? ', ' + order.subType : ''} `;
          }
        }

        output += `| ${utils.formatDate(new Date(order.date))} | ${order._id}`;
      }

      output += '\n';
    }

    output = utils.codeBlock(output);
  }

  return {
    count: ordersByPurpose?.length || 0,
    output,
  };
}

module.exports = {
  composeOrderBookInfoString,
  composeMinExchangeOrderString,
  composeLiquidityStats,
  composeTraderOrdersFull,
  composeOrderSummary,
  composeOrdersDetails,
};
