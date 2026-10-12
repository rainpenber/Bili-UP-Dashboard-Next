export const HEALTH_STATUS = ['ok', 'degraded', 'error'] as const;

export type HealthStatus = (typeof HEALTH_STATUS)[number];

export interface HealthResponse {
  status: HealthStatus;
  service: string;
  version: string;
  timestamp: string;
}

export function isHealthStatus(value: unknown): value is HealthStatus {
  return typeof value === 'string' && (HEALTH_STATUS as readonly string[]).includes(value);
}

export function parseHealthResponse(value: unknown): HealthResponse {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Health response must be an object');
  }
  const record = value as Record<string, unknown>;
  if (!isHealthStatus(record.status)) {
    throw new Error(`Invalid health status: ${String(record.status)}`);
  }
  if (typeof record.service !== 'string' || record.service.length === 0) {
    throw new Error('Health response service must be a non-empty string');
  }
  if (typeof record.version !== 'string' || record.version.length === 0) {
    throw new Error('Health response version must be a non-empty string');
  }
  if (typeof record.timestamp !== 'string' || Number.isNaN(Date.parse(record.timestamp))) {
    throw new Error('Health response timestamp must be an ISO date string');
  }
  return {
    status: record.status,
    service: record.service,
    version: record.version,
    timestamp: record.timestamp,
  };
}

export function createHealthResponse(
  partial: Pick<HealthResponse, 'service' | 'version'> & {
    status?: HealthStatus;
    timestamp?: string;
  },
): HealthResponse {
  return {
    status: partial.status ?? 'ok',
    service: partial.service,
    version: partial.version,
    timestamp: partial.timestamp ?? new Date().toISOString(),
  };
}
