import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { MonitorSearchSuggestionItem } from '@studio/contracts';
import { useMonitorSearchSuggestionsQuery } from '@/api/hooks/use-monitor-search-suggestions';
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

type FlatSuggestion = MonitorSearchSuggestionItem & { groupLabel: string };

function flattenSuggestions(data: {
  videos: MonitorSearchSuggestionItem[];
  creators: MonitorSearchSuggestionItem[];
  categories: MonitorSearchSuggestionItem[];
}): FlatSuggestion[] {
  return [
    ...data.videos.map((item) => ({ ...item, groupLabel: '视频' })),
    ...data.creators.map((item) => ({ ...item, groupLabel: 'UP主' })),
    ...data.categories.map((item) => ({ ...item, groupLabel: '分类' })),
  ];
}

function urlDraft(q: string, category: string): string {
  return q || category;
}

export function MonitorSearchField({
  type,
  q,
  category,
  onApply,
}: {
  type: 'video' | 'creator';
  q: string;
  category: string;
  onApply: (next: MonitorSearchApply) => void;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const onApplyRef = useRef(onApply);
  const [draft, setDraft] = useState(() => urlDraft(q, category));
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [debouncedSuggestQ, setDebouncedSuggestQ] = useState(() => draft.trim());
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

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSuggestQ(draft.trim());
    }, MONITOR_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [draft]);

  const suggestionsQuery = useMonitorSearchSuggestionsQuery({
    q: debouncedSuggestQ,
    type,
    enabled: open && debouncedSuggestQ.length > 0,
  });

  const flat = useMemo(
    () => (suggestionsQuery.data ? flattenSuggestions(suggestionsQuery.data) : []),
    [suggestionsQuery.data],
  );

  useEffect(() => {
    setHighlight(-1);
  }, [debouncedSuggestQ, suggestionsQuery.dataUpdatedAt]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const applySuggestion = (item: MonitorSearchSuggestionItem) => {
    skipDebounceRef.current = true;
    if (item.kind === 'category') {
      setDraft(item.label);
      setDebouncedSuggestQ(item.label);
      onApply({ q: '', category: item.value, page: 1, selected: null });
    } else if (item.kind === 'video') {
      setDraft(item.label);
      setDebouncedSuggestQ(item.label);
      onApply({ q: item.label, category: '', page: 1, selected: item.value });
    } else {
      setDraft(item.label);
      setDebouncedSuggestQ(item.label);
      onApply({
        q: item.label,
        category: '',
        page: 1,
        selected: type === 'creator' ? item.value : null,
      });
    }
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (flat.length === 0) return;
      setHighlight((index) => (index + 1) % flat.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length === 0) return;
      setHighlight((index) => (index <= 0 ? flat.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Enter' && open && highlight >= 0 && flat[highlight]) {
      event.preventDefault();
      applySuggestion(flat[highlight]!);
    }
  };

  const showPanel = open && draft.trim().length > 0;
  const loading = suggestionsQuery.isFetching;
  const empty =
    showPanel &&
    !loading &&
    suggestionsQuery.isSuccess &&
    flat.length === 0 &&
    debouncedSuggestQ === draft.trim();

  let lastGroup: string | null = null;

  return (
    <div ref={rootRef} className="relative grid min-w-0 gap-1.5 sm:col-span-2">
      <Label htmlFor="monitor-q" className="whitespace-nowrap">
        搜索
      </Label>
      <div className="flex min-w-0">
        <Input
          id="monitor-q"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-activedescendant={
            highlight >= 0 && flat[highlight] ? `${listboxId}-option-${highlight}` : undefined
          }
          value={draft}
          placeholder="标题、分类、UP 主或 BV 号"
          title="按视频标题、分类、UP 主名称或 BV / UID 搜索"
          className="min-w-[12rem] flex-1"
          data-testid="monitor-unified-search"
          autoComplete="off"
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>
      {showPanel ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="搜索建议"
          data-testid="monitor-search-suggestions"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {loading && flat.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground" role="status">
              正在搜索…
            </p>
          ) : null}
          {empty ? (
            <p className="px-3 py-2 text-sm text-muted-foreground" role="status">
              无匹配结果
            </p>
          ) : null}
          {flat.map((item, index) => {
            const showGroup = item.groupLabel !== lastGroup;
            lastGroup = item.groupLabel;
            return (
              <div key={`${item.kind}:${item.value}:${item.label}`}>
                {showGroup ? (
                  <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    {item.groupLabel}
                  </p>
                ) : null}
                <button
                  type="button"
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={highlight === index}
                  className={cn(
                    'flex w-full min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-left text-sm',
                    highlight === index ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                  )}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applySuggestion(item)}
                >
                  <span className="w-full truncate font-medium">{item.label}</span>
                  {item.secondary ? (
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {item.secondary}
                    </span>
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
