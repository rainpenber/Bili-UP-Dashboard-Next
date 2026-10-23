import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Debounce applied search URL updates (and thus list requests). */
export const MONITOR_SEARCH_DEBOUNCE_MS = 300;

export type MonitorSearchApply = {
  q: string;
  category: string;
  selected: string | null;
  page: number;
};

function urlDraft(q: string, category: string): string {
  return q || category;
}

/**
 * Unified monitor search: debounced URL `q` refresh only — no suggestion dropdown.
 * List filtering remains on GET /cards?q=… (title / UP name / category / exact BV|UID).
 */
export function MonitorSearchField({
  q,
  category,
  onApply,
  className,
}: {
  /** Kept for call-site compatibility; list type is decided by the page tab. */
  type?: 'video' | 'creator';
  q: string;
  category: string;
  onApply: (next: MonitorSearchApply) => void;
  className?: string;
}) {
  const onApplyRef = useRef(onApply);
  const [draft, setDraft] = useState(() => urlDraft(q, category));
  const skipDebounceRef = useRef(false);

  useEffect(() => {
    onApplyRef.current = onApply;
  }, [onApply]);

  useEffect(() => {
    const fromUrl = urlDraft(q, category);
    setDraft((current) => (current === fromUrl ? current : fromUrl));
  }, [q, category]);

  useEffect(() => {
    if (skipDebounceRef.current) {
      skipDebounceRef.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      const next = draft.trim();
      const current = urlDraft(q, category).trim();
      if (next === current) return;
      // Typing always drives unified `q`; clear exact category filter.
      onApplyRef.current({ q: next, category: '', page: 1, selected: null });
    }, MONITOR_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [draft, q, category]);

  const applyNow = (next: string) => {
    skipDebounceRef.current = true;
    const trimmed = next.trim();
    setDraft(next);
    onApplyRef.current({ q: trimmed, category: '', page: 1, selected: null });
  };

  const clear = () => {
    applyNow('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (draft.length === 0) return;
      event.preventDefault();
      clear();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      applyNow(draft);
    }
  };

  return (
    <div className={cn('grid w-full max-w-[360px] shrink-0 gap-1', className)}>
      <Label
        htmlFor="monitor-q"
        className="whitespace-nowrap text-xs font-medium text-muted-foreground"
      >
        搜索
      </Label>
      <div className="relative flex h-9 w-full max-w-[360px] min-w-0 items-center">
        <Input
          id="monitor-q"
          value={draft}
          placeholder="标题、分类、UP 主或 BV 号"
          title="按视频标题、分类、UP 主名称或 BV / UID 搜索"
          className="h-9 w-full max-w-[360px] min-w-0 pr-9"
          data-testid="monitor-unified-search"
          autoComplete="off"
          aria-label="搜索监控对象"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {draft.length > 0 ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute right-0.5 top-1/2 size-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="清除搜索"
            data-testid="monitor-search-clear"
            onClick={clear}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
