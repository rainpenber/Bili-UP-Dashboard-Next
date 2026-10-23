const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MINUTES = 5;
const MAX_MINUTES = 10_080;

export type FrequencyPolicy = {
  tier1MaxDays: number;
  tier1Minutes: number;
  tier2MaxDays: number;
  tier2Minutes: number;
  tier3Minutes: number;
  creatorMinutes: number;
};

export type ScheduleSubject = {
  type: 'video' | 'creator' | 'dynamic' | 'discovery';
  mode: 'auto' | 'fixed';
  fixedMinutes: number;
  pubdate: Date | null;
};

/** Dense window minutes are fixed by product: 15 then 30; never remap here. */
export const DENSE15_MINUTES = 15;
export const DENSE30_MINUTES = 30;

export type ScheduleDecision = {
  minutes: number;
  persistMinutes: boolean;
};

function readInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`采集器配置超出范围: ${raw}`);
  }
  return value;
}

export function readFrequencyPolicy(env: NodeJS.ProcessEnv = process.env): FrequencyPolicy {
  const tier1MaxDays = readInt(env.COLLECTOR_TIER1_MAX_DAYS, 3, 0, 3650);
  const tier2MaxDays = readInt(env.COLLECTOR_TIER2_MAX_DAYS, 14, tier1MaxDays, 3650);
  return {
    tier1MaxDays,
    tier1Minutes: readInt(env.COLLECTOR_TIER1_MINUTES, 15, MIN_MINUTES, MAX_MINUTES),
    tier2MaxDays,
    tier2Minutes: readInt(env.COLLECTOR_TIER2_MINUTES, 120, MIN_MINUTES, MAX_MINUTES),
    tier3Minutes: readInt(env.COLLECTOR_TIER3_MINUTES, 360, MIN_MINUTES, MAX_MINUTES),
    creatorMinutes: readInt(env.COLLECTOR_CREATOR_INTERVAL_MINUTES, 240, MIN_MINUTES, MAX_MINUTES),
  };
}

export function decideSchedule(
  subject: ScheduleSubject,
  now: Date,
  policy: FrequencyPolicy = readFrequencyPolicy({}),
): ScheduleDecision {
  if (subject.mode === 'fixed') {
    return { minutes: subject.fixedMinutes, persistMinutes: false };
  }
  if (subject.type === 'dynamic') {
    throw new Error('动态监控只支持固定间隔');
  }
  if (subject.type === 'discovery') {
    throw new Error('内容发现只支持固定间隔');
  }
  if (subject.type === 'creator') {
    return { minutes: policy.creatorMinutes, persistMinutes: true };
  }
  const ageMs = subject.pubdate ? now.getTime() - subject.pubdate.getTime() : 0;
  const ageDays = ageMs / DAY_MS;
  const minutes =
    ageDays <= policy.tier1MaxDays
      ? policy.tier1Minutes
      : ageDays <= policy.tier2MaxDays
        ? policy.tier2Minutes
        : policy.tier3Minutes;
  return { minutes, persistMinutes: true };
}
