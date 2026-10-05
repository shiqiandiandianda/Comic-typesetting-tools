import {
  DocumentValidationError,
  validateDocument,
  type Annotation,
  type BBox,
  type GridDocument,
  type Panel,
  type PanelBase,
  type PanelStyle,
  type Point,
} from "./document";
import {
  isValidBBox,
  panelBounds,
  polygonArea,
  polygonIsSimple,
  transformPoint,
} from "./geometry";

export type PanelPatch = Partial<Omit<PanelBase, "id" | "style">> & {
  style?: Partial<PanelStyle>;
  bbox?: BBox;
  points?: Point[];
};
export type NewAnnotation = Annotation extends infer Item
  ? Item extends Annotation
    ? Omit<Item, "id">
    : never
  : never;

/** Stable readable IDs; all document entity namespaces are considered. */
export function uniqueId(document: GridDocument, prefix: string): string {
  const used = new Set([
    ...document.assets.map((item) => item.id),
    ...document.panels.map((item) => item.id),
    ...document.annotations.map((item) => item.id),
  ]);
  let index = 1;
  while (used.has(`${prefix}${String(index).padStart(2, "0")}`)) index++;
  return `${prefix}${String(index).padStart(2, "0")}`;
}

function assertBounds(bbox: BBox): void {
  if (!isValidBBox(bbox))
    throw new RangeError("格框坐标必须有限，宽高必须大于零。");
}

function requireValid(document: GridDocument): GridDocument {
  const result = validateDocument(document);
  if (!result.valid) throw new DocumentValidationError(result.errors);
  return document;
}

function nextZ(document: GridDocument): number {
  return Math.max(0, ...document.panels.map((panel) => panel.z)) + 10;
}

function nextReadOrder(document: GridDocument): number {
  return (
    Math.max(0, ...document.panels.map((panel) => panel.readOrder ?? 0)) + 1
  );
}

export function createPanel(document: GridDocument, bbox: BBox): GridDocument {
  assertBounds(bbox);
  const panel: Panel = {
    id: uniqueId(document, "P"),
    type: "rect",
    label: "新格框",
    bbox: { ...bbox },
    z: nextZ(document),
    readOrder: nextReadOrder(document),
    visible: true,
    locked: false,
    style: {
      fill: "#EDF4FB",
      stroke: "#F97316",
      strokeWidth: 4,
      frameVisible: true,
      opacity: 1,
    },
    source: { method: "manual", reviewStatus: "confirmed" },
  };
  return { ...document, panels: [...document.panels, panel] };
}

export function createPolygonPanel(
  document: GridDocument,
  points: readonly Point[],
): GridDocument {
  if (
    points.length < 3 ||
    !points.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ) ||
    !Number.isFinite(polygonArea(points)) ||
    polygonArea(points) === 0 ||
    !polygonIsSimple(points)
  ) {
    throw new RangeError("多边形至少需要三个有效顶点，且不能退化或自交。");
  }
  const panel: Panel = {
    id: uniqueId(document, "P"),
    type: "polygon",
    label: "新多边形",
    points: points.map((point) => ({ ...point })),
    z: nextZ(document),
    readOrder: nextReadOrder(document),
    visible: true,
    locked: false,
    style: {
      fill: "#EDF4FB",
      stroke: "#F97316",
      strokeWidth: 4,
      frameVisible: true,
      opacity: 1,
    },
    source: { method: "manual", reviewStatus: "confirmed" },
  };
  assertBounds(panelBounds(panel));
  return { ...document, panels: [...document.panels, panel] };
}

function editedSource(panel: Panel): Panel["source"] {
  return panel.source ? { ...panel.source, reviewStatus: "edited" } : undefined;
}

function transformAnnotation(
  annotation: Annotation,
  from: BBox,
  to: BBox,
): Annotation {
  if (annotation.type === "text") {
    // Coordinates follow the panel; font size remains a document pixel value.
    return { ...annotation, ...transformPoint(annotation, from, to) };
  }
  return {
    ...annotation,
    start: transformPoint(annotation.start, from, to),
    end: transformPoint(annotation.end, from, to),
  };
}

function transformPanel(panel: Panel, to: BBox): Panel {
  const from = panelBounds(panel);
  return panel.type === "rect"
    ? {
        ...panel,
        bbox: { ...to },
        ...(panel.source ? { source: editedSource(panel) } : {}),
      }
    : {
        ...panel,
        points: panel.points.map((point) => transformPoint(point, from, to)),
        ...(panel.source ? { source: editedSource(panel) } : {}),
      };
}

function applyBounds(
  document: GridDocument,
  targets: Map<string, BBox>,
): GridDocument {
  const before = new Map<string, BBox>();
  const panels = document.panels.map((panel) => {
    const target = targets.get(panel.id);
    if (!target || panel.locked) return panel;
    assertBounds(target);
    const from = panelBounds(panel);
    if (
      from.x === target.x &&
      from.y === target.y &&
      from.width === target.width &&
      from.height === target.height
    )
      return panel;
    before.set(panel.id, from);
    return transformPanel(panel, target);
  });
  if (!before.size) return document;
  const annotations = document.annotations.map((annotation) => {
    const from = annotation.panelId
      ? before.get(annotation.panelId)
      : undefined;
    const to = annotation.panelId ? targets.get(annotation.panelId) : undefined;
    return annotation.followPanel && from && to
      ? transformAnnotation(annotation, from, to)
      : annotation;
  });
  return { ...document, panels, annotations };
}

