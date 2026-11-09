// @ts-nocheck — delegates to `services/commands` (commandTxs markdown commands).
'use strict';

/**
 * @module api/routes/commands
 * Operator command endpoints; each maps to a `commandTxs` handler.
 */

const { z } = require('zod');

const constants = require('../../helpers/const');
const { getAuthenticatedUser, routeAccess } = require('../lib/auth');
const { parseOrThrow, queryBoolean, strictNumber } = require('../lib/validate');
const commandsService = require('../services/commands');

/**
 * Most `args` accepted by `/commands/enable` and `/commands/disable`.
 *
 * Real commands take a handful of tokens. Without a bound, a 1 MiB body makes Zod build one issue
 * per array element, about 1 GiB of memory per request. Zod 4.6.6+ checks the bound before parsing
 * elements (GHSA-mrhx-c7xc-m3w5), so older versions stay exposed even with this limit.
 */
const MAX_COMMAND_ARGS = 32;

const startBodySchema = z.object({
  strategy: z.string().refine((value) => constants.MM_POLICIES.includes(value), {
    message: 'Invalid strategy',
  }).optional(),
});

const clearBodySchema = z.object({
  market: z.string().min(1),
  type: z.string().min(1),
  force: z.boolean(),
  side: z.enum(['buy', 'sell']).optional(),
  priceOp: z.enum(['<', '>']).optional(),
  price: strictNumber(z.number().positive()).optional(),
}).superRefine((body, ctx) => {
  const hasPriceFilter = Boolean(body.priceOp) || body.price !== undefined;
  if (!hasPriceFilter) {
    return;
  }

  if (['all', 'unk'].includes(body.type)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'price filter is not allowed with all or unk',
      path: ['priceOp'],
    });
  }

  if (!body.priceOp || body.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'priceOp and price are required together',
      path: ['price'],
    });
  }
});

const placeOrderBodySchema = z.object({
  market: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit']),
  price: strictNumber(z.number()).optional(),
  baseAmount: strictNumber(z.number()).optional(),
  quoteAmount: strictNumber(z.number()).optional(),
}).superRefine((body, ctx) => {
  if (body.baseAmount === undefined && body.quoteAmount === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'baseAmount or quoteAmount is required',
      path: ['baseAmount'],
    });
  }

  if (body.baseAmount !== undefined && body.baseAmount <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'baseAmount must be positive',
      path: ['baseAmount'],
    });
  }

  if (body.quoteAmount !== undefined && body.quoteAmount <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'quoteAmount must be positive',
      path: ['quoteAmount'],
    });
  }

  if (body.type === 'limit' && body.price === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'price is required for limit orders',
      path: ['price'],
    });
  }

  if (body.type === 'limit' && body.price !== undefined && body.price <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'price must be positive',
      path: ['price'],
    });
  }
});

const fillBodySchema = z.object({
  market: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  price: z.object({
    from: strictNumber(z.number()),
    to: strictNumber(z.number()),
  }),
  baseAmount: strictNumber(z.number()).optional(),
  quoteAmount: strictNumber(z.number()).optional(),
  count: strictNumber(z.number().int()),
}).superRefine((body, ctx) => {
  if (body.count <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'count must be positive',
      path: ['count'],
    });
  }

  if (body.side === 'sell') {
    if (body.baseAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'baseAmount is required for sell',
        path: ['baseAmount'],
      });
    } else if (body.baseAmount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'baseAmount must be positive',
        path: ['baseAmount'],
      });
    }
    return;
  }

  if (body.quoteAmount === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'quoteAmount is required for buy',
      path: ['quoteAmount'],
    });
  } else if (body.quoteAmount <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'quoteAmount must be positive',
      path: ['quoteAmount'],
    });
  }
});

const makeBodySchema = z.object({
  price: strictNumber(z.number()),
  when: z.enum(['now', 'in']),
  period: strictNumber(z.number().int()).optional(),
  periodType: z.enum(['mins', 'hrs', 'days']).optional(),
  confirm: z.boolean().optional(),
}).superRefine((body, ctx) => {
  if (body.when !== 'in') {
    return;
  }

  if (body.period === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'period is required when when is in',
      path: ['period'],
    });
  } else if (body.period <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'period must be positive',
      path: ['period'],
    });
  }

  if (!body.periodType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'periodType is required when when is in',
      path: ['periodType'],
    });
  }
});

const marketQuerySchema = z.object({
  market: z.string().min(1).optional(),
});

const balancesQuerySchema = z.object({
  allCoins: queryBoolean(),
  scope: z.enum(['pair', 'priority', 'allcoins']).optional(),
  accountType: z.string().optional(),
});

const ordersQuerySchema = z.object({
  market: z.string().min(1).optional(),
  type: z.string().optional(),
  full: queryBoolean(),
});

const calcQuerySchema = z.object({
  amount: z.coerce.number(),
  coinFrom: z.string().min(1),
  coinTo: z.string().min(1),
});

const coinQuerySchema = z.object({
  coin: z.string().min(1),
});

const showQuerySchema = z.object({
  mode: z.string().min(1),
  coin: z.string().optional(),
  count: z.coerce.number().int().optional(),
});

const transferBodySchema = z.object({
  amount: strictNumber(z.number().positive()),
  coin: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
});

const withdrawBodySchema = z.object({
  address: z.string().min(5),
  amount: strictNumber(z.number().positive()),
  coin: z.string().min(1),
  network: z.string().optional(),
  secondAccount: z.boolean().optional(),
  confirm: z.boolean().optional(),
});

