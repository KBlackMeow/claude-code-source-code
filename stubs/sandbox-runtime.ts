export const SandboxManager = {
  checkDependencies: () => ({ errors: [], warnings: [] }),
  isSupportedPlatform: () => false,
  initialize: async () => {},
  updateConfig: () => {},
  reset: async () => {},
  wrapWithSandbox: async (command: string) => command,
  getFsReadConfig: () => ({}),
  getFsWriteConfig: () => ({}),
  getNetworkRestrictionConfig: () => ({}),
  getIgnoreViolations: () => ({}),
  getAllowUnixSockets: () => [],
  getAllowLocalBinding: () => false,
  getEnableWeakerNestedSandbox: () => false,
  getProxyPort: () => undefined,
  getSocksProxyPort: () => undefined,
  getLinuxHttpSocketPath: () => undefined,
  getLinuxSocksSocketPath: () => undefined,
  waitForNetworkInitialization: async () => true,
  getSandboxViolationStore: () => ({}),
  annotateStderrWithSandboxFailures: (c: string, s: string) => s,
  cleanupAfterCommand: () => {},
};

export const SandboxRuntimeConfigSchema = {
  parse: (v: any) => v,
};

export class SandboxViolationStore {}
