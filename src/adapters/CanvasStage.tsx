import { useEffect, useLayoutEffect, useRef } from "react";
import {
  ActiveSelection,
  Canvas,
  FabricImage,
  FabricObject,
  FabricText,
  Group,
  Path,
  Polygon,
  Rect,
  config,
  util,
  type TMat2D,
} from "fabric";
import type { Annotation, GridDocument, Panel, Point } from "../core/document";
import { createPanel } from "../core/commands";
import {
  changePanel,
  makePanel,
  pointAt,
  previewDimensions,
  round,
  shapeOptions,
} from "./fabricGeometry";
import {
  dimensionValue,
  panelBounds,
  snapPoint,
  transformPoint,
} from "../core/geometry";

export interface CanvasStageProps {
  document: GridDocument;
  selectedIds: string[];
  onSelect(ids: string[]): void;
  onChange(document: GridDocument): void;
  tool: "select" | "rect" | "measure" | "pan";
  zoom: number;
  onZoomChange(zoom: number): void;
  onPointer(point: Point): void;
  onMeasure(start: Point, end: Point): void;
}

type Binding = { id: string; initialMatrix: TMat2D };
type Drawing = { start: Point; preview: FabricObject; secondClick?: boolean };
const matrixChanged = (a: TMat2D, b: TMat2D) =>
  a.some((value, index) => Math.abs(value - b[index]) > 0.00001);
const distance = (start: Point, end: Point) =>
  Math.hypot(end.x - start.x, end.y - start.y);

function makeAnnotation(annotation: Annotation): FabricObject {
  const options = { ...shapeOptions(), objectCaching: false };
  if (annotation.type === "text") {
    const text = new FabricText(annotation.text, {
      ...options,
      left: annotation.x,
      top: annotation.y,
      fill: annotation.color,
      fontSize: annotation.fontSize,
      fontFamily: annotation.fontFamily || "sans-serif",
      lineHeight: 1.2,
      strokeWidth: 0,
      // Text remains its authored size; multi-selection moves its anchor only.
      lockScalingX: true,
      lockScalingY: true,
      hasControls: false,
    });
    return text;
  }
  const { start, end, color } = annotation;
  const lineWidth = annotation.type === "arrow" ? annotation.strokeWidth : 2;
  const parts: FabricObject[] = [
    new Path(`M ${start.x} ${start.y} L ${end.x} ${end.y}`, {
      ...options,
      fill: "",
      stroke: color,
      strokeWidth: lineWidth,
      selectable: false,
      evented: false,
    }),
  ];
  const length = distance(start, end);
  const ux = length ? (end.x - start.x) / length : 1;
  const uy = length ? (end.y - start.y) / length : 0;
  const nx = length ? -uy : 0;
  const ny = length ? ux : 1;
  if (annotation.type === "arrow") {
    const head = Math.max(8, lineWidth * 4);
    parts.push(
      new Polygon(
        [
          { ...end },
          {
            x: end.x - ux * head + (nx * head) / 2,
            y: end.y - uy * head + (ny * head) / 2,
          },
          {
            x: end.x - ux * head - (nx * head) / 2,
            y: end.y - uy * head - (ny * head) / 2,
          },
        ],
        {
          ...options,
          fill: color,
          strokeWidth: 0,
          selectable: false,
          evented: false,
        },
      ),
    );
  } else {
    const dx = nx * 7;
    const dy = ny * 7;
    parts.push(
      new Path(
        `M ${start.x - dx} ${start.y - dy} L ${start.x + dx} ${start.y + dy} M ${end.x - dx} ${end.y - dy} L ${end.x + dx} ${end.y + dy}`,
        {
          ...options,
          fill: "",
          stroke: color,
          strokeWidth: lineWidth,
          selectable: false,
          evented: false,
        },
      ),
    );
  }
  const label =
    annotation.label ||
    (annotation.type === "dimension"
      ? `${Number(dimensionValue(annotation).toFixed(2))} px`
      : "");
  if (label) {
    const text = new FabricText(label, {
      ...options,
      left: (start.x + end.x) / 2,
      top: (start.y + end.y) / 2 - (annotation.type === "dimension" ? 24 : 22),
      fill: color,
      fontSize: 16,
      fontFamily: "sans-serif",
      lineHeight: 1.2,
      strokeWidth: 0,
      selectable: false,
      evented: false,
    });
    text.set({ left: text.left - text.width / 2 });
    parts.push(text);
  }
  const group = new Group(parts, options);
  group.setControlsVisibility({ mtr: false });
  return group;
}

