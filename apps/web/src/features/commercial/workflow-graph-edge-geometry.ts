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

function onCardBoundary(r: Rect, x: number, y: number, tol = 1.5): boolean {
  const onTop = Math.abs(y - r.top) <= tol && x >= r.left - tol && x <= r.right + tol;
  const onBottom = Math.abs(y - r.bottom) <= tol && x >= r.left - tol && x <= r.right + tol;
  return onTop || onBottom;
}

function inCardInterior(r: Rect, x: number, y: number, margin = 1): boolean {
  return x > r.left + margin && x < r.right - margin && y > r.top + margin && y < r.bottom - margin;
}

/** True if a sampled point lies strictly inside a card that this edge does not connect. */
export function pointViolatesEdgeCard(
  point: { x: number; y: number },
  card: Rect,
  sourceRect: Rect,
  targetRect: Rect,
): boolean {
  if (!inCardInterior(card, point.x, point.y)) return false;
  if (
    onCardBoundary(sourceRect, point.x, point.y) ||
    onCardBoundary(targetRect, point.x, point.y)
  ) {
    return false;
  }
  return true;
}

function orient(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function onSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
) {
  return (
    Math.min(a.x, c.x) - 1e-6 <= b.x &&
    b.x <= Math.max(a.x, c.x) + 1e-6 &&
    Math.min(a.y, c.y) - 1e-6 <= b.y &&
    b.y <= Math.max(a.y, c.y) + 1e-6
  );
}

export function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);
  if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) return false;
  if (o1 === 0 && onSegment(p1, p3, p2)) return false;
  if (o2 === 0 && onSegment(p1, p4, p2)) return false;
  if (o3 === 0 && onSegment(p3, p1, p4)) return false;
  if (o4 === 0 && onSegment(p3, p2, p4)) return false;
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

export function polylineSegments(
  points: { x: number; y: number }[],
): [(typeof points)[0], (typeof points)[0]][] {
  const segs: [(typeof points)[0], (typeof points)[0]][] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    segs.push([points[i]!, points[i + 1]!]);
  }
  return segs;
}

function segmentsProperlyCross(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean {
  return segmentsIntersect(a1, a2, b1, b2);
}

export function countEdgeEdgeCrossings(paths: string[]): number {
  const allSegs = paths.map((d) => polylineSegments(samplePathPoints(d, 12)));
  let crossings = 0;
  for (let i = 0; i < allSegs.length; i += 1) {
    for (let j = i + 1; j < allSegs.length; j += 1) {
      const a = allSegs[i]!;
      const b = allSegs[j]!;
      let crossed = false;
      for (const [a1, a2] of a) {
        for (const [b1, b2] of b) {
          if (segmentsProperlyCross(a1, a2, b1, b2)) {
            crossed = true;
            break;
          }
        }
        if (crossed) break;
      }
      if (crossed) crossings += 1;
    }
  }
  return crossings;
}

/** Assert every path uses only axis-aligned segments (orthogonal routing). */
export function countNonOrthogonalSegments(paths: string[]): number {
  let bad = 0;
  for (const d of paths) {
    const pts = samplePathPoints(d, 4);
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01) bad += 1;
    }
  }
  return bad;
}
