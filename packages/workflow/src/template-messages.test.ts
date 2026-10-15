import { describe, expect, test } from 'bun:test';
import {
  duplicateTemplateNodeNameMessage,
  templateCycleMessage,
  templateDuplicateEdgeMessage,
  templateEmptyNodeNameMessage,
  templateMissingEdgeMessage,
  templateSelfLoopMessage,
} from './template-messages';

describe('template refusal wording', () => {
  test('matches the reviewed cycle, duplicate-name, and self-loop sentences', () => {
    expect(templateCycleMessage('发布', '询单')).toBe(
      '无法连接「发布 → 询单」：会在流程中形成环路。',
    );
    expect(duplicateTemplateNodeNameMessage('大纲')).toBe(
      '节点名称「大纲」已存在，同一流程内名称必须唯一。',
    );
    expect(templateSelfLoopMessage()).toBe('不能将节点连接到自身。');
    expect(templateDuplicateEdgeMessage('询单', '大纲')).toBe('连接「询单 → 大纲」已存在。');
    expect(templateMissingEdgeMessage('询单', '大纲')).toBe(
      '不存在连接「询单 → 大纲」，无法断开。',
    );
    expect(templateEmptyNodeNameMessage()).toBe('节点名称不能为空。');
  });
});
