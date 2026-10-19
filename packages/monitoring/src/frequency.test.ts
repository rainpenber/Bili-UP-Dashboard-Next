import { describe, expect, test } from 'bun:test';
import { decideSchedule, readFrequencyPolicy, type ScheduleSubject } from './frequency';

const DAY = 24 * 60 * 60 * 1000;
const policy = readFrequencyPolicy({});

function video(pubdate: Date | null, mode: 'auto' | 'fixed' = 'auto'): ScheduleSubject {
  return { type: 'video', mode, fixedMinutes: 60, pubdate };
}

describe('collection frequency', () => {
  test('video age picks 15, 120, then 360 minutes', () => {
    const now = new Date('2026-10-19T00:00:00.000Z');
    expect(decideSchedule(video(new Date(now.getTime() - 2 * DAY)), now, policy).minutes).toBe(15);
    expect(decideSchedule(video(new Date(now.getTime() - 5 * DAY)), now, policy).minutes).toBe(120);
    expect(decideSchedule(video(new Date(now.getTime() - 30 * DAY)), now, policy).minutes).toBe(
      360,
    );
  });

  test('crossing 3 days and 14 days changes the next interval', () => {
    const pubdate = new Date('2026-10-01T00:00:00.000Z');
    const inside = decideSchedule(video(pubdate), new Date(pubdate.getTime() + 2 * DAY), policy);
    const afterThree = decideSchedule(
      video(pubdate),
      new Date(pubdate.getTime() + 3 * DAY + 60_000),
      policy,
    );
    const atFourteen = decideSchedule(
      video(pubdate),
      new Date(pubdate.getTime() + 14 * DAY),
      policy,
    );
    const afterFourteen = decideSchedule(
      video(pubdate),
      new Date(pubdate.getTime() + 14 * DAY + 60_000),
      policy,
    );
    expect(inside.minutes).toBe(15);
    expect(afterThree.minutes).toBe(120);
    expect(atFourteen.minutes).toBe(120);
    expect(afterFourteen.minutes).toBe(360);
  });

  test('fixed mode keeps interval_minutes and creators default to 240', () => {
    const now = new Date('2026-10-19T00:00:00.000Z');
    const fixed = decideSchedule(video(new Date(now.getTime() - 30 * DAY), 'fixed'), now, policy);
    expect(fixed).toEqual({ minutes: 60, persistMinutes: false });
    const creator = decideSchedule(
      { type: 'creator', mode: 'auto', fixedMinutes: 15, pubdate: null },
      now,
      policy,
    );
    expect(creator).toEqual({ minutes: 240, persistMinutes: true });
    const creatorFixed = decideSchedule(
      { type: 'creator', mode: 'fixed', fixedMinutes: 15, pubdate: null },
      now,
      policy,
    );
    expect(creatorFixed).toEqual({ minutes: 15, persistMinutes: false });
  });

  test('a video with no pubdate stays on the fresh tier until age is known', () => {
    const now = new Date('2026-10-19T00:00:00.000Z');
    expect(decideSchedule(video(null), now, policy).minutes).toBe(15);
  });
});
