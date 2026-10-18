'use strict';

/* global describe, test, expect, jest, beforeEach */

const crypto = require('crypto');

jest.mock('axios', () => jest.fn());

const axios = require('axios');
const QutradeAPI = require('../../trade/api/qutrade_api');

describe('Qutrade API client', () => {
  let seed;
  let publicKey;
  let publicKeyHex;
  let secretKeyHex;
  let api;

  beforeEach(() => {
    axios.mockReset();
    seed = crypto.randomBytes(32);
    const privateKey = crypto.createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
      format: 'der',
      type: 'pkcs8',
    });
    const publicKeyDer = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
    publicKey = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
    publicKeyHex = publicKeyDer.subarray(-32).toString('hex');
    secretKeyHex = Buffer.concat([seed, publicKeyDer.subarray(-32)]).toString('hex');
    api = QutradeAPI();
    api.setConfig('https://qutrade.io/api/v2', publicKeyHex, secretKeyHex, '', {}, false);
  });

  test('signs the endpoint plus sorted form parameters using Ed25519', async () => {
    axios.mockResolvedValue({ data: { result: 'success', payload: { order_id: 123 } } });

    await api.createOrder({
      side: 'buy',
      pair: 'FBC_USDT',
      requested_base_amount: '400.0',
      type: 'limit',
      requested_price: '0.0002300',
    });

    const request = axios.mock.calls[0][0];
    const parameters = new URLSearchParams(request.data);
    const tonce = parameters.get('tonce');
    parameters.delete('tonce');
    const signedBody = [...parameters.entries()].sort(([a], [b]) => a.localeCompare(b));
    signedBody.push(['tonce', tonce]);
    signedBody.sort(([a], [b]) => a.localeCompare(b));
    const canonicalBody = new URLSearchParams(signedBody).toString();

    expect(request.url).toBe('https://qutrade.io/api/v2/create_order');
    expect(request.data).toBe(canonicalBody);
    expect(request.headers['API-KEY']).toBe(publicKeyHex);
    expect(crypto.verify(
        null,
        Buffer.from(`/create_order${request.data}`, 'utf8'),
        publicKey,
        Buffer.from(request.headers['API-SIGN'], 'hex'),
    )).toBe(true);
  });

  test('encodes public market requests as sorted URL parameters', async () => {
    axios.mockResolvedValue({
      data: {
        result: 'success',
        payload: { FBC_USDT: { asks: [['0.00024', '500']], bids: [['0.00023', '600']] } },
      },
    });

    const response = await api.orderBook('FBC/USDT', 25);

    expect(response.payload.FBC_USDT.bids).toEqual([['0.00023', '600']]);
    expect(axios.mock.calls[0][0].url).toBe('https://qutrade.io/api/v2/depth?limit=25&pair=FBC_USDT');
  });

  test('rejects a malformed Ed25519 key before sending a private request', async () => {
    api.setConfig('https://qutrade.io/api/v2', publicKeyHex, 'bad-secret', '', {}, false);

    await expect(api.balances()).rejects.toThrow(/secret must be 64 or 128 hexadecimal/i);
    expect(axios).not.toHaveBeenCalled();
  });
});
