import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  error?: string | null;
  /** 说明文案；默认面向视频 */
  description?: string;
  onConfirm: () => void;
};

/**
 * 移除监控二次确认。遮罩 / Esc / 取消 → 关闭且不调用删除；
 * 「确认移除」才触发 onConfirm（调用方负责异步与失败时保持弹窗）。
 */
export function RemoveMonitorDialog({
  open,
  onOpenChange,
  pending = false,
  error = null,
  description = '移除后将停止采集该视频数据，历史样本保留，可重新添加恢复。',
  onConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        data-testid="remove-monitor-dialog"
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || pending) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-slot="alert-dialog-cancel"]')) return;
          event.preventDefault();
          onConfirm();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>移除监控？</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} data-slot="alert-dialog-cancel">
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            autoFocus
            disabled={pending}
            className={cn(buttonVariants({ variant: 'destructive' }))}
            aria-label="确认移除"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            确认移除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
