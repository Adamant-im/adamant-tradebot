'use strict';

/* global jest, describe, test, expect, beforeEach */

const { BadRequestError, NotFoundError, ServiceUnavailableError } = require('../../api/lib/errors');

jest.mock('../../modules/configReader', () => ({
  pair: 'ETH/USDT',
}));

const mockConnector = {
  features: jest.fn(() => ({
    getRates: true,
    getOrderBook: true,
    getTradesHistory: true,
    getCandlesHistory: true,
  })),
  getRates: jest.fn(),
  getOrderBook: jest.fn(),
  getTradesHistory: jest.fn(),
  getCandlesHistory: jest.fn(),
};

jest.mock('../../api/traderConnector', () => ({
  getTraderConnector: () => mockConnector,
  resetTraderConnector: jest.fn(),
}));

const marketService = require('../../api/services/market');

describe('market service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnector.features.mockReturnValue({
      getRates: true,
      getOrderBook: true,
      getTradesHistory: true,
      getCandlesHistory: true,
    });
  });

  test('resolvePair defaults to config.pair and validates format', () => {
    expect(marketService.resolvePair()).toBe('ETH/USDT');
    expect(marketService.resolvePair('BTC/USDT')).toBe('BTC/USDT');
    expect(() => marketService.resolvePair('INVALID')).toThrow(BadRequestError);
  });

  test('getTicker returns normalized payload', async () => {
    mockConnector.getRates.mockResolvedValue({
      ask: 101,
      bid: 99,
      last: 100,
    });

    const result = await marketService.getTicker();

    expect(result).toEqual({
      pair: 'ETH/USDT',
      ticker: { ask: 101, bid: 99, last: 100 },
    });
    expect(mockConnector.getRates).toHaveBeenCalledWith('ETH/USDT');
  });

  test('getTicker throws when connector returns empty data', async () => {
    mockConnector.getRates.mockResolvedValue(null);
    await expect(marketService.getTicker()).rejects.toThrow(NotFoundError);
  });

  test('getOrderBook throws when feature is disabled', async () => {
    mockConnector.features.mockReturnValue({ getOrderBook: false });
    await expect(marketService.getOrderBook()).rejects.toThrow(ServiceUnavailableError);
  });

  test('getOhlc requires timeframe', async () => {
    await expect(marketService.getOhlc({})).rejects.toThrow(BadRequestError);
  });

  test('getOhlc forwards candle query to connector', async () => {
    const candles = [{ open: 1, close: 2 }];
    mockConnector.getCandlesHistory.mockResolvedValue(candles);

    const result = await marketService.getOhlc({
      pair: 'ETH/USDT',
      timeframe: '1m',
      since: 1000,
      limit: 50,
      excludePartial: true,
    });

    expect(mockConnector.getCandlesHistory).toHaveBeenCalledWith(
        'ETH/USDT',
        '1m',
        1000,
        50,
        true,
    );
    expect(result).toEqual({
      pair: 'ETH/USDT',
      timeframe: '1m',
      candles,
    });
  });
});
