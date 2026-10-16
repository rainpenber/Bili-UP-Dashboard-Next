export type OverlapBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: boolean;
};

const PASSES = 12;

function overlaps(a: OverlapBox, b: OverlapBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Push `mover` fully outside `fixed`, leaving `gap`. Returns whether it moved. */
function clearOf(mover: OverlapBox, fixed: OverlapBox, gap: number): boolean {
  if (!overlaps(mover, fixed)) return false;
  const vertical =
    mover.y + mover.h / 2 >= fixed.y + fixed.h / 2
      ? fixed.y + fixed.h + gap - mover.y
      : mover.y + mover.h - (fixed.y - gap);
  const horizontal =
    mover.x + mover.w / 2 >= fixed.x + fixed.w / 2
      ? fixed.x + fixed.w + gap - mover.x
      : mover.x + mover.w - (fixed.x - gap);
  if (vertical <= horizontal) {
    mover.y += mover.y + mover.h / 2 >= fixed.y + fixed.h / 2 ? vertical : -vertical;
  } else {
    mover.x += mover.x + mover.w / 2 >= fixed.x + fixed.w / 2 ? horizontal : -horizontal;
  }
  return true;
}

/**
 * Offsets that move non-anchor boxes out of anchors (and out of each other).
 * Anchors stay put. Deltas are relative to the input coordinates.
 */
export function nudgeOverlaps(
  boxes: OverlapBox[],
  gap = 14,
): Record<string, { x: number; y: number }> {
  const work = boxes.map((box) => ({ ...box }));
  const origin = new Map(boxes.map((box) => [box.id, { x: box.x, y: box.y }]));
  for (let pass = 0; pass < PASSES; pass += 1) {
    let moved = false;
    for (let i = 0; i < work.length; i += 1) {
      for (let j = i + 1; j < work.length; j += 1) {
        const a = work[i]!;
        const b = work[j]!;
        if (!overlaps(a, b)) continue;
        if (a.anchor && b.anchor) continue;
        if (a.anchor) moved = clearOf(b, a, gap) || moved;
        else if (b.anchor) moved = clearOf(a, b, gap) || moved;
        else moved = clearOf(a, b, gap) || moved;
      }
    }
    if (!moved) break;
  }
  const nudge: Record<string, { x: number; y: number }> = {};
  for (const box of work) {
    const start = origin.get(box.id)!;
    const x = box.x - start.x;
    const y = box.y - start.y;
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) nudge[box.id] = { x, y };
  }
  return nudge;
}
