import { describe, expect, test } from 'bun:test';
import {
  parseAddTemplateNodeRequest,
  parseCreateProjectFromTemplateRequest,
  parseDefaultTemplateWorkspace,
  parseTemplateWriteError,
} from './commercial-template';

const VERSION_ID = 'ffff1111-1111-4111-8111-111111111111';
const NODE_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001';
const EDGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    slug: 'default_sponsorship',
    name: '默认商单流程',
    version: 1,
    isDraft: false,
    isDefault: true,
    publishedAt: '2026-10-15T00:00:00.000Z',
    nodes: [
      {
        id: NODE_ID,
        slug: 'inquiry',
        name: '询单',
        kind: 'stage',
        isOptional: false,
        posX: 0,
        posY: 0,
        packageId: null,
      },
    ],
    edges: [],
    ...overrides,
  };
}

describe('template workspace contracts', () => {
  test('parses a published workspace and a draft with null publishedAt', () => {
    const parsed = parseDefaultTemplateWorkspace({
      slug: 'default_sponsorship',
      draft: version({
        id: 'aaaa1111-1111-4111-8111-111111111111',
        version: 2,
        isDraft: true,
        isDefault: false,
        publishedAt: null,
      }),
      published: [version()],
    });
    expect(parsed.draft?.version).toBe(2);
    expect(parsed.draft?.publishedAt).toBeNull();
    expect(parsed.published[0]?.isDefault).toBe(true);
    expect(parsed.published[0]?.nodes[0]?.name).toBe('询单');
  });

  test('rejects a published version missing publishedAt and an empty node name', () => {
    expect(() =>
      parseDefaultTemplateWorkspace({
        slug: 'default_sponsorship',
        draft: null,
        published: [version({ publishedAt: null })],
      }),
    ).toThrow(/publishedAt/);
    expect(() =>
      parseAddTemplateNodeRequest({
        name: '  ',
        kind: 'stage',
        isOptional: false,
        posX: 0,
        posY: 0,
      }),
    ).toThrow('节点名称不能为空。');
    expect(() =>
      parseAddTemplateNodeRequest({
        name: '回访',
        kind: 'fan',
        isOptional: false,
        posX: 0,
        posY: 1,
      }),
    ).toThrow(/stage 或 merge/);
  });

  test('trims the project name and keeps the reviewed error code', () => {
    expect(
      parseCreateProjectFromTemplateRequest({
        name: '  春季商单  ',
        templateVersionId: VERSION_ID,
      }).name,
    ).toBe('春季商单');
    expect(
      parseTemplateWriteError({
        error: '无法连接「发布 → 询单」：会在流程中形成环路。',
        code: 'cycle',
      }).code,
    ).toBe('cycle');
    expect(EDGE_ID).toHaveLength(36);
  });
});
