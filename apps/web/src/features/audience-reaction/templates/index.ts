import type { TemplateId } from '../storage';
import { COMMENT_TEMPLATE } from './comment-template';
import { DANMAKU_TEMPLATE } from './danmaku-template';

/** 同步取模板，避免切模板时异步 fetch 串模板 */
export function getTemplateRaw(id: TemplateId): string {
  return id === 'comment' ? COMMENT_TEMPLATE : DANMAKU_TEMPLATE;
}

export { COMMENT_TEMPLATE, DANMAKU_TEMPLATE };
