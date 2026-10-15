import { describe, expect, test } from 'bun:test';
import { legalNodeCommands, type NodeCommand } from './node-actions';

function commands(
  status: Parameters<typeof legalNodeCommands>[0]['status'],
  extra?: {
    isOptional?: boolean;
    isPublishNode?: boolean;
  },
): NodeCommand[] {
  return legalNodeCommands({
    status,
    isOptional: extra?.isOptional ?? false,
    isPublishNode: extra?.isPublishNode ?? false,
  });
}

describe('legal node commands', () => {
  test('not_reached offers advance, and skip only when optional', () => {
    expect(commands('not_reached')).toEqual(['advance']);
    expect(commands('not_reached', { isOptional: true })).toEqual(['advance', 'skip']);
  });

  test('in_progress offers complete, rollback, and block', () => {
    expect(commands('in_progress')).toEqual(['complete', 'rollback', 'block']);
    expect(commands('in_progress', { isOptional: true })).toEqual([
      'complete',
      'rollback',
      'block',
      'skip',
    ]);
  });

  test('the publish node completes through publish', () => {
    expect(commands('in_progress', { isPublishNode: true })).toEqual([
      'publish',
      'rollback',
      'block',
    ]);
    expect(commands('not_reached', { isPublishNode: true })).toEqual(['advance']);
  });

  test('completed offers only rollback', () => {
    expect(commands('completed')).toEqual(['rollback']);
    expect(commands('completed', { isOptional: true })).toEqual(['rollback']);
  });

  test('blocked offers only unblock, including a block that has no reason', () => {
    expect(commands('blocked')).toEqual(['unblock']);
  });

  test('not_applicable clears with rollback and is not advanced in place', () => {
    expect(commands('not_applicable', { isOptional: true })).toEqual(['rollback']);
  });
});
