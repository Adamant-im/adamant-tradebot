'use strict';

/* global describe, test, expect, jest, beforeEach */

const mockApi = {
  setConfig: jest.fn(),
  markets: jest.fn(),
  orderBook: jest.fn(),
  createOrder: jest.fn(),
  openOrders: jest.fn(),
  orderHistory: jest.fn(),
  cancelOrders: jest.fn(),
};

jest.mock('../../trade/api/qutrade_api', () => jest.fn(() => mockApi));
jest.mock('../../helpers/utils', () => ({
  getModuleName: () => 'trader_qutrade',
  getPrecision: (decimals) => decimals,
}));
jest.mock('../../modules/configReader', () => ({ coin1: 'FBC', coin2: 'USDT' }));

const QutradeTrader = require('../../trade/trader_qutrade');

const market = {
  last: '0.0002321',
  ask: '0.0002353',
  bid: '0.0002288',
  step_price: '0.0000001',
  decimal_price: 7,
  min_price_buy: '0.0000001',
  max_price_buy: '0.0003481',
  min_price_sell: '0.000116',
  max_price_sell: '0.1',
  base_step_amount: '0.1',
  base_decimal_amount: 1,
  base_min_amount: '400',
  quote_step_amount: '0.00000001',
  quote_decimal_amount: 8,
  quote_min_amount: '0.1',
  base_volume: '0',
  quote_volume: '0',
};

