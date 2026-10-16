/** 把接口抛出的英文错误码换成页面上给人看的句子。未知中文原文原样保留。 */
const KNOWN_ERROR_COPY: Record<string, string> = {
  'not found': '没有找到',
  'bad request': '请求内容不对',
  'project not found': '找不到这个项目',
  'workflow not found': '找不到这条流程',
  'internal error': '出了点问题，请稍后再试',
  'invalid project id': '项目编号不对',
  'default template not found': '找不到默认流程',
  'batch not found': '找不到这次导入',
  'import failed': '导入没有成功',
  'invalid JSON body': '提交的内容无法识别',
};

function humanizeKnownError(raw: string): string {
  const known = KNOWN_ERROR_COPY[raw];
  if (known) return known;
  const http = /^HTTP (\d+)$/.exec(raw);
  if (!http) return raw;
  if (http[1] === '404') return '没有找到';
  if (http[1] === '400') return '请求内容不对';
  return '暂时连不上';
}

export function toUserErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error && error.message.trim() !== '' ? error.message : fallback;
  return humanizeKnownError(raw);
}
