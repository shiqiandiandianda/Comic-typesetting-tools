import { describe, expect, it } from "vitest";
import {
  ActiveSelection,
  Point,
  Polygon,
  Rect,
  util,
  type TMat2D,
  type Transform,
} from "fabric";
import type { PolygonPanel, RectPanel } from "../core/document";
import {
  changePanel,
  makePanel,
  MAX_PREVIEW_PIXELS,
  MAX_PREVIEW_SIDE,
  pointAt,
  previewDimensions,
} from "./fabricGeometry";

const rectangle = (strokeWidth = 4): RectPanel => ({
  id: "P01",
  type: "rect",
  z: 10,
  bbox: { x: 100, y: 50, width: 300, height: 200 },
  style: { fill: "#FFFFFF", stroke: "#E86536", strokeWidth },
  source: { method: "opencv", reviewStatus: "pending" },
});
const polygon = (): PolygonPanel => ({
  id: "P02",
  type: "polygon",
  z: 20,
  points: [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 300 },
    { x: 100, y: 300 },
  ],
  style: { fill: "#FFFFFF", stroke: "#E86536", strokeWidth: 4 },
});
const vertexTransform = (object: Polygon): Transform => ({
  target: object,
  corner: "p1",
  action: "modifyPoly",
  scaleX: object.scaleX,
  scaleY: object.scaleY,
  skewX: object.skewX,
  skewY: object.skewY,
  offsetX: 0,
  offsetY: 0,
  originX: object.originX,
  originY: object.originY,
  ex: 0,
  ey: 0,
  lastX: 0,
  lastY: 0,
  theta: 0,
  width: object.width,
  height: object.height,
  shiftKey: false,
  altKey: false,
  original: {
    ...util.saveObjectTransform(object),
    originX: object.originX,
    originY: object.originY,
  },
  actionPerformed: false,
});

describe("Fabric adapter document geometry", () => {
  it.each([
    { width: 100_000, height: 50, zoom: 1, dpr: 1 },
    { width: 1280, height: 30_000, zoom: 2, dpr: 2 },
    { width: 30_000, height: 1280, zoom: 2, dpr: 2 },
    { width: 32_767, height: 32_767, zoom: 2, dpr: 3 },
    { width: 1_000_000_000, height: 50, zoom: 0.001, dpr: 2 },
  ])(
    "caps the backing dimensions of $width × $height at $zoom × on DPR $dpr",
    ({ width, height, zoom, dpr }) => {
      const result = previewDimensions({ width, height }, zoom, dpr);
      expect(result.zoom).toBeGreaterThan(0);
      expect(result.zoom).toBeLessThanOrEqual(zoom);
      expect(result.backingWidth).toBeLessThanOrEqual(MAX_PREVIEW_SIDE);
      expect(result.backingHeight).toBeLessThanOrEqual(MAX_PREVIEW_SIDE);
      expect(result.backingWidth * result.backingHeight).toBeLessThanOrEqual(
        MAX_PREVIEW_PIXELS,
      );
      if (width === 1_000_000_000) expect(result.zoom).toBeLessThan(0.001);
    },
  );

  it("keeps Retina only when both physical sides and area fit the budget", () => {
    expect(previewDimensions({ width: 800, height: 1000 }, 1, 2).retina).toBe(
      true,
    );
    expect(previewDimensions({ width: 9000, height: 10 }, 1, 2).retina).toBe(
      false,
    );
    expect(previewDimensions({ width: 3000, height: 3000 }, 1, 2).retina).toBe(
      false,
    );
  });

  it.each([0, 4, 20])(
    "keeps nominal bounds independent of a %i px stroke",
    (strokeWidth) => {
      const authored = rectangle(strokeWidth);
      const object = makePanel(authored) as Rect;
      expect(object.originX).toBe("left");
      expect(object.originY).toBe("top");
      expect(
        pointAt(
          { x: -object.width / 2, y: -object.height / 2 },
          object.calcTransformMatrix(),
        ),
      ).toEqual({ x: authored.bbox.x, y: authored.bbox.y });
    },
  );

  it("normalizes an object transform without scaling its authored stroke", () => {
    const authored = rectangle(20);
    const object = makePanel(authored);
    const initial = object.calcTransformMatrix();
    const desired: TMat2D = [2, 0, 0, 1.5, 40, -10];
    util.applyTransformToObject(
      object,
      util.multiplyTransformMatrices(desired, initial),
    );
    const delta = util.multiplyTransformMatrices(
      object.calcTransformMatrix(),
      util.invertTransform(initial),
    );
    const result = changePanel(authored, delta) as RectPanel;
    expect(result.bbox).toEqual({ x: 240, y: 65, width: 600, height: 300 });
    expect(result.style.strokeWidth).toBe(20);
    expect(result.source?.reviewStatus).toBe("edited");
    expect(authored.bbox.x).toBe(100);
  });

  it("includes the ActiveSelection transform in each child scene matrix", () => {
    const first = rectangle();
    const second = {
      ...rectangle(),
      id: "P02",
      bbox: { x: 500, y: 50, width: 100, height: 100 },
    };
    const objects = [makePanel(first), makePanel(second)];
    const before = objects.map((object) => object.calcTransformMatrix());
    const selection = new ActiveSelection(objects, {
      originX: "left",
      originY: "top",
    });
    selection.set({ left: selection.left + 60, top: selection.top + 30 });
    for (const [index, authored] of [first, second].entries()) {
      const delta = util.multiplyTransformMatrices(
        objects[index].calcTransformMatrix(),
        util.invertTransform(before[index]),
      );
      expect((changePanel(authored, delta) as RectPanel).bbox).toEqual({
        ...authored.bbox,
        x: authored.bbox.x + 60,
        y: authored.bbox.y + 30,
      });
    }
  });

  it("copies polygon points so vertex editing cannot mutate the document", () => {
    const authored = polygon();
    const object = makePanel(authored) as Polygon;
    object.points[0].x = 999;
    expect(authored.points[0].x).toBe(100);
  });

  it("retains authored polygon coordinates across pathOffset compensation", () => {
    const authored = polygon();
    const object = makePanel(authored) as Polygon;
    const points = object.points.map((point) =>
      new Point(point).subtract(object.pathOffset),
    );
    expect(
      points.map((point) => pointAt(point, object.calcTransformMatrix())),
    ).toEqual(authored.points);
    expect(Object.keys(object.controls)).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("rejects a vertex move that creates intersecting edges", () => {
    const authored = polygon();
    const object = makePanel(authored) as Polygon;
    const before = object.points.map((point) => ({ ...point }));
    const action = object.controls.p1.actionHandler;
    expect(action({} as MouseEvent, vertexTransform(object), 50, 250)).toBe(
      false,
    );
    expect(object.points).toEqual(before);
  });

  it("snaps an accepted polygon vertex to authored grid coordinates", () => {
    const object = makePanel(polygon(), 20) as Polygon;
    const action = object.controls.p1.actionHandler;
    expect(action({} as MouseEvent, vertexTransform(object), 333, 101)).toBe(
      true,
    );
    const point = new Point(object.points[1]).subtract(object.pathOffset);
    expect(pointAt(point, object.calcTransformMatrix())).toEqual({
      x: 340,
      y: 100,
    });
  });
});
