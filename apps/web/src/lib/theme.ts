export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeAccent = 'indigo' | 'violet' | 'emerald' | 'amber' | 'rose';

export const THEME_STORAGE_KEY = 'studio-theme-mode';
export const ACCENT_STORAGE_KEY = 'studio-theme-accent';

export const ACCENT_LABELS: Record<ThemeAccent, string> = {
  indigo: '蓝靛',
  violet: '紫罗兰',
  emerald: '翡翠绿',
  amber: '琥珀橙',
  rose: '玫瑰红',
};

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function isThemeAccent(value: string | null): value is ThemeAccent {
  return (
    value === 'indigo' ||
    value === 'violet' ||
    value === 'emerald' ||
    value === 'amber' ||
    value === 'rose'
  );
}

export function readStoredThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function readStoredAccent(): ThemeAccent {
  try {
    const raw = localStorage.getItem(ACCENT_STORAGE_KEY);
    return isThemeAccent(raw) ? raw : 'indigo';
  } catch {
    return 'indigo';
  }
}

export function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyThemeToDocument(mode: ThemeMode, accent: ThemeAccent): void {
  const dark = resolveDark(mode);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.accent = accent;
  document.documentElement.dataset.themeMode = mode;
}

export function persistTheme(mode: ThemeMode, accent: ThemeAccent): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    /* ignore quota / private mode */
  }
}

/** index.html 内联脚本使用的同步逻辑 */
export function bootstrapThemeScript(): string {
  return `(function(){try{var m=localStorage.getItem('${THEME_STORAGE_KEY}');var a=localStorage.getItem('${ACCENT_STORAGE_KEY}')||'indigo';var d=m==='dark'||(m!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.accent=a;document.documentElement.dataset.themeMode=m||'system';}catch(e){}})();`;
}
