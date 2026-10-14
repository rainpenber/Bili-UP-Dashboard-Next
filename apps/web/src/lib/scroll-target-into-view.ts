/** Retry scroll until element exists (e.g. after async project load). */
export function scrollTargetIntoView(elementId: string, opts?: { maxAttempts?: number }) {
  const max = opts?.maxAttempts ?? 40;
  let attempt = 0;
  const tick = () => {
    if (attempt >= max) return;
    attempt += 1;
    const el = document.getElementById(elementId);
    if (!el) {
      requestAnimationFrame(tick);
      return;
    }
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  };
  requestAnimationFrame(tick);
}
