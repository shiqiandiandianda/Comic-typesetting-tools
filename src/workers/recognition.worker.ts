import cvModule from "@techstark/opencv-js";
import type * as Cv from "@techstark/opencv-js";
import {
  deduplicateDetections,
  mapDetection,
  type DetectedPanel,
} from "../features/detection";
import type {
  RecognitionRequest,
  RecognitionResponse,
} from "../features/recognition";

type CvRuntime = typeof Cv & {
  onRuntimeInitialized?: () => void;
  onAbort?: (reason: unknown) => void;
};
const runtime = cvModule as unknown as CvRuntime;
const ready = new Promise<{ cv: CvRuntime }>((resolve, reject) => {
  // OpenCV 4.12 has a self-referential thenable: wrap the runtime before resolving.
  if (typeof runtime.Mat === "function") resolve({ cv: runtime });
  else runtime.onRuntimeInitialized = () => resolve({ cv: runtime });
  runtime.onAbort = () =>
    reject(new Error("OpenCV 内存初始化失败，请缩小图片后重试。"));
});

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RecognitionRequest>) => void) | null;
  postMessage(message: RecognitionResponse): void;
};

const WORKING_PIXEL_BUDGET = 5_000_000;
const MAX_WORKING_SIDE = 12_000;
const TILE_SIDE = 2_048;
const TILE_OVERLAP = 256;

function detect(
  cv: CvRuntime,
  image: ImageData,
  minSize: number,
  threshold: number,
): DetectedPanel[] {
  const source = cv.matFromImageData(image);
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  const closed = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const panels: DetectedPanel[] = [];
  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.threshold(gray, binary, threshold, 255, cv.THRESH_BINARY_INV);
    cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(
      closed,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );
    for (let index = 0; index < contours.size(); index++) {
      const contour = contours.get(index);
      const polygon = new cv.Mat();
      try {
        const perimeter = cv.arcLength(contour, true);
        if (perimeter < minSize * 4) continue;
        cv.approxPolyDP(contour, polygon, Math.max(1, perimeter * 0.015), true);
        if (polygon.rows !== 4 || !cv.isContourConvex(polygon)) continue;
        const bbox = cv.boundingRect(polygon);
        const area = Math.abs(cv.contourArea(polygon));
        if (
          bbox.width < minSize ||
          bbox.height < minSize ||
          area < minSize * minSize ||
          area / (bbox.width * bbox.height) < 0.5
        )
          continue;
        const points = Array.from({ length: 4 }, (_, vertex) => ({
          x: polygon.data32S[vertex * 2],
          y: polygon.data32S[vertex * 2 + 1],
        }));
        const axisAligned = points.every((point, vertex) => {
          const next = points[(vertex + 1) % points.length];
          return (
            Math.abs(point.x - next.x) <= 2 || Math.abs(point.y - next.y) <= 2
          );
        });
        const score = Math.min(
          0.99,
          Math.max(
            0.1,
            0.6 +
              0.25 * (area / (bbox.width * bbox.height)) +
              0.14 * Math.min(1, area / (minSize * minSize * 8)),
          ),
        );
        panels.push({ bbox, score, ...(axisAligned ? {} : { points }) });
      } finally {
        contour.delete();
        polygon.delete();
      }
    }
    return deduplicateDetections(panels, 8);
  } finally {
    source.delete();
    gray.delete();
    binary.delete();
    closed.delete();
    contours.delete();
    hierarchy.delete();
    kernel.delete();
  }
}

workerScope.onmessage = async (event) => {
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    const { cv } = await ready;
    const { data, options } = event.data;
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data))
      throw new Error("图片资源无效，请重新载入图片。");
    const blob = await (await fetch(data)).blob();
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const factor = Math.min(
      1,
      Math.sqrt(WORKING_PIXEL_BUDGET / (bitmap.width * bitmap.height)),
      MAX_WORKING_SIDE / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * factor));
    const height = Math.max(1, Math.round(bitmap.height * factor));
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("浏览器无法创建识别工作画布。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const detections = detect(
      cv,
      context.getImageData(0, 0, width, height),
      options.minSize * factor,
      options.threshold,
    );
    // Map each axis independently to avoid rounding drift on long images.
    const sx = bitmap.width / width;
    const sy = bitmap.height / height;
    const panels = detections.map((panel) => {
      const mapped = mapDetection(panel, sx);
      mapped.bbox.y = panel.bbox.y * sy;
      mapped.bbox.height = panel.bbox.height * sy;
      if (mapped.points && panel.points)
        mapped.points.forEach((point, index) => {
          point.y = panel.points![index].y * sy;
        });
      return mapped;
    });
    if (factor < 1) {
      // A full-image pass finds large frames that cross tile boundaries. The
      // overlapping original-resolution passes retain smaller, thin borders.
      const stride = TILE_SIDE - TILE_OVERLAP;
      for (let top = 0; top < bitmap.height; top += stride) {
        for (let left = 0; left < bitmap.width; left += stride) {
          const tileWidth = Math.min(TILE_SIDE, bitmap.width - left);
          const tileHeight = Math.min(TILE_SIDE, bitmap.height - top);
          if (tileWidth < options.minSize || tileHeight < options.minSize)
            continue;
          canvas.width = tileWidth;
          canvas.height = tileHeight;
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, tileWidth, tileHeight);
          context.drawImage(
            bitmap,
            left,
            top,
            tileWidth,
            tileHeight,
            0,
            0,
            tileWidth,
            tileHeight,
          );
          const tilePanels = detect(
            cv,
            context.getImageData(0, 0, tileWidth, tileHeight),
            options.minSize,
            options.threshold,
          );
          for (const panel of tilePanels) {
            const box = panel.bbox;
            // Contours cut by an internal tile edge are completed by the
            // overview or a neighboring tile, rather than invented as frames.
            if (
              (left > 0 && box.x <= 1) ||
              (top > 0 && box.y <= 1) ||
              (left + tileWidth < bitmap.width &&
                box.x + box.width >= tileWidth - 1) ||
              (top + tileHeight < bitmap.height &&
                box.y + box.height >= tileHeight - 1)
            )
              continue;
            panels.push({
              ...panel,
              bbox: { ...box, x: box.x + left, y: box.y + top },
              ...(panel.points
                ? {
                    points: panel.points.map((point) => ({
                      x: point.x + left,
                      y: point.y + top,
                    })),
                  }
                : {}),
            });
          }
        }
      }
    }
    workerScope.postMessage({
      type: "result",
      panels: deduplicateDetections(panels, Math.max(8, Math.ceil(8 / factor))),
    });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "识别失败，请调整边框阈值或手动补画格框。",
    });
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
};
