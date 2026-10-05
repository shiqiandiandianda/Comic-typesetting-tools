import {
  DocumentValidationError,
  validateDocument,
  type BBox,
  type GridDocument,
} from "./document";
import { transformPoint } from "./geometry";

/** Resizing the viewport is separate; this command changes actual canvas pixels. */
export function resizeCanvas(
  document: GridDocument,
  width: number,
  height: number,
  options: { scaleObjects?: boolean } = {},
): GridDocument {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 32767 ||
    height > 32767 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    throw new RangeError("画布宽高必须为 1–32767 的整数。");
  }
  if (width === document.canvas.width && height === document.canvas.height)
    return document;
  const canvas = { ...document.canvas, width, height };
  if (!options.scaleObjects) return { ...document, canvas };

  const from: BBox = {
    x: 0,
    y: 0,
    width: document.canvas.width,
    height: document.canvas.height,
  };
  const to: BBox = { x: 0, y: 0, width, height };
  const scaleX = width / from.width;
  const scaleY = height / from.height;
  const transformBounds = (bbox: BBox): BBox => ({
    ...transformPoint(bbox, from, to),
    width: bbox.width * scaleX,
    height: bbox.height * scaleY,
  });
  const next: GridDocument = {
    ...document,
    canvas,
    // A whole-canvas transform also includes locked objects, preserving layout.
    panels: document.panels.map((panel) =>
      panel.type === "rect"
        ? { ...panel, bbox: transformBounds(panel.bbox) }
        : {
            ...panel,
            points: panel.points.map((point) =>
              transformPoint(point, from, to),
            ),
          },
    ),
    // Every annotation transforms once, whether independent or following a panel.
    annotations: document.annotations.map((annotation) =>
      annotation.type === "text"
        ? { ...annotation, ...transformPoint(annotation, from, to) }
        : {
            ...annotation,
            start: transformPoint(annotation.start, from, to),
            end: transformPoint(annotation.end, from, to),
          },
    ),
    ...(document.referenceImage
      ? {
          referenceImage: {
            ...document.referenceImage,
            bbox: transformBounds(document.referenceImage.bbox),
          },
        }
      : {}),
  };
  const result = validateDocument(next);
  if (!result.valid) throw new DocumentValidationError(result.errors);
  return next;
}
