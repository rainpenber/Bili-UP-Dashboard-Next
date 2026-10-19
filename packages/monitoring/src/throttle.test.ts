import { describe, expect, test } from 'bun:test';
import { createAccountThrottle, type ThrottleClock } from './throttle';

function manualClock(start = 0): ThrottleClock & { at: number } {
  const clock = {
    at: start,
    now() {
      return clock.at;
    },
    async sleep(ms: number) {
      clock.at += ms;
    },
  };
  return clock;
}

describe('account throttle', () => {
  test('keeps two requests at least the minimum interval apart, including jitter', async () => {
    const clock = manualClock();
    const throttle = createAccountThrottle({
      minIntervalMs: 1500,
      maxJitterMs: 800,
      maxPerMinute: 20,
      random: () => 0,
      clock,
    });
    await throttle.wait('account-a');
    await throttle.wait('account-a');
    expect(clock.at).toBe(1500);

    const jittered = manualClock();
    const withJitter = createAccountThrottle({
      minIntervalMs: 1500,
      maxJitterMs: 800,
      maxPerMinute: 20,
      random: () => 800 / 801,
      clock: jittered,
    });
    await withJitter.wait('account-a');
    await withJitter.wait('account-a');
    expect(jittered.at).toBe(1500 + 800);
  });

  test('different accounts do not share the interval', async () => {
    const clock = manualClock();
    const throttle = createAccountThrottle({
      minIntervalMs: 1500,
      maxJitterMs: 0,
      maxPerMinute: 20,
      random: () => 0,
      clock,
    });
    await throttle.wait('a');
    await throttle.wait('b');
    expect(clock.at).toBe(0);
  });

  test('waits once the per-minute cap is reached', async () => {
    const clock = manualClock();
    const throttle = createAccountThrottle({
      minIntervalMs: 0,
      maxJitterMs: 0,
      maxPerMinute: 2,
      random: () => 0,
      clock,
    });
    await throttle.wait('a');
    await throttle.wait('a');
    await throttle.wait('a');
    expect(clock.at).toBe(60_000);
  });

  test('serializes overlapping waits for one account', async () => {
    const clock = manualClock();
    const throttle = createAccountThrottle({
      minIntervalMs: 1000,
      maxJitterMs: 0,
      maxPerMinute: 20,
      random: () => 0,
      clock,
    });
    await Promise.all([throttle.wait('a'), throttle.wait('a')]);
    expect(clock.at).toBe(1000);
  });
});
