import { describe, expect, it } from "vitest";
import { createEmptyDocument, type GridDocument } from "../src/core/document";
import {
  documentToSvg,
  exportDocument,
  type ExportOptions,
} from "../src/services/export";

const options: ExportOptions = {
  format: "svg",
  scale: 1,
  jpegBackground: "#ffffff",
  includeAnnotations: true,
  includeReference: true,
};

function document(): GridDocument {
  const doc = createEmptyDocument();
  doc.canvas = { width: 100, height: 200, backgroundColor: "transparent" };
  doc.panels = [
    {
      id: "rect",
      type: "rect",
      bbox: { x: 10, y: 20, width: 30, height: 40 },
      z: 2,
      style: { fill: "#00ff0080", stroke: "#000000", strokeWidth: 2 },
    },
    {
      id: "poly",
      type: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 10, y: 20 },
      ],
      z: 0,
      style: {
        fill: "transparent",
        stroke: "#ff0000",
        strokeWidth: 1,
        frameVisible: false,
      },
    },
  ];
  doc.annotations = [
    {
      id: "text",
      type: "text",
      x: 5,
      y: 6,
      text: '<script>&"\n第二行',
      fontSize: 12,
      fontFamily: 'Test" onload="bad',
      color: "#333333",
      z: 1,
    },
  ];
  return doc;
}

describe("vector document export", () => {
  it("exports real vector elements in global z order, without editor guides", () => {
    const svg = documentToSvg(document(), options);
    expect(svg).toContain('width="100" height="200" viewBox="0 0 100 200"');
    expect(svg).toContain('<polygon points="0,0 20,0 10,20"');
    expect(svg).toContain('<rect x="10" y="20" width="30" height="40"');
    expect(svg.indexOf("<polygon")).toBeLessThan(svg.indexOf("<text"));
    expect(svg.indexOf("<text")).toBeLessThan(svg.indexOf('<rect x="10"'));
    expect(svg).not.toMatch(/gridStep|rulers|controls|data:image/);
    expect(svg).toContain('clip-path="url(#canvas-clip)"');
    expect(svg).toContain('fill="none" stroke="none"');
  });

  it("escapes text and font attributes instead of injecting markup", () => {
    const svg = documentToSvg(document(), options);
    expect(svg).toContain("&lt;script&gt;&amp;&quot;");
    expect(svg).toContain('font-family="Test&quot; onload=&quot;bad"');
    expect(svg).not.toContain("<script>");
    expect(svg).toMatch(/<tspan x="5" dy="[^\"]+">第二行<\/tspan>/);
  });

  it("respects annotation and hidden-object switches", () => {
    const doc = document();
    doc.panels[0].visible = false;
    const svg = documentToSvg(doc, { ...options, includeAnnotations: false });
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain('<rect x="10"');
  });

  it("embeds exportable references with exact document geometry", () => {
    const doc = document();
    doc.assets = [
      {
        id: "image",
        mimeType: "image/png",
        width: 1,
        height: 1,
        source: { type: "embedded", data: "data:image/png;base64,aGVsbG8=" },
      },
    ];
    doc.referenceImage = {
      assetId: "image",
      bbox: { x: 3, y: 4, width: 50, height: 60 },
      opacity: 0.5,
      visible: true,
      locked: true,
      exportable: true,
    };
    expect(documentToSvg(doc, options)).toContain(
      '<image href="data:image/png;base64,aGVsbG8=" x="3" y="4" width="50" height="60" opacity="0.5"',
    );
    doc.referenceImage.exportable = false;
    expect(documentToSvg(doc, options)).not.toContain("<image");
  });

  it("requires unresolved reference files to be re-associated", () => {
    const doc = document();
    doc.assets = [
      {
        id: "image",
        mimeType: "image/png",
        width: 1,
        height: 1,
        source: { type: "relative-file", path: "assets/reference.png" },
      },
    ];
    doc.referenceImage = {
      assetId: "image",
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      opacity: 1,
      visible: true,
      locked: true,
      exportable: true,
    };
    expect(() => documentToSvg(doc, options)).toThrow("尚未关联");
    expect(() =>
      documentToSvg(doc, { ...options, includeReference: false }),
    ).not.toThrow();
    doc.assets = [];
    expect(() => documentToSvg(doc, options)).toThrow("资源缺失");
  });

  it("returns a standalone SVG Blob without a raster intermediary", async () => {
    const blob = await exportDocument(document(), options);
    expect(blob.type).toBe("image/svg+xml;charset=utf-8");
    expect(await blob.text()).toContain("<polygon");
  });

  it("rejects invalid or excessive raster sizes before allocating canvas memory", async () => {
    await expect(
      exportDocument(document(), { ...options, scale: NaN }),
    ).rejects.toThrow("倍率");
    await expect(
      exportDocument(document(), { ...options, scale: 0 }),
    ).rejects.toThrow("倍率");
    await expect(
      exportDocument(document(), { ...options, format: "png", scale: 100 }),
    ).rejects.toThrow("内存预算");
    await expect(
      exportDocument(document(), {
        ...options,
        format: "jpeg",
        jpegBackground: "transparent",
      }),
    ).rejects.toThrow("铺底");
  });
});