describe('Qutrade trader adapter', () => {
  let trader;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.markets.mockResolvedValue({ result: 'success', payload: { FBC_USDT: market } });
    mockApi.orderBook.mockResolvedValue({
      result: 'success',
      payload: { FBC_USDT: { asks: [['0.00024', '500']], bids: [['0.00023', '600']] } },
    });
    mockApi.createOrder.mockResolvedValue({ result: 'success', payload: { order_id: 98765 } });
    trader = QutradeTrader('api-key', 'secret-key', '', { log: jest.fn(), warn: jest.fn(), info: jest.fn() });
  });

  test('maps Qutrade market symbols and amount constraints to bot format', async () => {
    const info = await trader.marketInfo('FBC/USDT');

    expect(info).toEqual(expect.objectContaining({
      pairReadable: 'FBC/USDT',
      pairPlain: 'FBC_USDT',
      coin1MinAmount: 400,
      coin2MinAmount: 0.1,
      amountStep: 0.1,
      quoteAmountStep: 0.00000001,
    }));
  });

  test('aligns a valid limit order to Qutrade price and amount steps', async () => {
    const result = await trader.placeOrder('buy', 'FBC/USDT', 0.0002300, 500, 1);

    expect(result.orderId).toBe('98765');
    expect(mockApi.createOrder).toHaveBeenCalledWith({
      pair: 'FBC_USDT',
      type: 'limit',
      side: 'buy',
      requested_price: '0.0002300',
      requested_base_amount: '500.0',
    });
  });

  test('blocks limit orders below Qutrade base minimum without sending them', async () => {
    const result = await trader.placeOrder('buy', 'FBC/USDT', 0.00023, 399, 1);

    expect(result.orderId).toBe(false);
    expect(result.message).toMatch(/below the minimum 400/);
    expect(mockApi.createOrder).not.toHaveBeenCalled();
  });

  test('normalizes Qutrade depth payload for the requested pair', async () => {
    const book = await trader.getOrderBook('FBC/USDT');

    expect(book).toEqual({
      bids: [{ price: 0.00023, amount: 600, count: 1, side: 'buy' }],
      asks: [{ price: 0.00024, amount: 500, count: 1, side: 'sell' }],
    });
    expect(mockApi.orderBook).toHaveBeenCalledWith('FBC_USDT');
  });

  test('retrieves a canceled Qutrade order with zero fills', async () => {
    mockApi.openOrders.mockResolvedValue({
      result: 'success',
      payload: [],
    });

    mockApi.orderHistory.mockResolvedValue({
      result: 'success',
      payload: [{
        order_id: '3593513',
        pair: 'FBC_USDT',
        side: 'buy',
        type: 'limit',
        status: 'canceled',
        requested_price: '0.0002289',
        requested_base_amount: '450',
        filled_base_amount: '0',
        filled_quote_amount: '0',
        timestamp_create: 1792290317,
        timestamp_update: 1792290321,
      }],
    });

    const result = await trader.getOrderDetails('3593513', 'FBC/USDT');

    expect(result).toEqual(expect.objectContaining({
      orderId: '3593513',
      status: 'cancelled',
      amount: 450,
      amountExecuted: 0,
      volumeExecuted: 0,
    }));
  });

  test('returns unknown when an order is absent from open orders and history', async () => {
    mockApi.openOrders.mockResolvedValue({
      result: 'success',
      payload: [],
    });
    mockApi.orderHistory.mockResolvedValue({
      result: 'success',
      payload: [],
    });

    const result = await trader.getOrderDetails('3593513', 'FBC/USDT');

    expect(result).toEqual({
      orderId: '3593513',
      status: 'unknown',
    });
  });

  test('returns undefined when Qutrade history is unavailable', async () => {
    mockApi.openOrders.mockResolvedValue({
      result: 'success',
      payload: [],
    });
    mockApi.orderHistory.mockRejectedValue(new Error('API unavailable'));

    const result = await trader.getOrderDetails('3593513', 'FBC/USDT');

    expect(result).toBeUndefined();
  });

  test('returns unknown for conflicting order states', async () => {
    const order = {
      order_id: '12345',
      pair: 'FBC_USDT',
      side: 'buy',
      type: 'limit',
      requested_price: '0.0002300',
      requested_base_amount: '450',
      filled_base_amount: '0',
      filled_quote_amount: '0',
      timestamp_create: 1792290317,
      timestamp_update: 1792290321,
    };

    mockApi.openOrders.mockResolvedValue({
      payload: [{ ...order, status: 'opened' }],
    });
    mockApi.orderHistory.mockResolvedValue({
      payload: [{ ...order, status: 'canceled' }],
    });

    const result = await trader.getOrderDetails('12345', 'FBC/USDT');

    expect(result).toEqual({
      orderId: '12345',
      status: 'unknown',
    });
  });

  test('preserves partial-fill quantities', async () => {
    mockApi.openOrders.mockResolvedValue({
      payload: [{
        order_id: '12346',
        pair: 'FBC_USDT',
        side: 'buy',
        type: 'limit',
        status: 'filling',
        requested_price: '0.0002300',
        requested_base_amount: '450',
        filled_base_amount: '100',
        filled_quote_amount: '0.023',
        timestamp_create: 1792290317,
        timestamp_update: 1792290321,
      }],
    });
    mockApi.orderHistory.mockResolvedValue({ payload: [] });

    const result = await trader.getOrderDetails('12346', 'FBC/USDT');

    expect(result).toEqual(expect.objectContaining({
      status: 'part_filled',
      amount: 450,
      amountExecuted: 100,
      volumeExecuted: 0.023,
    }));
  });

  test('preserves fills on canceled orders', async () => {
    mockApi.openOrders.mockResolvedValue({ payload: [] });
    mockApi.orderHistory.mockResolvedValue({
      payload: [{
        order_id: '12347',
        pair: 'FBC_USDT',
        side: 'sell',
        type: 'limit',
        status: 'canceled',
        requested_price: '0.0002300',
        requested_base_amount: '450',
        filled_base_amount: '150',
        filled_quote_amount: '0.0345',
        timestamp_create: 1792290317,
        timestamp_update: 1792290321,
      }],
    });

    const result = await trader.getOrderDetails('12347', 'FBC/USDT');

    expect(result).toEqual(expect.objectContaining({
      status: 'cancelled',
      amount: 450,
      amountExecuted: 150,
      volumeExecuted: 0.0345,
    }));
  });


  test('verifies cancellation after an API error', async () => {
    mockApi.cancelOrders.mockRejectedValue(
      new Error('Invalid cancellation response')
    );
    mockApi.openOrders.mockResolvedValue({ payload: [] });
    mockApi.orderHistory.mockResolvedValue({
      payload: [{
        order_id: '12348',
        pair: 'FBC_USDT',
        side: 'buy',
        status: 'canceled',
      }],
    });

    const result = await trader.cancelOrder(
      '12348', 'buy', 'FBC/USDT'
    );

    expect(result).toBe(true);
  });

  test('does not confirm cancellation while order remains open', async () => {
    mockApi.cancelOrders.mockRejectedValue(
      new Error('Invalid cancellation response')
    );
    mockApi.openOrders.mockResolvedValue({
      payload: [{
        order_id: '12349',
        pair: 'FBC_USDT',
        side: 'buy',
        status: 'opened',
      }],
    });
    mockApi.orderHistory.mockResolvedValue({ payload: [] });

    const result = await trader.cancelOrder(
      '12349', 'buy', 'FBC/USDT'
    );

    expect(result).not.toBe(true);
  });

  test('does not confuse a filled order with a canceled order', async () => {
    mockApi.cancelOrders.mockRejectedValue(
      new Error('Invalid cancellation response')
    );
    mockApi.openOrders.mockResolvedValue({ payload: [] });
    mockApi.orderHistory.mockResolvedValue({
      payload: [{
        order_id: '12350',
        pair: 'FBC_USDT',
        side: 'sell',
        status: 'filled',
      }],
    });

    const result = await trader.cancelOrder(
      '12350', 'sell', 'FBC/USDT'
    );

    expect(result).not.toBe(true);
  });

});
