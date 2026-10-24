import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type ToastListener = (message: string) => void;

const listeners = new Set<ToastListener>();

/** 轻量 toast：无第三方依赖；详情页移除成功等场景使用 */
export function toast(message: string): void {
  for (const listener of listeners) listener(message);
}

export function ToastHost({ className }: { className?: string }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onToast: ToastListener = (next) => {
      setMessage(next);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 3200);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="app-toast"
      className={cn(
        'fixed bottom-4 left-1/2 z-[60] max-w-[min(calc(100%-2rem),24rem)] -translate-x-1/2 rounded-md border bg-background px-4 py-2 text-sm text-foreground shadow-lg',
        className,
      )}
    >
      {message}
    </div>
  );
}
