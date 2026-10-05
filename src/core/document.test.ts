import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createExampleDocument,
  DocumentValidationError,
  parseDocument,
  serializeDocument,
  validateDocument,
  type Asset,
  type Panel,
} from "./document";

describe("GridLens document validation", () => {
  it("accepts the documented example and returns independent instances", () => {
    const first = createExampleDocument();
    expect(validateDocument(first).valid).toBe(true);
    first.panels[0].label = "已修改";
    expect(createExampleDocument().panels[0].label).toBe("连续主景底层");
    expect(validateDocument(createEmptyDocument()).valid).toBe(true);
  });

  it("rejects malformed JSON and exposes actionable field errors", () => {
    expect(() => parseDocument("{not JSON}")).toThrow(DocumentValidationError);
    const document = createExampleDocument();
    document.canvas.width = -1;
    const result = validateDocument(document);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(
        result.errors.some((error) => error.path === "/canvas/width"),
      ).toBe(true);
    expect(() => parseDocument(JSON.stringify(document))).toThrow(
      DocumentValidationError,
    );
  });

  it("does not accept silent repairs, unknown fields or another schema version", () => {
    const document = createEmptyDocument();
    expect(
      validateDocument({ ...document, schemaVersion: "2.0.0" }).valid,
    ).toBe(false);
    expect(validateDocument({ ...document, unexpected: true }).valid).toBe(
      false,
    );
    expect(
      validateDocument({
        ...document,
        canvas: { ...document.canvas, width: "1280" },
      }).valid,
    ).toBe(false);
    expect(
      validateDocument({
        ...document,
        panels: [
          {
            ...createExampleDocument().panels[1],
            bbox: { x: 0, y: 0, width: 0, height: 20 },
          },
        ],
      }).valid,
    ).toBe(false);
  });

  it("checks unique IDs across every entity namespace", () => {
    const document = createExampleDocument();
    document.panels[1].id = document.panels[0].id;
    const result = validateDocument(document);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(
        result.errors.find((error) => error.path === "/panels/1/id"),
      ).toBeDefined();
    const crossNamespace = createExampleDocument();
    crossNamespace.annotations[0].id = crossNamespace.panels[0].id;
    expect(validateDocument(crossNamespace).valid).toBe(false);
  });

  it("rejects missing panel references, absent followPanel targets and missing image assets", () => {
    const document = createExampleDocument();
    document.annotations[0].panelId = "missing";
    expect(validateDocument(document).valid).toBe(false);
    const withoutTarget = createExampleDocument();
    delete withoutTarget.annotations[0].panelId;
    expect(validateDocument(withoutTarget).valid).toBe(false);
    const missingAsset = createEmptyDocument();
    missingAsset.referenceImage = {
      assetId: "missing",
      bbox: { x: 0, y: 0, width: 100, height: 100 },
      opacity: 1,
      visible: true,
      locked: true,
      exportable: false,
    };
    expect(validateDocument(missingAsset).valid).toBe(false);
  });

  it("accepts safe relative files and refuses traversal and MIME mismatches", () => {
    const document = createEmptyDocument();
    const asset: Asset = {
      id: "IMG01",
      mimeType: "image/png",
      width: 10,
      height: 10,
      source: { type: "relative-file", path: "assets/pages/page-01.png" },
    };
    document.assets = [asset];
    expect(validateDocument(document).valid).toBe(true);
    for (const path of [
      "assets/../secret.png",
      "assets/./page.png",
      "assets//page.png",
      "/etc/passwd",
      "https://example.com/page.png",
    ]) {
      document.assets = [{ ...asset, source: { type: "relative-file", path } }];
      expect(validateDocument(document).valid).toBe(false);
    }
    document.assets = [
      {
        ...asset,
        source: { type: "embedded", data: "data:image/jpeg;base64,aGVsbG8=" },
      },
    ];
    expect(validateDocument(document).valid).toBe(false);
  });

  it("rejects nonfinite numbers, overflowed bounds and cyclic metadata", () => {
    const document = createExampleDocument();
    document.annotations[0].z = Infinity;
    expect(validateDocument(document).valid).toBe(false);
    const overflow = createExampleDocument();
    overflow.panels[1] = {
      ...overflow.panels[1],
      type: "rect",
      bbox: { x: 1e308, y: 0, width: 1e308, height: 10 },
    };
    expect(validateDocument(overflow).valid).toBe(false);
    const cycle: Record<string, unknown> = {};
    cycle.loop = cycle;
    expect(
      validateDocument({ ...createEmptyDocument(), metadata: cycle }).valid,
    ).toBe(false);
    expect(
      validateDocument({ ...createEmptyDocument(), metadata: { number: NaN } })
        .valid,
    ).toBe(false);
  });

  it("accepts tilted polygons but rejects collinear, crossing and repeated-edge geometry", () => {
    const base = createExampleDocument().panels[1];
    const polygon: Panel = {
      ...base,
      type: "polygon",
      points: [
        { x: -10, y: 0 },
        { x: 20, y: 4 },
        { x: 25, y: 30 },
        { x: 0, y: 25 },
      ],
    };
    delete (polygon as unknown as Record<string, unknown>).bbox;
    const document = { ...createEmptyDocument(), panels: [polygon] };
    expect(validateDocument(document).valid).toBe(true);
    for (const points of [
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 10, y: 20 },
        { x: 10, y: -10 },
      ],
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 0 },
        { x: 0, y: 20 },
      ],
    ]) {
      expect(
        validateDocument({ ...document, panels: [{ ...polygon, points }] })
          .valid,
      ).toBe(false);
    }
  });

  it("round-trips subpixel positions within the promised 0.001 px precision", () => {
    const document = createExampleDocument();
    const panel = document.panels[1];
    if (panel.type !== "rect") throw new Error("Expected rectangle");
    panel.bbox.x = 291.123456789;
    const restored = parseDocument(serializeDocument(document));
    const restoredPanel = restored.panels[1];
    if (restoredPanel.type !== "rect") throw new Error("Expected rectangle");
    expect(restoredPanel.bbox.x).toBeCloseTo(panel.bbox.x, 6);
    expect(panel.bbox.x).toBe(291.123456789);
  });
});
