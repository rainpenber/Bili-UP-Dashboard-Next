import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from './clipboard';
import { convertDanmakuText, type DanmakuConvertMode } from './danmakuConvert';
import { assertFileSize, MAX_UPLOAD_BYTES } from './file-limits';
import {
  clearStoredForm,
  defaultForm,
  exportConfig,
  importConfig,
  loadForm,
  saveForm,
  type StoredForm,
  type TemplateId,
} from './storage';
import { isSubtitleFilename, parseSubtitleFile, type SubtitleCue } from './subtitle';
import { applyTemplate, buildSubtitleCsv } from './template';
import { getTemplateRaw } from './templates';

const EMPTY_SUBTITLE_PLACEHOLDER = '（尚未上传字幕或解析结果为空）';

function downloadJson(text: string, filename: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AudienceReactionScreen() {
  const initial = useMemo(() => loadForm(), []);
  const [form, setForm] = useState<StoredForm>(initial.form);
  const [storageMessage, setStorageMessage] = useState<string | null>(
    initial.ok === false ? initial.error : (initial.warning ?? null),
  );
  /** 损坏草稿 / 显式清除后暂不自动写回；用户编辑时再恢复 */
  const skipAutosaveRef = useRef(initial.ok === false);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [subtitleFileName, setSubtitleFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [manualCopyOpen, setManualCopyOpen] = useState(false);

  const subtitleFileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const danmakuOpenBtnRef = useRef<HTMLButtonElement>(null);

  const [danmakuConvertOpen, setDanmakuConvertOpen] = useState(false);
  const [danmakuConvertInput, setDanmakuConvertInput] = useState('');
  const [danmakuConvertMode, setDanmakuConvertMode] = useState<DanmakuConvertMode>('mmssToPipe');
  const [danmakuCopyHint, setDanmakuCopyHint] = useState('');
  const [danmakuManualOpen, setDanmakuManualOpen] = useState(false);

  const productId = useId();
  const categoryId = useId();
  const positioningId = useId();
  const refId = useId();
  const danmakuInId = useId();
  const danmakuOutId = useId();

  const templateRaw = getTemplateRaw(form.templateId);

  const preview = useMemo(() => {
    const subtitle_csv = cues.length ? buildSubtitleCsv(cues) : EMPTY_SUBTITLE_PLACEHOLDER;
    return applyTemplate(templateRaw, {
      product: form.product,
      category: form.category,
      positioning: form.positioning,
      reference_comments: form.reference_comments,
      subtitle_csv,
    });
  }, [templateRaw, form, cues]);

  const danmakuConvertStats = useMemo(() => {
    const { lines, skipped } = convertDanmakuText(danmakuConvertInput, danmakuConvertMode);
    return { text: lines.join('\n'), skipped, count: lines.length };
  }, [danmakuConvertInput, danmakuConvertMode]);

  useEffect(() => {
    if (skipAutosaveRef.current) return;
    const result = saveForm(form);
    if (!result.ok) {
      setStorageMessage(result.error);
    }
  }, [form]);

  function updateForm(patch: Partial<StoredForm>) {
    skipAutosaveRef.current = false;
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function setTemplate(id: TemplateId) {
    updateForm({ templateId: id });
  }

  async function processSubtitleFile(file: File) {
    if (!isSubtitleFilename(file.name)) {
      setParseError('请上传 .srt、.ass 或 .ssa 文件（未改动当前字幕）');
      return;
    }
    try {
      assertFileSize(file, MAX_UPLOAD_BYTES);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
      return;
    }

    setParseError(null);
    try {
      const text = await file.text();
      const parsed = parseSubtitleFile(file.name, text);
      setCues(parsed);
      setSubtitleFileName(file.name);
      if (parsed.length === 0) {
        setParseError('未解析到任何字幕行，请检查文件格式。');
      }
    } catch (err) {
      setCues([]);
      setSubtitleFileName(file.name);
      setParseError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSubtitleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await processSubtitleFile(file);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const related = e.relatedTarget as Node | null;
    const current = e.currentTarget;
    if (related && current.contains(related)) return;
    setDragOver(false);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processSubtitleFile(file);
  }

  function clearSubtitle() {
    setCues([]);
    setSubtitleFileName('');
    setParseError(null);
    if (subtitleFileInput.current) subtitleFileInput.current.value = '';
  }

  async function copyPreview() {
    const ok = await copyTextToClipboard(preview);
    if (ok) {
      setCopyHint('已复制到剪贴板');
      setTimeout(() => setCopyHint(''), 2000);
    } else {
      setCopyHint('复制失败，请使用手动复制');
      setManualCopyOpen(true);
      setTimeout(() => setCopyHint(''), 4000);
    }
  }

  function downloadExport() {
    downloadJson(exportConfig(form), 'audience-reaction-prompt-config.json');
  }

  async function onImportJson(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      assertFileSize(file, MAX_UPLOAD_BYTES);
      const text = await file.text();
      const next = importConfig(text);
      skipAutosaveRef.current = false;
      setForm(next);
      setParseError(null);
      setStorageMessage('已从 JSON 导入（兼容旧工具 version:1 导出）');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
  }

  function clearDraft() {
    skipAutosaveRef.current = true;
    const result = clearStoredForm();
    if (!result.ok) {
      setStorageMessage(result.error);
      return;
    }
    setForm(defaultForm());
    setStorageMessage('已清除本地草稿');
  }

  async function copyDanmakuResult() {
    const ok = await copyTextToClipboard(danmakuConvertStats.text);
    if (ok) {
      setDanmakuCopyHint('已复制到剪贴板');
      setTimeout(() => setDanmakuCopyHint(''), 2000);
    } else {
      setDanmakuCopyHint('复制失败，请使用手动复制');
      setDanmakuManualOpen(true);
      setTimeout(() => setDanmakuCopyHint(''), 4000);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 overflow-x-hidden px-0">
      <PageHeader
        title="观众反应模拟"
        description="在浏览器本地解析字幕并组合提示词模板，供发布前内部评估。内容不上传后端或第三方；结果为内部模拟，不是真实观众数据，也不会自动生成或发布任何平台互动。"
      />

      {storageMessage ? (
        <p
          role="status"
          className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        >
          {storageMessage}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="overflow-hidden p-0">
            <input
              ref={subtitleFileInput}
              type="file"
              accept=".srt,.ass,.ssa"
              className="sr-only"
              onChange={onSubtitleFile}
            />
            <div
              role="button"
              tabIndex={0}
              className={cn(
                'flex min-h-[min(22rem,50vh)] w-full cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                dragOver
                  ? 'border-primary bg-muted/60'
                  : 'border-border bg-muted/20 hover:bg-muted/35',
              )}
              aria-label="上传字幕文件，支持点击或拖拽"
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => subtitleFileInput.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  subtitleFileInput.current?.click();
                }
              }}
            >
              <div>
                <p className="text-lg font-medium">字幕文件</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  拖拽到此处，或点击选择 · 支持 .srt、.ass / .ssa
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  解析为 CSV（开始时间秒 + 文本）填入提示词 · 上限{' '}
                  {(MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)} MiB · 仅本地处理
                </p>
              </div>
              {parseError ? (
                <p className="max-w-md text-sm text-destructive">{parseError}</p>
              ) : null}
            </div>
            {subtitleFileName ? (
              <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/15 px-4 py-3 text-sm">
                <span className="min-w-0 truncate text-foreground">
                  已选：{subtitleFileName} · {cues.length} 条字幕
                </span>
                <button
                  type="button"
                  className="shrink-0 text-primary underline"
                  onClick={clearSubtitle}
                >
                  清除
                </button>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>产品信息</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div>
                <Label htmlFor={productId}>商品</Label>
                <Input
                  id={productId}
                  value={form.product}
                  onChange={(e) => updateForm({ product: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor={categoryId}>品类</Label>
                <Input
                  id={categoryId}
                  value={form.category}
                  onChange={(e) => updateForm({ category: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor={positioningId}>产品定位</Label>
                <Input
                  id={positioningId}
                  value={form.positioning}
                  onChange={(e) => updateForm({ positioning: e.target.value })}
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>参考评论</CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor={refId}>一行一条</Label>
              <textarea
                id={refId}
                value={form.reference_comments}
                onChange={(e) => updateForm({ reference_comments: e.target.value })}
                rows={8}
                className="mt-1 w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                placeholder="粘贴参考评论，每行一条"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>配置导入 / 导出</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                导出为 JSON 便于换机备份（不含字幕文件，仅表单与模板选择）。可导入旧工具 version:1
                导出；不读取旧站点跨源 localStorage。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={downloadExport}>
                  导出 JSON
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => importInput.current?.click()}
                >
                  导入 JSON
                </Button>
                <Button type="button" variant="outline" onClick={clearDraft}>
                  清除本地草稿
                </Button>
              </div>
              <input
                ref={importInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={onImportJson}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex min-h-[70vh] min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium leading-none">模板</span>
            <div
              className="inline-flex h-10 w-full max-w-full rounded-lg border border-border bg-muted/30 p-1"
              role="group"
              aria-label="选择提示词模板"
            >
              <button
                type="button"
                className={cn(
                  'flex-1 rounded-md px-3 text-sm font-medium transition-colors',
                  form.templateId === 'danmaku'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                )}
                onClick={() => setTemplate('danmaku')}
              >
                弹幕模拟
              </button>
              <button
                type="button"
                className={cn(
                  'flex-1 rounded-md px-3 text-sm font-medium transition-colors',
                  form.templateId === 'comment'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                )}
                onClick={() => setTemplate('comment')}
              >
                评论模拟
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              提示词供内部观众反应模拟与内容审核评估；不代表真实观众，也不会向 B
              站或其他平台发布互动。
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium">组合结果</h2>
            <div className="flex shrink-0 items-center gap-2">
              {copyHint ? (
                <span className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
                  {copyHint}
                </span>
              ) : null}
              <Button type="button" onClick={copyPreview}>
                复制全文
              </Button>
              <Button type="button" variant="outline" onClick={() => setManualCopyOpen(true)}>
                手动复制
              </Button>
            </div>
          </div>
          <textarea
            ref={previewRef}
            readOnly
            value={preview}
            aria-label="组合提示词预览"
            className="min-h-[min(55vh,32rem)] w-full min-w-0 flex-1 resize-y overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed"
          />

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              在「分:秒 +
              内容」与「秒|内容」等格式间转换，便于整理弹幕时间轴（内部整理，非真实弹幕抓取）。
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              ref={danmakuOpenBtnRef}
              onClick={() => setDanmakuConvertOpen(true)}
            >
              弹幕时间格式转换
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={danmakuConvertOpen}
        onOpenChange={(open) => {
          setDanmakuConvertOpen(open);
          if (!open) {
            queueMicrotask(() => danmakuOpenBtnRef.current?.focus());
          }
        }}
      >
        <DialogContent
          className="flex max-h-[min(92vh,56rem)] w-[min(100vw-1rem,72rem)] max-w-none flex-col gap-4 overflow-y-auto p-5 sm:max-w-none"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle id="danmaku-convert-title">弹幕时间格式转换</DialogTitle>
            <DialogDescription id="danmaku-convert-desc">
              左侧粘贴文本，右侧实时显示转换结果；点击遮罩外不会关闭本窗口。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ToggleGroup
              type="single"
              variant="outline"
              className="flex w-full min-w-0 flex-1 flex-wrap bg-transparent sm:flex-nowrap"
              value={danmakuConvertMode}
              onValueChange={(v) => {
                if (v === 'mmssToPipe' || v === 'pipeToSlash') setDanmakuConvertMode(v);
              }}
            >
              <ToggleGroupItem
                value="mmssToPipe"
                aria-label="分秒转竖线格式"
                className="flex-1 px-2 text-xs sm:text-sm"
              >
                分:秒 → 秒|内容
              </ToggleGroupItem>
              <ToggleGroupItem
                value="pipeToSlash"
                aria-label="竖线转斜杠时间轴"
                className="flex-1 px-2 text-xs sm:text-sm"
              >
                秒|内容 → 内容/分:秒
              </ToggleGroupItem>
            </ToggleGroup>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                关闭
              </Button>
            </DialogClose>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-2">
            <div className="flex min-h-[min(40vh,18rem)] min-w-0 flex-col gap-1.5">
              <Label htmlFor={danmakuInId}>输入</Label>
              <textarea
                id={danmakuInId}
                rows={18}
                value={danmakuConvertInput}
                onChange={(e) => setDanmakuConvertInput(e.target.value)}
                className="min-h-[min(40vh,18rem)] w-full flex-1 resize-y rounded-md border border-input bg-transparent p-3 font-mono text-xs leading-relaxed"
                placeholder="例如：00:08 弹幕内容（每行一条）或 8|弹幕内容"
              />
            </div>
            <div className="flex min-h-[min(40vh,18rem)] min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor={danmakuOutId}>转换结果</Label>
                <div className="flex items-center gap-2">
                  {danmakuCopyHint ? (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400" role="status">
                      {danmakuCopyHint}
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    onClick={copyDanmakuResult}
                  >
                    复制结果
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setDanmakuManualOpen(true)}
                  >
                    手动复制
                  </Button>
                </div>
              </div>
              <textarea
                id={danmakuOutId}
                readOnly
                value={danmakuConvertStats.text}
                className="min-h-[min(40vh,18rem)] w-full flex-1 resize-y overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed"
              />
              <p className="text-xs text-muted-foreground">
                已转换 {danmakuConvertStats.count} 行，跳过 {danmakuConvertStats.skipped} 行
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manualCopyOpen} onOpenChange={setManualCopyOpen}>
        <DialogContent className="flex max-h-[min(85vh,40rem)] flex-col gap-3">
          <DialogHeader>
            <DialogTitle>手动复制提示词</DialogTitle>
            <DialogDescription>
              剪贴板不可用或非安全上下文时，请全选下方文本后手动复制（Ctrl/Cmd+C）。
            </DialogDescription>
          </DialogHeader>
          <textarea
            readOnly
            value={preview}
            className="min-h-[16rem] w-full flex-1 resize-y overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <DialogClose asChild>
            <Button type="button" variant="outline">
              关闭
            </Button>
          </DialogClose>
        </DialogContent>
      </Dialog>

      <Dialog open={danmakuManualOpen} onOpenChange={setDanmakuManualOpen}>
        <DialogContent className="flex max-h-[min(85vh,40rem)] flex-col gap-3">
          <DialogHeader>
            <DialogTitle>手动复制转换结果</DialogTitle>
            <DialogDescription>请全选下方文本后手动复制。</DialogDescription>
          </DialogHeader>
          <textarea
            readOnly
            value={danmakuConvertStats.text}
            className="min-h-[12rem] w-full flex-1 resize-y overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <DialogClose asChild>
            <Button type="button" variant="outline">
              关闭
            </Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}
