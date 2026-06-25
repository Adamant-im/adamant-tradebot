declare var __dirname: string;
declare var process: any;
declare var require: any;
declare var module: any;

declare module 'fs' {
  const fs: any;
  export = fs;
}

declare module 'path' {
  const path: any;
  export = path;
}

declare module 'net' {
  const net: any;
  export = net;
}

declare module 'http' {
  export interface Server {
    once(...args: any[]): any;
    listen(...args: any[]): any;
  }

  const http: any;
  export = http;
}
