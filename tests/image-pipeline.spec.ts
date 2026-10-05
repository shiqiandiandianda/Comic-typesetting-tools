import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";

test("本地图片方向、矢量导出、透明 PNG 与 JPG 铺底保持正确", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const exportSource = "/src/services/export.ts";
    const imageSource = "/src/services/image.ts";
    const documentSource = "/src/core/document.ts";
    const { exportDocument } = (await import(
      exportSource
    )) as typeof import("../src/services/export");
    const { readImage } = (await import(
      imageSource
    )) as typeof import("../src/services/image");
    const { createEmptyDocument } = (await import(
      documentSource
    )) as typeof import("../src/core/document");
    const original = document.createElement("canvas");
    original.width = 50;
    original.height = 30;
    const context = original.getContext("2d")!;
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 25, 30);
    context.fillStyle = "#0000ff";
    context.fillRect(25, 0, 25, 30);
    const jpeg = await new Promise<Blob>((resolve) =>
      original.toBlob((blob) => resolve(blob!), "image/jpeg", 1),
    );
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    // A standard EXIF orientation=6 APP1 segment (90 degrees clockwise).
    const exif = new Uint8Array([
      255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0,
      18, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const oriented = new File(
      [bytes.slice(0, 2), exif, bytes.slice(2)],
      "oriented.jpg",
      { type: "image/jpeg" },
    );
    const asset = await readImage(oriented);
    const normalized = await createImageBitmap(
      await (
        await fetch(asset.source.type === "embedded" ? asset.source.data : "")
      ).blob(),
    );
    original.width = normalized.width;
    original.height = normalized.height;
    context.drawImage(normalized, 0, 0);
    const orientationColor = Array.from(context.getImageData(15, 5, 1, 1).data);
    normalized.close();
    let invalidMessage = "";
    try {
      await readImage(
        new File(["not a png"], "fake.png", { type: "image/png" }),
      );
    } catch (error) {
      invalidMessage = error instanceof Error ? error.message : "";
    }
    const doc = createEmptyDocument();
    doc.canvas = { width: 64, height: 96, backgroundColor: "transparent" };
    doc.panels = [
      {
        id: "frame",
        type: "rect",
        bbox: { x: 10, y: 10, width: 20, height: 30 },
        style: { fill: "#00ff00", stroke: "#000000", strokeWidth: 2 },
        z: 1,
      },
    ];
    const base = {
      scale: 2,
      jpegBackground: "#112233",
      includeAnnotations: true,
      includeReference: false,
    };
    const png = await exportDocument(doc, { ...base, format: "png" });
    const jpg = await exportDocument(doc, { ...base, format: "jpeg" });
    const svg = await exportDocument(doc, { ...base, format: "svg" });
    const inspect = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const output = {
        width: bitmap.width,
        height: bitmap.height,
        corner: Array.from(ctx.getImageData(0, 0, 1, 1).data),
        fill: Array.from(ctx.getImageData(40, 40, 1, 1).data),
      };
      bitmap.close();
      return output;
    };
    return {
      assetSize: [asset.width, asset.height],
      orientationColor,
      invalidMessage,
      png: await inspect(png),
      jpg: await inspect(jpg),
      svg: await svg.text(),
    };
  });
  expect(result.assetSize).toEqual([30, 50]);
  expect(result.orientationColor[0]).toBeGreaterThan(240);
  expect(result.orientationColor[2]).toBeLessThan(15);
  expect(result.invalidMessage).toContain("仅支持真实");
  expect([result.png.width, result.png.height]).toEqual([128, 192]);
  expect(result.png.corner[3]).toBe(0);
  expect(result.png.fill).toEqual([0, 255, 0, 255]);
  expect([result.jpg.width, result.jpg.height]).toEqual([128, 192]);
  expect(result.jpg.corner[3]).toBe(255);
  for (let channel = 0; channel < 3; channel++)
    expect(
      Math.abs(result.jpg.corner[channel] - [17, 34, 51][channel]),
    ).toBeLessThanOrEqual(3);
  expect(result.svg).toContain('width="64" height="96"');
  expect(result.svg).toContain('<rect x="10"');
  expect(result.svg).not.toContain("<image");
});

