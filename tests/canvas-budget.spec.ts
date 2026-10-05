import { expect, test } from "@playwright/test";

test.use({ deviceScaleFactor: 2 });

test("large previews retain valid backing canvases within budget at every resize step", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      stageAllocations: Array<[number, number]>;
    };
    state.stageAllocations = [];
    const record = (canvas: HTMLCanvasElement) => {
      if (
        canvas.classList.contains("lower-canvas") ||
        canvas.classList.contains("upper-canvas")
      ) {
        state.stageAllocations.push([canvas.width, canvas.height]);
      }
    };
    for (const key of ["width", "height"]) {
      const original = Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        key,
      )!;
      Object.defineProperty(HTMLCanvasElement.prototype, key, {
        ...original,
        set(this: HTMLCanvasElement, value: number) {
          original.set!.call(this, value);
          record(this);
        },
      });
    }
    const originalAttribute = HTMLCanvasElement.prototype.setAttribute;
    HTMLCanvasElement.prototype.setAttribute = function (
      this: HTMLCanvasElement,
      name: string,
      value: string,
    ) {
      originalAttribute.call(this, name, value);
      if (name === "width" || name === "height") record(this);
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".upper-canvas")).toBeVisible();
  // The tall-to-wide switch also verifies that temporary allocations are safe.
  for (const [width, height] of [
    [1280, 30000],
    [30000, 1280],
    [32767, 50],
    [32000, 32000],
  ]) {
    await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
    const input = page.getByRole("textbox", { name: "项目 JSON", exact: true });
    const project = JSON.parse(await input.inputValue());
    project.canvas = { width, height, backgroundColor: "#FFFFFF" };
    project.panels = [];
    project.annotations = [];
    project.assets = [];
    project.referenceImage = null;
    await input.fill(JSON.stringify(project));
    await page.getByRole("button", { name: "校验并导入", exact: true }).click();
    await page
      .getByRole("combobox", { name: "预览缩放", exact: true })
      .selectOption("2");
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const result = await page.evaluate(() => {
      const state = window as typeof window & {
        stageAllocations: Array<[number, number]>;
      };
      return {
        zoom: Number(
          (
            document.querySelector(
              '[aria-label="预览缩放"]',
            ) as HTMLSelectElement
          ).value,
        ),
        surfaces: [
          ...document.querySelectorAll<HTMLCanvasElement>(
            ".stage-canvas canvas",
          ),
        ].map((canvas) => ({
          width: canvas.width,
          height: canvas.height,
          encoding: canvas.toDataURL().slice(0, 22),
        })),
        unsafeAllocation: state.stageAllocations.find(
          ([w, h]) => w > 16384 || h > 16384 || w * h > 16_000_000,
        ),
      };
    });
    expect(result.zoom).toBeGreaterThan(0);
    expect(result.zoom).toBeLessThan(2);
    expect(result.surfaces).toHaveLength(2);
    expect(result.unsafeAllocation).toBeUndefined();
    for (const surface of result.surfaces) {
      expect(surface.width).toBeLessThanOrEqual(16_384);
      expect(surface.height).toBeLessThanOrEqual(16_384);
      expect(surface.width * surface.height).toBeLessThanOrEqual(16_000_000);
      expect(surface.encoding).toBe("data:image/png;base64,");
    }
  }
  expect(errors).toEqual([]);
});
