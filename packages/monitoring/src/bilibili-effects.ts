import {
  clearCollectorCircuit,
  commitBilibiliCreator,
  commitBilibiliDynamic,
  commitBilibiliVideo,
  deferCollectorJob,
  disableMonitorTarget,
  getVideoDenseCollectPlan,
  insertCollectorRequests,
  markBiliAccountExpired,
  markBiliAccountUsed,
  openCollectorCircuit,
  persistDenseCollectPhase,
  readBiliAccountSecret,
  readCollectorCircuit,
  readTargetSchedule,
  recordCollectorFailure,
  resolveCollectorAccount,
  resolveDenseCollectMinutes,
  type Sql,
} from '@studio/db';
import type { BilibiliEffects } from './bilibili-job';
import { cookieHeader, decryptCookieJar, type EncryptedCookie } from './credentials';

async function advanceDensePhaseIfNeeded(sql: Sql, targetId: string, now: Date): Promise<void> {
  const plan = await getVideoDenseCollectPlan(sql, targetId);
  if (!plan) return;
  const resolved = resolveDenseCollectMinutes(plan, now);
  if (resolved.shouldPersistPhase) {
    await persistDenseCollectPhase(sql, {
      targetId,
      phase: resolved.phase,
      now,
    });
  }
}

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
    async deferJob(jobId, until) {
      await deferCollectorJob(sql, jobId, until);
    },
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
    async commitVideo(input) {
      await advanceDensePhaseIfNeeded(sql, input.targetId, input.startedAt);
      return commitBilibiliVideo(sql, input);
    },
    commitCreator: (input) => commitBilibiliCreator(sql, input),
    commitDynamic: (input) => commitBilibiliDynamic(sql, input),
    async failJob(input) {
      const result = await recordCollectorFailure(sql, {
        jobId: input.jobId,
        targetId: input.targetId,
        attempts: input.attempts,
        maxAttempts: input.maxAttempts,
        error: input.error,
        durationMs: input.durationMs,
        startedAt: input.startedAt,
        retryAt: input.retryAt,
        ...(input.schedule ? { schedule: input.schedule } : {}),
        ...(input.haltAutoSchedule ? { haltAutoSchedule: true } : {}),
      });
      return {
        runId: result.runId,
        applied: result.applied,
        ...(result.halted !== undefined ? { halted: result.halted } : {}),
      };
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
        })),
      );
    },
    markUsed: (accountId) => markBiliAccountUsed(sql, accountId),
  };
}
