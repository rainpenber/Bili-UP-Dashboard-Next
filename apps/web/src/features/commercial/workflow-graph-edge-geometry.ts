/** Sample points along an SVG path `d` attribute (M/L/H/V/Q/C segments, simplified). */
export function samplePathPoints(d: string, samplesPerSegment = 8): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let cx = 0;
  let cy = 0;
  const tokens = d.match(/[MLHVCSQTAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return points;

  let i = 0;
  const readNum = () => parseFloat(tokens[i++]!);

  while (i < tokens.length) {
    const cmd = tokens[i]!;
    if (/^[MLHVCSQTAZ]$/i.test(cmd)) {
      i += 1;
      const upper = cmd.toUpperCase();
      if (upper === 'M') {
        cx = readNum();
        cy = readNum();
        points.push({ x: cx, y: cy });
      } else if (upper === 'L') {
        const x2 = readNum();
        const y2 = readNum();
        for (let s = 1; s <= samplesPerSegment; s += 1) {
          const t = s / samplesPerSegment;
          points.push({ x: cx + (x2 - cx) * t, y: cy + (y2 - cy) * t });
        }
        cx = x2;
        cy = y2;
      } else if (upper === 'H') {
        const x2 = readNum();
        for (let s = 1; s <= samplesPerSegment; s += 1) {
          const t = s / samplesPerSegment;
          points.push({ x: cx + (x2 - cx) * t, y: cy });
        }
        cx = x2;
      } else if (upper === 'V') {
        const y2 = readNum();
        for (let s = 1; s <= samplesPerSegment; s += 1) {
          const t = s / samplesPerSegment;
          points.push({ x: cx, y: cy + (y2 - cy) * t });
        }
        cy = y2;
      } else if (upper === 'C') {
        const x1 = readNum();
        const y1 = readNum();
        const x2 = readNum();
        const y2 = readNum();
        const x3 = readNum();
        const y3 = readNum();
        for (let s = 1; s <= samplesPerSegment; s += 1) {
          const t = s / samplesPerSegment;
          const u = 1 - t;
          points.push({
            x: u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            y: u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          });
        }
        cx = x3;
        cy = y3;
      } else if (upper === 'Z') {
        /* close */
      } else {
        break;
      }
    } else {
      i += 1;
    }
  }
  return points;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function rectContainsPoint(r: Rect, x: number, y: number, pad = 2): boolean {
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

/** True if point is inside rect but not allowed as endpoint touch for this edge. */
export function pointViolatesEdgeCard(
  point: { x: number; y: number },
  card: Rect,
  sourceRect: Rect,
  targetRect: Rect,
): boolean {
  if (!rectContainsPoint(card, point.x, point.y, 1)) return false;
  const touchesSource =
    rectContainsPoint(sourceRect, point.x, point.y, 4) ||
    rectContainsPoint(targetRect, point.x, point.y, 4);
  return !touchesSource;
}
