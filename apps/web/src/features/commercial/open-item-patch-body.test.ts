import { describe, expect, test } from 'bun:test';
import { buildOpenItemPatchBody } from './open-item-patch-body';

describe('buildOpenItemPatchBody', () => {
  test('clears blocksNodeId with null when impact is normal', () => {
    const body = buildOpenItemPatchBody({
      title: 'T',
      description: '',
      closeCriteria: '',
      nextAction: '',
      nextActor: 'us',
      impact: 'normal',
      blocksNodeId: '99999999-9999-4999-8999-999999999901',
      workflowNodeId: '',
    });
    expect(body.blocksNodeId).toBeNull();
    expect(body).not.toHaveProperty('blocksNodeId', undefined);
  });

  test('keeps blocksNodeId when impact is blocking', () => {
    const nodeId = '99999999-9999-4999-8999-999999999902';
    const body = buildOpenItemPatchBody({
      title: 'T',
      description: '',
      closeCriteria: '',
      nextAction: '',
      nextActor: 'us',
      impact: 'blocking',
      blocksNodeId: nodeId,
      workflowNodeId: '',
    });
    expect(body.blocksNodeId).toBe(nodeId);
  });
});
