import {
  clearCollectorCircuit,
  commitBilibiliCreator,
  commitBilibiliVideo,
  deferCollectorJob,
  disableMonitorTarget,
  insertCollectorRequests,
  markBiliAccountExpired,
  markBiliAccountUsed,
  openCollectorCircuit,
  readBiliAccountSecret,
  readCollectorCircuit,
  readTargetSchedule,
  recordCollectorFailure,
  resolveCollectorAccount,
  type Sql,
} from '@studio/db';
import type { BilibiliEffects } from './bilibili-job';
import { cookieHeader, decryptCookieJar, type EncryptedCookie } from './credentials';

export function createSqlBilibiliEffects(
  sql: Sql,
  options: { secretKey: Buffer | null },
): BilibiliEffects {
  return {
    resolveAccount: (input) => resolveCollectorAccount(sql, input),
    readCircuit: (accountId) => readCollectorCircuit(sql, accountId),
    openCircuit: (input) => openCollectorCircuit(sql, input),
    clearCircuit: (accountId) => clearCollectorCircuit(sql, accountId),
    expireAccount: (accountId) => markBiliAccountExpired(sql, accountId),
    disableTarget: (targetId, error) => disableMonitorTarget(sql, targetId, error),
    deferJob: (jobId, until) => deferCollectorJob(sql, jobId, until),
    readSchedule: (targetId) => readTargetSchedule(sql, targetId),
    async cookieHeaderFor(accountId) {
      const secret = await readBiliAccountSecret(sql, accountId);
      if (!secret) return null;
      if (!options.secretKey) {
        throw new Error('COLLECTOR_SECRET_KEY 缺失，无法读取采集凭据');
      }
      const payload: EncryptedCookie = {
        ciphertext: secret.ciphertext,
        iv: secret.iv,
        authTag: secret.authTag,
        keyVersion: secret.keyVersion,
      };
      return cookieHeader(decryptCookieJar(payload, options.secretKey));
    },
    commitVideo: (input) => commitBilibiliVideo(sql, input),
    commitCreator: (input) => commitBilibiliCreator(sql, input),
    async failJob(input) {
      const result = await recordCollectorFailure(sql, input);
      return { runId: result.runId };
    },
    async audit(input) {
      if (input.calls.length === 0) return;
      await insertCollectorRequests(
        sql,
        input.calls.map((call) => ({
          accountId: input.accountId,
          runId: input.runId,
          endpoint: call.endpoint,
          statusCode: call.statusCode,
          bizCode: call.bizCode,
          durationMs: call.durationMs,
          error: call.error,
          ...(call.requestedAt ? { requestedAt: call.requestedAt } : {}),
        })),
      );
    },
    markUsed: (accountId) => markBiliAccountUsed(sql, accountId),
  };
}
