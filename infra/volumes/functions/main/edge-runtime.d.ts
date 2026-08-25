declare const EdgeRuntime: {
  userWorkers: {
    create(options: {
      servicePath: string;
      memoryLimitMb: number;
      workerTimeoutMs: number;
      noModuleCache: boolean;
      importMapPath: string;
      envVars: Array<[string, string]>;
    }): Promise<{ fetch(request: Request): Promise<Response> }>;
  };
};
