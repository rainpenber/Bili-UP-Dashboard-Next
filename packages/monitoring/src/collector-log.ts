/** Structural logger used by the collector. `@studio/observability` satisfies it. */
export type CollectorLogFields = {
  event?: string;
  context?: Record<string, unknown>;
  err?: unknown;
};

export type CollectorLogBindings = {
  jobId?: string;
  runId?: string;
  targetId?: string;
};

export type CollectorLogger = {
  child(bindings: CollectorLogBindings): CollectorLogger;
  debug(message: string, fields?: CollectorLogFields): void;
  info(message: string, fields?: CollectorLogFields): void;
  warn(message: string, fields?: CollectorLogFields): void;
  error(message: string, fields?: CollectorLogFields): void;
};