function changeAnnotation(
  annotation: Annotation,
  map: (point: Point) => Point,
): Annotation {
  if (annotation.type === "text")
    return { ...annotation, ...map({ x: annotation.x, y: annotation.y }) };
  return {
    ...annotation,
    start: map(annotation.start),
    end: map(annotation.end),
  };
}

/** A preview adapter. Authored geometry always stays in document pixels. */
export function CanvasStage(props: CanvasStageProps) {
  const { document: doc, selectedIds, tool } = props;
  const preview = previewDimensions(
    doc.canvas,
    props.zoom,
    config.devicePixelRatio,
  );
  const { zoom, width, height } = preview;
  const scrollRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const bindingsRef = useRef(new WeakMap<FabricObject, Binding>());
  const propsRef = useRef(props);
  const suppressSelection = useRef(false);
  const drawingRef = useRef<Drawing | null>(null);
  const measureRef = useRef<Point | null>(null);
  const panRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  propsRef.current = { ...props, zoom };
  useEffect(() => {
    if (props.zoom !== zoom) propsRef.current.onZoomChange(zoom);
  }, [props.zoom, zoom]);

  const syncSelection = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ids = new Set(propsRef.current.selectedIds);
    const selected = canvas.getObjects().filter((object) => {
      const binding = bindingsRef.current.get(object);
      return binding && ids.has(binding.id) && object.selectable;
    });
    const active = canvas.getActiveObjects();
    if (
      propsRef.current.tool === "select" &&
      selected.length === active.length &&
      selected.every((object) => active.includes(object))
    )
      return;
    suppressSelection.current = true;
    canvas.discardActiveObject();
    if (propsRef.current.tool === "select") {
      if (selected.length === 1) canvas.setActiveObject(selected[0]);
      else if (selected.length > 1) {
        const selection = new ActiveSelection(selected, {
          ...shapeOptions(),
          canvas,
        });
        selection.setControlsVisibility({ mtr: false });
        canvas.setActiveObject(selection);
      }
    }
    suppressSelection.current = false;
    canvas.requestRenderAll();
  };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Each mount owns a fresh DOM node, so async Fabric disposal is StrictMode safe.
    const element = window.document.createElement("canvas");
    element.setAttribute("aria-label", "漫画格框编辑画布");
    host.appendChild(element);
    const canvas = new Canvas(element, {
      preserveObjectStacking: true,
      selectionColor: "#E8653620",
      selectionBorderColor: "#E86536",
      selectionLineWidth: 1,
      enableRetinaScaling: true,
      renderOnAddRemove: false,
    });
    canvasRef.current = canvas;
    let alive = true;
    const scenePoint = (event: Parameters<Canvas["getScenePoint"]>[0]) => {
      const point = canvas.getScenePoint(event);
      return { x: round(point.x), y: round(point.y) };
    };
    const bounded = (point: Point): Point => {
      const current = propsRef.current;
      const guides = current.document.guides;
      const resolved =
        current.tool === "rect" && guides?.snapToGrid
          ? snapPoint(point, guides.gridStep)
          : point;
      return {
        x: Math.max(0, Math.min(current.document.canvas.width, resolved.x)),
        y: Math.max(0, Math.min(current.document.canvas.height, resolved.y)),
      };
    };
    const clearDrawing = () => {
      if (drawingRef.current) canvas.remove(drawingRef.current.preview);
      drawingRef.current = null;
      measureRef.current = null;
      canvas.requestRenderAll();
    };
    const select = () => {
      if (!alive || suppressSelection.current) return;
      const ids = canvas.getActiveObjects().flatMap((object) => {
        const binding = bindingsRef.current.get(object);
        return binding ? [binding.id] : [];
      });
      propsRef.current.onSelect(ids);
    };
    canvas.on("selection:created", select);
    canvas.on("selection:updated", select);
    canvas.on("selection:cleared", select);
    canvas.on("mouse:down", (event) => {
      if (!alive || ("button" in event.e && event.e.button !== 0)) return;
      scrollRef.current?.focus({ preventScroll: true });
      const current = propsRef.current;
      const point = bounded(scenePoint(event.e));
      if (current.tool === "select") {
        const binding = event.target && bindingsRef.current.get(event.target);
        if (binding && !event.target?.selectable)
          current.onSelect([binding.id]);
        return;
      }
      if (current.tool === "rect") {
        const preview = new Rect({
          ...shapeOptions(true),
          left: point.x,
          top: point.y,
          width: 0,
          height: 0,
          fill: "#E8653618",
          stroke: "#E86536",
          strokeWidth: 1 / current.zoom,
          strokeDashArray: [6 / current.zoom, 4 / current.zoom],
          evented: false,
        });
        canvas.add(preview);
        drawingRef.current = { start: point, preview };
      } else if (current.tool === "measure") {
        const start = measureRef.current ?? point;
        const secondClick = measureRef.current !== null;
        if (drawingRef.current) canvas.remove(drawingRef.current.preview);
        const preview = new Path(
          `M ${start.x} ${start.y} L ${point.x} ${point.y}`,
          {
            ...shapeOptions(true),
            fill: "",
            stroke: "#2563EB",
            strokeWidth: 2 / current.zoom,
            evented: false,
          },
        );
        canvas.add(preview);
        drawingRef.current = { start, preview, secondClick };
        measureRef.current = start;
      }
    });
    canvas.on("mouse:move", (event) => {
      if (!alive) return;
      const point = scenePoint(event.e);
      propsRef.current.onPointer(point);
      const drawing = drawingRef.current;
      if (!drawing) return;
      const end = bounded(point);
      if (propsRef.current.tool === "rect")
        drawing.preview.set({
          left: Math.min(drawing.start.x, end.x),
          top: Math.min(drawing.start.y, end.y),
          width: Math.abs(end.x - drawing.start.x),
          height: Math.abs(end.y - drawing.start.y),
        });
      else if (propsRef.current.tool === "measure") {
        canvas.remove(drawing.preview);
        drawing.preview = new Path(
          `M ${drawing.start.x} ${drawing.start.y} L ${end.x} ${end.y}`,
          {
            ...shapeOptions(true),
            fill: "",
            stroke: "#2563EB",
            strokeWidth: 2 / propsRef.current.zoom,
            evented: false,
          },
        );
        canvas.add(drawing.preview);
      }
      canvas.requestRenderAll();
    });
    canvas.on("mouse:up", (event) => {
      if (!alive) return;
      const drawing = drawingRef.current;
      if (!drawing) return;
      const current = propsRef.current;
      const end = bounded(scenePoint(event.e));
      if (current.tool === "rect") {
        const width = Math.abs(end.x - drawing.start.x);
        const height = Math.abs(end.y - drawing.start.y);
        clearDrawing();
        if (width >= 2 && height >= 2) {
          const next = createPanel(current.document, {
            x: Math.min(end.x, drawing.start.x),
            y: Math.min(end.y, drawing.start.y),
            width,
            height,
          });
          current.onChange(next);
          current.onSelect([next.panels[next.panels.length - 1].id]);
        }
      } else if (
        current.tool === "measure" &&
        (drawing.secondClick ||
          distance(drawing.start, end) * current.zoom >= 6)
      ) {
        const start = drawing.start;
        clearDrawing();
        if (distance(start, end) > 0) current.onMeasure(start, end);
      }
    });
    canvas.on("mouse:wheel", (event) => {
      if (!event.e.ctrlKey && !event.e.metaKey) return;
      event.e.preventDefault();
      event.e.stopPropagation();
      const current = propsRef.current;
      current.onZoomChange(
        previewDimensions(
          current.document.canvas,
          current.zoom * (event.e.deltaY < 0 ? 1.1 : 1 / 1.1),
          config.devicePixelRatio,
        ).zoom,
      );
    });
    canvas.on("object:moving", (event) => {
      const current = propsRef.current;
      const guides = current.document.guides;
      if (!guides?.snapToGrid || guides.gridStep <= 0) return;
      const objects =
        event.target instanceof ActiveSelection
          ? event.target.getObjects()
          : [event.target];
      const anchors: Point[] = [];
      for (const object of objects) {
        const binding = bindingsRef.current.get(object);
        if (!binding) continue;
        const matrix = util.multiplyTransformMatrices(
          object.calcTransformMatrix(),
          util.invertTransform(binding.initialMatrix),
        );
        const panel = current.document.panels.find(
          (item) => item.id === binding.id,
        );
        if (panel) anchors.push(panelBounds(changePanel(panel, matrix)));
        else {
          const annotation = current.document.annotations.find(
            (item) => item.id === binding.id,
          );
          if (annotation?.type === "text")
            anchors.push(pointAt(annotation, matrix));
          else if (annotation)
            anchors.push(
              pointAt(annotation.start, matrix),
              pointAt(annotation.end, matrix),
            );
        }
      }
      if (!anchors.length) return;
      const origin = {
        x: Math.min(...anchors.map((point) => point.x)),
        y: Math.min(...anchors.map((point) => point.y)),
      };
      const snapped = snapPoint(origin, guides.gridStep);
      // A selection snaps as a unit, preserving spacing among all its members.
      event.target.set({
        left: event.target.left + snapped.x - origin.x,
        top: event.target.top + snapped.y - origin.y,
      });
      event.target.setCoords();
    });
    canvas.on("object:modified", () => {
      if (!alive) return;
      const current = propsRef.current;
      const matrices = new Map<string, TMat2D>();
      const polygonPoints = new Map<string, Point[]>();
      for (const object of canvas.getObjects()) {
        const binding = bindingsRef.current.get(object);
        if (!binding) continue;
        const matrix = object.calcTransformMatrix();
        if (object instanceof Polygon) {
          const points = object.points.map((point) =>
            pointAt(
              {
                x: point.x - object.pathOffset.x,
                y: point.y - object.pathOffset.y,
              },
              matrix,
            ),
          );
          const panel = current.document.panels.find(
            (item) => item.id === binding.id,
          );
          if (
            panel?.type === "polygon" &&
            points.some(
              (point, index) =>
                Math.abs(point.x - panel.points[index].x) > 0.001 ||
                Math.abs(point.y - panel.points[index].y) > 0.001,
            )
          ) {
            polygonPoints.set(binding.id, points);
          }
        }
        if (matrixChanged(matrix, binding.initialMatrix))
          matrices.set(
            binding.id,
            util.multiplyTransformMatrices(
              matrix,
              util.invertTransform(binding.initialMatrix),
            ),
          );
      }
      if (!matrices.size && !polygonPoints.size) return;
      const panelChanges = new Map<string, { before: Panel; after: Panel }>();
      const panels = current.document.panels.map((panel) => {
        const matrix = matrices.get(panel.id);
        const points = polygonPoints.get(panel.id);
        if ((!matrix && !points) || panel.locked) return panel;
        const after =
          points && panel.type === "polygon"
            ? {
                ...panel,
                points,
                ...(panel.source
                  ? {
                      source: {
                        ...panel.source,
                        reviewStatus: "edited" as const,
                      },
                    }
                  : {}),
              }
            : changePanel(panel, matrix!);
        panelChanges.set(panel.id, { before: panel, after });
        return after;
      });
      const annotations = current.document.annotations.map((annotation) => {
        const matrix = matrices.get(annotation.id);
        if (matrix)
          return changeAnnotation(annotation, (point) =>
            pointAt(point, matrix),
          );
        const panelChange =
          annotation.panelId && annotation.followPanel
            ? panelChanges.get(annotation.panelId)
            : undefined;
        if (!panelChange) return annotation;
        const from = panelBounds(panelChange.before);
        const to = panelBounds(panelChange.after);
        return changeAnnotation(annotation, (point) =>
          transformPoint(point, from, to),
        );
      });
      current.onChange({ ...current.document, panels, annotations });
    });
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drawingRef.current) clearDrawing();
    };
    window.addEventListener("keydown", cancel);
    return () => {
      alive = false;
      window.removeEventListener("keydown", cancel);
      drawingRef.current = null;
      measureRef.current = null;
      canvasRef.current = null;
      void canvas.dispose();
      host.replaceChildren();
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    suppressSelection.current = true;
    canvas.discardActiveObject();
    canvas.clear();
    bindingsRef.current = new WeakMap();
    drawingRef.current = null;
    measureRef.current = null;
    canvas.backgroundColor = doc.canvas.backgroundColor;
    const entries = [
      ...doc.panels
        .filter((panel) => panel.visible !== false)
        .map((panel) => ({
          entry: panel,
          object: makePanel(
            panel,
            doc.guides?.snapToGrid ? doc.guides.gridStep : 0,
          ),
        })),
      ...doc.annotations
        .filter((annotation) => annotation.visible !== false)
        .map((annotation) => ({
          entry: annotation,
          object: makeAnnotation(annotation),
        })),
    ].sort((a, b) => a.entry.z - b.entry.z);
    for (const { entry, object } of entries) {
      canvas.add(object);
      object.setCoords();
      bindingsRef.current.set(object, {
        id: entry.id,
        initialMatrix: [...object.calcTransformMatrix()],
      });
    }
    suppressSelection.current = false;
    syncSelection();
    const controller = new AbortController();
    const reference = doc.referenceImage;
    const asset =
      reference && doc.assets.find((item) => item.id === reference.assetId);
    if (reference?.visible && asset?.source.type === "embedded") {
      void FabricImage.fromURL(
        asset.source.data,
        { signal: controller.signal },
        {
          ...shapeOptions(true),
          evented: false,
          left: reference.bbox.x,
          top: reference.bbox.y,
          opacity: reference.opacity,
          strokeWidth: 0,
        },
      )
        .then((image) => {
          if (controller.signal.aborted || canvas.disposed) return;
          image.set({
            scaleX: reference.bbox.width / image.width,
            scaleY: reference.bbox.height / image.height,
          });
          canvas.add(image);
          canvas.sendObjectToBack(image);
          canvas.requestRenderAll();
        })
        .catch(() => {
          /* Invalid embedded images never block editable geometry. */
        });
    }
    canvas.requestRenderAll();
    return () => controller.abort();
  }, [doc]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.enableRetinaScaling = preview.retina;
    // Fabric writes width before height; clear first to avoid a giant transient
    // allocation when switching from a tall page to a wide page.
    canvas.setDimensions({ width: 0, height: 0 }, { backstoreOnly: true });
    canvas.setDimensions({ width, height });
    canvas.setZoom(zoom);
    canvas.calcOffset();
    canvas.requestRenderAll();
  }, [width, height, zoom, preview.retina]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.selection = tool === "select";
    canvas.skipTargetFind = tool !== "select";
    canvas.defaultCursor =
      tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair";
    if (drawingRef.current) canvas.remove(drawingRef.current.preview);
    drawingRef.current = null;
    measureRef.current = null;
    syncSelection();
  }, [tool, selectedIds]);

  const rulerStep = 10 ** Math.ceil(Math.log10(80 / zoom));
  const gridStep = (doc.guides?.gridStep ?? 100) * zoom;
  return (
    <div
      ref={scrollRef}
      className="stage-scroll"
      tabIndex={0}
      aria-label="画布工作区"
      style={{
        overflow: "auto",
        minWidth: 0,
        cursor: tool === "pan" ? "grab" : undefined,
      }}
      onPointerDown={(event) => {
        if (tool !== "pan" || event.button !== 0) return;
        const scroll = scrollRef.current;
        if (!scroll) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        panRef.current = {
          x: event.clientX,
          y: event.clientY,
          left: scroll.scrollLeft,
          top: scroll.scrollTop,
        };
      }}
      onPointerMove={(event) => {
        const pan = panRef.current;
        const scroll = scrollRef.current;
        if (!pan || !scroll) return;
        scroll.scrollLeft = pan.left - (event.clientX - pan.x);
        scroll.scrollTop = pan.top - (event.clientY - pan.y);
      }}
      onPointerUp={() => {
        panRef.current = null;
      }}
      onPointerCancel={() => {
        panRef.current = null;
      }}
    >
      <div
        className="stage-paper"
        style={{
          width,
          height,
          position: "relative",
          margin: "32px auto",
          flexShrink: 0,
        }}
      >
        <div
          ref={hostRef}
          className="stage-canvas"
          style={{ position: "absolute", inset: 0, zIndex: 1 }}
        />
        {doc.guides?.gridVisible && gridStep >= 5 && (
          <div
            aria-hidden="true"
            className="stage-grid"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              pointerEvents: "none",
              backgroundImage: `linear-gradient(to right, ${doc.guides.gridColor ?? "#94A3B830"} 1px, transparent 1px), linear-gradient(to bottom, ${doc.guides.gridColor ?? "#94A3B830"} 1px, transparent 1px)`,
              backgroundSize: `${gridStep}px ${gridStep}px`,
            }}
          />
        )}
        {doc.guides?.rulersVisible && (
          <svg
            className="stage-rulers"
            aria-hidden="true"
            width={width + 24}
            height={height + 24}
            style={{
              position: "absolute",
              left: -24,
              top: -24,
              zIndex: 3,
              pointerEvents: "none",
              overflow: "visible",
            }}
          >
            <rect x={0} y={0} width={width + 24} height={24} fill="#F4F2ED" />
            <rect x={0} y={0} width={24} height={height + 24} fill="#F4F2ED" />
            <g
              fill="#737168"
              stroke="#C4C0B7"
              fontSize={9}
              fontFamily="monospace"
            >
              {Array.from(
                {
                  length: Math.min(
                    500,
                    Math.floor(doc.canvas.width / rulerStep) + 1,
                  ),
                },
                (_, index) => {
                  const x = index * rulerStep * zoom + 24;
                  return (
                    <g key={`x${index}`}>
                      <line x1={x} x2={x} y1={16} y2={24} />
                      <text x={x + 3} y={12} stroke="none">
                        {index * rulerStep}
                      </text>
                    </g>
                  );
                },
              )}
              {Array.from(
                {
                  length: Math.min(
                    500,
                    Math.floor(doc.canvas.height / rulerStep) + 1,
                  ),
                },
                (_, index) => {
                  const y = index * rulerStep * zoom + 24;
                  return (
                    <g key={`y${index}`}>
                      <line x1={16} x2={24} y1={y} y2={y} />
                      <text
                        x={3}
                        y={y + 11}
                        stroke="none"
                        transform={`rotate(-90 3 ${y + 11})`}
                      >
                        {index * rulerStep}
                      </text>
                    </g>
                  );
                },
              )}
            </g>
            <rect x={0} y={0} width={24} height={24} fill="#E9E5DE" />
          </svg>
        )}
      </div>
    </div>
  );
}
