/** Ambient module shims for optional WebUI API typecheck subsets. */

declare const __dirname: string;

declare module 'fastify' {
  import type { Server as HttpServer } from 'http';

  export interface FastifyReply {
    status(code: number): FastifyReply;
    send(payload?: unknown): FastifyReply;
    code(status: number): FastifyReply;
    header(name: string, value: string): FastifyReply;
    type(contentType: string): FastifyReply;
  }

  export interface FastifyRequest {
    body: unknown;
    query: Record<string, string | undefined>;
    method: string;
    url: string;
    user?: { login?: string };
    jwtVerify(): Promise<void>;
  }

  type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => unknown | Promise<unknown>;

  interface RouteShorthandMethod {
    (path: string, handler: RouteHandler): void;
    (path: string, opts: { preHandler?: unknown[] }, handler: RouteHandler): void;
  }

  export interface FastifyInstance {
    get: RouteShorthandMethod;
    post: RouteShorthandMethod;
    put: RouteShorthandMethod;
    register(plugin: unknown, opts?: unknown): Promise<void>;
    addHook(
      name: string,
      handler: (request: FastifyRequest, reply: FastifyReply, payload: unknown) => unknown | Promise<unknown>,
    ): void;
    decorate(name: string, value: unknown): void;
    listen(opts: { port: number; host: string }): Promise<string>;
    setErrorHandler(handler: (error: unknown, request: FastifyRequest, reply: FastifyReply) => unknown): void;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    jwt: { sign(payload: { login: string }): string };
    server: HttpServer;
    io?: import('socket.io').Server;
    inject(opts: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }): Promise<{
      statusCode: number;
      json(): unknown;
    }>;
    ready(): Promise<void>;
    close(): Promise<void>;
  }

  function fastify(opts?: { logger?: boolean }): FastifyInstance;
  export = fastify;
}

declare module 'socket.io' {
  export interface Socket {
    id: string;
    emit(event: string, payload?: unknown): void;
    on(event: string, listener: (...args: any[]) => void): void;
  }

  export class Server {
    constructor(httpServer: unknown, opts?: { cors?: { origin: string }; path?: string });
    use(middleware: (socket: Socket, next: (err?: Error) => void) => void): void;
    on(event: 'connection', listener: (socket: Socket) => void): void;
    emit(event: string, payload: unknown): void;
    sockets: { emit(event: string, payload: unknown): void };
  }
}

declare module 'fast-deep-equal' {
  function equal(a: unknown, b: unknown): boolean;
  export = equal;
}
