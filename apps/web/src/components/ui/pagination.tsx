import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  disabled?: boolean;
};

export function Pagination({
  page,
  totalPages,
  onPageChange,
  className,
  disabled,
}: PaginationProps) {
  const safeTotal = Math.max(1, totalPages);
  const atStart = page <= 1;
  const atEnd = page >= safeTotal;

  return (
    <nav
      aria-label="分页"
      className={cn('flex items-center gap-3 text-sm', className)}
      data-slot="pagination"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || atStart}
        onClick={() => onPageChange(page - 1)}
        aria-label="上一页"
      >
        <ChevronLeft className="size-4" />
        上一页
      </Button>
      <span className="tabular-nums text-muted-foreground" aria-live="polite">
        第 {page} / {safeTotal} 页
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || atEnd}
        onClick={() => onPageChange(page + 1)}
        aria-label="下一页"
      >
        下一页
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}
