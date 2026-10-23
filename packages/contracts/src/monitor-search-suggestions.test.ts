import { describe, expect, test } from 'bun:test';
import {
  MONITOR_SEARCH_SUGGESTION_GROUP_LIMIT,
  parseMonitorSearchSuggestionsQuery,
  parseMonitorSearchSuggestionsResponse,
} from './monitor-search-suggestions';

describe('monitor search suggestions contracts', () => {
  test('parses query with default limit and rejects overlong q', () => {
    expect(parseMonitorSearchSuggestionsQuery({ type: 'video', q: ' 游戏 ' })).toEqual({
      q: '游戏',
      type: 'video',
      limit: MONITOR_SEARCH_SUGGESTION_GROUP_LIMIT,
    });
    expect(parseMonitorSearchSuggestionsQuery({ type: 'creator', q: 'a', limit: '3' }).limit).toBe(
      3,
    );
    expect(parseMonitorSearchSuggestionsQuery({ type: 'video', q: '', limit: '99' }).limit).toBe(
      MONITOR_SEARCH_SUGGESTION_GROUP_LIMIT,
    );
    expect(() => parseMonitorSearchSuggestionsQuery({ type: 'dynamic' as string })).toThrow(
      /视频或 UP/,
    );
    expect(() => parseMonitorSearchSuggestionsQuery({ type: 'video', q: 'x'.repeat(121) })).toThrow(
      /过长/,
    );
  });

  test('parses grouped response and requires readable labels', () => {
    const parsed = parseMonitorSearchSuggestionsResponse({
      q: '狐',
      type: 'video',
      limit: 5,
      videos: [
        {
          kind: 'video',
          label: '狐正正的日常',
          secondary: '狐正正 · BV1xx411c7mD',
          value: 'BV1xx411c7mD',
        },
      ],
      creators: [
        {
          kind: 'creator',
          label: '狐正正',
          secondary: '3493141386627335',
          value: '3493141386627335',
        },
      ],
      categories: [{ kind: 'category', label: '游戏', secondary: null, value: '游戏' }],
    });
    expect(parsed.videos[0]?.label).toBe('狐正正的日常');
    expect(parsed.creators[0]?.label).toBe('狐正正');
    expect(parsed.categories[0]?.secondary).toBeNull();
    expect(() =>
      parseMonitorSearchSuggestionsResponse({
        q: 'x',
        type: 'video',
        limit: 5,
        videos: [{ kind: 'video', label: '', secondary: null, value: 'BV1' }],
        creators: [],
        categories: [],
      }),
    ).toThrow(/可读名称/);
  });
});