const cancelBodySchema = z.object({
  market: z.string().min(1).optional(),
  id: z.string().min(1),
  side: z.enum(['buy', 'sell']).optional(),
});

const orderQuerySchema = z.object({
  market: z.string().min(1).optional(),
  id: z.string().min(1),
});

const convertBodySchema = z.object({
  amount: strictNumber(z.number().positive()),
  coinFrom: z.string().min(1),
  coinTo: z.string().min(1),
});

const volumeBodySchema = z.object({
  amount: strictNumber(z.number().positive()),
});

const enableBodySchema = z.object({
  feature: z.string().min(1),
  args: z.array(z.string()).max(MAX_COMMAND_ARGS).optional(),
});

const disableBodySchema = z.object({
  feature: z.string().min(1),
  args: z.array(z.string()).max(MAX_COMMAND_ARGS).optional(),
});

const twapBodySchema = z.object({
  stop: z.boolean().optional(),
  market: z.string().min(1).optional(),
  side: z.enum(['buy', 'sell']).optional(),
  amount: strictNumber(z.number().positive()).optional(),
  minPrice: strictNumber(z.number().positive()).optional(),
  maxPrice: strictNumber(z.number().positive()).optional(),
  time: z.string().optional(),
  interval: z.string().optional(),
  strategy: z.string().optional(),
  confirm: z.boolean().optional(),
}).superRefine((body, ctx) => {
  if (body.stop) {
    return;
  }
  if (!body.market || !body.side || body.amount === undefined || !body.time || !body.interval) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'market, side, amount, time, and interval are required unless stop=true',
      path: ['market'],
    });
  }
});

/**
 * Registers `/api/v1/commands/*` routes (all require JWT).
 *
 * Monitoring reads accept any role. Commands that change bot or exchange state, or expose
 * deposit addresses and fund history, require `manager` regardless of the HTTP method.
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function commandsRoutes(fastify) {
  const readAccess = routeAccess(fastify, 'read-only');
  const managerAccess = routeAccess(fastify, 'manager');

  fastify.post('/commands/start', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    parseOrThrow(startBodySchema, request.body ?? {});
    return commandsService.runStart(user.login);
  });

  fastify.post('/commands/stop', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    return commandsService.runStop(user.login);
  });

  fastify.post('/commands/clear', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(clearBodySchema, request.body);
    return commandsService.runClear(user.login, body);
  });

  fastify.post('/commands/place-order', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(placeOrderBodySchema, request.body);
    return commandsService.runPlaceOrder(user.login, body);
  });

  fastify.post('/commands/fill', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(fillBodySchema, request.body);
    return commandsService.runFill(user.login, body);
  });

  fastify.post('/commands/make', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(makeBodySchema, request.body);
    return commandsService.runMake(user.login, body);
  });

  fastify.post('/commands/stop-making-price', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    return commandsService.runStopMakingPrice(user.login);
  });

  fastify.get('/commands/balances', readAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(balancesQuerySchema, request.query);
    return commandsService.runBalances(user.login, user, query);
  });

  fastify.get('/commands/stats', readAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(marketQuerySchema, request.query);
    return commandsService.runStats(user.login, query.market);
  });

  fastify.get('/commands/orders', readAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(ordersQuerySchema, request.query);
    return commandsService.runOrders(user.login, query);
  });

  fastify.get('/commands/rates', readAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(marketQuerySchema, request.query);
    return commandsService.runRates(user.login, query.market);
  });

  fastify.get('/commands/pair', readAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(marketQuerySchema, request.query);
    return commandsService.runPair(user.login, query.market);
  });

  fastify.get('/commands/calc', readAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(calcQuerySchema, request.query);
    return commandsService.runCalc(user.login, query);
  });

  // Some connectors create a deposit address when the exchange has none yet (KuCoin, MEXC, Poloniex, Coinbase)
  fastify.get('/commands/deposit', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(coinQuerySchema, request.query);
    return commandsService.runDeposit(user.login, query.coin);
  });

  // Deposit and withdrawal history lists addresses, amounts, and tx ids
  fastify.get('/commands/show', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(showQuerySchema, request.query);
    return commandsService.runShow(user.login, query);
  });

  fastify.get('/commands/info', readAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(coinQuerySchema, request.query);
    return commandsService.runInfo(user.login, query.coin);
  });

  fastify.post('/commands/transfer', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(transferBodySchema, request.body);
    return commandsService.runTransfer(user.login, body);
  });

  fastify.post('/commands/withdraw', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(withdrawBodySchema, request.body);
    return commandsService.runWithdraw(user.login, body);
  });

  fastify.post('/commands/cancel', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(cancelBodySchema, request.body);
    return commandsService.runCancel(user.login, body);
  });

  fastify.get('/commands/order', readAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(orderQuerySchema, request.query);
    return commandsService.runOrder(user.login, query);
  });

  fastify.post('/commands/convert', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(convertBodySchema, request.body);
    return commandsService.runConvert(user.login, body);
  });

  fastify.get('/commands/account', readAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    return commandsService.runAccount(user.login);
  });

  fastify.post('/commands/volume', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(volumeBodySchema, request.body);
    return commandsService.runVolume(user.login, body);
  });

  fastify.post('/commands/enable', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(enableBodySchema, request.body);
    return commandsService.runEnable(user.login, body);
  });

  fastify.post('/commands/disable', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(disableBodySchema, request.body);
    return commandsService.runDisable(user.login, body);
  });

  fastify.post('/commands/twap', managerAccess, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(twapBodySchema, request.body);
    return commandsService.runTwap(user.login, body);
  });
}

module.exports = commandsRoutes;