export function movePanels(
  document: GridDocument,
  ids: readonly string[],
  dx: number,
  dy: number,
): GridDocument {
  if (!Number.isFinite(dx) || !Number.isFinite(dy))
    throw new RangeError("移动距离必须是有限数值。");
  if (dx === 0 && dy === 0) return document;
  const selected = new Set(ids);
  const targets = new Map<string, BBox>();
  for (const panel of document.panels) {
    if (selected.has(panel.id) && !panel.locked) {
      const bbox = panelBounds(panel);
      targets.set(panel.id, { ...bbox, x: bbox.x + dx, y: bbox.y + dy });
    }
  }
  return applyBounds(document, targets);
}

export function resizePanel(
  document: GridDocument,
  id: string,
  bbox: BBox,
): GridDocument {
  const panel = document.panels.find((item) => item.id === id);
  if (!panel || panel.locked) return document;
  assertBounds(bbox);
  return applyBounds(document, new Map([[id, bbox]]));
}

/** Changes in reading order never implicitly reorder the paint stack. */
export function setReadOrder(
  document: GridDocument,
  id: string,
  readOrder: number,
): GridDocument {
  if (!Number.isInteger(readOrder) || readOrder < 1)
    throw new RangeError("阅读顺序必须是正整数。");
  return updatePanel(document, id, { readOrder });
}

export function updatePanel(
  document: GridDocument,
  id: string,
  patch: PanelPatch,
): GridDocument {
  const current = document.panels.find((panel) => panel.id === id);
  if (!current) return document;
  if (current.locked) {
    const allowed: PanelPatch = {};
    if (patch.locked !== undefined) allowed.locked = patch.locked;
    if (patch.visible !== undefined) allowed.visible = patch.visible;
    if (!Object.keys(allowed).length) return document;
    return {
      ...document,
      panels: document.panels.map((panel) =>
        panel.id === id ? ({ ...panel, ...allowed } as Panel) : panel,
      ),
    };
  }
  let next = document;
  if (patch.bbox) next = resizePanel(next, id, patch.bbox);
  const { bbox: _bbox, points, style, ...properties } = patch;
  const panel = next.panels.find((item) => item.id === id);
  if (!panel) return next;
  let updated: Panel = {
    ...panel,
    ...properties,
    style: { ...panel.style, ...style },
  };
  let annotations = next.annotations;
  if (points && panel.type === "polygon") {
    const before = panelBounds(panel);
    updated = {
      ...updated,
      type: "polygon",
      points: points.map((point) => ({ ...point })),
      ...(panel.source ? { source: editedSource(panel) } : {}),
    };
    const after = panelBounds(updated);
    annotations = annotations.map((annotation) =>
      annotation.panelId === id && annotation.followPanel
        ? transformAnnotation(annotation, before, after)
        : annotation,
    );
  }
  return requireValid({
    ...next,
    panels: next.panels.map((item) => (item.id === id ? updated : item)),
    annotations,
  });
}

export function deletePanels(
  document: GridDocument,
  ids: readonly string[],
  options: { annotations?: "keep" | "delete" } = {},
): GridDocument {
  const selected = new Set(ids);
  const deleted = new Set(
    document.panels
      .filter((panel) => selected.has(panel.id) && !panel.locked)
      .map((panel) => panel.id),
  );
  if (!deleted.size) return document;
  const annotations = document.annotations.flatMap((annotation) => {
    if (!annotation.panelId || !deleted.has(annotation.panelId))
      return [annotation];
    if (options.annotations === "delete") return [];
    const {
      panelId: _panelId,
      followPanel: _followPanel,
      ...independent
    } = annotation;
    return [independent as Annotation];
  });
  return {
    ...document,
    panels: document.panels.filter((panel) => !deleted.has(panel.id)),
    annotations,
  };
}

export function duplicatePanels(
  document: GridDocument,
  ids: readonly string[],
  offset: Point = { x: 24, y: 24 },
): GridDocument {
  const selected = new Set(ids);
  let next = document;
  for (const panel of document.panels.filter(
    (item) => selected.has(item.id) && !item.locked,
  )) {
    const bounds = panelBounds(panel);
    const to = { ...bounds, x: bounds.x + offset.x, y: bounds.y + offset.y };
    assertBounds(to);
    const copy: Panel = {
      ...transformPanel(panel, to),
      id: uniqueId(next, "P"),
      label: `${panel.label || panel.id} 副本`,
      z: nextZ(next),
      readOrder: nextReadOrder(next),
      locked: false,
    };
    next = { ...next, panels: [...next.panels, copy] };
    for (const annotation of document.annotations.filter(
      (item) => item.panelId === panel.id && item.followPanel,
    )) {
      const copyAnnotation = transformAnnotation(annotation, bounds, to);
      next = {
        ...next,
        annotations: [
          ...next.annotations,
          {
            ...copyAnnotation,
            id: uniqueId(
              next,
              annotation.type === "text"
                ? "B"
                : annotation.type === "dimension"
                  ? "D"
                  : "A",
            ),
            panelId: copy.id,
          },
        ],
      };
    }
  }
  return next;
}

export function createAnnotation(
  document: GridDocument,
  annotation: NewAnnotation,
): GridDocument {
  const prefix =
    annotation.type === "text"
      ? "B"
      : annotation.type === "dimension"
        ? "D"
        : "A";
  return requireValid({
    ...document,
    annotations: [
      ...document.annotations,
      {
        ...structuredClone(annotation),
        id: uniqueId(document, prefix),
      } as Annotation,
    ],
  });
}

export function removeAnnotation(
  document: GridDocument,
  id: string,
): GridDocument {
  if (!document.annotations.some((annotation) => annotation.id === id))
    return document;
  return {
    ...document,
    annotations: document.annotations.filter(
      (annotation) => annotation.id !== id,
    ),
  };
}
