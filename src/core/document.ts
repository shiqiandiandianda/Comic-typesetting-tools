import Ajv2020 from "ajv/dist/2020";
import schema from "../../docs/development-plan/gridlens.schema.json";
import example from "../../docs/development-plan/示例项目.json";
import {
  isValidBBox,
  panelBounds,
  polygonArea,
  polygonIsSimple,
} from "./geometry";

export interface Point {
  x: number;
  y: number;
}
export interface BBox extends Point {
  width: number;
  height: number;
}
export interface PanelStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  frameVisible?: boolean;
  opacity?: number;
}
export interface PanelSource {
  method: "manual" | "json" | "opencv";
  reviewStatus: "pending" | "confirmed" | "edited";
  score?: number;
  uncertaintyPx?: number;
}
export interface PanelBase {
  id: string;
  label?: string;
  visible?: boolean;
  locked?: boolean;
  z: number;
  readOrder?: number;
  style: PanelStyle;
  source?: PanelSource;
}
export interface RectPanel extends PanelBase {
  type: "rect";
  bbox: BBox;
}
export interface PolygonPanel extends PanelBase {
  type: "polygon";
  points: Point[];
}
export type Panel = RectPanel | PolygonPanel;

export interface AnnotationBase {
  id: string;
  z: number;
  visible?: boolean;
  color: string;
  panelId?: string;
  followPanel?: boolean;
}
export interface TextAnnotation extends AnnotationBase {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily?: string;
}
export interface ArrowAnnotation extends AnnotationBase {
  type: "arrow";
  start: Point;
  end: Point;
  strokeWidth: number;
  label?: string;
}
export interface DimensionAnnotation extends AnnotationBase {
  type: "dimension";
  start: Point;
  end: Point;
  mode: "horizontal" | "vertical" | "distance";
  label?: string;
}
export type Annotation = TextAnnotation | ArrowAnnotation | DimensionAnnotation;

export interface Asset {
  id: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  source:
    | { type: "embedded"; data: string }
    | { type: "relative-file"; path: string };
}
export interface ReferenceImage {
  assetId: string;
  bbox: BBox;
  opacity: number;
  visible: boolean;
  locked: boolean;
  exportable: boolean;
}
export interface Guides {
  gridVisible: boolean;
  gridStep: number;
  gridColor?: string;
  snapToGrid: boolean;
  rulersVisible?: boolean;
}
export interface GridDocument {
  format: "gridlens";
  schemaVersion: "1.0.0";
  coordinateSpace: "canvas-px";
  title?: string;
  canvas: {
    width: number;
    height: number;
    backgroundColor: string;
    clipToCanvas?: boolean;
  };
  assets: Asset[];
  referenceImage?: ReferenceImage | null;
  panels: Panel[];
  annotations: Annotation[];
  guides?: Guides;
  metadata?: Record<string, unknown>;
}

export interface ValidationIssue {
  path: string;
  message: string;
}
export type ValidationResult =
  | { valid: true; document: GridDocument }
  | { valid: false; errors: ValidationIssue[] };

export class DocumentValidationError extends Error {
  readonly errors: ValidationIssue[];
  constructor(errors: ValidationIssue[]) {
    super(
      errors
        .map((error) => `${error.path || "/"}：${error.message}`)
        .join("\n"),
    );
    this.name = "DocumentValidationError";
    this.errors = errors;
  }
}

const validator = new Ajv2020({
  allErrors: true,
  strict: true,
}).compile<GridDocument>(schema);

