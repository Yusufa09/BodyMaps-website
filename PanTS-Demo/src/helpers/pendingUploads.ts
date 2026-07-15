// Resumable-upload store backed by IndexedDB.
//
// A chunked upload can be interrupted by a tab close/reload. The backend keeps
// every received chunk on disk (`/tmp/uploads/<session_id>/chunk-N`) and a
// re-sent chunk just overwrites, so the *server* side is already resumable —
// the only thing lost on reload is the browser's `File` object (in-memory refs
// don't survive a page unload). IndexedDB *does* persist Blobs across reloads,
// so we stash the picked file plus a chunk cursor here and resume on reopen.
//
// Everything is best-effort: if IndexedDB is unavailable or over quota, callers
// fall back to a normal (non-resumable) upload rather than failing the run.

export type PendingUpload = {
  sessionId: string;
  file: Blob;         // the picked File — File extends Blob, survives in IDB
  filename: string;
  model: string;
  bdmapId: string;
  totalChunks: number;
  nextChunk: number;  // first chunk not yet confirmed uploaded
};

const DB_NAME = "bodymaps-uploads";
const STORE = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "sessionId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest | void,
  onResult?: (req: IDBRequest) => T,
): Promise<T | void> {
  return openDb().then(db =>
    new Promise<T | void>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const req = fn(store);
      tx.oncomplete = () => { db.close(); resolve(req && onResult ? onResult(req) : undefined); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    })
  );
}

export async function savePendingUpload(p: PendingUpload): Promise<boolean> {
  try {
    await withStore("readwrite", store => store.put(p));
    return true;
  } catch (e) {
    console.warn("savePendingUpload failed — upload won't be resumable", e);
    return false;
  }
}

export async function setPendingNextChunk(sessionId: string, nextChunk: number): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const getReq = store.get(sessionId);
      getReq.onsuccess = () => {
        const rec = getReq.result as PendingUpload | undefined;
        if (rec) { rec.nextChunk = nextChunk; store.put(rec); }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.warn("setPendingNextChunk failed", e);
  }
}

export async function deletePendingUpload(sessionId: string): Promise<void> {
  try {
    await withStore("readwrite", store => store.delete(sessionId));
  } catch (e) {
    console.warn("deletePendingUpload failed", e);
  }
}

export async function loadPendingUploads(): Promise<PendingUpload[]> {
  try {
    const result = await withStore<PendingUpload[]>(
      "readonly",
      store => store.getAll(),
      req => (req.result as PendingUpload[]) || [],
    );
    return (result as PendingUpload[]) || [];
  } catch (e) {
    console.warn("loadPendingUploads failed", e);
    return [];
  }
}
