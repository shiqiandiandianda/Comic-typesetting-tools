import type { Annotation, GridDocument, Panel, Point } from "../core/document";

export interface ExportOptions {
  format: "png" | "jpeg" | "svg";
  scale: number;
  jpegBackground: string;
  includeAnnotations: boolean;
  includeReference: boolean;
}

const MAX_RASTER_SIDE = 32_767;
const MAX_RASTER_PIXELS = 32_000_000;

const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
const color = (value: string) =>
  value === "transparent" ? "none" : escapeXml(value);
const xy = (point: Point) => `${point.x},${point.y}`;

function panelSvg(panel: Panel): string {
  if (panel.visible === false) return "";
  const style = `fill="${color(panel.style.fill)}" stroke="${panel.style.frameVisible === false ? "none" : color(panel.style.stroke)}" stroke-width="${panel.style.strokeWidth}" opacity="${panel.style.opacity ?? 1}"`;
  if (panel.type === "rect") {
    const { x, y, width, height } = panel.bbox;
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${style}/>`;
  }
  return `<polygon points="${panel.points.map(xy).join(" ")}" ${style}/>`;
}

function textSvg(
  x: number,
  y: number,
  text: string,
  size: number,
  fill: string,
  family = "sans-serif",
  centered = false,
): string {
  const lines = text.split(/\r?\n/);
  return `<text x="${x}" y="${y}" font-size="${size}" font-family="${escapeXml(family)}" fill="${color(fill)}" dominant-baseline="text-before-edge"${centered ? ' text-anchor="middle"' : ""} xml:space="preserve">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? size * 1.2 : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function annotationSvg(annotation: Annotation): string {
  if (annotation.visible === false) return "";
  if (annotation.type === "text")
    return textSvg(
      annotation.x,
      annotation.y,
      annotation.text,
      annotation.fontSize,
      annotation.color,
      annotation.fontFamily,
    );
  const { start, end } = annotation;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const width = annotation.type === "arrow" ? annotation.strokeWidth : 2;
  const line = `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${color(annotation.color)}" stroke-width="${width}"/>`;
  const nx = length ? -dy / length : 0;
  const ny = length ? dx / length : 1;
  if (annotation.type === "arrow") {
    const head = Math.max(8, width * 4);
    const ux = length ? dx / length : 1;
    const uy = length ? dy / length : 0;
    const points = [
      end,
      {
        x: end.x - ux * head + (nx * head) / 2,
        y: end.y - uy * head + (ny * head) / 2,
      },
      {
        x: end.x - ux * head - (nx * head) / 2,
        y: end.y - uy * head - (ny * head) / 2,
      },
    ];
    return (
      line +
      `<polygon points="${points.map(xy).join(" ")}" fill="${color(annotation.color)}"/>` +
      (annotation.label
        ? textSvg(
            (start.x + end.x) / 2,
            (start.y + end.y) / 2 - 22,
            annotation.label,
            16,
            annotation.color,
            undefined,
            true,
          )
        : "")
    );
  }
  const tick = (point: Point) =>
    `<line x1="${point.x - nx * 7}" y1="${point.y - ny * 7}" x2="${point.x + nx * 7}" y2="${point.y + ny * 7}" stroke="${color(annotation.color)}" stroke-width="2"/>`;
  const measured =
    annotation.mode === "horizontal"
      ? Math.abs(dx)
      : annotation.mode === "vertical"
        ? Math.abs(dy)
        : length;
  const label = annotation.label || `${Number(measured.toFixed(2))} px`;
  return (
    line +
    tick(start) +
    tick(end) +
    textSvg(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2 - 24,
      label,
      16,
      annotation.color,
      undefined,
      true,
    )
  );
}

/** Generate genuine vector geometry from the business document, with no editor overlays. */
export function documentToSvg(
  doc: GridDocument,
  options: Pick<ExportOptions, "includeAnnotations" | "includeReference">,
): string {
  let reference = "";
  if (
    options.includeReference &&
    doc.referenceImage?.visible &&
    doc.referenceImage.exportable
  ) {
    const image = doc.referenceImage;
    const asset = doc.assets.find((item) => item.id === image.assetId);
    if (!asset) throw new Error("参考图片资源缺失，请重新关联图片后再导出。");
    if (asset.source.type !== "embedded")
      throw new Error(
        `参考图片 ${asset.source.path} 尚未关联，请在参考图面板重新选择本地图片。`,
      );
    if (
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
        asset.source.data,
      )
    )
      throw new Error("参考图片内容无效，请重新载入图片。");
    const { x, y, width, height } = image.bbox;
    reference = `<image href="${asset.source.data}" x="${x}" y="${y}" width="${width}" height="${height}" opacity="${image.opacity}" preserveAspectRatio="none"/>`;
  }
  const layers: { z: number; svg: string }[] = doc.panels.map((panel) => ({
    z: panel.z,
    svg: panelSvg(panel),
  }));
  if (options.includeAnnotations)
    layers.push(
      ...doc.annotations.map((annotation) => ({
        z: annotation.z,
        svg: annotationSvg(annotation),
      })),
    );
  layers.sort((a, b) => a.z - b.z);
  const { width, height, backgroundColor } = doc.canvas;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="canvas-clip"><rect width="${width}" height="${height}"/></clipPath></defs><rect width="${width}" height="${height}" fill="${color(backgroundColor)}"/><g clip-path="url(#canvas-clip)">${reference}${layers.map((layer) => layer.svg).join("")}</g></svg>`;
}

export async function exportDocument(
  doc: GridDocument,
  options: ExportOptions,
): Promise<Blob> {
  if (!Number.isFinite(options.scale) || options.scale <= 0)
    throw new Error("导出倍率必须为大于 0 的数字。");
  const svg = new Blob([documentToSvg(doc, options)], {
    type: "image/svg+xml;charset=utf-8",
  });
  if (options.format === "svg") return svg;
  const width = Math.round(doc.canvas.width * options.scale);
  const height = Math.round(doc.canvas.height * options.scale);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_RASTER_SIDE ||
    height > MAX_RASTER_SIDE ||
    width * height > MAX_RASTER_PIXELS
  )
    throw new Error(
      "导出尺寸超过浏览器内存预算（3200 万像素），请降低倍率或改用 SVG。",
    );
  if (
    options.format === "jpeg" &&
    !/^#[0-9a-f]{6}$/i.test(options.jpegBackground)
  )
    throw new Error("JPG 铺底颜色必须是六位 HEX 颜色。");
  if ("fonts" in document) await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建导出画布，请降低倍率后重试。");
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (options.format === "jpeg") {
      context.fillStyle = options.jpegBackground;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("图片编码失败，请降低导出倍率。")),
        options.format === "png" ? "image/png" : "image/jpeg",
        0.95,
      ),
    );
  } catch (error) {
    throw new Error(
      `图片导出失败：${error instanceof Error ? error.message : "浏览器无法渲染图片"}`,
    );
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Keep the object URL alive while the browser starts its download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
