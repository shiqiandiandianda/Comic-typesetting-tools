import { describe, expect, it } from "vitest";
import {
  deduplicateDetections,
  mapDetection,
  type DetectedPanel,
} from "../src/features/detection";

function panel(
  x: number,
  y: number,
  width: number,
  height: number,
  score = 0.8,
): DetectedPanel {
  return { bbox: { x, y, width, height }, score };
}

describe("deduplicateDetections", () => {
  it("keeps the more confident contour of a double border without changing the input", () => {
    const outer = panel(10, 10, 100, 100, 0.6);
    const inner = panel(13, 13, 94, 94, 0.95);
    const candidates = [outer, inner];
    const before = structuredClone(candidates);

    expect(deduplicateDetections(candidates)).toEqual([inner]);
    expect(candidates).toEqual(before);
  });

  it("compares all four edges, rather than just the origin", () => {
    const large = panel(10, 10, 100, 100);
    const inset = panel(10, 10, 50, 50);

    expect(deduplicateDetections([large, inset])).toHaveLength(2);
  });

  it("merges very similar large contours whose edge differences exceed pixel tolerance", () => {
    const first = panel(0, 0, 1000, 1000, 0.7);
    const second = panel(10, 10, 1000, 1000, 0.9);

    expect(deduplicateDetections([first, second])).toEqual([second]);
  });

  it("retains genuinely nested and overlapping panels", () => {
    const outer = panel(0, 0, 100, 100);
    const inner = panel(10, 10, 80, 80);
    const overlap = panel(50, 20, 100, 100);

    expect(deduplicateDetections([overlap, inner, outer])).toEqual([
      outer,
      inner,
      overlap,
    ]);
  });

  it("retains nested large contours with materially different area even at high IoU", () => {
    const outer = panel(0, 0, 1000, 1000);
    const inner = panel(15, 15, 970, 970);

    expect(deduplicateDetections([outer, inner])).toHaveLength(2);
  });

  it("uses the requested pixel tolerance and sorts rows before columns", () => {
    const topRight = panel(200, 10, 100, 100);
    const topLeft = panel(10, 10, 100, 100);
    const lower = panel(0, 200, 100, 100);
    const close = panel(13, 13, 94, 94, 0.7);

    expect(deduplicateDetections([lower, topRight, close, topLeft], 2)).toEqual(
      [topLeft, topRight, close, lower],
    );
  });

  it("does not transitively collapse a chain of nearby panels", () => {
    const first = panel(0, 0, 30, 30, 0.9);
    const middle = panel(4, 0, 30, 30, 0.8);
    const last = panel(8, 0, 30, 30, 0.7);

    expect(deduplicateDetections([middle, last, first])).toEqual([first, last]);
  });

  it("handles an empty list and rejects invalid tolerance", () => {
    expect(deduplicateDetections([])).toEqual([]);
    expect(() => deduplicateDetections([], -1)).toThrow(RangeError);
    expect(() => deduplicateDetections([], Number.NaN)).toThrow(RangeError);
  });
});

describe("mapDetection", () => {
  it("scales the bounding box and polygon into original-image coordinates", () => {
    const candidate: DetectedPanel = {
      ...panel(3, 5, 20, 30, 0.87),
      points: [
        { x: 3, y: 5 },
        { x: 23, y: 6 },
        { x: 21, y: 35 },
      ],
    };
    const before = structuredClone(candidate);

    expect(mapDetection(candidate, 2.5)).toEqual({
      bbox: { x: 7.5, y: 12.5, width: 50, height: 75 },
      score: 0.87,
      points: [
        { x: 7.5, y: 12.5 },
        { x: 57.5, y: 15 },
        { x: 52.5, y: 87.5 },
      ],
    });
    expect(candidate).toEqual(before);
  });

  it("preserves rectangle candidates without adding a polygon", () => {
    const candidate = panel(1, 2, 3, 4);
    const mapped = mapDetection(candidate, 1);

    expect(mapped).toEqual(candidate);
    expect(mapped).not.toBe(candidate);
    expect(mapped.bbox).not.toBe(candidate.bbox);
    expect(mapped).not.toHaveProperty("points");
  });

  it("rejects invalid mapping scales", () => {
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => mapDetection(panel(0, 0, 10, 10), scale)).toThrow(
        RangeError,
      );
    }
  });
});
