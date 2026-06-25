// @ts-nocheck — delegates to `services/commands` (commandTxs markdown commands).
'use strict';

/**
 * @module api/routes/commands
 * Operator command endpoints; each maps to a `commandTxs` handler.
 */

const { z } = require('zod');

const constants = require('../../helpers/const');
const { getAuthenticatedUser } = require('../lib/auth');
const { parseOrThrow } = require('../lib/validate');
const commandsService = require('../services/commands');

const startBodySchema = z.object({
  strategy: z.string().refine((value) => constants.MM_POLICIES.includes(value), {
    message: 'Invalid strategy',
  }),
});

const clearBodySchema = z.object({
  market: z.string().min(1),
  type: z.enum(['all', 'unk', 'man', 't', 'tb', 'ob', 'liq', 'pw', 'fb', 'cl', 'ag']),
  force: z.boolean(),
});

const placeOrderBodySchema = z.object({
  market: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit']),
  price: z.coerce.number().optional(),
  baseAmount: z.coerce.number().optional(),
  quoteAmount: z.coerce.number().optional(),
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
    from: z.coerce.number(),
    to: z.coerce.number(),
  }),
  baseAmount: z.coerce.number().optional(),
  quoteAmount: z.coerce.number().optional(),
  count: z.coerce.number().int(),
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
  price: z.coerce.number(),
  when: z.enum(['now', 'in']),
  period: z.coerce.number().int().optional(),
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

const transferQuerySchema = z.object({
  amount: z.coerce.number(),
  coin: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
});

/**
 * Registers `/api/v1/commands/*` routes (all require JWT).
 *
 * @param {import('fastify').FastifyInstance} fastify Parent Fastify instance
 * @returns {Promise<void>}
 */
async function commandsRoutes(fastify) {
  const withAuth = {
    preHandler: [fastify.authenticate],
  };

  fastify.post('/commands/start', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(startBodySchema, request.body);
    return commandsService.runStart(user.login, body.strategy);
  });

  fastify.post('/commands/stop', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    return commandsService.runStop(user.login);
  });

  fastify.post('/commands/clear', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(clearBodySchema, request.body);
    return commandsService.runClear(user.login, body);
  });

  fastify.post('/commands/place-order', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(placeOrderBodySchema, request.body);
    return commandsService.runPlaceOrder(user.login, body);
  });

  fastify.post('/commands/fill', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(fillBodySchema, request.body);
    return commandsService.runFill(user.login, body);
  });

  fastify.post('/commands/make', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const body = parseOrThrow(makeBodySchema, request.body);
    return commandsService.runMake(user.login, body);
  });

  fastify.post('/commands/stop-making-price', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    return commandsService.runStopMakingPrice(user.login);
  });

  fastify.get('/commands/balances', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    return commandsService.runBalances(user.login, user);
  });

  fastify.get('/commands/stats', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(marketQuerySchema, request.query);
    return commandsService.runStats(user.login, query.market);
  });

  fastify.get('/commands/orders', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(marketQuerySchema, request.query);
    return commandsService.runOrders(user.login, query.market);
  });

  fastify.get('/commands/rates', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(marketQuerySchema, request.query);
    return commandsService.runRates(user.login, query.market);
  });

  fastify.get('/commands/calc', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(calcQuerySchema, request.query);
    return commandsService.runCalc(user.login, query);
  });

  fastify.get('/commands/deposit', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(coinQuerySchema, request.query);
    return commandsService.runDeposit(user.login, query.coin);
  });

  fastify.get('/commands/show', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(showQuerySchema, request.query);
    return commandsService.runShow(user.login, query);
  });

  fastify.get('/commands/info', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(coinQuerySchema, request.query);
    return commandsService.runInfo(user.login, query.coin);
  });

  fastify.get('/commands/transfer', withAuth, async (request) => {
    const user = getAuthenticatedUser(request);
    const query = parseOrThrow(transferQuerySchema, request.query);
    return commandsService.runTransfer(user.login, query);
  });
}

module.exports = commandsRoutes;
