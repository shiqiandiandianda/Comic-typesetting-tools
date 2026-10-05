import { test, expect } from "@playwright/test";

test("example geometry, numeric edit, undo, invalid import, vector export and JSON restore", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "X / px", exact: true }),
  ).toHaveValue("291");
  await expect(page.locator(".geometry-summary")).toContainText("1,242");
  const x = page.getByRole("spinbutton", { name: "X / px", exact: true });
  await x.fill("391");
  await x.press("Enter");
  await expect(page.locator(".geometry-summary")).toContainText("1,342");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(x).toHaveValue("291");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(x).toHaveValue("391");
  await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  await page
    .getByRole("textbox", { name: "项目 JSON", exact: true })
    .fill('{"bad": true}');
  await page.getByRole("button", { name: "校验并导入" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await expect(x).toHaveValue("391");
  await page.getByRole("button", { name: "导出图片", exact: true }).click();
  await page.getByRole("combobox", { name: "导出格式" }).selectOption("svg");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载图片", exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const svg = Buffer.concat(chunks).toString();
  expect(svg).toContain("<rect");
  expect(svg).toContain("<text");
  expect(svg).not.toContain("upper-canvas");
  await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  const json = await page
    .getByRole("textbox", { name: "项目 JSON", exact: true })
    .inputValue();
  expect(JSON.parse(json).panels[1].bbox.x).toBe(391);
  await page.getByRole("button", { name: "校验并导入" }).click();
  await page.getByRole("button", { name: /再次指认副格/ }).click();
  await expect(x).toHaveValue("391");
  await page.screenshot({ path: "/tmp/gridlens-editor.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("canvas drag preserves raw pixels at different zooms, drawing and measurement", async ({
  page,
}) => {
  await page.goto("/");
  // Use a small canvas to expose objects at every zoom without scrolling.
  await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  const input = page.getByRole("textbox", { name: "项目 JSON" });
  const doc = JSON.parse(await input.inputValue());
  doc.canvas = { width: 500, height: 500, backgroundColor: "#FFFFFF" };
  doc.panels = [
    {
      ...doc.panels[1],
      id: "P02",
      bbox: { x: 100, y: 100, width: 100, height: 100 },
      style: { fill: "#EDF4FB", stroke: "#F97316", strokeWidth: 4 },
      z: 1,
    },
  ];
  doc.annotations = [];
  doc.guides.gridVisible = false;
  await input.fill(JSON.stringify(doc));
  await page.getByRole("button", { name: "校验并导入" }).click();
  const canvas = page.locator(".upper-canvas");
  await expect(canvas).toBeVisible();
  for (const zoom of [0.25, 1, 2]) {
    await page
      .getByRole("combobox", { name: "预览缩放" })
      .selectOption(String(zoom));
    await page.getByRole("button", { name: /再次指认副格/ }).click();
    const box = await canvas.boundingBox();
    const xpos = Number(
      await page
        .getByRole("spinbutton", { name: "X / px", exact: true })
        .inputValue(),
    );
    const ypos = Number(
      await page
        .getByRole("spinbutton", { name: "Y / px", exact: true })
        .inputValue(),
    );
    await page.mouse.move(
      box!.x + (xpos + 50) * zoom,
      box!.y + (ypos + 50) * zoom,
    );
    await page.mouse.down();
    await page.mouse.move(
      box!.x + (xpos + 70) * zoom,
      box!.y + (ypos + 70) * zoom,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(
      page.getByRole("spinbutton", { name: "X / px", exact: true }),
    ).toHaveValue(String(xpos + 20));
    await expect(
      page.getByRole("spinbutton", { name: "Y / px", exact: true }),
    ).toHaveValue(String(ypos + 20));
  }
  await page.getByRole("combobox", { name: "预览缩放" }).selectOption("1");
  await page.getByRole("button", { name: /^格框R$/ }).click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box!.x + 280, box!.y + 100);
  await page.mouse.down();
  await page.mouse.move(box!.x + 390, box!.y + 220, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(".layer-row")).toHaveCount(2);
  await page.getByRole("button", { name: /^测量M$/ }).click();
  await page.mouse.click(box!.x + 50, box!.y + 50);
  await page.mouse.click(box!.x + 150, box!.y + 50);
  await expect(page.locator(".measure-readout")).toContainText("距离 100 px");
  await page.getByRole("button", { name: "保存尺寸标注", exact: true }).click();
  await expect(page.locator(".annotation-list button")).toHaveCount(1);
});

test("responsive panels remain accessible and autosaved projects can be restored", async ({
  page,
}) => {
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "GridLens", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width < 900) {
      await page.getByRole("button", { name: "属性", exact: true }).click();
      await expect(
        page.getByRole("spinbutton", { name: "画布宽 / px", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "项目", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "载入参考图片", exact: true }),
      ).toBeVisible();
    }
  }
  await page
    .getByRole("spinbutton", { name: "X / px", exact: true })
    .fill("410");
  await page
    .getByRole("spinbutton", { name: "X / px", exact: true })
    .press("Enter");
  await expect(page.locator(".project-name")).toContainText("已自动保存到本机");
  await page.reload();
  await page.getByRole("button", { name: "恢复项目", exact: true }).click();
  await page.getByRole("button", { name: /再次指认副格/ }).click();
  await expect(
    page.getByRole("spinbutton", { name: "X / px", exact: true }),
  ).toHaveValue("410");
});
