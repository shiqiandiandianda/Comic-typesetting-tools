import { describe, expect, it } from "vitest";
import { resizeCanvas } from "./canvas";
import {
  createEmptyDocument,
  createExampleDocument,
  type GridDocument,
} from "./document";

describe("canvas resize command", () => {
  it("retains all object geometry by default and does not mutate the document", () => {
    const original = createExampleDocument();
    const before = JSON.stringify(original);
    const resized = resizeCanvas(original, 2000, 3000);
    expect(resized.canvas).toMatchObject({ width: 2000, height: 3000 });
    expect(resized.panels).toBe(original.panels);
    expect(resized.annotations).toBe(original.annotations);
    expect(resized.referenceImage).toBe(original.referenceImage);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("scales both axes, locked panels, polygon points, annotations and reference bounds but preserves typography", () => {
    const document: GridDocument = {
      ...createEmptyDocument(),
      canvas: { width: 100, height: 200, backgroundColor: "#FFFFFF" },
      assets: [
        {
          id: "IMG01",
          mimeType: "image/png",
          width: 100,
          height: 200,
          source: { type: "relative-file", path: "assets/reference.png" },
        },
      ],
      referenceImage: {
        assetId: "IMG01",
        bbox: { x: 10, y: 20, width: 80, height: 160 },
        opacity: 0.5,
        visible: true,
        locked: true,
        exportable: true,
      },
      panels: [
        {
          id: "P01",
          type: "rect",
          bbox: { x: -5, y: 20, width: 40, height: 100 },
          locked: true,
          z: 30,
          readOrder: 2,
          style: { fill: "transparent", stroke: "#000000", strokeWidth: 2 },
        },
        {
          id: "P02",
          type: "polygon",
          points: [
            { x: 20, y: 30 },
            { x: 40, y: 30 },
            { x: 30, y: 70 },
          ],
          z: 10,
          readOrder: 1,
          style: { fill: "transparent", stroke: "#000000", strokeWidth: 2 },
        },
      ],
      annotations: [
        {
          id: "B01",
          type: "text",
          x: 10,
          y: 50,
          text: "字号保持",
          fontSize: 24,
          color: "#000000",
          z: 100,
          panelId: "P01",
          followPanel: true,
        },
        {
          id: "D01",
          type: "dimension",
          start: { x: 10, y: 20 },
          end: { x: 40, y: 80 },
          mode: "distance",
          z: 200,
          color: "#000000",
        },
        {
          id: "A01",
          type: "arrow",
          start: { x: 30, y: 40 },
          end: { x: 50, y: 60 },
          strokeWidth: 3,
          z: 201,
          color: "#000000",
          panelId: "P02",
          followPanel: true,
        },
      ],
    };
    const resized = resizeCanvas(document, 200, 100, { scaleObjects: true });
    expect(resized.panels[0]).toMatchObject({
      bbox: { x: -10, y: 10, width: 80, height: 50 },
      locked: true,
      z: 30,
      readOrder: 2,
    });
    expect(resized.panels[1]).toMatchObject({
      points: [
        { x: 40, y: 15 },
        { x: 80, y: 15 },
        { x: 60, y: 35 },
      ],
      z: 10,
      readOrder: 1,
    });
    expect(resized.annotations[0]).toMatchObject({
      x: 20,
      y: 25,
      fontSize: 24,
      z: 100,
    });
    expect(resized.annotations[1]).toMatchObject({
      start: { x: 20, y: 10 },
      end: { x: 80, y: 40 },
    });
    expect(resized.annotations[2]).toMatchObject({
      start: { x: 60, y: 20 },
      end: { x: 100, y: 30 },
      strokeWidth: 3,
    });
    expect(resized.referenceImage).toMatchObject({
      bbox: { x: 20, y: 10, width: 160, height: 80 },
      opacity: 0.5,
      locked: true,
    });
    expect(document.panels[0]).toMatchObject({
      bbox: { x: -5, y: 20, width: 40, height: 100 },
    });
  });

  it("rejects zero, negative, fractional and nonfinite canvas sizes", () => {
    const document = createEmptyDocument();
    for (const invalid of [0, -1, 0.5, NaN, Infinity, -Infinity]) {
      expect(() => resizeCanvas(document, invalid, 100)).toThrow(RangeError);
      expect(() =>
        resizeCanvas(document, 100, invalid, { scaleObjects: true }),
      ).toThrow(RangeError);
    }
  });
});
