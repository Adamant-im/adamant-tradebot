'use strict';

const mockTicker = jest.fn();
const mockSetConfig = jest.fn();

jest.mock('../../trade/api/fameexnet_api', () => jest.fn(() => ({
  setConfig: mockSetConfig,
  ticker: mockTicker,
})));
jest.mock('../../helpers/utils', () => ({
  getModuleName: jest.fn(() => 'trader_fameexnet'),
}));
jest.mock('../../modules/configReader', () => ({
  coin1: 'ADM',
  coin2: 'USDT',
}));

const createTrader = require('../../trade/trader/trader_fameexnet');

const mockLog = {
  log: jest.fn(),
  warn: jest.fn(),
};

describe('FameEX connector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('maps ticker base and quote volumes to the common rates format', async () => {
    mockTicker.mockResolvedValue({
      amount: 3752.31,
      buy: 0.0101,
      high: 0.010923,
      last: 0.010299,
      low: 0.010116,
      sell: 0.010398,
      vol: 298321.92,
    });
    const trader = createTrader(null, null, null, mockLog, true, false);

    const rates = await trader.getRates('ADM/USDT');

    expect(mockTicker).toHaveBeenCalledWith('ADMUSDT');
    expect(rates).toMatchObject({
      volume: 298321.92,
      volumeInCoin2: 3752.31,
    });
  });
});