function jsonNumberIssues(
  value: unknown,
  issues: ValidationIssue[],
  path = "",
  seen = new WeakSet<object>(),
): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    issues.push({ path, message: "数值必须有限，不能是 NaN 或 Infinity。" });
  } else if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      issues.push({ path, message: "文档不能包含循环对象引用。" });
      return;
    }
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      jsonNumberIssues(
        child,
        issues,
        `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        seen,
      );
    }
    seen.delete(value);
  }
}

/** Schema first, then relationships and geometry. Nothing is coerced or repaired. */
export function validateDocument(value: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  jsonNumberIssues(value, errors);
  if (errors.length) return { valid: false, errors };
  if (!validator(value)) {
    return {
      valid: false,
      errors: (validator.errors ?? []).map((error) => ({
        path:
          error.keyword === "required"
            ? `${error.instancePath}/${String(error.params.missingProperty)}`
            : error.instancePath,
        message: error.message ?? "文档格式不符合 GridLens 1.0.0 规范。",
      })),
    };
  }
  const seenIds = new Set<string>();
  for (const key of ["assets", "panels", "annotations"] as const) {
    value[key].forEach((item, index) => {
      if (seenIds.has(item.id))
        errors.push({
          path: `/${key}/${index}/id`,
          message: `ID「${item.id}」重复。`,
        });
      seenIds.add(item.id);
    });
  }
  const assetIds = new Set(value.assets.map((asset) => asset.id));
  const panelIds = new Set(value.panels.map((panel) => panel.id));
  value.assets.forEach((asset, index) => {
    if (asset.source.type === "relative-file") {
      const segments = asset.source.path.split("/");
      if (
        segments[0] !== "assets" ||
        segments.some(
          (segment) => !segment || segment === ".." || segment === ".",
        )
      ) {
        errors.push({
          path: `/assets/${index}/source/path`,
          message:
            "资源必须使用 assets/ 下的安全相对路径，不能包含空段、. 或 ..。",
        });
      }
    } else {
      const prefix = `data:${asset.mimeType};base64,`;
      if (!asset.source.data.startsWith(prefix)) {
        errors.push({
          path: `/assets/${index}/source/data`,
          message: "嵌入图片类型必须与 mimeType 一致。",
        });
      }
    }
  });
  if (value.referenceImage) {
    if (!assetIds.has(value.referenceImage.assetId)) {
      errors.push({
        path: "/referenceImage/assetId",
        message: `缺少资源「${value.referenceImage.assetId}」。`,
      });
    }
    if (!isValidBBox(value.referenceImage.bbox)) {
      errors.push({
        path: "/referenceImage/bbox",
        message: "参考图范围必须具有有限的有效边界。",
      });
    }
  }
  value.panels.forEach((panel, index) => {
    if (!isValidBBox(panelBounds(panel))) {
      errors.push({
        path: `/panels/${index}`,
        message: "格框必须具有有限的有效边界。",
      });
    }
    if (panel.type === "polygon") {
      const area = polygonArea(panel.points);
      if (!Number.isFinite(area) || area === 0) {
        errors.push({
          path: `/panels/${index}/points`,
          message: "多边形面积必须非零且有限。",
        });
      } else if (!polygonIsSimple(panel.points)) {
        errors.push({
          path: `/panels/${index}/points`,
          message: "多边形不能自交、边线重叠或包含重复顶点。",
        });
      }
    }
  });
  value.annotations.forEach((annotation, index) => {
    if (annotation.panelId && !panelIds.has(annotation.panelId)) {
      errors.push({
        path: `/annotations/${index}/panelId`,
        message: `缺少关联格框「${annotation.panelId}」。`,
      });
    }
    if (annotation.followPanel && !annotation.panelId) {
      errors.push({
        path: `/annotations/${index}/panelId`,
        message: "跟随格框的标注必须指定 panelId。",
      });
    }
  });
  return errors.length
    ? { valid: false, errors }
    : { valid: true, document: value };
}

export function parseDocument(text: string): GridDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DocumentValidationError([
      { path: "/", message: "JSON 语法错误，请检查引号、逗号与括号。" },
    ]);
  }
  const result = validateDocument(value);
  if (!result.valid) throw new DocumentValidationError(result.errors);
  return result.document;
}

export function createExampleDocument(): GridDocument {
  return parseDocument(JSON.stringify(example));
}

export function createEmptyDocument(): GridDocument {
  return {
    format: "gridlens",
    schemaVersion: "1.0.0",
    coordinateSpace: "canvas-px",
    title: "未命名项目",
    canvas: {
      width: 1280,
      height: 3840,
      backgroundColor: "#FFFFFF",
      clipToCanvas: true,
    },
    assets: [],
    referenceImage: null,
    panels: [],
    annotations: [],
    guides: {
      gridVisible: true,
      gridStep: 256,
      gridColor: "#DD486080",
      snapToGrid: false,
      rulersVisible: true,
    },
  };
}

export function serializeDocument(document: GridDocument): string {
  const result = validateDocument(document);
  if (!result.valid) throw new DocumentValidationError(result.errors);
  // Six decimal places retain subpixel accuracy without mutating the live model.
  return JSON.stringify(
    document,
    (_key, value: unknown) => {
      if (typeof value !== "number") return value;
      return Number.isInteger(value) ? value : Number(value.toFixed(6));
    },
    2,
  );
}
