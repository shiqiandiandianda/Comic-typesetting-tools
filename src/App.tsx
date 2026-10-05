import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CanvasStage } from "./adapters/CanvasStage";
import {
  createEmptyDocument,
  createExampleDocument,
  parseDocument,
  validateDocument,
  type Annotation,
  type GridDocument,
  type Panel,
  type Point,
} from "./core/document";
import { panelBounds, panelGap } from "./core/geometry";
import { resizeCanvas } from "./core/canvas";
import {
  createAnnotation,
  createPanel,
  createPolygonPanel,
  deletePanels,
  duplicatePanels,
  movePanels,
  removeAnnotation,
  resizePanel,
  updatePanel,
} from "./core/commands";
import { downloadBlob, exportDocument } from "./services/export";
import { readImage } from "./services/image";
import { loadDocument, saveDocument } from "./services/persistence";
import { startRecognition } from "./features/recognition";

type Tool = "select" | "rect" | "measure" | "pan";
type History = {
  past: GridDocument[];
  present: GridDocument;
  future: GridDocument[];
};
type Action = { type: "edit"; doc: GridDocument } | { type: "undo" | "redo" };
function historyReducer(h: History, a: Action): History {
  if (a.type === "edit") {
    if (JSON.stringify(a.doc) === JSON.stringify(h.present)) return h;
    return {
      past: [...h.past.slice(-49), h.present],
      present: a.doc,
      future: [],
    };
  }
  if (a.type === "undo" && h.past.length)
    return {
      past: h.past.slice(0, -1),
      present: h.past.at(-1)!,
      future: [h.present, ...h.future],
    };
  if (a.type === "redo" && h.future.length)
    return {
      past: [...h.past, h.present],
      present: h.future[0],
      future: h.future.slice(1),
    };
  return h;
}
const fmt = (n: number) =>
  Number(n.toFixed(3)).toLocaleString("en-US", { maximumFractionDigits: 3 });
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  integer = false,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const submit = () => {
    const n = Number(draft);
    if (
      draft.trim() &&
      Number.isFinite(n) &&
      (min === undefined || n >= min) &&
      (max === undefined || n <= max) &&
      (!integer || Number.isInteger(n))
    )
      onChange(n);
    else setDraft(String(value));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        step={integer ? 1 : "any"}
        min={min}
        max={max}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            submit();
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => {
      d?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <div className="modal-title">
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="关闭对话框">
          关闭
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({
    past: [],
    present: createExampleDocument(),
    future: [],
  }));
  const doc = history.present;
  const docRef = useRef(doc);
  docRef.current = doc;
  const [selected, setSelected] = useState<string[]>(["P02"]);
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(0.15);
  const [pointer, setPointer] = useState<Point>({ x: 0, y: 0 });
  const [measurement, setMeasurement] = useState<{
    start: Point;
    end: Point;
  } | null>(null);
  const [notice, setNotice] = useState("示例已载入 · 选择格框开始编辑");
  const [modal, setModal] = useState<
    "json" | "export" | "help" | "delete" | null
  >(null);
  const [scaleObjects, setScaleObjects] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [saveState, setSaveState] = useState("尚未修改");
  const [dirty, setDirty] = useState(false);
  const [recoverable, setRecoverable] = useState<GridDocument | null>(null);
  const [mobilePanel, setMobilePanel] = useState<
    "canvas" | "project" | "properties"
  >("canvas");
  const [exportFormat, setExportFormat] = useState<"png" | "jpeg" | "svg">(
    "png",
  );
  const [exportScale, setExportScale] = useState(1);
  const [jpegBackground, setJpegBackground] = useState("#FFFFFF");
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [includeReference, setIncludeReference] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);
  const [detectBusy, setDetectBusy] = useState(false);
  const [minSize, setMinSize] = useState(60);
  const [threshold, setThreshold] = useState(160);
  const detection = useRef<ReturnType<typeof startRecognition> | null>(null);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const relinkInput = useRef<HTMLInputElement>(null);
  const stageHost = useRef<HTMLDivElement>(null);
  const panel = doc.panels.find((p) => p.id === selected[0]);
  const annotation = doc.annotations.find((a) => a.id === selected[0]);
  const bounds = panel ? panelBounds(panel) : null;
  const selectedPanels = doc.panels.filter((p) => selected.includes(p.id));
  const gap =
    selectedPanels.length === 2
      ? panelGap(selectedPanels[0], selectedPanels[1])
      : null;
  const pending = doc.panels.filter(
    (p) => p.source?.reviewStatus === "pending",
  ).length;
  const asset = doc.assets.find((a) => a.id === doc.referenceImage?.assetId);

  const edit = useCallback((next: GridDocument) => {
    const result = validateDocument(next);
    if (!result.valid) {
      setNotice(
        result.errors
          .map((e) => `${e.path}: ${e.message}`)
          .slice(0, 3)
          .join("\n"),
      );
      return;
    }
    dispatch({ type: "edit", doc: next });
    setDirty(true);
  }, []);
  const cancelDetection = useCallback(() => {
    generation.current++;
    detection.current?.cancel();
    detection.current = null;
    setDetectBusy(false);
  }, []);
  const replace = (next: GridDocument) => {
    cancelDetection();
    edit(next);
    setSelected([]);
    setMeasurement(null);
  };

  useEffect(() => {
    let active = true;
    void loadDocument()
      .then((saved) => {
        if (active && saved) setRecoverable(saved);
      })
      .catch((e) => {
        if (active) setSaveState(`恢复不可用：${errorText(e)}`);
      });
    return () => {
      active = false;
    };
  }, []);
  const saveQueue = useRef(Promise.resolve());
  useEffect(() => {
    if (!dirty) return;
    let active = true;
    setSaveState("等待保存…");
    const timer = window.setTimeout(() => {
      setSaveState("保存中…");
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(() => saveDocument(doc));
      void saveQueue.current
        .then(() => {
          if (active) setSaveState("已自动保存到本机");
        })
        .catch((e) => {
          if (active)
            setSaveState(`自动保存失败：${errorText(e)}，请下载 JSON`);
        });
    }, 600);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [doc, dirty]);
  useEffect(
    () => () => {
      detection.current?.cancel();
    },
    [],
  );

  const performDelete = useCallback(
    (followers: "keep" | "delete" = "keep") => {
      let next = deletePanels(docRef.current, selected, {
        annotations: followers,
      });
      for (const id of selected) next = removeAnnotation(next, id);
      edit(next);
      setSelected([]);
      setModal(null);
    },
    [selected, edit],
  );
  const deleteSelected = useCallback(() => {
    const current = docRef.current;
    const removable = new Set(
      current.panels
        .filter((p) => selected.includes(p.id) && !p.locked)
        .map((p) => p.id),
    );
    if (current.annotations.some((a) => a.panelId && removable.has(a.panelId)))
      setModal("delete");
    else performDelete();
  }, [selected, performDelete]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true]",
        ) ||
        modal
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        setDirty(true);
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        downloadBlob(
          new Blob([JSON.stringify(docRef.current, null, 2)], {
            type: "application/json",
          }),
          "gridlens.json",
        );
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        edit(duplicatePanels(docRef.current, selected));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx =
          e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy =
          e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const next = movePanels(docRef.current, selected, dx, dy);
        edit({
          ...next,
          annotations: next.annotations.map((a) => {
            if (
              !selected.includes(a.id) ||
              (a.followPanel && a.panelId && selected.includes(a.panelId))
            )
              return a;
            return a.type === "text"
              ? { ...a, x: a.x + dx, y: a.y + dy }
              : {
                  ...a,
                  start: { x: a.start.x + dx, y: a.start.y + dy },
                  end: { x: a.end.x + dx, y: a.end.y + dy },
                };
          }),
        });
      } else if (!mod && !e.altKey) {
        const tools: Record<string, Tool> = {
          v: "select",
          r: "rect",
          m: "measure",
          h: "pan",
        };
        if (tools[e.key.toLowerCase()]) setTool(tools[e.key.toLowerCase()]);
        if (e.key === "Escape") {
          setTool("select");
          setSelected([]);
          setMeasurement(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, modal, edit, deleteSelected]);

  const fit = () => {
    const r = stageHost.current?.getBoundingClientRect();
    if (r)
      setZoom(
        Math.max(
          0.02,
          Math.min(
            2,
            (r.width - 110) / doc.canvas.width,
            (r.height - 150) / doc.canvas.height,
          ),
        ),
      );
  };
  const updateSelected = (patch: Partial<Panel>) => {
    if (panel) edit(updatePanel(doc, panel.id, patch));
  };
  const updateAnnotation = (patch: Partial<Annotation>) => {
    if (annotation)
      edit({
        ...doc,
        annotations: doc.annotations.map((a) =>
          a.id === annotation.id ? ({ ...a, ...patch } as Annotation) : a,
        ),
      });
  };
  const saveJSON = () => {
    downloadBlob(
      new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
      "gridlens.json",
    );
    setNotice("项目 JSON 已下载，图片资源随项目嵌入保存");
  };
  const importJSON = (text: string) => {
    try {
      const next = parseDocument(text);
      replace(next);
      setModal(null);
      setJsonError("");
      setNotice("JSON 已导入，原文档可通过撤销恢复");
    } catch (e) {
      setJsonError(errorText(e));
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) {
      setNotice("JSON 超过 32 MB，请缩小嵌入图片后重试");
      return;
    }
    const text = await file.text();
    setJsonDraft(text);
    setJsonError("");
    setModal("json");
  };
  const importImage = async (file?: File) => {
    if (!file) return;
    cancelDetection();
    setNotice("正在读取本地图片…");
    const token = generation.current;
    try {
      const image = await readImage(file);
      if (token !== generation.current) return;
      const next = createEmptyDocument();
      next.title = file.name;
      next.canvas.width = image.width;
      next.canvas.height = image.height;
      next.assets = [image];
      next.referenceImage = {
        assetId: image.id,
        bbox: { x: 0, y: 0, width: image.width, height: image.height },
        opacity: 1,
        visible: true,
        locked: true,
        exportable: true,
      };
      edit(next);
      setSelected([]);
      setMeasurement(null);
      setNotice("图片已载入 · 可自动识别，也可用格框工具手工补画");
    } catch (e) {
      setNotice(errorText(e));
    }
  };
  const detect = async () => {
    if (!asset || !doc.referenceImage || detectBusy) return;
    const reference = doc.referenceImage;
    cancelDetection();
    const token = generation.current;
    setDetectBusy(true);
    setNotice("正在加载本地识别引擎并寻找格框…");
    const job = startRecognition(asset, { minSize, threshold });
    detection.current = job;
    try {
      const candidates = await job.promise;
      if (
        generation.current !== token ||
        docRef.current.referenceImage?.assetId !== asset.id
      )
        return;
      let next = deletePanels(
        docRef.current,
        docRef.current.panels
          .filter(
            (p) =>
              p.source?.method === "opencv" &&
              p.source.reviewStatus === "pending",
          )
          .map((p) => p.id),
      );
      const ids: string[] = [];
      for (const candidate of candidates) {
        const b = candidate.bbox;
        const mapped = {
          x: reference.bbox.x + (b.x * reference.bbox.width) / asset.width,
          y: reference.bbox.y + (b.y * reference.bbox.height) / asset.height,
          width: (b.width * reference.bbox.width) / asset.width,
          height: (b.height * reference.bbox.height) / asset.height,
        };
        if (
          next.panels.some((p) => {
            const existing = panelBounds(p);
            const tolerance =
              8 *
              Math.max(
                reference.bbox.width / asset.width,
                reference.bbox.height / asset.height,
              );
            return (
              Math.abs(existing.x - mapped.x) <= tolerance &&
              Math.abs(existing.y - mapped.y) <= tolerance &&
              Math.abs(existing.width - mapped.width) <= tolerance &&
              Math.abs(existing.height - mapped.height) <= tolerance
            );
          })
        )
          continue;
        next = candidate.points
          ? createPolygonPanel(
              next,
              candidate.points.map((p) => ({
                x:
                  reference.bbox.x + (p.x * reference.bbox.width) / asset.width,
                y:
                  reference.bbox.y +
                  (p.y * reference.bbox.height) / asset.height,
              })),
            )
          : createPanel(next, mapped);
        const newPanel = next.panels.at(-1)!;
        ids.push(newPanel.id);
        newPanel.style = { ...newPanel.style, fill: "transparent" };
        newPanel.source = {
          method: "opencv",
          reviewStatus: "pending",
          score: candidate.score,
        };
      }
      edit(next);
      setSelected(ids.slice(0, 1));
      setNotice(
        candidates.length
          ? `识别完成 · ${ids.length} 个候选待复核，已保留现有确认与修正结果`
          : "未检出格框 · 请调整边框强度，或手工补画",
      );
    } catch (e) {
      if (token === generation.current) setNotice(`识别失败：${errorText(e)}`);
    } finally {
      if (token === generation.current) {
        setDetectBusy(false);
        detection.current = null;
      }
    }
  };
  const relinkImage = async (file?: File) => {
    if (!file || !asset) return;
    cancelDetection();
    const token = generation.current;
    try {
      const image = await readImage(file);
      if (token !== generation.current) return;
      edit({
        ...docRef.current,
        assets: docRef.current.assets.map((a) =>
          a.id === asset.id ? { ...image, id: a.id } : a,
        ),
      });
      setNotice("参考图片已重新关联，格框与标注坐标保留");
    } catch (e) {
      setNotice(errorText(e));
    }
  };
  const doExport = async () => {
    setExportBusy(true);
    try {
      const blob = await exportDocument(doc, {
        format: exportFormat,
        scale: exportScale,
        jpegBackground,
        includeAnnotations,
        includeReference,
      });
      downloadBlob(
        blob,
        `gridlens.${exportFormat === "jpeg" ? "jpg" : exportFormat}`,
      );
      setNotice("导出完成 · 原始画布尺寸与倍率已应用");
      setModal(null);
    } catch (e) {
      setNotice(`导出失败：${errorText(e)}`);
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="app" data-mobile-panel={mobilePanel}>
      <header className="app-header">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <rect x="3" y="3" width="26" height="26" rx="5" />
            <path d="M9 9h14v14H9zM9 16h14M16 9v14" />
          </svg>
          <div>
            <h1>GridLens</h1>
            <span>漫画格框工作台</span>
          </div>
        </div>
        <div className="project-name">
          <strong>{doc.title || "未命名项目"}</strong>
          <span>{saveState}</span>
        </div>
        <div className="header-actions">
          <button onClick={saveJSON}>保存 JSON</button>
          <button className="primary" onClick={() => setModal("export")}>
            导出图片
          </button>
          <button
            className="help-button"
            onClick={() => setModal("help")}
            aria-label="操作帮助"
          >
            ?
          </button>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="工作区面板">
        {(
          [
            ["project", "项目"],
            ["canvas", "画布"],
            ["properties", "属性"],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            aria-pressed={mobilePanel === id}
            onClick={() => setMobilePanel(id)}
          >
            {text}
          </button>
        ))}
      </nav>
      <div className="workbench">
        <aside className="left-sidebar" aria-label="项目与图层">
          <section className="sidebar-section">
            <div className="section-heading">
              <h2>项目</h2>
              <span className="eyebrow">LOCAL FIRST</span>
            </div>
            <div className="button-grid">
              <button
                onClick={() => {
                  setJsonDraft(JSON.stringify(doc, null, 2));
                  setJsonError("");
                  setModal("json");
                }}
              >
                粘贴 JSON
              </button>
              <button onClick={() => fileInput.current?.click()}>
                导入文件
              </button>
              <button
                onClick={() => {
                  replace(createExampleDocument());
                  setNotice("示例已载入");
                }}
              >
                载入示例
              </button>
              <button
                onClick={() => {
                  replace(createEmptyDocument());
                  setNotice("新建画布 · 可开始绘制格框");
                }}
              >
                新建画布
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                void importImage(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </section>
          {recoverable && (
            <div className="recovery">
              <p>发现本机保存的项目</p>
              <button
                onClick={() => {
                  replace(recoverable);
                  setRecoverable(null);
                  setNotice("已恢复本机项目");
                }}
              >
                恢复项目
              </button>
              <button onClick={() => setRecoverable(null)}>稍后</button>
            </div>
          )}
          <section className="sidebar-section">
            <div className="section-heading">
              <h2>图片识别</h2>
              <span className="tag">本地处理</span>
            </div>
            <button
              className="full-width"
              onClick={() => imageInput.current?.click()}
            >
              载入参考图片
            </button>
            {asset ? (
              <>
                <p className="subtle">
                  {asset.width} × {asset.height} px ·{" "}
                  {asset.source.type === "embedded"
                    ? "图片已嵌入项目"
                    : "图片尚未关联"}
                </p>
                <input
                  ref={relinkInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => {
                    void relinkImage(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button
                  className="full-width"
                  onClick={() => relinkInput.current?.click()}
                >
                  重新关联参考图
                </button>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={doc.referenceImage?.visible ?? true}
                    onChange={(e) => {
                      if (doc.referenceImage)
                        edit({
                          ...doc,
                          referenceImage: {
                            ...doc.referenceImage,
                            visible: e.target.checked,
                          },
                        });
                    }}
                  />
                  显示参考图片
                </label>
                <div className="field-grid">
                  <NumberField
                    label="最小格边 / px"
                    value={minSize}
                    min={8}
                    integer
                    onChange={setMinSize}
                  />
                  <NumberField
                    label="边框强度 / 1–254"
                    value={threshold}
                    min={1}
                    integer
                    onChange={(n) => setThreshold(Math.min(254, n))}
                  />
                </div>
                <button
                  className="full-width primary"
                  onClick={() => void detect()}
                  disabled={detectBusy}
                >
                  自动识别格框
                </button>
                {detectBusy && (
                  <button
                    className="full-width"
                    onClick={() => {
                      cancelDetection();
                      setNotice("识别已取消");
                    }}
                  >
                    取消识别
                  </button>
                )}
                <p className="subtle">候选需要人工审核；漏格可手工补画。</p>
              </>
            ) : (
              <p className="subtle">从漫画图片生成格框候选，再确认与校正。</p>
            )}
          </section>
          <section className="sidebar-section layers">
            <div className="section-heading">
              <h2>格框</h2>
              <span className="count">{doc.panels.length} 个</span>
            </div>
            {pending > 0 && <p className="pending">{pending} 个候选待确认</p>}
            <div className="layer-list">
              {[...doc.panels]
                .sort((a, b) => b.z - a.z)
                .map((p) => (
                  <button
                    key={p.id}
                    className={`layer-row ${selected.includes(p.id) ? "is-selected" : ""}`}
                    aria-pressed={selected.includes(p.id)}
                    onClick={(e) => {
                      setSelected(
                        e.shiftKey
                          ? selected.includes(p.id)
                            ? selected.filter((id) => id !== p.id)
                            : [...selected, p.id]
                          : [p.id],
                      );
                      setTool("select");
                    }}
                  >
                    <span className="layer-mark" aria-hidden="true" />
                    <span className="layer-text">
                      <strong>{p.label || p.id}</strong>
                      <small>
                        {p.id} · Z {p.z} {p.locked ? "· 已锁定" : ""}
                      </small>
                    </span>
                    <span className="layer-state">
                      {p.source?.reviewStatus === "pending"
                        ? "待审"
                        : p.visible === false
                          ? "隐藏"
                          : p.type === "polygon"
                            ? "多边形"
                            : "矩形"}
                    </span>
                  </button>
                ))}
            </div>
            <button
              className="full-width add-layer"
              onClick={() => {
                const next = createPanel(doc, {
                  x: 64,
                  y: 64,
                  width: Math.min(480, doc.canvas.width / 2),
                  height: Math.min(320, doc.canvas.height / 2),
                });
                edit(next);
                setSelected([next.panels.at(-1)!.id]);
              }}
            >
              + 添加格框
            </button>
          </section>
          <section className="sidebar-section">
            <div className="section-heading">
              <h2>标注</h2>
              <span className="count">{doc.annotations.length}</span>
            </div>
            <div className="annotation-list">
              {doc.annotations.map((a) => (
                <button
                  className={selected.includes(a.id) ? "is-selected" : ""}
                  key={a.id}
                  onClick={() => setSelected([a.id])}
                >
                  {a.type === "text"
                    ? "文字"
                    : a.type === "arrow"
                      ? "箭头"
                      : "尺寸"}{" "}
                  · {a.type === "text" ? a.text.slice(0, 12) : a.id}
                </button>
              ))}
            </div>
            <div className="button-grid">
              {(["text", "arrow", "dimension"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    const x = bounds?.x ?? 64,
                      y = bounds?.y ?? 64;
                    const base = {
                      color: "#7C3AED",
                      z: 200,
                      visible: true,
                      ...(panel
                        ? { panelId: panel.id, followPanel: true }
                        : {}),
                    };
                    const next = createAnnotation(
                      doc,
                      type === "text"
                        ? {
                            ...base,
                            type,
                            x,
                            y,
                            text: "新标注",
                            fontSize: 32,
                            fontFamily: "Microsoft YaHei",
                          }
                        : type === "arrow"
                          ? {
                              ...base,
                              type,
                              start: { x, y },
                              end: { x: x + 200, y: y + 100 },
                              strokeWidth: 4,
                            }
                          : {
                              ...base,
                              type,
                              start: { x, y },
                              end: { x: x + 200, y },
                              mode: "horizontal",
                            },
                    );
                    edit(next);
                    setSelected([next.annotations.at(-1)!.id]);
                  }}
                >
                  {type === "text"
                    ? "+ 文字"
                    : type === "arrow"
                      ? "+ 箭头"
                      : "+ 尺寸"}
                </button>
              ))}
            </div>
          </section>
          <div className="sidebar-foot">
            坐标单位：原始像素
            <br />
            预览缩放不会改变项目数据
          </div>
        </aside>
        <main className="canvas-column" ref={stageHost} aria-label="画布工作区">
          <div className="canvas-toolbar">
            <div className="tool-group">
              {(
                [
                  ["select", "选择", "V"],
                  ["rect", "格框", "R"],
                  ["measure", "测量", "M"],
                  ["pan", "平移", "H"],
                ] as const
              ).map(([id, label, shortcut]) => (
                <button
                  key={id}
                  aria-pressed={tool === id}
                  className={tool === id ? "active" : ""}
                  onClick={() => setTool(id)}
                  title={`${label} (${shortcut})`}
                >
                  {label}
                  <kbd>{shortcut}</kbd>
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              <button
                disabled={!history.past.length}
                onClick={() => {
                  dispatch({ type: "undo" });
                  setDirty(true);
                }}
              >
                撤销
              </button>
              <button
                disabled={!history.future.length}
                onClick={() => {
                  dispatch({ type: "redo" });
                  setDirty(true);
                }}
              >
                重做
              </button>
              <span className="toolbar-divider" />
              <label className="zoom-control">
                <span className="sr-only">预览缩放</span>
                <select
                  aria-label="预览缩放"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                >
                  {![0.1, 0.25, 0.5, 1, 2].includes(zoom) && (
                    <option value={zoom}>{Math.round(zoom * 100)}%</option>
                  )}
                  {[0.1, 0.25, 0.5, 1, 2].map((z) => (
                    <option key={z} value={z}>
                      {z * 100}%
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={fit}>适应画布</button>
            </div>
          </div>
          <div className="canvas-info">
            <span>
              {doc.canvas.width} × {doc.canvas.height} px
            </span>
            <span>
              {tool === "rect"
                ? "在画布上拖动绘制格框"
                : tool === "measure"
                  ? "点击两点，测量原始像素距离"
                  : tool === "pan"
                    ? "拖动平移工作区"
                    : "Shift 多选 · 方向键微调 · 拖动手柄缩放"}
            </span>
          </div>
          <CanvasStage
            document={doc}
            selectedIds={selected}
            onSelect={setSelected}
            onChange={edit}
            tool={tool}
            zoom={zoom}
            onZoomChange={setZoom}
            onPointer={setPointer}
            onMeasure={(start, end) => {
              setMeasurement({ start, end });
            }}
          />
          {measurement && (
            <div className="measure-readout">
              <span>ΔX {fmt(measurement.end.x - measurement.start.x)} px</span>
              <span>ΔY {fmt(measurement.end.y - measurement.start.y)} px</span>
              <strong>
                距离{" "}
                {fmt(
                  Math.hypot(
                    measurement.end.x - measurement.start.x,
                    measurement.end.y - measurement.start.y,
                  ),
                )}{" "}
                px
              </strong>
              <button
                onClick={() => {
                  edit(
                    createAnnotation(doc, {
                      type: "dimension",
                      ...measurement,
                      mode: "distance",
                      color: "#2563EB",
                      z: 300,
                      visible: true,
                    }),
                  );
                  setMeasurement(null);
                }}
              >
                保存尺寸标注
              </button>
              <button
                aria-label="清除测量"
                onClick={() => setMeasurement(null)}
              >
                关闭
              </button>
            </div>
          )}
        </main>
        <aside className="right-sidebar" aria-label="属性编辑">
          <section className="sidebar-section">
            <div className="section-heading">
              <h2>画布设置</h2>
              <span className="eyebrow">CANVAS</span>
            </div>
            <div className="field-grid">
              <NumberField
                label="画布宽 / px"
                value={doc.canvas.width}
                min={1}
                max={32767}
                integer
                onChange={(width) =>
                  edit(
                    resizeCanvas(doc, width, doc.canvas.height, {
                      scaleObjects,
                    }),
                  )
                }
              />
              <NumberField
                label="画布高 / px"
                value={doc.canvas.height}
                min={1}
                max={32767}
                integer
                onChange={(height) =>
                  edit(
                    resizeCanvas(doc, doc.canvas.width, height, {
                      scaleObjects,
                    }),
                  )
                }
              />
            </div>
            <label className="field">
              <span>比例预设</span>
              <select
                aria-label="比例预设"
                defaultValue=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const [w, h] = e.target.value.split(":").map(Number);
                  const width = Math.min(
                    doc.canvas.width,
                    Math.floor((32767 * w) / h),
                  );
                  edit(
                    resizeCanvas(
                      doc,
                      width,
                      Math.max(1, Math.round((width * h) / w)),
                      { scaleObjects },
                    ),
                  );
                  e.target.value = "";
                }}
              >
                <option value="">自定义尺寸</option>
                {["1:3", "1:1", "4:3", "3:4", "9:16", "16:9"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={scaleObjects}
                onChange={(e) => setScaleObjects(e.target.checked)}
              />
              尺寸变化时同步缩放对象
            </label>
            <label className="color-field">
              <span>画布底色</span>
              <input
                type="color"
                aria-label="画布底色"
                value={
                  doc.canvas.backgroundColor === "transparent"
                    ? "#FFFFFF"
                    : doc.canvas.backgroundColor.slice(0, 7)
                }
                onChange={(e) =>
                  edit({
                    ...doc,
                    canvas: { ...doc.canvas, backgroundColor: e.target.value },
                  })
                }
              />
              <code>{doc.canvas.backgroundColor}</code>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={doc.canvas.backgroundColor === "transparent"}
                onChange={(e) =>
                  edit({
                    ...doc,
                    canvas: {
                      ...doc.canvas,
                      backgroundColor: e.target.checked
                        ? "transparent"
                        : "#FFFFFF",
                    },
                  })
                }
              />
              透明背景
            </label>
          </section>
          <section className="sidebar-section">
            <div className="section-heading">
              <h2>辅助显示</h2>
              <span className="eyebrow">GUIDES</span>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={doc.guides?.gridVisible ?? false}
                onChange={(e) =>
                  edit({
                    ...doc,
                    guides: {
                      gridStep: 256,
                      snapToGrid: false,
                      ...doc.guides,
                      gridVisible: e.target.checked,
                    },
                  })
                }
              />
              显示网格
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={doc.guides?.snapToGrid ?? false}
                onChange={(e) =>
                  edit({
                    ...doc,
                    guides: {
                      gridStep: 256,
                      gridVisible: true,
                      ...doc.guides,
                      snapToGrid: e.target.checked,
                    },
                  })
                }
              />
              吸附网格
            </label>
            <NumberField
              label="网格间距 / px"
              value={doc.guides?.gridStep ?? 256}
              min={1}
              onChange={(gridStep) =>
                edit({
                  ...doc,
                  guides: {
                    gridVisible: true,
                    snapToGrid: false,
                    ...doc.guides,
                    gridStep,
                  },
                })
              }
            />
            <label className="check">
              <input
                type="checkbox"
                checked={doc.guides?.rulersVisible ?? true}
                onChange={(e) =>
                  edit({
                    ...doc,
                    guides: {
                      gridVisible: false,
                      gridStep: 256,
                      snapToGrid: false,
                      ...doc.guides,
                      rulersVisible: e.target.checked,
                    },
                  })
                }
              />
              显示标尺
            </label>
          </section>
          <section className="sidebar-section object-properties">
            <div className="section-heading">
              <h2>对象属性</h2>
              <span className="tag">
                {selected.length > 1
                  ? `${selected.length} 个已选`
                  : panel?.id || annotation?.id || "未选择"}
              </span>
            </div>
            {panel && bounds ? (
              <>
                <label className="field">
                  <span>格框名称</span>
                  <input
                    aria-label="格框名称"
                    value={panel.label || ""}
                    onChange={(e) => updateSelected({ label: e.target.value })}
                  />
                </label>
                <div className="field-grid">
                  {(["x", "y", "width", "height"] as const).map((key, i) => (
                    <NumberField
                      key={key}
                      label={["X / px", "Y / px", "宽 / px", "高 / px"][i]}
                      value={bounds[key]}
                      min={
                        key === "width" || key === "height" ? 0.001 : undefined
                      }
                      disabled={panel.locked}
                      onChange={(n) =>
                        edit(
                          resizePanel(doc, panel.id, { ...bounds, [key]: n }),
                        )
                      }
                    />
                  ))}
                </div>
                <div className="geometry-summary">
                  {gap && (
                    <>
                      <span>
                        横向间距 / 交叠 <b>{fmt(gap.gapX)}</b>
                      </span>
                      <span>
                        纵向间距 / 交叠 <b>{fmt(gap.gapY)}</b>
                      </span>
                    </>
                  )}
                  <span>
                    右边界 <b>{fmt(bounds.x + bounds.width)}</b>
                  </span>
                  <span>
                    下边界 <b>{fmt(bounds.y + bounds.height)}</b>
                  </span>
                  <span>
                    宽高比 <b>{fmt(bounds.width / bounds.height)}</b>
                  </span>
                </div>
                <div className="field-grid">
                  <NumberField
                    label="叠放顺序 Z"
                    value={panel.z}
                    integer
                    onChange={(z) => updateSelected({ z })}
                  />
                  <NumberField
                    label="阅读顺序"
                    value={panel.readOrder ?? 1}
                    min={1}
                    integer
                    onChange={(readOrder) => updateSelected({ readOrder })}
                  />
                </div>
                <label className="color-field">
                  <span>描边颜色</span>
                  <input
                    type="color"
                    aria-label="描边颜色"
                    value={panel.style.stroke.slice(0, 7)}
                    onChange={(e) =>
                      updateSelected({
                        style: { ...panel.style, stroke: e.target.value },
                      })
                    }
                  />
                </label>
                <NumberField
                  label="描边宽 / px"
                  value={panel.style.strokeWidth}
                  min={0}
                  onChange={(strokeWidth) =>
                    updateSelected({ style: { ...panel.style, strokeWidth } })
                  }
                />
                <label className="color-field">
                  <span>填充颜色</span>
                  <input
                    type="color"
                    aria-label="格框填充颜色"
                    value={
                      panel.style.fill === "transparent"
                        ? "#FFFFFF"
                        : panel.style.fill.slice(0, 7)
                    }
                    onChange={(e) =>
                      updateSelected({
                        style: { ...panel.style, fill: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={panel.style.fill === "transparent"}
                    onChange={(e) =>
                      updateSelected({
                        style: {
                          ...panel.style,
                          fill: e.target.checked ? "transparent" : "#FFFFFF",
                        },
                      })
                    }
                  />
                  透明填充
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={panel.style.frameVisible !== false}
                    onChange={(e) =>
                      updateSelected({
                        style: {
                          ...panel.style,
                          frameVisible: e.target.checked,
                        },
                      })
                    }
                  />
                  显示描边
                </label>
                <NumberField
                  label="格框不透明度 / 0–1"
                  value={panel.style.opacity ?? 1}
                  min={0}
                  max={1}
                  onChange={(opacity) =>
                    updateSelected({ style: { ...panel.style, opacity } })
                  }
                />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={panel.locked ?? false}
                    onChange={(e) =>
                      updateSelected({ locked: e.target.checked })
                    }
                  />
                  锁定格框
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={panel.visible !== false}
                    onChange={(e) =>
                      updateSelected({ visible: e.target.checked })
                    }
                  />
                  显示格框
                </label>
                <div className="button-grid">
                  <button onClick={() => edit(duplicatePanels(doc, selected))}>
                    复制格框
                  </button>
                  <button
                    className="danger"
                    disabled={panel.locked}
                    onClick={deleteSelected}
                  >
                    删除格框
                  </button>
                </div>
                <div className="nudge-control" aria-label="格框微调">
                  {[
                    ["←", -1, 0],
                    ["↑", 0, -1],
                    ["↓", 0, 1],
                    ["→", 1, 0],
                  ].map(([label, dx, dy]) => (
                    <button
                      key={label}
                      aria-label={`向${label}移动1像素`}
                      disabled={panel.locked}
                      onClick={() =>
                        edit(movePanels(doc, selected, Number(dx), Number(dy)))
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {panel.source?.method === "opencv" && (
                  <div className="review-box">
                    <p>
                      识别候选 ·{" "}
                      {panel.source.reviewStatus === "pending"
                        ? "待确认"
                        : panel.source.reviewStatus === "edited"
                          ? "已修正"
                          : "已确认"}
                    </p>
                    <button
                      disabled={panel.source.reviewStatus === "confirmed"}
                      onClick={() =>
                        updateSelected({
                          source: {
                            ...panel.source!,
                            reviewStatus: "confirmed",
                          },
                        })
                      }
                    >
                      确认此格框
                    </button>
                  </div>
                )}
              </>
            ) : annotation ? (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={annotation.visible !== false}
                    onChange={(e) =>
                      edit({
                        ...doc,
                        annotations: doc.annotations.map((a) =>
                          a.id === annotation.id
                            ? { ...a, visible: e.target.checked }
                            : a,
                        ),
                      })
                    }
                  />
                  显示标注
                </label>
                {annotation.type === "text" && (
                  <>
                    <label className="field">
                      <span>标注文字</span>
                      <textarea
                        aria-label="标注文字"
                        value={annotation.text}
                        onChange={(e) =>
                          edit({
                            ...doc,
                            annotations: doc.annotations.map((a) =>
                              a.id === annotation.id && a.type === "text"
                                ? { ...a, text: e.target.value }
                                : a,
                            ),
                          })
                        }
                      />
                    </label>
                    <NumberField
                      label="字号 / px"
                      value={annotation.fontSize}
                      min={1}
                      onChange={(fontSize) =>
                        edit({
                          ...doc,
                          annotations: doc.annotations.map((a) =>
                            a.id === annotation.id && a.type === "text"
                              ? { ...a, fontSize }
                              : a,
                          ),
                        })
                      }
                    />
                  </>
                )}
                <label className="color-field">
                  <span>标注颜色</span>
                  <input
                    type="color"
                    aria-label="标注颜色"
                    value={annotation.color.slice(0, 7)}
                    onChange={(e) =>
                      edit({
                        ...doc,
                        annotations: doc.annotations.map((a) =>
                          a.id === annotation.id
                            ? { ...a, color: e.target.value }
                            : a,
                        ),
                      })
                    }
                  />
                </label>
                <div className="field-grid">
                  {annotation.type === "text" ? (
                    <>
                      <NumberField
                        label="文字 X / px"
                        value={annotation.x}
                        onChange={(x) => updateAnnotation({ x })}
                      />
                      <NumberField
                        label="文字 Y / px"
                        value={annotation.y}
                        onChange={(y) => updateAnnotation({ y })}
                      />
                    </>
                  ) : (
                    <>
                      {(["start", "end"] as const).flatMap((endpoint) =>
                        (["x", "y"] as const).map((axis) => (
                          <NumberField
                            key={endpoint + axis}
                            label={`${endpoint === "start" ? "起点" : "终点"} ${axis.toUpperCase()} / px`}
                            value={annotation[endpoint][axis]}
                            onChange={(n) =>
                              updateAnnotation({
                                [endpoint]: {
                                  ...annotation[endpoint],
                                  [axis]: n,
                                },
                              })
                            }
                          />
                        )),
                      )}
                    </>
                  )}
                </div>
                <label className="field">
                  <span>关联格框</span>
                  <select
                    aria-label="关联格框"
                    value={annotation.panelId || ""}
                    onChange={(e) => {
                      const {
                        panelId: _id,
                        followPanel: _follow,
                        ...base
                      } = annotation;
                      edit({
                        ...doc,
                        annotations: doc.annotations.map((a) =>
                          a.id === annotation.id
                            ? ({
                                ...base,
                                ...(e.target.value
                                  ? {
                                      panelId: e.target.value,
                                      followPanel: true,
                                    }
                                  : {}),
                              } as Annotation)
                            : a,
                        ),
                      });
                    }}
                  >
                    <option value="">独立标注</option>
                    {doc.panels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label || p.id}
                      </option>
                    ))}
                  </select>
                </label>
                {annotation.panelId && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={annotation.followPanel ?? false}
                      onChange={(e) =>
                        updateAnnotation({ followPanel: e.target.checked })
                      }
                    />
                    跟随格框移动
                  </label>
                )}
                {annotation.type === "dimension" && (
                  <label className="field">
                    <span>测量模式</span>
                    <select
                      aria-label="测量模式"
                      value={annotation.mode}
                      onChange={(e) =>
                        updateAnnotation({
                          mode: e.target.value as
                            "horizontal" | "vertical" | "distance",
                        })
                      }
                    >
                      <option value="horizontal">水平距离</option>
                      <option value="vertical">垂直距离</option>
                      <option value="distance">直线距离</option>
                    </select>
                  </label>
                )}
                <button className="danger full-width" onClick={deleteSelected}>
                  删除标注
                </button>
              </>
            ) : (
              <div className="empty-properties">
                <span className="empty-cross" aria-hidden="true">
                  +
                </span>
                <p>选择格框或标注</p>
                <small>在这里精确调整坐标与样式</small>
              </div>
            )}
          </section>
        </aside>
      </div>
      <footer className="status-bar">
        <span className="pointer-position">
          X {fmt(pointer.x)}　Y {fmt(pointer.y)}
        </span>
        <span className="notice" role="status" aria-live="polite">
          {notice}
        </span>
        <span>
          {Math.round(zoom * 100)}% ·{" "}
          {pending ? `${pending} 待确认` : "原始像素"}
        </span>
      </footer>
      {modal === "json" && (
        <Modal title="导入项目 JSON" onClose={() => setModal(null)}>
          <p className="subtle">
            导入前校验格式、坐标与资源引用。导入失败时保留当前文档。
          </p>
          <textarea
            className="json-editor"
            aria-label="项目 JSON"
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
            spellCheck={false}
          />
          {jsonError && (
            <pre className="form-error" role="alert">
              {jsonError}
            </pre>
          )}
          <div className="modal-actions">
            <button onClick={() => setModal(null)}>取消</button>
            <button className="primary" onClick={() => importJSON(jsonDraft)}>
              校验并导入
            </button>
          </div>
        </Modal>
      )}
      {modal === "export" && (
        <Modal title="导出图片" onClose={() => setModal(null)}>
          <label className="field">
            <span>文件格式</span>
            <select
              aria-label="导出格式"
              value={exportFormat}
              onChange={(e) =>
                setExportFormat(e.target.value as typeof exportFormat)
              }
            >
              <option value="png">PNG · 支持透明背景</option>
              <option value="jpeg">JPG · 适合图片分享</option>
              <option value="svg">SVG · 矢量格框与标注</option>
            </select>
          </label>
          <NumberField
            label="导出倍率"
            value={exportScale}
            min={0.1}
            disabled={exportFormat === "svg"}
            onChange={setExportScale}
          />
          <p className="subtle">
            输出尺寸：
            {Math.round(
              doc.canvas.width * (exportFormat === "svg" ? 1 : exportScale),
            )}{" "}
            ×{" "}
            {Math.round(
              doc.canvas.height * (exportFormat === "svg" ? 1 : exportScale),
            )}{" "}
            px
          </p>
          {exportFormat === "jpeg" && (
            <label className="color-field">
              <span>JPG 铺底颜色</span>
              <input
                aria-label="JPG铺底颜色"
                type="color"
                value={jpegBackground}
                onChange={(e) => setJpegBackground(e.target.value)}
              />
            </label>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={includeAnnotations}
              onChange={(e) => setIncludeAnnotations(e.target.checked)}
            />
            包含标注
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={includeReference}
              onChange={(e) => setIncludeReference(e.target.checked)}
            />
            包含参考图片
          </label>
          <p className="subtle">网格、标尺和选择手柄不会导出。</p>
          <div className="modal-actions">
            <button onClick={() => setModal(null)} disabled={exportBusy}>
              取消
            </button>
            <button
              className="primary"
              onClick={() => void doExport()}
              disabled={exportBusy}
            >
              {exportBusy ? "正在导出…" : "下载图片"}
            </button>
          </div>
        </Modal>
      )}
      {modal === "delete" && (
        <Modal title="删除格框与关联标注" onClose={() => setModal(null)}>
          <p className="subtle">
            选中的格框有关联标注。可以保留标注并解除关联，或一起删除。撤销可恢复。
          </p>
          <div className="modal-actions">
            <button onClick={() => setModal(null)}>取消</button>
            <button onClick={() => performDelete("keep")}>
              保留标注，删除格框
            </button>
            <button className="danger" onClick={() => performDelete("delete")}>
              一起删除
            </button>
          </div>
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="工作台操作" onClose={() => setModal(null)}>
          <div className="help-copy">
            <p>V 选择 · R 绘制格框 · M 两点测量 · H 平移</p>
            <p>Shift + 点击多选；方向键移动 1px，Shift + 方向键移动 10px。</p>
            <p>
              Ctrl/⌘ + Z 撤销，Shift + Ctrl/⌘ + Z 重做，Ctrl/⌘ + D 复制，Ctrl/⌘
              + S 保存 JSON。
            </p>
            <p>
              数值面板和方向按钮可替代拖动。输入数值后按 Enter
              或离开输入框应用。
            </p>
            <p>
              项目在本机浏览器自动保存，建议同时下载 JSON
              备份。图片识别结果需要人工确认。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