test("实际 OpenCV Worker 检出矩形、嵌套与斜格，合并双边框且可取消", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const recognitionSource = "/src/features/recognition.ts";
    const { startRecognition } = (await import(
      recognitionSource
    )) as typeof import("../src/features/recognition");
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 800;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 800, 800);
    context.strokeStyle = "#000000";
    context.lineWidth = 2;
    context.strokeRect(30, 30, 730, 730);
    context.strokeRect(80, 90, 250, 180);
    context.strokeRect(84, 94, 242, 172);
    context.beginPath();
    context.moveTo(410, 100);
    context.lineTo(730, 140);
    context.lineTo(680, 350);
    context.lineTo(390, 310);
    context.closePath();
    context.stroke();
    const asset = {
      id: "synth",
      width: 800,
      height: 800,
      mimeType: "image/png" as const,
      source: { type: "embedded" as const, data: canvas.toDataURL() },
    };
    const panels = await startRecognition(asset, {
      minSize: 40,
      threshold: 160,
    }).promise;
    const cancelled = startRecognition(asset, { minSize: 40, threshold: 160 });
    cancelled.cancel();
    let cancelName = "";
    try {
      await cancelled.promise;
    } catch (error) {
      cancelName = error instanceof DOMException ? error.name : "";
    }
    return { panels, cancelName };
  });
  const rectangle = result.panels.find(
    (panel) =>
      Math.abs(panel.bbox.x - 80) <= 2 && Math.abs(panel.bbox.y - 90) <= 2,
  );
  expect(rectangle).toBeDefined();
  expect(rectangle!.bbox.width).toBeCloseTo(250, -1);
  expect(
    result.panels.some(
      (panel) => panel.bbox.width > 720 && panel.bbox.height > 720,
    ),
  ).toBe(true);
  expect(
    result.panels.some(
      (panel) => panel.points?.length === 4 && panel.bbox.x > 380,
    ),
  ).toBe(true);
  expect(result.panels.length).toBe(3);
  expect(result.cancelName).toBe("AbortError");
});

test("长图分块识别保留跨块大格与原图坐标", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const panels = await page.evaluate(async () => {
    const source = "/src/features/recognition.ts";
    const { startRecognition } = (await import(
      source
    )) as typeof import("../src/features/recognition");
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 6000;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#000000";
    context.lineWidth = 3;
    context.strokeRect(40, 100, 1190, 5600);
    context.strokeRect(90, 1800, 450, 450);
    context.strokeRect(700, 4400, 350, 300);
    const asset = {
      id: "long",
      width: canvas.width,
      height: canvas.height,
      mimeType: "image/png" as const,
      source: { type: "embedded" as const, data: canvas.toDataURL() },
    };
    return startRecognition(asset, { minSize: 40, threshold: 160 }).promise;
  });
  for (const [x, y, width, height] of [
    [40, 100, 1190, 5600],
    [90, 1800, 450, 450],
    [700, 4400, 350, 300],
  ]) {
    const panel = panels.find(
      (candidate) =>
        Math.abs(candidate.bbox.x - x) <= 3 &&
        Math.abs(candidate.bbox.y - y) <= 3,
    );
    expect(panel).toBeDefined();
    expect(Math.abs(panel!.bbox.width - width)).toBeLessThanOrEqual(5);
    expect(Math.abs(panel!.bbox.height - height)).toBeLessThanOrEqual(5);
  }
  expect(panels.length).toBe(3);
});

test("IndexedDB 自动保存可以恢复独立文档快照", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const persistenceSource = "/src/services/persistence.ts";
    const documentSource = "/src/core/document.ts";
    const { saveDocument, loadDocument } = (await import(
      persistenceSource
    )) as typeof import("../src/services/persistence");
    const { createEmptyDocument } = (await import(
      documentSource
    )) as typeof import("../src/core/document");
    const doc = createEmptyDocument();
    doc.title = "恢复测试";
    await saveDocument(doc);
    doc.title = "保存后修改";
    const recovered = await loadDocument();
    return { title: recovered?.title, canvas: recovered?.canvas };
  });
  expect(result.title).toBe("恢复测试");
  expect(result.canvas).toMatchObject({ width: 1280, height: 3840 });
});

test("参考图识别、候选确认、JSON 重载和包含参考图的 PNG 下载走通", async ({
  page,
}) => {
  await page.goto("/");
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 600;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 600, 600);
    context.strokeStyle = "#000000";
    context.lineWidth = 2;
    context.strokeRect(40, 60, 210, 200);
    context.beginPath();
    context.moveTo(330, 300);
    context.lineTo(560, 340);
    context.lineTo(530, 540);
    context.lineTo(320, 500);
    context.closePath();
    context.stroke();
    return canvas.toDataURL().split(",")[1];
  });
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "载入参考图片", exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "comic-fixture.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  });
  await expect(
    page.getByRole("button", { name: "自动识别格框", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "自动识别格框", exact: true }).click();
  await expect(page.locator(".pending")).toHaveText("2 个候选待确认", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "确认此格框", exact: true }).click();
  await expect(page.locator(".pending")).toHaveText("1 个候选待确认");
  await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  const input = page.getByRole("textbox", { name: "项目 JSON", exact: true });
  const doc = JSON.parse(await input.inputValue());
  expect(doc.panels).toHaveLength(2);
  expect(
    doc.panels.some((panel: { type: string }) => panel.type === "polygon"),
  ).toBe(true);
  expect(
    doc.panels.filter(
      (panel: { source: { reviewStatus: string } }) =>
        panel.source.reviewStatus === "confirmed",
    ),
  ).toHaveLength(1);
  expect(doc.assets[0].source.type).toBe("embedded");
  await page.getByRole("button", { name: "校验并导入", exact: true }).click();
  await expect(page.locator(".pending")).toHaveText("1 个候选待确认");
  await page.getByRole("button", { name: "导出图片", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载图片", exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const png = Buffer.concat(chunks);
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  expect(png.readUInt32BE(16)).toBe(600);
  expect(png.readUInt32BE(20)).toBe(600);
});
