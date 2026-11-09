'use strict';

/**
 * Public (and a few private-shaped) HTTP fixtures for mocked trader Jest suites.
 * Live exchange checks stay in `tests/trader_live/`.
 *
 * @module tests/trader/publicHttpMocks
 */

const LATOKEN_BTC_ID = '92151d82-df98-4d88-9a4d-284fa9eca49f';
const LATOKEN_USDT_ID = '0c3a106d-bde3-4c13-a26e-3fd2394529e5';

const binanceSymbol = {
  symbol: 'BTCUSDT',
  status: 'TRADING',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  baseAssetPrecision: 8,
  quoteAssetPrecision: 8,
  isSpotTradingAllowed: true,
  quoteOrderQtyMarketAllowed: true,
  orderTypes: ['LIMIT', 'LIMIT_MAKER', 'MARKET'],
  filters: [
    { filterType: 'LOT_SIZE', minQty: '0.00001', maxQty: '9000', stepSize: '0.00001' },
    { filterType: 'MIN_NOTIONAL', minNotional: '5' },
    { filterType: 'PRICE_FILTER', minPrice: '0.01', maxPrice: '1000000', tickSize: '0.01' },
    { filterType: 'MAX_NUM_ORDERS', maxNumOrders: 200 },
  ],
};

const binanceTicker = {
  symbol: 'BTCUSDT',
  lastPrice: '50000',
  bidPrice: '49999',
  askPrice: '50001',
  volume: '10',
  quoteVolume: '500000',
  highPrice: '51000',
  lowPrice: '49000',
};

const binanceDepth = {
  bids: [['49999', '0.5']],
  asks: [['50001', '0.4']],
};

const binanceTrades = [{
  id: 1,
  price: '50000',
  qty: '0.1',
  quoteQty: '5000',
  time: 1700000000000,
  isBuyerMaker: false,
}];

const mexcSymbol = {
  symbol: 'BTCUSDT',
  status: 'ENABLED',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  baseAssetPrecision: 6,
  quoteAssetPrecision: 2,
  baseSizePrecision: '0.000001',
  quoteAmountPrecision: '1',
  maxQuoteAmount: '1000000',
  isSpotTradingAllowed: true,
};

const kucoinWrap = (data) => ({ code: '200000', data });
const bitmartWrap = (data) => ({ code: 1000, message: 'OK', data });
const lbankWrap = (data) => ({ result: true, error_code: 0, data });
const okxWrap = (data) => ({ code: '0', msg: '', data });
const krakenWrap = (result) => ({ error: [], result });
const digifinexWrap = (extra) => ({ code: 0, ...extra });

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {import('axios-mock-adapter')} axiosMock
 * @param {string} method
 * @param {string} urlFragment
 * @param {unknown} body
 * @returns {void}
 */
function on(axiosMock, method, urlFragment, body, { prefix = false, json = false } = {}) {
  const pattern = prefix ?
    escapeRegex(urlFragment) :
    `${escapeRegex(urlFragment)}(?:\\?|$)`;
  const matcher = new RegExp(pattern);
  const payload = json && body !== undefined && typeof body !== 'string' ?
    JSON.stringify(body) :
    body;
  if (method === 'get') {
    axiosMock.onGet(matcher).reply(200, payload);
  } else if (method === 'post') {
    axiosMock.onPost(matcher).reply(200, payload);
  } else if (method === 'delete') {
    axiosMock.onDelete(matcher).reply(200, payload);
  }
}

