'use strict';

/* global jest, describe, test, expect, beforeEach, afterEach, beforeAll, afterAll */

const http = require('http');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');

const { signHs256 } = require('../../helpers/jwt');

jest.mock('../../modules/configReader', () => ({
  private_webui_secret_key: 'test-secret',
  private_webui_allowed_ips: [],
  private_webui_jwt_max_ttl: '24h',
  exchange: 'binance',
  pair: 'ETH/USDT',
  coin1: 'ETH',
  coin2: 'USDT',
}));

jest.mock('../../api/services/params', () => ({
  getParamsUpdatePayload: () => ({
    params: {},
    revision: 0,
    origin: 'bot',
    requestId: null,
  }),
  bumpParamsRevision: (origin = 'bot', requestId = null) => ({
    params: {},
    revision: 1,
    origin,
    requestId,
  }),
}));

const { registerWebSocket } = require('../../api/ws');

const NOW_MS = Date.UTC(2026, 9, 1, 12, 0, 0);

/**
 * Minimal Socket.IO server double that records middleware and handlers.
 *
 * @returns {{ use: Function, on: Function, middlewares: Function[], handlers: Record<string, Function> }}
 */
function createFakeIo() {
  const io = {
    middlewares: [],
    handlers: {},
  };

  io.use = (fn) => io.middlewares.push(fn);
  io.on = (event, fn) => {
    io.handlers[event] = fn;
  };

  return io;
}

/**
 * Minimal Socket.IO socket double.
 *
 * @param {string} token Raw JWT passed in the handshake
 */
function createFakeSocket(token) {
  const listeners = {};
  const socket = {
    id: 'socket-1',
    data: {},
    handshake: {
      address: '127.0.0.1',
      auth: { token },
      query: {},
    },
    listeners,
    emit: jest.fn(),
    on: jest.fn((event, fn) => {
      listeners[event] = fn;
    }),
    disconnect: jest.fn(() => {
      listeners.disconnect?.('server namespace disconnect');
    }),
  };

  return socket;
}

/**
 * Runs the registered auth middleware and resolves with the value passed to `next()`.
 */
function runAuth(io, socket) {
  return new Promise((resolve) => {
    io.middlewares[0](socket, resolve);
  });
}

describe('WebUI Socket.IO auth', () => {
  /** @type {ReturnType<typeof createFakeIo>} */
  let io;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW_MS });
    io = createFakeIo();
    registerWebSocket(io);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('rejects a token without exp', async () => {
    const socket = createFakeSocket(signHs256({ login: 'operator' }, 'test-secret'));

    const result = await runAuth(io, socket);

    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('Unauthorized');
    expect(socket.data.user).toBeUndefined();
  });

  test('rejects an expired token', async () => {
    const token = signHs256({ login: 'operator', exp: NOW_MS / 1000 - 1 }, 'test-secret');
    const socket = createFakeSocket(token);

    const result = await runAuth(io, socket);

    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('Unauthorized');
  });

  test('rejects a token whose exp exceeds private_webui_jwt_max_ttl', async () => {
    const socket = createFakeSocket(signHs256({ login: 'operator' }, 'test-secret', { expiresIn: '7d' }));

    const result = await runAuth(io, socket);

    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('Unauthorized');
  });

  test('accepts a valid token and remembers its expiry', async () => {
    const socket = createFakeSocket(signHs256({ login: 'operator', role: 'read-only' }, 'test-secret', { expiresIn: '1h' }));

    const result = await runAuth(io, socket);

    expect(result).toBeUndefined();
    expect(socket.data.user).toEqual({ login: 'operator', role: 'read-only' });
    expect(socket.data.tokenExpiresAt).toBe(NOW_MS + 60 * 60 * 1000);
  });

  test('disconnects the socket when its token expires', async () => {
    const socket = createFakeSocket(signHs256({ login: 'operator', exp: NOW_MS / 1000 + 60 }, 'test-secret'));

    expect(await runAuth(io, socket)).toBeUndefined();
    io.handlers.connection(socket);

    expect(socket.emit).toHaveBeenCalledWith('params:updated', expect.objectContaining({ revision: 0 }));

    jest.advanceTimersByTime(59_000);
    expect(socket.disconnect).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  test('stops the expiry timer when the client disconnects first', async () => {
    const socket = createFakeSocket(signHs256({ login: 'operator', exp: NOW_MS / 1000 + 60 }, 'test-secret'));

    expect(await runAuth(io, socket)).toBeUndefined();
    io.handlers.connection(socket);

    socket.listeners.disconnect('client namespace disconnect');
    jest.advanceTimersByTime(120_000);

    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});

describe('WebUI Socket.IO auth over a real connection', () => {
  /** @type {import('http').Server} */
  let httpServer;
  /** @type {import('socket.io').Server} */
  let ioServer;
  let url;

  beforeAll(async () => {
    httpServer = http.createServer();
    ioServer = new Server(httpServer, { path: '/api/v1/ws' });
    registerWebSocket(ioServer);

    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${httpServer.address().port}`;
  });

  afterAll(async () => {
    ioServer.close();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  /**
   * @param {string} token Raw JWT
   */
  function connect(token) {
    return ioClient(url, {
      path: '/api/v1/ws',
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
  }

  test('refuses a handshake with a token without exp', async () => {
    const client = connect(signHs256({ login: 'operator' }, 'test-secret'));

    const error = await new Promise((resolve) => client.on('connect_error', resolve));
    client.close();

    expect(error.message).toBe('Unauthorized');
  });

  test('closes the session from the server side when the token expires', async () => {
    const client = connect(signHs256({ login: 'operator', exp: Math.floor(Date.now() / 1000) + 2 }, 'test-secret'));

    const snapshot = await new Promise((resolve, reject) => {
      client.on('params:updated', resolve);
      client.on('connect_error', reject);
    });
    expect(snapshot).toMatchObject({ revision: 0 });

    const reason = await new Promise((resolve) => client.on('disconnect', resolve));
    client.close();

    expect(reason).toBe('io server disconnect');
  }, 10_000);
});
