import { describe, expect, test } from 'bun:test';
import {
  buildOpenItemConfirmationPatch,
  buildOpenItemEditPatchBody,
  validateOpenItemEditConfirmer,
} from './open-item-patch';

const STAFF = '33333333-3333-4333-8333-333333333333';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('open item patch payload', () => {
  test('confirmed item field-only edit omits confirmation keys', () => {
    const result = buildOpenItemEditPatchBody(
      { humanConfirmed: true, confirmedById: STAFF },
      {
        title: '新标题',
        itemType: 'our_action',
        responsibleParty: 'us',
        description: '',
        closeCondition: '',
        workflowNodeId: '',
        dueLocal: '',
        humanConfirmed: true,
        confirmedById: STAFF,
      },
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.body.humanConfirmed).toBeUndefined();
    expect(result.body.confirmedById).toBeUndefined();
    expect(result.body.title).toBe('新标题');
  });

  test('unconfirm sends humanConfirmed false only', () => {
    const patch = buildOpenItemConfirmationPatch(
      { humanConfirmed: true, confirmedById: STAFF },
      { humanConfirmed: false, confirmedById: STAFF },
    );
    expect(patch).toEqual({ humanConfirmed: false });
  });

  test('new confirm requires confirmer in payload', () => {
    const patch = buildOpenItemConfirmationPatch(
      { humanConfirmed: false, confirmedById: null },
      { humanConfirmed: true, confirmedById: STAFF },
    );
    expect(patch).toEqual({ humanConfirmed: true, confirmedById: STAFF });
  });

  test('confirmer change while confirmed includes both fields', () => {
    const patch = buildOpenItemConfirmationPatch(
      { humanConfirmed: true, confirmedById: STAFF },
      { humanConfirmed: true, confirmedById: OTHER },
    );
    expect(patch).toEqual({ humanConfirmed: true, confirmedById: OTHER });
  });

  test('blocks save when confirming without confirmer', () => {
    expect(validateOpenItemEditConfirmer({ humanConfirmed: true, confirmedById: '' })).toBe(
      '确认时必须选择确认人',
    );
    const result = buildOpenItemEditPatchBody(
      { humanConfirmed: false, confirmedById: null },
      {
        title: 'x',
        itemType: 'confirmation',
        responsibleParty: 'us',
        description: '',
        closeCondition: '',
        workflowNodeId: '',
        dueLocal: '',
        humanConfirmed: true,
        confirmedById: '',
      },
    );
    expect(result).toEqual({ error: '确认时必须选择确认人' });
  });
});
