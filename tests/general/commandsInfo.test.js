'use strict';

const mockParseCommandParams = jest.fn();
const mockConvertCryptos = jest.fn();
const mockGetFallbackRateInfo = jest.fn();
const mockFormSendBackMessage = jest.fn((message) => ({
  msgNotify: '',
  msgSendBack: message,
  notifyType: 'log',
}));
const mockGetRates = jest.fn();

jest.mock('../../modules/commands/context', () => ({
  constants: {
    PRECISION_DECIMALS: 8,
  },
  config: {
    exchangeName: 'Azbit',
  },
  log: {
    error: jest.fn(),
  },
  orderUtils: {
    getRatesCached: mockGetRates,
  },
  moduleName: 'commandTxs',
  utils: {
    formatNumber: (value) => String(value),
    isPositiveOrZeroNumber: (value) => Number.isFinite(value) && value >= 0,
    parseCommandParams: mockParseCommandParams,
  },
  exchangerUtils: {
    convertCryptos: mockConvertCryptos,
    getFallbackRateInfo: mockGetFallbackRateInfo,
    hasTicker: jest.fn(() => true),
    isFiat: jest.fn(() => true),
  },
}));
jest.mock('../../modules/commands/helpers', () => ({
  formSendBackMessage: mockFormSendBackMessage,
}));
jest.mock('../../modules/commands/compose', () => ({}));

const { calc } = require('../../modules/commands/info');

function buildParsedParams(amount = '37k', number = 37_000) {
  const amountParam = {
    paramPlain: amount,
    paramNumber: Number(amount),
    paramSmartNumber: number > 0 ? {
      isNumber: true,
      fancyNumberString: amount,
      number,
    } : { isNumber: false },
  };

  return {
    exactParamsCount: true,
    indexOf: (param) => param === 'to' ? 2 : undefined,
    is: (param) => param === 'to',
    moreByIndex: (index) => index === 0 ? amountParam : undefined,
    nextTo: () => ({ paramUc: 'USDT' }),
    prevTo: () => ({ paramUc: 'ADM' }),
  };
}

describe('calc', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFallbackRateInfo.mockReset();
    mockParseCommandParams.mockReturnValue(buildParsedParams());
    mockConvertCryptos.mockReturnValue({ outAmount: 74 });
    mockGetRates.mockResolvedValue(undefined);
  });

  test('converts a smart-number amount', async () => {
    const result = await calc(['37k', 'adm', 'to', 'usdt'], {}, true);

    expect(mockParseCommandParams).toHaveBeenCalledWith(['37k', 'adm', 'to', 'usdt'], 4);
    expect(mockConvertCryptos).toHaveBeenCalledWith('ADM', 'USDT', 37_000);
    expect(mockGetRates).not.toHaveBeenCalled();
    expect(result.msgSendBack).toBe('74.00');
  });

  test('keeps zero as a valid amount', async () => {
    mockParseCommandParams.mockReturnValue(buildParsedParams('0', 0));
    mockConvertCryptos.mockReturnValue({ outAmount: 0 });

    const result = await calc(['0', 'adm', 'to', 'usdt'], {}, true);

    expect(mockConvertCryptos).toHaveBeenCalledWith('ADM', 'USDT', 0);
    expect(result.msgSendBack).toBe('0.00');
  });

  test('returns command usage through formSendBackMessage for invalid syntax', async () => {
    mockParseCommandParams.mockReturnValue(undefined);

    const result = await calc(['37k', 'adm', 'usdt'], {}, false);

    expect(mockFormSendBackMessage).toHaveBeenCalledWith('Unexpected arguments. Try: */calc 2.05 BTC to USDT*.');
    expect(mockConvertCryptos).not.toHaveBeenCalled();
    expect(result.msgSendBack).toBe('Unexpected arguments. Try: */calc 2.05 BTC to USDT*.');
  });

  test('adds direct exchange rates to the chat response', async () => {
    mockGetRates.mockResolvedValue({
      ask: 0.0021,
      bid: 0.0019,
    });

    const result = await calc(['37k', 'adm', 'to', 'usdt'], {}, false);

    expect(mockGetRates).toHaveBeenCalledWith('ADM/USDT', 'commandTxs');
    expect(result.msgSendBack).toBe(
        'Global market value of 37000 ADM equals 74.00 USDT.\n\n' +
        'Azbit value of 37000 ADM:\n' +
        'Bid: **70.30000000 USDT**, ask: **77.70000000 USDT**.',
    );
  });
  test.each(['ADM', 'USDT'])('labels exchange fallback in either %s conversion currency', async (coin) => {
    mockGetFallbackRateInfo.mockImplementation((symbol) => symbol === coin ? {
      source: 'exchange', exchange: 'XT', pair: 'ADM/USDT', usdRate: 2,
    } : undefined);
    const result = await calc(['37k', 'adm', 'to', 'usdt'], {}, false);
    expect(result.msgSendBack).toContain('Estimated value (XT ADM/USDT spot ticker fallback)');
    expect(result.msgSendBack).not.toContain('Global market value');
  });

  test('labels stablecoin parity estimates without changing numeric WebUI responses', async () => {
    mockGetFallbackRateInfo.mockReturnValue({ source: 'stablecoin', usdRate: 1 });
    const chat = await calc(['37k', 'adm', 'to', 'usdt'], {}, false);
    const api = await calc(['37k', 'adm', 'to', 'usdt'], {}, true);
    expect(chat.msgSendBack).toContain('Estimated value (assumed stablecoin USD parity)');
    expect(api.msgSendBack).toBe('74.00');
  });

});
