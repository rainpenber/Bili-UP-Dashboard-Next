import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { stopCardActivatePropagation } from '@/features/monitoring/card-activate';
import { cn } from '@/lib/utils';

const BVID = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const MID = /^[1-9][0-9]{0,18}$/;
const DYNAMIC_ID = /^[1-9]\d*$/;

export type BilibiliExternalKind = 'video' | 'dynamic' | 'creator';

export function bilibiliExternalHref(
  kind: BilibiliExternalKind,
  id: string | null | undefined,
): string | null {
  const value = id?.trim() ?? '';
  if (!value) return null;
  if (kind === 'video') {
    if (!BVID.test(value)) return null;
    return `https://www.bilibili.com/video/${value}`;
  }
  if (kind === 'dynamic') {
    if (!DYNAMIC_ID.test(value)) return null;
    return `https://www.bilibili.com/opus/${value}`;
  }
  if (!MID.test(value)) return null;
  return `https://space.bilibili.com/${value}`;
}

/**
 * Icon-only Bilibili open link for monitor cards. stopPropagation so card select/nav stays intact.
 */
export function BilibiliExternalLinkButton({
  kind,
  id,
  className,
  testId = 'bilibili-external-link',
}: {
  kind: BilibiliExternalKind;
  id: string | null | undefined;
  className?: string;
  testId?: string;
}) {
  const href = bilibiliExternalHref(kind, id);
  if (!href) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      asChild
      className={cn('size-8 shrink-0 px-0', className)}
      data-testid={testId}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="在 B 站打开"
        onClick={stopCardActivatePropagation}
        onKeyDown={stopCardActivatePropagation}
      >
        <ExternalLink className="size-4" aria-hidden />
      </a>
    </Button>
  );
}
