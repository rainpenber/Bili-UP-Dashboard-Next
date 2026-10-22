import { describe, expect, test } from 'bun:test';
import { parseMonitorSearchParams, writeMonitorSearchParams } from './monitor-url-state';

describe('monitor URL state', () => {
  test('defaults and parsing', () => {
    const state = parseMonitorSearchParams(new URLSearchParams());
    expect(state).toEqual({
      tab: 'videos',
      page: 1,
      category: '',
      q: '',
      selected: null,
      monitor: 'all',
      view: 'split',
      sort: 'published_desc',
    });
  });

  test('video sort is written only when not the default', () => {
    expect(parseMonitorSearchParams(new URLSearchParams('sort=published_asc')).sort).toBe(
      'published_asc',
    );
    expect(parseMonitorSearchParams(new URLSearchParams('sort=bogus')).sort).toBe(
      'published_desc',
    );
    const asc = writeMonitorSearchParams(new URLSearchParams('tab=videos'), {
      sort: 'published_asc',
    });
    expect(asc.get('sort')).toBe('published_asc');
    const desc = writeMonitorSearchParams(asc, { sort: 'published_desc' });
    expect(desc.has('sort')).toBe(false);
    const creators = writeMonitorSearchParams(
      new URLSearchParams('tab=videos&sort=published_asc'),
      { tab: 'creators' },
    );
    expect(creators.has('sort')).toBe(false);
  });

  test('view falls back to split unless the query is grid', () => {
    expect(parseMonitorSearchParams(new URLSearchParams('view=grid')).view).toBe('grid');
    expect(parseMonitorSearchParams(new URLSearchParams('view=split')).view).toBe('split');
    for (const raw of ['', 'board', 'GRID', 'list']) {
      expect(parseMonitorSearchParams(new URLSearchParams(`view=${raw}`)).view).toBe('split');
    }
  });

  test('layout changes keep filters, selection, and page', () => {
    const base = new URLSearchParams(
      'tab=creators&page=2&q=test&category=游戏&monitor=paused&selected=abc&view=grid',
    );
    const samePage = writeMonitorSearchParams(base, { view: 'split' });
    expect(samePage.get('tab')).toBe('creators');
    expect(samePage.get('page')).toBe('2');
    expect(samePage.get('q')).toBe('test');
    expect(samePage.get('category')).toBe('游戏');
    expect(samePage.get('monitor')).toBe('paused');
    expect(samePage.get('selected')).toBe('abc');
    expect(samePage.has('view')).toBe(false);

    const grid = writeMonitorSearchParams(samePage, { view: 'grid' });
    expect(grid.get('view')).toBe('grid');
    expect(grid.get('page')).toBe('2');
    expect(grid.get('selected')).toBe('abc');
    expect(grid.get('q')).toBe('test');

    const nextPage = writeMonitorSearchParams(grid, { page: 3 });
    expect(nextPage.get('view')).toBe('grid');
    expect(nextPage.get('page')).toBe('3');
    expect(nextPage.get('selected')).toBe('abc');
  });

  test('old targets tab opens the video page and keeps the monitor filter', () => {
    const state = parseMonitorSearchParams(
      new URLSearchParams('tab=targets&page=3&monitor=paused'),
    );
    expect(state.tab).toBe('videos');
    expect(state.page).toBe(3);
    expect(state.monitor).toBe('paused');
    const next = writeMonitorSearchParams(new URLSearchParams('tab=targets'), { monitor: 'all' });
    expect(next.get('tab')).toBe('videos');
    expect(next.has('monitor')).toBe(false);
  });

  test('write merges and clears empty fields', () => {
    const base = new URLSearchParams('tab=creators&page=2&q=test&selected=abc');
    const next = writeMonitorSearchParams(base, { q: '', selected: null, page: 1 });
    expect(next.get('tab')).toBe('creators');
    expect(next.get('page')).toBe('1');
    expect(next.has('q')).toBe(false);
    expect(next.has('selected')).toBe(false);
  });
});
