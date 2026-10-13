import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import { ACCENT_LABELS, type ThemeAccent, type ThemeMode } from '@/lib/theme';
import { useThemePreferences } from '@/components/theme/theme-provider';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const MODES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];

export function ThemeControls({ className }: { className?: string }) {
  const { mode, accent, setMode, setAccent } = useThemePreferences();

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div
        className="flex items-center gap-0.5 rounded-md border p-0.5"
        role="group"
        aria-label="主题模式"
      >
        {MODES.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            type="button"
            variant={mode === value ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 px-2"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="sr-only sm:not-sr-only sm:ml-1.5">{label}</span>
          </Button>
        ))}
      </div>
      <Select value={accent} onValueChange={(v) => setAccent(v as ThemeAccent)}>
        <SelectTrigger className="h-8 w-[8.5rem]" aria-label="强调色">
          <Palette className="size-3.5 shrink-0 opacity-70" aria-hidden />
          <SelectValue placeholder="强调色" />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(ACCENT_LABELS) as ThemeAccent[]).map((key) => (
            <SelectItem key={key} value={key}>
              {ACCENT_LABELS[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
