import type { BBox, DimensionAnnotation, Panel, Point } from "./document";

/** Bounds describe geometry only; a centered stroke is not part of the bbox. */
export function panelBounds(panel: Panel): BBox {
  if (panel.type === "rect") return { ...panel.bbox };
  const first = panel.points[0];
  if (!first) throw new RangeError("多边形至少需要一个顶点。");
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const point of panel.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Signed shoelace area, shifted to the first point to reduce cancellation. */
export function polygonArea(points: readonly Point[]): number {
  const first = points[0];
  if (!first || points.length < 3) return 0;
  let doubleArea = 0;
  for (let i = 1; i < points.length - 1; i++) {
    doubleArea += cross(first, points[i], points[i + 1]);
  }
  return doubleArea / 2;
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    cross(a, b, p) === 0 &&
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (
    abC > 0 !== abD > 0 &&
    cdA > 0 !== cdB > 0 &&
    abC !== 0 &&
    abD !== 0 &&
    cdA !== 0 &&
    cdB !== 0
  )
    return true;
  return (
    (abC === 0 && onSegment(a, b, c)) ||
    (abD === 0 && onSegment(a, b, d)) ||
    (cdA === 0 && onSegment(c, d, a)) ||
    (cdB === 0 && onSegment(c, d, b))
  );
}

/** Closed last points are accepted; touching nonadjacent edges are rejected. */
export function polygonIsSimple(input: readonly Point[]): boolean {
  const points =
    input.length > 1 && samePoint(input[0], input[input.length - 1])
      ? input.slice(0, -1)
      : input;
  if (points.length < 3) return false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (samePoint(a, b)) return false;
    // Adjacent collinear edges that reverse direction overlap each other.
    const c = points[(i + 2) % points.length];
    if (
      cross(a, b, c) === 0 &&
      (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0
    )
      return false;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      if (segmentsIntersect(a, b, points[j], points[(j + 1) % points.length]))
        return false;
    }
  }
  return true;
}

export function transformPoint(point: Point, from: BBox, to: BBox): Point {
  return {
    x: to.x + (point.x - from.x) * (to.width / from.width),
    y: to.y + (point.y - from.y) * (to.height / from.height),
  };
}

export function dimensionValue(annotation: DimensionAnnotation): number {
  const dx = annotation.end.x - annotation.start.x;
  const dy = annotation.end.y - annotation.start.y;
  if (annotation.mode === "horizontal") return Math.abs(dx);
  if (annotation.mode === "vertical") return Math.abs(dy);
  return Math.hypot(dx, dy);
}

export function bboxFromPoints(a: Point, b: Point): BBox {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function isValidBBox(bbox: BBox): boolean {
  return (
    Object.values(bbox).every(Number.isFinite) &&
    bbox.width > 0 &&
    bbox.height > 0 &&
    Number.isFinite(bbox.x + bbox.width) &&
    Number.isFinite(bbox.y + bbox.height)
  );
}

export function snapPoint(point: Point, step: number): Point {
  if (!Number.isFinite(step) || step <= 0) return { ...point };
  return {
    x: Math.round(point.x / step) * step,
    y: Math.round(point.y / step) * step,
  };
}

/** Axis gaps between geometric bounds: positive separation, negative overlap. */
export function panelGap(a: Panel, b: Panel): { gapX: number; gapY: number } {
  const first = panelBounds(a);
  const second = panelBounds(b);
  return {
    gapX:
      Math.max(first.x, second.x) -
      Math.min(first.x + first.width, second.x + second.width),
    gapY:
      Math.max(first.y, second.y) -
      Math.min(first.y + first.height, second.y + second.height),
  };
}
