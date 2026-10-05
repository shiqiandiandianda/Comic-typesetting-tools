import { describe, expect, it } from "vitest";
import {
  createExampleDocument,
  type DimensionAnnotation,
  type Panel,
} from "./document";
import {
  bboxFromPoints,
  dimensionValue,
  panelBounds,
  panelGap,
  polygonArea,
  polygonIsSimple,
  snapPoint,
  transformPoint,
} from "./geometry";

describe("canvas pixel geometry", () => {
  it("matches P02 documented dimensions and stroke-independent bounds", () => {
    const panel = createExampleDocument().panels[1];
    const bbox = panelBounds(panel);
    expect(bbox).toEqual({ x: 291, y: 1548, width: 951, height: 756 });
    expect(bbox.x + bbox.width).toBe(1242);
    expect(bbox.y + bbox.height).toBe(2304);
    bbox.x = 0;
    expect(panelBounds(panel).x).toBe(291);
  });

  it("calculates true polygon bounds and signed area without rounding", () => {
    const panel: Panel = {
      id: "P01",
      type: "polygon",
      points: [
        { x: -4.25, y: 8 },
        { x: 12.5, y: 3 },
        { x: 20, y: 30 },
        { x: 0, y: 25 },
      ],
      z: 10,
      style: { fill: "transparent", stroke: "#000000", strokeWidth: 1 },
    };
    expect(panelBounds(panel)).toEqual({
      x: -4.25,
      y: 3,
      width: 24.25,
      height: 27,
    });
    expect(
      polygonArea([
        { x: 1e9, y: 1e9 },
        { x: 1e9 + 10, y: 1e9 },
        { x: 1e9, y: 1e9 + 10 },
      ]),
    ).toBe(50);
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ]),
    ).toBe(-50);
  });

  it("accepts simple closed polygons and catches nonadjacent contact and overlap", () => {
    const rectangle = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonIsSimple([...rectangle, rectangle[0]])).toBe(true);
    expect(
      polygonIsSimple([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ]),
    ).toBe(false);
    expect(
      polygonIsSimple([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 10 },
      ]),
    ).toBe(false);
  });

  it("transforms global coordinates and preserves fractions", () => {
    expect(
      transformPoint(
        { x: 15, y: 35 },
        { x: 10, y: 20, width: 20, height: 30 },
        { x: 100, y: 200, width: 60, height: 60 },
      ),
    ).toEqual({ x: 115, y: 230 });
    expect(bboxFromPoints({ x: 8.25, y: 20 }, { x: -2, y: 10 })).toEqual({
      x: -2,
      y: 10,
      width: 10.25,
      height: 10,
    });
    expect(snapPoint({ x: 31, y: -9 }, 16)).toEqual({ x: 32, y: -16 });
  });

  it("derives dimensions from endpoints for all measurement modes", () => {
    const dimension: DimensionAnnotation = {
      id: "D01",
      type: "dimension",
      start: { x: 10, y: 10 },
      end: { x: 13, y: 14 },
      mode: "distance",
      color: "#000000",
      z: 200,
    };
    expect(dimensionValue(dimension)).toBe(5);
    expect(dimensionValue({ ...dimension, mode: "horizontal" })).toBe(3);
    expect(dimensionValue({ ...dimension, mode: "vertical" })).toBe(4);
  });

  it("measures symmetric axis gaps and actual overlap, including containment and edge contact", () => {
    const base = createExampleDocument().panels[1];
    const a: Panel = {
      ...base,
      type: "rect",
      bbox: { x: 0, y: 0, width: 100, height: 100 },
    };
    const separated: Panel = {
      ...base,
      type: "rect",
      bbox: { x: 120, y: 150, width: 50, height: 50 },
    };
    expect(panelGap(a, separated)).toEqual({ gapX: 20, gapY: 50 });
    expect(panelGap(separated, a)).toEqual(panelGap(a, separated));
    const overlap: Panel = {
      ...base,
      type: "rect",
      bbox: { x: 75, y: 80, width: 100, height: 100 },
    };
    expect(panelGap(a, overlap)).toEqual({ gapX: -25, gapY: -20 });
    const contained: Panel = {
      ...base,
      type: "rect",
      bbox: { x: 30, y: 40, width: 20, height: 10 },
    };
    expect(panelGap(a, contained)).toEqual({ gapX: -20, gapY: -10 });
    const touching: Panel = {
      ...base,
      type: "rect",
      bbox: { x: 100, y: 100, width: 30, height: 40 },
    };
    expect(panelGap(a, touching)).toEqual({ gapX: 0, gapY: 0 });
  });
});
