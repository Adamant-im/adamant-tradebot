/**
 * Type definitions for the `mm` maintenance CLI (`bin/mm.js`, `modules/mm/*`).
 */

export type MmMode = 'npm' | 'docker';

export type MmInstallMethod = 'npm' | 'docker' | 'git-manual' | 'unknown';

export interface MmContext {
  mode: MmMode;
  installMethod: MmInstallMethod;
  workDir: string;
  packageRoot: string;
  configPath: string;
  tradeSettingsDir: string;
  logsDir: string;
  composeFile?: string;
  composeProjectDir?: string;
  pm2ProcessName: string;
  composeService: string;
  version: string;
  mmExecutable: string;
}

export interface MmParsedArgs {
  command?: string;
  _: string[];
  mode?: string;
  workDir?: string;
  json?: boolean;
  short?: boolean;
  all?: boolean;
  edit?: boolean;
  restart?: boolean;
  follow?: boolean;
  check?: boolean;
  tail?: number;
  since?: string;
  level?: string;
  grep?: string;
  help?: boolean;
  noColor?: boolean;
}

export type MmCliMain = (argv: string[]) => Promise<number>;

export interface MmCliModule {
  main: MmCliMain;
  parseArgs: (argv: string[]) => MmParsedArgs;
  printHelp: () => void;
}

export type MmCheckStatus = 'OK' | 'WARNING' | 'FAILED' | 'SKIPPED';

export interface MmDoctorSection {
  status: MmCheckStatus;
  messages: string[];
  fixes: string[];
}

export type Pm2Api = typeof import('pm2');

export type MmPm2ProcessDescription = import('pm2').ProcessDescription & {
  pm2_env?: import('pm2').ProcessDescription['pm2_env'] & {
    exit_code?: number;
    restart_time?: number;
  };
};

export interface MmProcessStatusSummary {
  running: boolean;
  pid?: number;
  pm2Id?: number;
  uptimeMs?: number;
  restarts?: number;
  exitCode?: number;
  lastError?: string;
  containerId?: string;
  source?: 'pm2' | 'docker';
}

export interface MmShellResult {
  code: number;
  stdout: string;
  stderr: string;
}
