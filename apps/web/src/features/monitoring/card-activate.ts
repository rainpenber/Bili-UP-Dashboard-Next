import type { KeyboardEvent, MouseEvent } from 'react';

/** Activate card primary action on click / Enter / Space; ignore nested interactive targets. */
export function handleCardActivateKey(
  event: KeyboardEvent<HTMLElement>,
  activate: (() => void) | undefined,
): void {
  if (!activate) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('a,button,input,select,textarea,[role="button"]')) {
    // Nested control handles its own keyboard; do not double-fire.
    if (target !== event.currentTarget) return;
  }
  event.preventDefault();
  activate();
}

export function stopCardActivatePropagation(
  event: MouseEvent | KeyboardEvent,
): void {
  event.stopPropagation();
}
