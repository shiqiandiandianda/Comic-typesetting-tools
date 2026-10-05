import type { Asset } from "../core/document";
import type { DetectedPanel } from "./detection";

export type { DetectedPanel } from "./detection";
export interface RecognitionOptions {
  minSize: number;
  threshold: number;
}
export interface RecognitionRequest {
  data: string;
  options: RecognitionOptions;
}
export type RecognitionResponse =
  | { type: "result"; panels: DetectedPanel[] }
  | { type: "error"; message: string };

/** Each job owns its worker. Termination also releases all WASM memory. */
export function startRecognition(
  asset: Asset,
  options: RecognitionOptions,
): { promise: Promise<DetectedPanel[]>; cancel(): void } {
  let worker: Worker | undefined;
  let settled = false;
  let rejectPromise: (error: Error) => void = () => {};
  const cleanup = () => {
    worker?.terminate();
    worker = undefined;
  };
  const promise = new Promise<DetectedPanel[]>((resolve, reject) => {
    rejectPromise = reject;
    if (asset.source.type !== "embedded") {
      settled = true;
      reject(new Error("图片尚未关联，请重新选择本地参考图片。"));
      return;
    }
    if (
      !Number.isFinite(options.minSize) ||
      options.minSize < 1 ||
      !Number.isFinite(options.threshold) ||
      options.threshold < 1 ||
      options.threshold > 254
    ) {
      settled = true;
      reject(new Error("最小格子需至少 1 px，边框阈值需在 1–254 之间。"));
      return;
    }
    try {
      worker = new Worker(
        new URL("../workers/recognition.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (event: MessageEvent<RecognitionResponse>) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (event.data.type === "result") resolve(event.data.panels);
        else reject(new Error(event.data.message));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("识别引擎启动失败，请重试或手动补画格框。"));
      };
      worker.onmessageerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("识别结果无法读取，请重试。"));
      };
      worker.postMessage({
        data: asset.source.data,
        options,
      } satisfies RecognitionRequest);
    } catch {
      settled = true;
      cleanup();
      reject(
        new Error(
          "当前浏览器无法启动本地识别，请使用较新的 Chrome、Edge 或 Firefox。",
        ),
      );
    }
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(new DOMException("识别已取消。", "AbortError"));
    },
  };
}
