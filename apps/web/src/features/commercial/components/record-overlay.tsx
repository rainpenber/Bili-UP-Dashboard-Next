import {
  useEffect,
  useId,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { DEMO_STATUS_COLOR } from '../workflow-status-map';
import type { MockStatus } from '../../workflow-mock/flow-nodes';

export type RecordOverlayItem = {
  id: string;
  name: string;
  status: string;
  demoStatus: MockStatus;
  statusLabel: string;
  blockingReason?: string | null;
  planLabel?: string | null;
  actualLabel?: string | null;
  overdue?: boolean;
  /** Per-row interactive controls, such as the stage tooltip node actions. */
  actions?: ReactNode;
};

type Placement = {
  side: 'top' | 'bottom';
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  arrowX: number;
};

function placeOverlay(anchor: HTMLElement): Placement {
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(360, Math.max(0, window.innerWidth - margin * 2));
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const side: 'top' | 'bottom' = spaceBelow < 180 && spaceAbove > spaceBelow ? 'top' : 'bottom';
  const left = Math.min(
    Math.max(rect.left, margin),
    Math.max(margin, window.innerWidth - width - margin),
  );
  const arrowX = Math.min(
    Math.max(rect.left + rect.width / 2 - left - 5, 14),
    Math.max(14, width - 24),
  );
  const room = side === 'bottom' ? spaceBelow : spaceAbove;
  const maxHeight = Math.min(320, Math.max(96, room - 16));
  const top = side === 'bottom' ? rect.bottom + margin : rect.top - margin;
  return { side, left, top, width, maxHeight, arrowX };
}

export function RecordOverlayList({ items }: { items: RecordOverlayItem[] }) {
  return (
    <ol className="record-overlay-list">
      {items.map((item) => {
        const color = DEMO_STATUS_COLOR[item.demoStatus];
        return (
          <li
            key={item.id}
            className="record-overlay-row"
            data-status={item.demoStatus}
            data-workflow-status={item.status}
          >
            <span className="record-overlay-dot" style={{ color }} aria-hidden />
            <div className="record-overlay-copy">
              <div className="record-overlay-title-row">
                <span className="record-overlay-name">{item.name}</span>
                <span className="record-overlay-status" style={{ color }}>
                  {item.statusLabel}
                </span>
              </div>
              {item.blockingReason ? (
                <p className="record-overlay-reason">{item.blockingReason}</p>
              ) : null}
              {item.planLabel ? <p className="record-overlay-meta">计划 {item.planLabel}</p> : null}
              {item.actualLabel ? (
                <p className="record-overlay-meta">实际 {item.actualLabel}</p>
              ) : null}
              {item.overdue ? <p className="record-overlay-overdue">逾期</p> : null}
              {item.actions ? (
                <div className="flex min-w-0 flex-wrap justify-end">{item.actions}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function AnchoredRecordOverlay({
  open,
  anchorRef,
  title,
  testId,
  stageId,
  layoutKey,
  interactive = false,
  onPointerEnter,
  onPointerLeave,
  onKeyDown,
  onFocus,
  onBlur,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  title: string;
  testId: string;
  stageId?: string;
  layoutKey?: string;
  /** Stage quick actions are a non-modal dialog. Summary overlays stay read-only tooltips. */
  interactive?: boolean;
  onPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onFocus?: (event: ReactFocusEvent<HTMLDivElement>) => void;
  onBlur?: (event: ReactFocusEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const headingId = useId();
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      setRendered(false);
      return;
    }
    setRendered(true);
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!rendered) return;
    const measure = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setPlacement(placeOverlay(anchor));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [rendered, anchorRef, open, layoutKey]);

  if (!open || !rendered || !placement || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="record-overlay"
      data-testid={testId}
      data-stage-id={stageId}
      data-side={placement.side}
      data-visible={visible ? 'true' : 'false'}
      data-motion="140ms"
      data-interactive={interactive ? 'true' : 'false'}
      role={interactive ? 'dialog' : 'tooltip'}
      aria-modal={interactive ? false : undefined}
      aria-labelledby={interactive ? headingId : undefined}
      style={{
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
        top: placement.side === 'bottom' ? placement.top : undefined,
        bottom: placement.side === 'top' ? window.innerHeight - placement.top : undefined,
        ['--record-arrow-x' as string]: `${placement.arrowX}px`,
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <span className="record-overlay-arrow" aria-hidden />
      <p id={headingId} className="record-overlay-heading">
        {title}
      </p>
      {children}
    </div>,
    document.body,
  );
}