const registries = {
  binance(axiosMock) {
    const base = 'https://api.binance.com';
    on(axiosMock, 'get', `${base}/api/v3/exchangeInfo`, { symbols: [binanceSymbol] });
    on(axiosMock, 'get', `${base}/api/v3/ticker/24hr`, binanceTicker);
    on(axiosMock, 'get', `${base}/api/v3/depth`, binanceDepth);
    on(axiosMock, 'get', `${base}/api/v3/trades`, binanceTrades);
  },

  binanceus(axiosMock) {
    const base = 'https://api.binance.us';
    on(axiosMock, 'get', `${base}/api/v3/exchangeInfo`, { symbols: [binanceSymbol] });
    on(axiosMock, 'get', `${base}/api/v3/ticker/24hr`, binanceTicker);
    on(axiosMock, 'get', `${base}/api/v3/depth`, binanceDepth);
    on(axiosMock, 'get', `${base}/api/v3/trades`, binanceTrades);
  },

  lbank(axiosMock) {
    const base = 'https://api.lbkex.com';
    on(axiosMock, 'get', `${base}/v2/accuracy.do`, lbankWrap([
      { symbol: 'btc_usdt', quantityAccuracy: 4, priceAccuracy: 2, minTranQua: '0.0001' },
      { symbol: 'bnb_usdt', quantityAccuracy: 4, priceAccuracy: 2, minTranQua: '0.0001' },
    ]));
    on(axiosMock, 'get', `${base}/v2/currencyPairs.do`, lbankWrap(['btc_usdt', 'bnb_usdt']));
    on(axiosMock, 'get', `${base}/v2/ticker/24hr.do`, lbankWrap([{
      ticker: { latest: '50000', vol: '10', turnover: '500000', high: '51000', low: '49000' },
    }]));
    on(axiosMock, 'get', `${base}/v2/depth.do`, lbankWrap({
      asks: [['50001', '0.4']],
      bids: [['49999', '0.5']],
    }));
    on(axiosMock, 'get', `${base}/v2/supplement/trades.do`, lbankWrap([{
      id: 1, price: '50000', qty: '0.1', time: 1700000000000, isBuyerMaker: false,
    }]));
    on(axiosMock, 'get', `${base}/v2/assetConfigs.do`, lbankWrap([{
      chainName: 'erc20',
      canDeposit: true,
    }]));
  },

  gateio(axiosMock) {
    const base = 'https://api.gateio.ws/api/v4';
    const pair = (id, baseCoin, quote) => ({
      id,
      base: baseCoin,
      quote,
      amount_precision: 4,
      precision: 2,
      min_base_amount: '0.0001',
      min_quote_amount: '1',
      trade_status: 'tradable',
    });
    on(axiosMock, 'get', `${base}/spot/currency_pairs`, [
      pair('BTC_USDT', 'BTC', 'USDT'),
      pair('ETH_USDT', 'ETH', 'USDT'),
      pair('ETH_BTC', 'ETH', 'BTC'),
    ]);
    on(axiosMock, 'get', `${base}/spot/tickers`, [{
      currency_pair: 'BTC_USDT',
      last: '50000',
      lowest_ask: '50001',
      highest_bid: '49999',
      base_volume: '10',
      quote_volume: '500000',
      high_24h: '51000',
      low_24h: '49000',
    }]);
    on(axiosMock, 'get', `${base}/spot/order_book`, {
      asks: [['50001', '0.4']],
      bids: [['49999', '0.5']],
    });
    on(axiosMock, 'get', `${base}/spot/trades`, [{
      id: '1',
      amount: '0.1',
      price: '50000',
      side: 'sell',
      create_time_ms: '1700000000000',
    }]);
  },

  hitbtc(axiosMock) {
    const base = 'https://api.hitbtc.com/api/3';
    const symbol = (baseCurrency, quoteCurrency) => ({
      base_currency: baseCurrency,
      quote_currency: quoteCurrency,
      quantity_increment: '0.00001',
      tick_size: '0.01',
    });
    on(axiosMock, 'get', `${base}/public/symbol`, {
      BTCUSDT: symbol('BTC', 'USDT'),
      'BTC/USDT': symbol('BTC', 'USDT'),
      ETHUSDT: symbol('ETH', 'USDT'),
      ETHBTC: symbol('ETH', 'BTC'),
    });
    on(axiosMock, 'get', `${base}/public/ticker/`, {
      ask: '50001', bid: '49999', volume: '10', volume_quote: '500000', high: '51000', low: '49000',
    }, { prefix: true });
    on(axiosMock, 'get', `${base}/public/orderbook/`, {
      ask: [['50001', '0.4']],
      bid: [['49999', '0.5']],
    }, { prefix: true });
    on(axiosMock, 'get', `${base}/public/trades/`, [{
      id: 1, qty: '0.1', price: '50000', timestamp: '2023-01-01T00:00:00.000Z', side: 'sell',
    }], { prefix: true });
  },

  kucoin(axiosMock) {
    const base = 'https://api.kucoin.com/api';
    on(axiosMock, 'get', `${base}/v2/symbols`, kucoinWrap([{
      symbol: 'BTC-USDT',
      baseIncrement: '0.00001',
      quoteIncrement: '0.01',
      baseMinSize: '0.00001',
      baseMaxSize: '1000',
      quoteMinSize: '1',
      quoteMaxSize: '1000000',
      enableTrading: true,
    }]));
    on(axiosMock, 'get', `${base}/v1/market/stats`, kucoinWrap({
      sell: '50001', buy: '49999', last: '50000', vol: '10', volValue: '500000', high: '51000', low: '49000',
    }));
    on(axiosMock, 'get', `${base}/v1/market/orderbook/level2_100`, kucoinWrap({
      asks: [['50001', '0.4']],
      bids: [['49999', '0.5']],
    }));
    on(axiosMock, 'get', `${base}/v1/market/histories`, kucoinWrap([{
      size: '0.1', price: '50000', time: 1700000000000, side: 'sell',
    }]));
    on(axiosMock, 'get', `${base}/v3/currencies`, kucoinWrap([{
      currency: 'BTC',
      name: 'Bitcoin',
      precision: 8,
      confirms: 2,
      chains: [{
        chainName: 'BTC',
        chainId: 'btc',
        isDepositEnabled: true,
        isWithdrawEnabled: true,
        withdrawalMinFee: '0.0005',
        withdrawalMinSize: '0.001',
        confirms: 2,
      }],
    }]));
  },

  bitmart(axiosMock) {
    const base = 'https://api-cloud.bitmart.com';
    on(axiosMock, 'get', `${base}/spot/v1/symbols/details`, bitmartWrap({
      symbols: [{
        symbol: 'BTC_USDT',
        symbol_id: 1,
        base_currency: 'BTC',
        quote_currency: 'USDT',
        base_min_size: '0.00001',
        price_max_precision: 2,
        min_buy_amount: '1',
        trade_status: 'trading',
      }, {
        symbol: 'XAG_USDT',
        symbol_id: 2,
        base_currency: 'XAG',
        quote_currency: 'USDT',
        base_min_size: '0.01',
        price_max_precision: 4,
        min_buy_amount: '1',
        trade_status: 'trading',
      }],
    }));
    on(axiosMock, 'get', `${base}/spot/quotation/v3/ticker`, bitmartWrap({
      ask_px: '50001', bid_px: '49999', last: '50000', v_24h: '10', qv_24h: '500000', high_24h: '51000', low_24h: '49000',
    }));
    on(axiosMock, 'get', `${base}/spot/quotation/v3/books`, bitmartWrap({
      asks: [['50001', '0.4']],
      bids: [['49999', '0.5']],
    }));
    on(axiosMock, 'get', `${base}/spot/quotation/v3/trades`, bitmartWrap([
      [1, 1700000000000, '50000', '0.1', 'sell'],
    ]));
    on(axiosMock, 'get', `${base}/account/v1/currencies`, bitmartWrap({
      currencies: [{
        currency: 'USDT-TRC20',
        name: 'TetherUSD',
        network: 'TRC20',
        deposit_enabled: true,
        withdraw_enabled: true,
        withdraw_minfee: '1',
        withdraw_minsize: '10',
      }],
    }));
  },

  digifinex(axiosMock) {
    const base = 'https://openapi.digifinex.com/v3';
    on(axiosMock, 'get', `${base}/spot/symbols`, digifinexWrap({
      symbol_list: [{
        symbol: 'BTC_USDT',
        amount_precision: 6,
        price_precision: 2,
        minimum_amount: '0.0001',
        minimum_value: '1',
        status: 'TRADING',
      }],
    }));
    on(axiosMock, 'get', `${base}/ticker`, digifinexWrap({
      ticker: [{
        sell: '50001', buy: '49999', last: '50000', vol: '10', base_vol: '500000', high: '51000', low: '49000',
      }],
    }));
    on(axiosMock, 'get', `${base}/order_book`, digifinexWrap({
      asks: [['50001', '0.4']],
      bids: [['49999', '0.5']],
    }));
    on(axiosMock, 'get', `${base}/trades`, digifinexWrap({
      data: [{
        amount: '0.1', price: '50000', type: 'sell', id: '1', date: 1700000000,
      }],
    }));
  },

  mexc(axiosMock) {
    const base = 'https://api.mexc.com/api';
    on(axiosMock, 'get', `${base}/v3/exchangeInfo`, { symbols: [mexcSymbol] });
    on(axiosMock, 'get', `${base}/v3/ticker/24hr`, {
      askPrice: '50001', bidPrice: '49999', lastPrice: '50000',
      volume: '10', quoteVolume: '500000', highPrice: '51000', lowPrice: '49000',
    });
    on(axiosMock, 'get', `${base}/v3/depth`, binanceDepth);
    on(axiosMock, 'get', `${base}/v3/trades`, binanceTrades);
    on(axiosMock, 'get', `${base}/v3/capital/config/getall`, [{
      coin: 'BTC',
      name: 'Bitcoin',
      networkList: [{
        network: 'BTC',
        withdrawFee: '0.0001',
        withdrawMin: '0.001',
        minConfirm: 1,
        withdrawEnable: true,
        depositEnable: true,
      }],
    }]);
  },

  okx(axiosMock) {
    const base = 'https://www.okx.com';
    on(axiosMock, 'get', `${base}/api/v5/public/instruments`, okxWrap([{
      instId: 'BTC-USDT',
      baseCcy: 'BTC',
      quoteCcy: 'USDT',
      lotSz: '0.00001',
      tickSz: '0.1',
      minSz: '0.00001',
      state: 'live',
    }]));
    on(axiosMock, 'get', `${base}/api/v5/market/ticker`, okxWrap([{
      askPx: '50001', bidPx: '49999', last: '50000',
      vol24h: '10', volCcy24h: '500000', high24h: '51000', low24h: '49000',
    }]));
    on(axiosMock, 'get', `${base}/api/v5/market/trades`, okxWrap([{
      sz: '0.1', px: '50000', ts: '1700000000000', side: 'sell', tradeId: '1',
    }]));
    on(axiosMock, 'get', `${base}/api/v5/market/books`, okxWrap([{
      asks: [['50001', '0.4', '0', '1']],
      bids: [['49999', '0.5', '0', '1']],
    }]));
  },

  okcoin(axiosMock) {
    const base = 'https://www.okcoin.com/api';
    on(axiosMock, 'get', `${base}/spot/v3/instruments`, [{
      instrument_id: 'BTC-USDT',
      size_increment: '0.00000001',
      tick_size: '0.01',
      min_size: '0.001',
    }]);
    on(axiosMock, 'get', `${base}/spot/v3/instruments/BTC-USDT/ticker`, {
      best_ask: '50001', best_bid: '49999',
      base_volume_24h: '10', quote_volume_24h: '500000', high_24h: '51000', low_24h: '49000',
    });
    on(axiosMock, 'get', `${base}/spot/v3/instruments/BTC-USDT/trades`, [{
      size: '0.1', price: '50000', timestamp: '2023-01-01T00:00:00.000Z', side: 'sell', trade_id: '1',
    }]);
    on(axiosMock, 'get', `${base}/spot/v3/instruments/BTC-USDT/book`, {
      asks: [['50001', '0.4']],
      bids: [['49999', '0.5']],
    });
  },

  poloniex(axiosMock) {
    const base = 'https://api.poloniex.com';
    on(axiosMock, 'get', `${base}/markets`, [{
      symbol: 'BTC_USDT',
      state: 'NORMAL',
      symbolTradeLimit: {
        quantityScale: 6,
        priceScale: 2,
        minQuantity: '0.000001',
        minAmount: '1',
      },
    }]);
    on(axiosMock, 'get', `${base}/v2/currencies`, [{
      coin: 'AAVE',
      name: 'Aave',
      networkList: [{
        id: 1,
        name: 'ETH',
        coin: 'AAVEETH',
        depositEnable: true,
        withdrawalEnable: true,
      }],
    }, {
      coin: 'BTC',
      name: 'Bitcoin',
      networkList: [{
        id: 2,
        name: 'BTC',
        coin: 'BTC',
        depositEnable: true,
        withdrawalEnable: true,
      }],
    }]);
    on(axiosMock, 'get', `${base}/markets/BTC_USDT/ticker24h`, {
      ask: '50001', bid: '49999', markPrice: '50000',
      quantity: '10', amount: '500000', high: '51000', low: '49000',
    });
    on(axiosMock, 'get', `${base}/markets/BTC_USDT/trades`, [{
      quantity: '0.1', price: '50000', amount: '5000',
      takerSide: 'sell', id: '1', createTime: 1700000000000,
    }]);
    on(axiosMock, 'get', `${base}/markets/BTC_USDT/orderBook`, {
      asks: ['50001', '0.4'],
      bids: ['49999', '0.5'],
    });
    on(axiosMock, 'get', `${base}/accounts/balances`, [{
      balances: [
        { currency: 'BTC', available: '1', hold: '0.1' },
        { currency: 'USDT', available: '100', hold: '0' },
      ],
    }]);
    on(axiosMock, 'get', `${base}/orders`, [{
      id: '1',
      symbol: 'BTC_USDT',
      price: '50000',
      side: 'BUY',
      type: 'LIMIT',
      state: 'NEW',
      quantity: '0.1',
      filledQuantity: '0',
      createTime: 1700000000000,
    }]);
    on(axiosMock, 'post', `${base}/orders`, { id: '514845991795' });
    on(axiosMock, 'delete', `${base}/orders/`, { code: 200, orderId: '1' }, { prefix: true });
    on(axiosMock, 'delete', `${base}/orders`, [{ code: 200, orderId: '1' }]);
    on(axiosMock, 'get', `${base}/wallets/addresses`, { AAVEETH: '0xae8d0d7c520daebb1580dabaa91f3ccf8ae492f5' });
  },

  latoken(axiosMock) {
    const base = 'https://api.latoken.com';
    on(axiosMock, 'get', `${base}/v2/pair`, [{
      id: 'pair-1',
      baseCurrency: LATOKEN_BTC_ID,
      quoteCurrency: LATOKEN_USDT_ID,
      quantityDecimals: 8,
      priceDecimals: 2,
      costDisplayDecimals: 2,
      quantityTick: '0.00000001',
      priceTick: '0.01',
      minOrderQuantity: '0.0001',
      status: 'PAIR_STATUS_ACTIVE',
    }]);
    on(axiosMock, 'get', `${base}/v2/currency`, [
      { id: LATOKEN_BTC_ID, tag: 'BTC', name: 'Bitcoin', decimals: 8, status: 'CURRENCY_STATUS_ACTIVE' },
      { id: LATOKEN_USDT_ID, tag: 'USDT', name: 'Tether', decimals: 6, status: 'CURRENCY_STATUS_ACTIVE' },
    ]);
    on(axiosMock, 'get', `${base}/v2/ticker/`, {
      bestAsk: '50001', bestBid: '49999', amount24h: '10', volume24h: '500000', lastPrice: '50000',
    }, { prefix: true });
    on(axiosMock, 'get', `${base}/v2/book/`, {
      ask: [{ quantity: '0.4', price: '50001' }],
      bid: [{ quantity: '0.5', price: '49999' }],
    }, { prefix: true });
    on(axiosMock, 'get', `${base}/v2/trade/history/`, [{
      quantity: '0.1', price: '50000', cost: '5000', timestamp: 1700000000000,
      isMakerBuyer: false, id: '1',
    }], { prefix: true });
  },

  coinbase(axiosMock) {
    const base = 'https://api.exchange.coinbase.com';
    on(axiosMock, 'get', `${base}/products`, [{
      id: 'BTC-USDT',
      base_increment: '0.00000001',
      quote_increment: '0.01',
      min_market_funds: '1',
      status: 'online',
      status_message: '',
    }]);
    on(axiosMock, 'get', `${base}/products/BTC-USDT/ticker`, {
      ask: '50001', bid: '49999', volume: '10', price: '50000',
    });
    on(axiosMock, 'get', `${base}/products/BTC-USDT/stats`, {
      volume: '10', last: '50000', high: '51000', low: '49000',
    });
    on(axiosMock, 'get', `${base}/products/BTC-USDT/book`, {
      asks: [['50001', '0.4', 'id-ask']],
      bids: [['49999', '0.5', 'id-bid']],
    });
    on(axiosMock, 'get', `${base}/products/BTC-USDT/trades`, [{
      size: '0.1', price: '50000', side: 'sell', trade_id: 1, time: '2023-01-01T00:00:00.000Z',
    }]);
    on(axiosMock, 'get', `${base}/currencies`, [{
      id: 'ETH',
      name: 'Ethereum',
      status: 'online',
      max_precision: '0.00000001',
      min_size: '0.001',
      default_network: 'ethereum',
      details: {
        type: 'crypto',
        network_confirmations: 12,
        min_withdrawal_amount: '0.001',
        max_withdrawal_amount: '1000',
      },
      supported_networks: [{
        id: 'ethereum',
        status: 'online',
        min_withdrawal_amount: '0.001',
        max_withdrawal_amount: '1000',
        network_confirmations: 12,
        contract_address: '',
      }],
    }]);
  },

  bitfinex(axiosMock) {
    const pub = 'https://api-pub.bitfinex.com/v2';
    on(axiosMock, 'get', `${pub}/conf/pub:info:pair`, [[
      ['BTCUSD', [null, null, null, '0.00006', '2000', null, null, null, null, null]],
    ]]);
    on(axiosMock, 'get', `${pub}/conf/pub:list:currency`, [
      ['BTC', 'USD', 'USDT', 'UST', 'SAN'],
      [
        ['BTC', 'Bitcoin'],
        ['USD', 'US Dollar'],
        ['USDT', 'Tether'],
        ['UST', 'Tether USDt'],
        ['SAN', 'Santiment'],
      ],
      [['UST', 'USDT']],
      [],
      [['BTC', [null, 0.0004]], ['USD', [null, 0]], ['USDT', [null, 0]], ['UST', [null, 0]]],
      [['bitcoin', ['BTC']], ['tetheruso', ['USDT', 'UST']]],
      [['bitcoin', [1, 1, 0, 0, null, null, null, 0]], ['tetheruso', [1, 1, 0, 0, null, null, null, 0]]],
    ], { prefix: true });
    on(axiosMock, 'get', `${pub}/ticker/t`, [
      49999, 1, 50001, 1, 100, 0.01, 50000, 10, 51000, 49000,
    ], { prefix: true });
    on(axiosMock, 'get', `${pub}/trades/t`, [
      [1, 1700000000000, -0.1, 50000],
    ], { prefix: true });
  },

  kraken(axiosMock) {
    const base = 'https://api.kraken.com';
    on(axiosMock, 'get', `${base}/0/public/AssetPairs`, krakenWrap({
      ETHUSDT: {
        wsname: 'ETH/USDT',
        altname: 'ETHUSDT',
        base: 'ETH',
        quote: 'USDT',
        pair_decimals: 2,
        lot_decimals: 8,
        ordermin: '0.001',
        costmin: '1',
      },
    }));
    on(axiosMock, 'get', `${base}/0/public/Assets`, krakenWrap({
      ETH: { altname: 'ETH', decimals: 8, display_decimals: 5, status: 'enabled' },
      USDT: { altname: 'USDT', decimals: 8, display_decimals: 8, status: 'enabled' },
    }));
    on(axiosMock, 'get', `${base}/0/public/Ticker`, krakenWrap({
      ETHUSDT: {
        a: ['3001', '1', '1'],
        b: ['2999', '1', '1'],
        c: ['3000', '0.1'],
        v: ['10', '100'],
        p: ['3000', '3000'],
        h: ['3100', '3100'],
        l: ['2900', '2900'],
      },
    }));
    on(axiosMock, 'get', `${base}/0/public/Depth`, krakenWrap({
      ETHUSDT: {
        asks: [['3001', '0.4', 1700000000]],
        bids: [['2999', '0.5', 1700000000]],
      },
    }));
    on(axiosMock, 'get', `${base}/0/public/Trades`, krakenWrap({
      ETHUSDT: [
        ['3000', '0.1', 1700000000, 's', 'm', '', 'tid-1'],
      ],
      last: '1700000000',
    }));
  },
};

/**
 * Registers public HTTP fixtures on an axios-mock-adapter instance.
 *
 * @param {string} exchange Connector slug
 * @param {import('axios-mock-adapter')} axiosMock Adapter
 * @returns {void}
 */
function registerPublicHttpMocks(exchange, axiosMock) {
  const register = registries[exchange];
  if (!register) {
    throw new Error(`No public HTTP fixtures for exchange "${exchange}"`);
  }
  register(axiosMock);
}

module.exports = {
  mockHttp: on,
  registerPublicHttpMocks,
  LATOKEN_BTC_ID,
  LATOKEN_USDT_ID,
};
