import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createExampleDocument,
  validateDocument,
  type TextAnnotation,
} from "./document";
import {
  createAnnotation,
  createPanel,
  createPolygonPanel,
  deletePanels,
  duplicatePanels,
  movePanels,
  resizePanel,
  setReadOrder,
  updatePanel,
} from "./commands";
import { panelBounds } from "./geometry";

describe("immutable editing commands", () => {
  it("creates validated panels without retaining caller-owned geometry", () => {
    const empty = createEmptyDocument();
    const bbox = { x: -5, y: 20.5, width: 100, height: 200 };
    const document = createPanel(empty, bbox);
    bbox.x = 999;
    expect(empty.panels).toHaveLength(0);
    expect(panelBounds(document.panels[0]).x).toBe(-5);
    expect(validateDocument(document).valid).toBe(true);
    expect(() =>
      createPanel(empty, { x: 0, y: 0, width: 0, height: 10 }),
    ).toThrow(RangeError);
  });

  it("moves multiple panels once, respects locks and follows all annotation types", () => {
    const original = createExampleDocument();
    original.annotations.push({
      id: "A01",
      type: "arrow",
      start: { x: 10, y: 20 },
      end: { x: 30, y: 40 },
      panelId: "P02",
      followPanel: true,
      color: "#000000",
      strokeWidth: 2,
      z: 201,
    });
    original.annotations.push({
      id: "B04",
      type: "text",
      x: 10,
      y: 20,
      text: "独立标注",
      fontSize: 12,
      color: "#000000",
      z: 202,
      panelId: "P02",
      followPanel: false,
    });
    const originalText = JSON.stringify(original);
    const moved = movePanels(original, ["P01", "P02", "P02", "P03"], 100, 20);
    expect(JSON.stringify(original)).toBe(originalText);
    expect(moved.panels[0]).toBe(original.panels[0]);
    expect(panelBounds(moved.panels[1])).toEqual({
      x: 391,
      y: 1568,
      width: 951,
      height: 756,
    });
    expect(moved.annotations[1]).toMatchObject({
      x: 406,
      y: 2238,
      fontSize: 46,
    });
    expect(moved.annotations[3]).toMatchObject({
      start: { x: 391, y: 1530 },
      end: { x: 1342, y: 1530 },
    });
    expect(moved.annotations[4]).toMatchObject({
      start: { x: 110, y: 40 },
      end: { x: 130, y: 60 },
    });
    expect(moved.annotations[5]).toBe(original.annotations[5]);
    expect(validateDocument(moved).valid).toBe(true);
  });

  it("scales following positions and endpoints without scaling typography", () => {
    let document = createPanel(createEmptyDocument(), {
      x: 10,
      y: 20,
      width: 100,
      height: 100,
    });
    document = createAnnotation(document, {
      type: "text",
      x: 35,
      y: 70,
      text: "Test",
      fontSize: 24,
      color: "#000000",
      z: 100,
      panelId: "P01",
      followPanel: true,
    });
    document = createAnnotation(document, {
      type: "dimension",
      start: { x: 10, y: 10 },
      end: { x: 110, y: 10 },
      mode: "horizontal",
      color: "#000000",
      z: 200,
      panelId: "P01",
      followPanel: true,
    });
    const resized = resizePanel(document, "P01", {
      x: 20,
      y: 40,
      width: 200,
      height: 50,
    });
    expect(resized.annotations[0]).toMatchObject({
      x: 70,
      y: 65,
      fontSize: 24,
    });
    expect(resized.annotations[1]).toMatchObject({
      start: { x: 20, y: 35 },
      end: { x: 220, y: 35 },
    });
    expect((document.annotations[0] as TextAnnotation).fontSize).toBe(24);
  });

  it("transforms polygon points and follows their derived bounds", () => {
    const document = createPolygonPanel(createEmptyDocument(), [
      { x: 10, y: 20 },
      { x: 20, y: 25 },
      { x: 10, y: 40 },
    ]);
    const resized = resizePanel(document, "P01", {
      x: 30,
      y: 50,
      width: 20,
      height: 60,
    });
    expect(resized.panels[0]).toMatchObject({
      points: [
        { x: 30, y: 50 },
        { x: 50, y: 65 },
        { x: 30, y: 110 },
      ],
    });
    expect(panelBounds(resized.panels[0])).toEqual({
      x: 30,
      y: 50,
      width: 20,
      height: 60,
    });
    expect(validateDocument(resized).valid).toBe(true);
  });

  it("changing reading order does not change z or array order", () => {
    const original = createExampleDocument();
    const reordered = setReadOrder(original, "P02", 8);
    expect(reordered.panels.map((panel) => [panel.id, panel.z])).toEqual(
      original.panels.map((panel) => [panel.id, panel.z]),
    );
    expect(reordered.panels[1].readOrder).toBe(8);
    expect(original.panels[1].readOrder).toBe(2);
  });

  it("protects locked geometry and permits explicitly unlocking", () => {
    const original = createExampleDocument();
    expect(
      resizePanel(original, "P01", { x: 20, y: 20, width: 10, height: 10 }),
    ).toBe(original);
    expect(updatePanel(original, "P01", { style: { strokeWidth: 10 } })).toBe(
      original,
    );
    expect(deletePanels(original, ["P01"])).toBe(original);
    const unlocked = updatePanel(original, "P01", { locked: false });
    expect(panelBounds(movePanels(unlocked, ["P01"], 1, 1).panels[0]).x).toBe(
      1,
    );
  });

  it("deletion retains independent annotations by default and can delete associated annotations", () => {
    const original = createExampleDocument();
    const kept = deletePanels(original, ["P02"]);
    expect(kept.panels.some((panel) => panel.id === "P02")).toBe(false);
    expect(kept.annotations).toHaveLength(4);
    expect(kept.annotations[1]).not.toHaveProperty("panelId");
    expect(kept.annotations[1]).not.toHaveProperty("followPanel");
    expect(validateDocument(kept).valid).toBe(true);
    const deleted = deletePanels(original, ["P02"], { annotations: "delete" });
    expect(deleted.annotations.map((annotation) => annotation.id)).toEqual([
      "B01",
      "B03",
    ]);
  });

  it("duplicates panels and followers with fresh IDs and without changing originals", () => {
    const original = createExampleDocument();
    const duplicated = duplicatePanels(original, ["P02"]);
    expect(duplicated.panels).toHaveLength(4);
    expect(duplicated.annotations).toHaveLength(6);
    const copy = duplicated.panels[3];
    expect(copy.id).toBe("P04");
    expect(panelBounds(copy)).toEqual({
      x: 315,
      y: 1572,
      width: 951,
      height: 756,
    });
    expect(duplicated.annotations[4]).toMatchObject({
      panelId: "P04",
      x: 330,
      y: 2242,
    });
    expect(duplicated.panels[1]).toBe(original.panels[1]);
    expect(validateDocument(duplicated).valid).toBe(true);
  });
});
