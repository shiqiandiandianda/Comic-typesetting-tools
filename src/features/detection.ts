/** A detected candidate in either the working image or original image coordinates. */
export interface DetectedPanel {
  bbox: { x: number; y: number; width: number; height: number };
  score: number;
  points?: { x: number; y: number }[];
}

function area(panel: DetectedPanel): number {
  return Math.max(0, panel.bbox.width) * Math.max(0, panel.bbox.height);
}

function isDuplicate(
  a: DetectedPanel,
  b: DetectedPanel,
  tolerance: number,
): boolean {
  const first = a.bbox;
  const second = b.bbox;
  const edgesMatch =
    Math.abs(first.x - second.x) <= tolerance &&
    Math.abs(first.y - second.y) <= tolerance &&
    Math.abs(first.x + first.width - second.x - second.width) <= tolerance &&
    Math.abs(first.y + first.height - second.y - second.height) <= tolerance;

  if (edgesMatch) return true;

  const firstArea = area(a);
  const secondArea = area(b);
  if (firstArea === 0 || secondArea === 0) return false;

  const intersectionWidth = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) -
      Math.max(first.x, second.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) -
      Math.max(first.y, second.y),
  );
  const intersection = intersectionWidth * intersectionHeight;
  const intersectionOverUnion =
    intersection / (firstArea + secondArea - intersection);
  const areaRatio =
    Math.min(firstArea, secondArea) / Math.max(firstArea, secondArea);

  // Double border contours can move by several pixels on a large image. The
  // area check keeps a materially smaller inset panel as a separate candidate.
  return intersectionOverUnion > 0.92 && areaRatio >= 0.95;
}

/**
 * Remove near-identical border contours, keeping the strongest detection.
 * Genuine inset and partially overlapping panels remain independent candidates.
 * Candidates are returned in top-to-bottom, then left-to-right order.
 */
export function deduplicateDetections(
  panels: readonly DetectedPanel[],
  tolerance = 4,
): DetectedPanel[] {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError(
      "Detection tolerance must be a finite non-negative number.",
    );
  }

  const strongestFirst = [...panels].sort(
    (a, b) => b.score - a.score || area(b) - area(a),
  );
  const retained: DetectedPanel[] = [];

  for (const panel of strongestFirst) {
    if (!retained.some((existing) => isDuplicate(panel, existing, tolerance))) {
      retained.push(panel);
    }
  }

  return retained.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
}

/** Scale working-image coordinates by originalSize / workingSize. */
export function mapDetection(
  panel: DetectedPanel,
  scale: number,
): DetectedPanel {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("Detection scale must be a finite positive number.");
  }

  const mapped: DetectedPanel = {
    bbox: {
      x: panel.bbox.x * scale,
      y: panel.bbox.y * scale,
      width: panel.bbox.width * scale,
      height: panel.bbox.height * scale,
    },
    score: panel.score,
  };

  if (panel.points) {
    mapped.points = panel.points.map(({ x, y }) => ({
      x: x * scale,
      y: y * scale,
    }));
  }

  return mapped;
}
