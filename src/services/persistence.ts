import {
  parseDocument,
  serializeDocument,
  type GridDocument,
} from "../core/document";

const DATABASE = "gridlens-projects";
const STORE = "autosave";
const KEY = "current-document";
let databasePromise: Promise<IDBDatabase> | null = null;

function storageError(error: unknown): Error {
  const name = error instanceof DOMException ? error.name : "";
  return new Error(
    name === "QuotaExceededError"
      ? "浏览器存储空间不足，自动保存失败，请下载项目 JSON 以保留修改。"
      : "浏览器本地存储不可用，请下载项目 JSON 以保留修改。",
  );
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(storageError(null));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () =>
      reject(
        new Error(
          "本地存储升级被其他标签页阻塞，请关闭旧的 GridLens 标签页后重试。",
        ),
      );
  }).catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

export async function saveDocument(doc: GridDocument): Promise<void> {
  // Validate and capture the snapshot before an asynchronous write starts.
  const snapshot = serializeDocument(doc);
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    try {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(snapshot, KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(storageError(transaction.error));
      transaction.onabort = () => reject(storageError(transaction.error));
    } catch (error) {
      reject(storageError(error));
    }
  });
}

export async function loadDocument(): Promise<GridDocument | null> {
  const database = await openDatabase();
  const saved = await new Promise<unknown>((resolve, reject) => {
    try {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(storageError(request.error));
      transaction.onabort = () => reject(storageError(transaction.error));
    } catch (error) {
      reject(storageError(error));
    }
  });
  if (saved === undefined) return null;
  if (typeof saved !== "string")
    throw new Error("自动保存的项目格式无效，请导入手动保存的项目 JSON。");
  try {
    return parseDocument(saved);
  } catch {
    throw new Error(
      "自动保存的项目无法通过格式校验，请导入手动保存的项目 JSON。",
    );
  }
}
