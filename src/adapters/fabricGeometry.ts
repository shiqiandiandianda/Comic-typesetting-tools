import {
  FabricObject,
  Point as FabricPoint,
  Polygon,
  Rect,
  controlsUtils,
  util,
  type TMat2D,
} from "fabric";
import type { Panel, Point } from "../core/document";
import {
  panelBounds,
  polygonArea,
  polygonIsSimple,
  snapPoint,
} from "../core/geometry";

export const MAX_PREVIEW_SIDE = 16_384;
export const MAX_PREVIEW_PIXELS = 16_000_000;

/** Keep each of Fabric's two backing canvases inside the same allocation budget. */
export function previewDimensions(
  canvas: { width: number; height: number },
  requestedZoom: number,
  devicePixelRatio = 1,
) {
  const safeZoom = Math.min(
    2,
    MAX_PREVIEW_SIDE / canvas.width,
    MAX_PREVIEW_SIDE / canvas.height,
    Math.sqrt(MAX_PREVIEW_PIXELS / (canvas.width * canvas.height)),
  );
  const requested =
    Number.isFinite(requestedZoom) && requestedZoom > 0
      ? Math.max(0.001, Math.min(2, requestedZoom))
      : 0.15;
  // A safety cap can be smaller than the ordinary user-facing minimum.
  const zoom = Math.min(requested, safeZoom);
  const width = Math.max(1, Math.floor(canvas.width * zoom));
  const height = Math.max(1, Math.floor(canvas.height * zoom));
  const dpr = Number.isFinite(devicePixelRatio)
    ? Math.max(1, devicePixelRatio)
    : 1;
  const retinaWidth = Math.floor(width * dpr);
  const retinaHeight = Math.floor(height * dpr);
  const retina =
    retinaWidth <= MAX_PREVIEW_SIDE &&
    retinaHeight <= MAX_PREVIEW_SIDE &&
    retinaWidth * retinaHeight <= MAX_PREVIEW_PIXELS;
  return {
    zoom,
    width,
    height,
    retina,
    backingWidth: retina ? retinaWidth : width,
    backingHeight: retina ? retinaHeight : height,
  };
}

export const round = (value: number) => Math.round(value * 1000) / 1000;
export const pointAt = (point: Point, matrix: TMat2D): Point => {
  const result = util.transformPoint(new FabricPoint(point.x, point.y), matrix);
  return { x: round(result.x), y: round(result.y) };
};
export function shapeOptions(locked = false) {
  return {
    originX: "left" as const,
    originY: "top" as const,
    selectable: !locked,
    evented: true,
    lockRotation: true,
    lockScalingFlip: true,
    lockMovementX: locked,
    lockMovementY: locked,
    lockScalingX: locked,
    lockScalingY: locked,
    hasControls: !locked,
    cornerColor: "#E86536",
    cornerStrokeColor: "#FFFFFF",
    borderColor: "#E86536",
    cornerStyle: "circle" as const,
    transparentCorners: false,
    cornerSize: 10,
    padding: 2,
    strokeUniform: true,
  };
}

export function makePanel(panel: Panel, snapStep = 0): FabricObject {
  const strokeWidth =
    panel.style.frameVisible === false ? 0 : panel.style.strokeWidth;
  const bounds = panelBounds(panel);
  const options = {
    ...shapeOptions(panel.locked),
    // Fabric positions an object's outer stroke edge at its left/top origin.
    // Compensating here keeps authored bounds independent of the frame width.
    left: bounds.x - strokeWidth / 2,
    top: bounds.y - strokeWidth / 2,
    fill: panel.style.fill,
    stroke:
      panel.style.frameVisible === false ? "transparent" : panel.style.stroke,
    strokeWidth,
    opacity: panel.style.opacity ?? 1,
    objectCaching: false,
  };
  const object =
    panel.type === "rect"
      ? new Rect({
          ...options,
          width: panel.bbox.width,
          height: panel.bbox.height,
        })
      : new Polygon(
          panel.points.map((point) => ({ ...point })),
          options,
        );
  object.setControlsVisibility({ mtr: false });
  if (object instanceof Polygon && !panel.locked) {
    object.controls = controlsUtils.createPolyControls(object, {
      cursorStyle: "crosshair",
      sizeX: 10,
      sizeY: 10,
    });
    for (const control of Object.values(object.controls)) {
      const action = control.actionHandler;
      control.actionHandler = (...args) => {
        const previous = {
          points: object.points.map((point) => ({ ...point })),
          pathOffset: object.pathOffset.clone(),
          left: object.left,
          top: object.top,
          width: object.width,
          height: object.height,
        };
        const point =
          snapStep > 0
            ? snapPoint({ x: args[2], y: args[3] }, snapStep)
            : { x: args[2], y: args[3] };
        const result = action(args[0], args[1], point.x, point.y);
        if (
          !polygonIsSimple(object.points) ||
          Math.abs(polygonArea(object.points)) < 0.001
        ) {
          object.set(previous);
          object.setCoords();
          return false;
        }
        return result;
      };
    }
  }
  return object;
}

export function changePanel(panel: Panel, matrix: TMat2D): Panel {
  const edited = panel.source
    ? { source: { ...panel.source, reviewStatus: "edited" as const } }
    : {};
  if (panel.type === "polygon")
    return {
      ...panel,
      ...edited,
      points: panel.points.map((point) => pointAt(point, matrix)),
    };
  const { x, y, width, height } = panel.bbox;
  const corners = [
    pointAt({ x, y }, matrix),
    pointAt({ x: x + width, y }, matrix),
    pointAt({ x, y: y + height }, matrix),
    pointAt({ x: x + width, y: y + height }, matrix),
  ];
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  return {
    ...panel,
    ...edited,
    bbox: {
      x: round(minX),
      y: round(minY),
      width: Math.max(
        1,
        round(Math.max(...corners.map((point) => point.x)) - minX),
      ),
      height: Math.max(
        1,
        round(Math.max(...corners.map((point) => point.y)) - minY),
      ),
    },
  };
}
