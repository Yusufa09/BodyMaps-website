import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

const MODEL_OPTIONS: { id: string; label: string; desc: string }[] = [
  { id: "None",      label: "None",       desc: "View only — files never leave your browser" },
  { id: "ePAI",      label: "ePAI",       desc: "For detailed pancreas and tumor analysis" },
  { id: "SuPreM",    label: "SuPreM",     desc: "For whole-body scans from lungs to legs" },
  { id: "MedFormer", label: "MedFormer",  desc: "For reliable abdominal segmentation" },
  { id: "R-Super",   label: "R-Super",    desc: "For the highest tumor detection accuracy" },
  { id: "Atlas-Net", label: "Atlas-Net",  desc: "For anatomically consistent results" },
];
import { useNavigate } from 'react-router-dom';
import './UploadPage.css';

// Lazy so NiiVue / Cornerstone aren't pulled into the upload bundle until a file
// is actually previewed. CtPreview handles NIfTI, DicomPreview handles a DICOM series.
const CtPreview = lazy(() => import('../components/CtPreview/CtPreview'));
const DicomPreview = lazy(() => import('../components/CtPreview/DicomPreview'));
import { API_BASE } from '../helpers/constants';
import {
  addRecentUpload,
  formatRelativeTime,
  loadRecentUploads,
  recentStatusColor,
  removeRecentUpload,
  updateRecentUploadStatus,
  type RecentUpload,
} from '../helpers/recentUploads';
import Header from '../components/Header';
import { looksLikeDicom, setLocalDicomFiles } from '../helpers/dicomLocal';
import { setLocalNiftiFile } from '../helpers/localNifti';
import {
  deletePendingUpload,
  loadPendingUploads,
  savePendingUpload,
  setPendingNextChunk,
  type PendingUpload,
} from '../helpers/pendingUploads';

const parseApiResponse = async (res: Response): Promise<any> => {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  const text = await res.text();
  const shortBody = text.slice(0, 200).replace(/\s+/g, " ").trim();
  throw new Error(
    `Expected JSON but got ${contentType || "unknown content-type"} (HTTP ${res.status}). Body: ${shortBody}`
  );
};

// A selection is either a single NIfTI file or a picked DICOM folder (the series'
// raw .dcm slices). Both are previewable individually and runnable through inference.
type SelectedItem =
  | { id: string; kind: 'nifti'; file: File }
  | { id: string; kind: 'dicom'; files: File[]; label: string };

const UploadPage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Folder picker for a DICOM series (run inference, or view-only when model is "None").
  const dicomUploadInputRef = useRef<HTMLInputElement | null>(null);
  // One poll timer per in-flight session so runs can proceed in parallel.
  const pollTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // Whether the current foreground upload got stored in IndexedDB (resumable).
  // If IDB was unavailable we fall back to warning before an unload instead.
  const uploadResumableRef = useRef<boolean>(false);
  // AbortController per session so a mid-upload run can be cancelled cleanly.
  const uploadAbortRef = useRef<Map<string, AbortController>>(new Map());
  // Which session currently drives the foreground upload progress bar.
  const foregroundUploadSidRef = useRef<string | null>(null);

  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  // Which selected item's inline preview is open (null = none). One at a time.
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [serverPath, setServerPath] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [bdmapId, setBdmapId] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [inferenceCompleted, setInferenceCompleted] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<"None" | "ePAI" | "SuPreM" | "OpenVAE" | "MedFormer" | "R-Super" | "Atlas-Net" | "">("");
  const [modelDropOpen, setModelDropOpen] = useState(false);
  const modelDropRef = useRef<HTMLDivElement>(null);
  const [preDropOpen, setPreDropOpen] = useState(false);
  const preDropRef = useRef<HTMLDivElement>(null);
  const [preValue, setPreValue] = useState("");
  const [postDropOpen, setPostDropOpen] = useState(false);
  const postDropRef = useRef<HTMLDivElement>(null);
  const [postValue, setPostValue] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>(() => loadRecentUploads());
  // Sub-state of each Active card: "uploading" | "queued" | "running".
  const [sessionPhases, setSessionPhases] = useState<Record<string, string>>({});

  const setPhase = (sid: string, phase?: string) =>
    setSessionPhases(prev => {
      if (phase === undefined) {
        if (!(sid in prev)) return prev;
        const { [sid]: _dropped, ...rest } = prev;
        return rest;
      }
      return prev[sid] === phase ? prev : { ...prev, [sid]: phase };
    });

  const allowedExtensions = [".nii", ".nii.gz"];

  /* ── File handling ── */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const filteredFiles = Array.from(e.target.files).filter(file =>
      allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
    );
    if (filteredFiles.length === 0) {
      alert("Please select .nii or .nii.gz files only");
      return;
    }
    setSelectedItems(prev => [...prev, ...filteredFiles.map(f => ({ id: crypto.randomUUID(), kind: 'nifti' as const, file: f }))]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!e.dataTransfer.files) return;
    const filteredFiles = Array.from(e.dataTransfer.files).filter(file =>
      allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
    );
    if (filteredFiles.length === 0) {
      alert("Please drop .nii or .nii.gz files only");
      return;
    }
    setSelectedItems(prev => [...prev, ...filteredFiles.map(f => ({ id: crypto.randomUUID(), kind: 'nifti' as const, file: f }))]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const removeItem = (id: string) => {
    setSelectedItems(prev => prev.filter(item => item.id !== id));
    setPreviewItemId(prev => (prev === id ? null : prev));
  };

  // Pick a DICOM folder to RUN INFERENCE on (distinct from the view-only opener):
  // the raw slices are added as one selectable item, previewable and runnable.
  const handleDicomInferenceSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same folder later
    const candidates = files.filter(looksLikeDicom);
    if (!candidates.length) {
      alert("No DICOM files (.dcm) found in the selected folder.");
      return;
    }
    setSelectedItems(prev => [
      ...prev,
      { id: crypto.randomUUID(), kind: 'dicom', files: candidates, label: `DICOM series (${candidates.length} slices)` },
    ]);
  };

  /* ── Inference polling (one timer per session) ── */
  const stopPolling = (sid: string) => {
    const timer = pollTimersRef.current.get(sid);
    if (timer) {
      clearInterval(timer);
      pollTimersRef.current.delete(sid);
    }
  };

  const stopAllPolling = () => {
    pollTimersRef.current.forEach(timer => clearInterval(timer));
    pollTimersRef.current.clear();
  };

  const finishSession = (sid: string, model: string) => {
    stopPolling(sid);
    setPhase(sid);
    const uploads = updateRecentUploadStatus(sid, "Completed");
    setRecentUploads(uploads);
    setSessionId(sid);
    setInferenceCompleted(true);
    // Only auto-open the viewer when no other run is still in flight.
    if (!uploads.some(u => u.status === "Processing")) {
      setTimeout(() => {
        navigate(model === "OpenVAE" ? `/reconstruction/${sid}` : `/session/${sid}`);
      }, 600);
    }
  };

  const startInferencePolling = (sid: string, model: string) => {
    stopPolling(sid);
    let notFoundCount = 0;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/inference-status/${sid}`);
        const data = await parseApiResponse(res);
        const status = (data.status || "").toLowerCase();

        // The server doesn't know this session: the upload never finished
        // (tab closed mid-upload) or the backend restarted and lost its
        // in-memory job table. A few consecutive hits = gone, not a blip.
        if (status === "not_found") {
          notFoundCount += 1;
          if (notFoundCount >= 3) {
            stopPolling(sid);
            setPhase(sid);
            setRecentUploads(updateRecentUploadStatus(sid, "Failed"));
            setMessage("Session no longer exists on the server - marked as Failed.");
          }
          return;
        }
        notFoundCount = 0;

        if (!res.ok) throw new Error(data.error || data.status || "Status check failed");

        if (status === "completed") {
          finishSession(sid, model);
        } else if (status === "failed") {
          stopPolling(sid);
          setPhase(sid);
          setRecentUploads(updateRecentUploadStatus(sid, "Failed"));
          setMessage(`Inference failed${data.error ? `: ${data.error}` : ""}`);
        } else if (status === "cancelled") {
          // Cancelled elsewhere (another tab, or the backend) - reflect it.
          stopPolling(sid);
          setPhase(sid);
          setRecentUploads(updateRecentUploadStatus(sid, "Cancelled"));
        } else if (status === "queued" || status === "running") {
          setPhase(sid, status);
        }
      } catch (err) {
        // Network blip or proxy error while the backend restarts - the job
        // may still be alive server-side, so keep polling.
        console.error(err);
      }
    }, 2500);
    pollTimersRef.current.set(sid, timer);
  };

  // Cancel one run, whatever phase it's in: aborts an in-flight upload or
  // kills a queued/running server job.
  const cancelRun = (upload: RecentUpload) => {
    const sid = upload.sessionId;
    stopPolling(sid);
    setPhase(sid);

    const controller = uploadAbortRef.current.get(sid);
    if (controller) controller.abort();
    deletePendingUpload(sid);

    // Fire-and-forget: if the job never reached the server (upload phase)
    // this 404s, which is fine - the client side is already torn down.
    fetch(`${API_BASE}/api/cancel-inference/${sid}`, { method: "POST" }).catch(() => {});

    if (foregroundUploadSidRef.current === sid) {
      foregroundUploadSidRef.current = null;
      setIsUploading(false);
    }
    setRecentUploads(updateRecentUploadStatus(sid, "Cancelled"));
    setMessage(`Cancelled ${upload.label}`);
  };

  useEffect(() => {
    // Resume every in-flight run - there can be several in parallel. Uploads
    // that were still mid-transfer live in IndexedDB and must be *resumed*
    // (not polled - the server has no job for them yet); the rest are already
    // inferencing server-side, so we reconnect their pollers.
    let cancelled = false;
    (async () => {
      const processing = loadRecentUploads().filter(u => u.status === "Processing");
      const pending = await loadPendingUploads();
      if (cancelled) return;
      const pendingById = new Map(pending.map(p => [p.sessionId, p]));

      for (const u of processing) {
        if (pendingById.has(u.sessionId)) {
          runUpload(pendingById.get(u.sessionId)!, false);  // resume the upload
        } else {
          startInferencePolling(u.sessionId, u.model);       // resume polling
        }
      }

      // Clean up IndexedDB entries whose card no longer exists (deleted or
      // trimmed off the 8-entry list) so the store can't leak.
      const known = new Set(loadRecentUploads().map(u => u.sessionId));
      pending.filter(p => !known.has(p.sessionId)).forEach(p => deletePendingUpload(p.sessionId));

      if (processing.length > 0) {
        setSessionId(processing[0].sessionId);
        setMessage(`Reconnected · ${processing.length} run${processing.length === 1 ? "" : "s"} in progress`);
      }
    })();
    return () => { cancelled = true; stopAllPolling(); };
  }, []);

  // Only warn before an unload if the current upload could NOT be stored in
  // IndexedDB (quota/private-mode) - otherwise an interrupted upload resumes
  // automatically on reopen, so no scary dialog is needed.
  useEffect(() => {
    if (!isUploading || uploadResumableRef.current) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isUploading]);

  useEffect(() => {
    if (!modelDropOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelDropRef.current && !modelDropRef.current.contains(e.target as Node))
        setModelDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelDropOpen]);

  useEffect(() => {
    if (!preDropOpen) return;
    const handler = (e: MouseEvent) => {
      if (preDropRef.current && !preDropRef.current.contains(e.target as Node))
        setPreDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [preDropOpen]);

  useEffect(() => {
    if (!postDropOpen) return;
    const handler = (e: MouseEvent) => {
      if (postDropRef.current && !postDropRef.current.contains(e.target as Node))
        setPostDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [postDropOpen]);

  /* ── Upload (chunked) ── */
  const CHUNK_SIZE = 256 * 1024;

  // Uploads the file described by `p` from p.nextChunk onward, finalizes, then
  // starts inference. Resumable: the file lives in IndexedDB and the chunk
  // cursor is persisted, so a reload can call this again to pick up where it
  // left off. `foreground` = the run the user just clicked (drives the progress
  // bar); resumed background runs show only their Active-section spinner.
  const runUpload = async (p: PendingUpload, foreground: boolean) => {
    const { sessionId: sid, file, filename, model, bdmapId: bid, totalChunks } = p;
    const controller = new AbortController();
    uploadAbortRef.current.set(sid, controller);
    setPhase(sid, "uploading");
    try {
      if (foreground) {
        foregroundUploadSidRef.current = sid;
        setIsUploading(true);
        setUploadProgress(Math.round((p.nextChunk / totalChunks) * 100));
        setMessage(`Uploading ${filename}...`);
      }

      for (let i = p.nextChunk; i < totalChunks; i++) {
        const chunk = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
        const formData = new FormData();
        formData.append("session_id", sid);
        formData.append("chunk_index", i.toString());
        formData.append("total_chunks", totalChunks.toString());
        formData.append("file", chunk);

        const res = await fetch(`${API_BASE}/api/upload-inference-chunk`, {
          method: "POST", body: formData, signal: controller.signal,
        });
        if (res.status === 413) throw new Error("Upload chunk too large for server/proxy limit (HTTP 413).");
        const data = await parseApiResponse(res);
        if (!res.ok) throw new Error(data.error || "Chunk upload failed");

        // Persist the cursor every so often (not every chunk - that would be a
        // lot of IDB writes). On resume we re-send at most a few already-stored
        // chunks, which the backend just overwrites. Harmless.
        if (i % 16 === 0) await setPendingNextChunk(sid, i + 1);
        if (foreground) setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
      }

      if (foreground) setMessage("Finalizing upload...");
      const finalizeRes = await fetch(`${API_BASE}/api/finalize-upload`, {
        method: "POST",
        signal: controller.signal,
        body: new URLSearchParams({
          session_id: sid,
          total_chunks: totalChunks.toString(),
          output_filename: filename,
          ...(bid ? { bdmap_id: bid } : {}),
        }),
      });
      const finalizeData = await parseApiResponse(finalizeRes);
      if (!finalizeRes.ok) throw new Error(finalizeData.error);
      const uploadedName = finalizeData.uploaded_filename || filename;

      // File is fully on the server now - drop the IDB copy before we kick off
      // inference so a later reload resumes by polling, not re-uploading.
      await deletePendingUpload(sid);
      if (foreground) {
        foregroundUploadSidRef.current = null;
        setUploadProgress(100);
        setIsUploading(false);
      }

      if (foreground) setMessage(`Starting ${model} inference...`);
      const inferFd = new FormData();
      inferFd.append("session_id", sid);
      inferFd.append("model_name", model);
      inferFd.append("uploaded_filename", uploadedName);
      const res = await fetch(`${API_BASE}/api/run-epai-inference`, {
        method: "POST", body: inferFd, signal: controller.signal,
      });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || "Failed to start inference");

      setSessionId(sid);
      setPhase(sid, "queued"); // server queues for the GPU; poll refines this
      if (foreground) setMessage(`${model} inference started. Session: ${sid}`);
      startInferencePolling(sid, model);
    } catch (err) {
      // A user cancel aborts our fetches - cancelRun already did the cleanup
      // and set the card to Cancelled, so don't overwrite that with Failed.
      if (controller.signal.aborted) return;
      console.error(err);
      setPhase(sid);
      if (foreground) {
        foregroundUploadSidRef.current = null;
        setIsUploading(false);
      }
      await deletePendingUpload(sid);
      setRecentUploads(updateRecentUploadStatus(sid, "Failed"));
      if (foreground) setMessage("Failed: " + (err as Error).message);
    } finally {
      if (uploadAbortRef.current.get(sid) === controller) {
        uploadAbortRef.current.delete(sid);
      }
    }
  };

  // DICOM folder → inference. Uploads each raw slice, asks the server to convert
  // the series to NIfTI (SimpleITK), then hands off to the same inference + polling
  // flow as a NIfTI run. Not IndexedDB-resumable (a folder is many files); a reload
  // mid-upload marks the run Failed, consistent with the Active/Recent cards. Wired
  // into uploadAbortRef so the Active card's Cancel button aborts it cleanly.
  const runDicomUpload = async (sid: string, files: File[], model: string) => {
    const controller = new AbortController();
    uploadAbortRef.current.set(sid, controller);
    foregroundUploadSidRef.current = sid;
    uploadResumableRef.current = false; // no IDB copy for a DICOM folder
    setPhase(sid, "uploading");
    try {
      setIsUploading(true);
      setUploadProgress(0);
      setMessage(`Uploading DICOM series (${files.length} slices)...`);

      for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append("session_id", sid);
        formData.append("file", files[i]);
        const res = await fetch(`${API_BASE}/api/upload-dicom-slice`, {
          method: "POST", body: formData, signal: controller.signal,
        });
        if (res.status === 413) throw new Error("DICOM slice too large for server/proxy limit (HTTP 413).");
        const data = await parseApiResponse(res);
        if (!res.ok) throw new Error(data.error || "DICOM slice upload failed");
        setUploadProgress(Math.round(((i + 1) / files.length) * 100));
      }

      setMessage("Converting DICOM series to NIfTI...");
      const finalizeRes = await fetch(`${API_BASE}/api/finalize-dicom`, {
        method: "POST", signal: controller.signal,
        body: new URLSearchParams({ session_id: sid }),
      });
      const finalizeData = await parseApiResponse(finalizeRes);
      if (!finalizeRes.ok) throw new Error(finalizeData.error || "DICOM conversion failed");
      const uploadedName = finalizeData.uploaded_filename || "ct.nii.gz";

      foregroundUploadSidRef.current = null;
      setUploadProgress(100);
      setIsUploading(false);

      setMessage(`Starting ${model} inference...`);
      const inferFd = new FormData();
      inferFd.append("session_id", sid);
      inferFd.append("model_name", model);
      inferFd.append("uploaded_filename", uploadedName);
      const res = await fetch(`${API_BASE}/api/run-epai-inference`, {
        method: "POST", body: inferFd, signal: controller.signal,
      });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || "Failed to start inference");

      setSessionId(sid);
      setPhase(sid, "queued"); // server queues for the GPU; poll refines this
      setMessage(`${model} inference started. Session: ${sid}`);
      startInferencePolling(sid, model);
    } catch (err) {
      // A user cancel aborts our fetches - cancelRun already set the card to
      // Cancelled, so don't overwrite that with Failed.
      if (controller.signal.aborted) return;
      console.error(err);
      setPhase(sid);
      foregroundUploadSidRef.current = null;
      setIsUploading(false);
      setRecentUploads(updateRecentUploadStatus(sid, "Failed"));
      setMessage("Failed: " + (err as Error).message);
    } finally {
      if (uploadAbortRef.current.get(sid) === controller) {
        uploadAbortRef.current.delete(sid);
      }
    }
  };

  /* ── Run inference ── */
  const handleRunEpaiInference = async () => {
    const item = selectedItems[0] ?? null;

    // "None" model = view only: open the scan in its full local viewer, nothing is
    // uploaded or run. DICOM opens the /dicom viewer, NIfTI the /local-nifti viewer.
    if (selectedModel === "None") {
      if (!item) { alert("Select a scan to view first."); return; }
      if (item.kind === "dicom") {
        setLocalDicomFiles(item.files);
        navigate("/dicom");
      } else {
        setLocalNiftiFile(item.file);
        navigate("/local-nifti");
      }
      return;
    }

    const path = serverPath.trim();
    if (!item && !path) {
      alert("Provide a server file path or upload/select a file first.");
      return;
    }

    const model = selectedModel;
    const sid = crypto.randomUUID();
    const itemName = item ? (item.kind === 'dicom' ? item.label : item.file.name) : undefined;
    const label = bdmapId.trim() || (path ? path.split("/").pop() : itemName) || sid;

    setInferenceCompleted(false);
    setRecentUploads(
      addRecentUpload({
        sessionId: sid,
        label,
        model,
        status: "Processing",
        timestamp: Date.now(),
        isReconstruction: model === "OpenVAE",
      })
    );

    // Server-path run: nothing to upload, kick off inference directly. A server
    // path always wins over a selected file, matching the prior behavior.
    if (path) {
      try {
        setSessionId(sid);
        setMessage(`Starting ${model} inference...`);
        const fd = new FormData();
        fd.append("session_id", sid);
        fd.append("model_name", model);
        fd.append("INPUT_SERVER_PATH", path);
        const res = await fetch(`${API_BASE}/api/run-epai-inference`, { method: "POST", body: fd });
        const data = await parseApiResponse(res);
        if (!res.ok) throw new Error(data.error || "Failed to start inference");
        setMessage(`${model} inference started. Session: ${sid}`);
        setPhase(sid, "queued");
        startInferencePolling(sid, model);
      } catch (err) {
        console.error(err);
        setRecentUploads(updateRecentUploadStatus(sid, "Failed"));
        setMessage("Failed: " + (err as Error).message);
      }
      return;
    }

    // Consume the first item so the next can be queued. A DICOM folder uploads its
    // slices and converts server-side; a NIfTI file rides the resumable path (stashed
    // in IndexedDB so an interrupted upload can resume).
    setSelectedItems(prev => prev.slice(1));

    if (item!.kind === 'dicom') {
      runDicomUpload(sid, item!.files, model);
      return;
    }

    const file = item!.file;
    const pending: PendingUpload = {
      sessionId: sid,
      file,
      filename: file.name,
      model,
      bdmapId: bdmapId.trim(),
      totalChunks: Math.ceil(file.size / CHUNK_SIZE),
      nextChunk: 0,
    };
    uploadResumableRef.current = await savePendingUpload(pending);
    runUpload(pending, true);
  };

  const handleCheckStatus = async () => {
    if (!sessionId) { setMessage("No session id yet."); return; }
    try {
      const res = await fetch(`${API_BASE}/api/inference-status/${sessionId}`);
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || data.status || "Status check failed");
      setMessage(`Status: ${data.status}${data.error ? ` (${data.error})` : ""}`);
      const status = (data.status || "").toLowerCase();
      if (status === "completed") {
        setInferenceCompleted(true);
        setRecentUploads(updateRecentUploadStatus(sessionId, "Completed"));
        stopPolling(sessionId);
      } else if (status === "cancelled") {
        setRecentUploads(updateRecentUploadStatus(sessionId, "Cancelled"));
        stopPolling(sessionId);
        setPhase(sessionId);
      } else if (status === "running" || status === "queued") {
        if (!pollTimersRef.current.has(sessionId)) {
          // Use the model recorded on the card - the dropdown may have changed
          // since this run started, and the model decides the viewer route.
          const model = loadRecentUploads().find(u => u.sessionId === sessionId)?.model || selectedModel;
          startInferencePolling(sessionId, model);
        }
      }
    } catch (err) {
      console.error(err);
      setMessage("Status check failed: " + (err as Error).message);
    }
  };

  const handleDownloadResult = async () => {
    if (!sessionId) { setMessage("No session id yet."); return; }
    setMessage("Preparing download...");
    try {
      const statusRes = await fetch(`${API_BASE}/api/inference-status/${sessionId}`);
      const statusData = await parseApiResponse(statusRes);
      if (!statusRes.ok) throw new Error(statusData.error || statusData.status || "Status check failed");
      if (statusData.status !== "completed") {
        setMessage(`Status: ${statusData.status || "unknown"}. Please wait until completed.`);
        return;
      }
      stopPolling(sessionId);

      const resultRes = await fetch(`${API_BASE}/api/get_result/${sessionId}`);
      if (!resultRes.ok) {
        const maybeJson = await parseApiResponse(resultRes);
        throw new Error(maybeJson?.error || "Failed to download result zip");
      }
      const blob = await resultRes.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `epai_output_${sessionId}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
      setMessage("Download started: zip includes combined_labels.nii.gz and output.csv");
    } catch (err) {
      console.error(err);
      setMessage("Download failed: " + (err as Error).message);
    }
  };

  const handleRunEpaiOnReconstruction = async () => {
    if (!sessionId) {
      alert("No completed reconstruction session to run ePAI on.");
      return;
    }
    const newSessionId = crypto.randomUUID();
    setInferenceCompleted(false);
    setMessage("Starting ePAI inference on reconstructed CT...");

    const formData = new FormData();
    formData.append("session_id", newSessionId);
    formData.append("model_name", "ePAI");
    formData.append("source_reconstruction_session_id", sessionId);

    try {
      const res = await fetch(`${API_BASE}/api/run-epai-inference`, {
        method: "POST",
        body: formData,
      });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || "Failed to start ePAI inference on reconstruction");

      const sid = data.session_id || newSessionId;
      setSessionId(sid);
      setSelectedModel("ePAI" as const);
      setMessage(`ePAI inference started on reconstructed CT. Session: ${sid}`);
      if (sid) {
        setRecentUploads(
          addRecentUpload({
            sessionId: sid,
            label: "ePAI on reconstruction",
            model: "ePAI",
            status: "Processing",
            timestamp: Date.now(),
          })
        );
        startInferencePolling(sid, "ePAI");
      }
    } catch (err) {
      console.error(err);
      setMessage("Failed to start ePAI on reconstruction: " + (err as Error).message);
    }
  };

  /* ── Render ── */
  const previewItem = selectedItems.find(i => i.id === previewItemId) ?? null;

  return (
    <div className="upload-page-wrapper">
      {/* Ambient glow */}
      <div className="ambient-orbs">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
      </div>

      <Header />

      <div className="upload-main">
        <div className="upload-card">
          <div className="upload-card-label">Upload</div>

          {/* ── Drop zone ── */}
          <div
            className={`dropzone${isDragOver ? ' drag-over' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".nii,.gz"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <input
              // Set the folder-picker attributes imperatively — passing webkitdirectory
              // as a JSX/spread prop doesn't reliably apply it, so the picker falls back
              // to single files. directory is the Firefox spelling.
              ref={el => {
                dicomUploadInputRef.current = el;
                if (el) {
                  el.setAttribute('webkitdirectory', '');
                  el.setAttribute('directory', '');
                }
              }}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleDicomInferenceSelect}
            />
            <svg className="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div className="dropzone-text">Click or drag to upload</div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button
                type="button"
                className="dropzone-btn"
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
              >
                Select NIfTI file
              </button>
              <button
                type="button"
                className="dropzone-btn"
                onClick={e => { e.stopPropagation(); dicomUploadInputRef.current?.click(); }}
              >
                Select DICOM folder
              </button>
            </div>
          </div>

          {/* ── Selected items: NIfTI files + DICOM series, each individually previewable ── */}
          {selectedItems.length > 0 && (
            <div className="file-chips">
              {selectedItems.map((item) => {
                const name = item.kind === 'dicom' ? item.label : item.file.name;
                const isOpen = previewItemId === item.id;
                return (
                  <div key={item.id} className={`file-chip${isOpen ? ' file-chip--active' : ''}`}>
                    <span className="file-chip-name">{name}</span>
                    <button
                      className="file-chip-preview"
                      onClick={() => setPreviewItemId(prev => (prev === item.id ? null : item.id))}
                    >
                      {isOpen ? 'Hide' : 'Preview'}
                    </button>
                    <button className="file-chip-remove" onClick={() => removeItem(item.id)}>×</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Pre-inference preview: inspect the selected scan before running a model ── */}
          {previewItem && !isUploading && (
            <>
              <div className="ct-preview-label">
                Preview · {previewItem.kind === 'dicom' ? previewItem.label : previewItem.file.name}
              </div>
              <Suspense fallback={<div className="ct-preview ct-preview--msg">Loading preview…</div>}>
                {previewItem.kind === 'dicom'
                  ? <DicomPreview files={previewItem.files} />
                  : <CtPreview file={previewItem.file} />}
              </Suspense>
            </>
          )}

          {/* ── Pipeline row ── */}
          <div className="pipeline-row">
            {/* Step 1: Preprocessing */}
            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <div className="pipeline-badge">1</div>
                <span className="pipeline-label">Preprocessing</span>
                <span className="pipeline-optional">optional</span>
              </div>
              <div className="model-dropdown" ref={preDropRef}>
                <button
                  className={`model-dropdown-btn${preValue ? ' has-value' : ''}${preDropOpen ? ' open' : ''}`}
                  onClick={() => setPreDropOpen(o => !o)}
                  type="button"
                >
                  <span>{preValue || 'None (skip)'}</span>
                  <svg className={`model-dropdown-chevron${preDropOpen ? ' rotated' : ''}`} width="10" height="6" viewBox="0 0 10 6" fill="none">
                    <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {preDropOpen && (
                  <div className="model-dropdown-menu">
                    {[
                      { id: "", label: "None (skip)", desc: "Upload and segment as-is" },
                      { id: "OpenVAE", label: "OpenVAE", desc: "Enhance the scan quality before segmenting" },
                    ].map(opt => (
                      <div
                        key={opt.id}
                        className={`model-dropdown-item${preValue === opt.id ? ' selected' : ''}`}
                        onClick={() => { setPreValue(opt.id); setPreDropOpen(false); }}
                      >
                        <div className="model-dropdown-item-content">
                          <span className="model-dropdown-item-name">{opt.label}</span>
                          <span className="model-dropdown-item-desc">{opt.desc}</span>
                        </div>
                        <div className="model-dropdown-item-side">
                          {preValue === opt.id && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="model-dropdown-check">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="pipeline-arrow">→</div>

            {/* Step 2: Model */}
            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <div className="pipeline-badge">2</div>
                <span className="pipeline-label">Model</span>
              </div>
              <div className="model-dropdown" ref={modelDropRef}>
                <button
                  className={`model-dropdown-btn${selectedModel ? ' has-value' : ''}${modelDropOpen ? ' open' : ''}`}
                  onClick={() => setModelDropOpen(o => !o)}
                  type="button"
                >
                  <span>{selectedModel || 'Select a model'}</span>
                  <svg className={`model-dropdown-chevron${modelDropOpen ? ' rotated' : ''}`} width="10" height="6" viewBox="0 0 10 6" fill="none">
                    <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {modelDropOpen && (
                  <div className="model-dropdown-menu">
                    {MODEL_OPTIONS.map(m => (
                      <div
                        key={m.id}
                        className={`model-dropdown-item${selectedModel === m.id ? ' selected' : ''}`}
                        onClick={() => { setSelectedModel(m.id as typeof selectedModel); setModelDropOpen(false); }}
                      >
                        <div className="model-dropdown-item-content">
                          <span className="model-dropdown-item-name">{m.label}</span>
                          <span className="model-dropdown-item-desc">{m.desc}</span>
                        </div>
                        <div className="model-dropdown-item-side">
                          {selectedModel === m.id && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="model-dropdown-check">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="pipeline-arrow">→</div>

            {/* Step 3: Postprocessing */}
            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <div className="pipeline-badge">3</div>
                <span className="pipeline-label">Postprocessing</span>
                <span className="pipeline-optional">optional</span>
              </div>
              <div className="model-dropdown" ref={postDropRef}>
                <button
                  className={`model-dropdown-btn${postValue ? ' has-value' : ''}${postDropOpen ? ' open' : ''}`}
                  onClick={() => setPostDropOpen(o => !o)}
                  type="button"
                >
                  <span>{postValue || 'None (skip)'}</span>
                  <svg className={`model-dropdown-chevron${postDropOpen ? ' rotated' : ''}`} width="10" height="6" viewBox="0 0 10 6" fill="none">
                    <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {postDropOpen && (
                  <div className="model-dropdown-menu">
                    {[
                      { id: "", label: "None (skip)", desc: "Use results as-is" },
                      { id: "ShapeKit", label: "ShapeKit", desc: "Clean up and smooth organ outlines" },
                    ].map(opt => (
                      <div
                        key={opt.id}
                        className={`model-dropdown-item${postValue === opt.id ? ' selected' : ''}`}
                        onClick={() => { setPostValue(opt.id); setPostDropOpen(false); }}
                      >
                        <div className="model-dropdown-item-content">
                          <span className="model-dropdown-item-name">{opt.label}</span>
                          <span className="model-dropdown-item-desc">{opt.desc}</span>
                        </div>
                        <div className="model-dropdown-item-side">
                          {postValue === opt.id && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="model-dropdown-check">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button
              className="run-btn"
              onClick={handleRunEpaiInference}
              disabled={!selectedModel || isUploading}
            >
              {selectedModel === "None" ? "View" : "Run"}
            </button>
          </div>

          {/* ── Advanced options ── */}
          <div className="advanced-section">
            <button
              className={`advanced-toggle${showAdvanced ? ' open' : ''}`}
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M2 1l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Advanced Options
            </button>
            {showAdvanced && (
              <div className="advanced-fields">
                <input
                  type="text"
                  className="advanced-input"
                  placeholder="Server CT path: /path/to/xxx.nii.gz"
                  value={serverPath}
                  onChange={(e) => setServerPath(e.target.value)}
                />
                <input
                  type="text"
                  className="advanced-input"
                  placeholder="Optional BDMAP ID (e.g. BDMAP_00000338)"
                  value={bdmapId}
                  onChange={(e) => setBdmapId(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* ── Action bar ── */}
          {sessionId && (
            <div className="action-bar">
              <button className="action-btn" onClick={handleCheckStatus}>Check Status</button>
              <button className="action-btn" onClick={handleDownloadResult}>Download</button>
            </div>
          )}

          {/* ── Progress (upload phase only - running inference shows in Active below) ── */}
          {isUploading && (
            <div className="progress-section">
              <div className="progress-item">
                <div className="progress-label">
                  <span className="progress-label-text">Upload Progress</span>
                  <span className="progress-label-pct">{uploadProgress}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill progress-fill-upload" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* ── Results ── */}
          {inferenceCompleted && sessionId && (
            <div className="result-section">
              <div className="result-title">✓ Inference Complete</div>
              <div className="result-btns">
                {selectedModel === "OpenVAE" ? (
                  <>
                    <button className="result-btn" onClick={() => navigate(`/reconstruction/${sessionId}`)}>
                      View Reconstruction
                    </button>
                    <button className="result-btn" onClick={handleRunEpaiOnReconstruction}>
                      Run ePAI on Result
                    </button>
                    <button className="result-btn" onClick={handleDownloadResult}>
                      Download
                    </button>
                  </>
                ) : (
                  <>
                    <button className="result-btn result-btn-primary" onClick={() => navigate(`/session/${sessionId}`)}>
                      View Visualization
                    </button>
                    <button className="result-btn" onClick={handleDownloadResult}>
                      Download Results
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Status messages ── */}
          {sessionId && !inferenceCompleted && (
            <div className="status-msg status-msg-session">Session: {sessionId}</div>
          )}
          {message && <div className="status-msg">{message}</div>}
        </div>

        {/* ── Active (in-progress) Uploads ── */}
        {recentUploads.some(u => u.status === "Processing") && (
          <div style={{ marginTop: "32px" }}>
            <div style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#8f8f8f",
              marginBottom: "16px",
              paddingLeft: "4px"
            }}>
              Active
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {recentUploads.filter(u => u.status === "Processing").map((upload) => {
                const phase = sessionPhases[upload.sessionId];
                const phaseLabel =
                  phase === "uploading" ? "Uploading…" :
                  phase === "queued"    ? "Queued for GPU" :
                  "Running…";
                return (
                  <div key={upload.sessionId} style={{
                    background: "#f5f5f5",
                    border: "1px solid rgba(0,45,114,0.14)",
                    borderRadius: "12px",
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                      <div style={{
                        width: "36px", height: "36px", borderRadius: "8px",
                        background: "rgba(0,45,114,0.04)", border: "1px solid rgba(0,45,114,0.12)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <div className="upload-spinner" />
                      </div>
                      <div>
                        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "14px", fontWeight: 600, color: "#111111" }}>
                          {upload.label}
                        </div>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "#6a6a6a", marginTop: "2px" }}>
                          {upload.model ? `${upload.model} · ` : ""}{formatRelativeTime(upload.timestamp)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "12px", fontWeight: 500, color: phase === "queued" ? "#6a6a6a" : "#002D72" }}>
                        {phaseLabel}
                      </span>
                      <button className="active-cancel-btn" onClick={() => cancelRun(upload)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Recent Uploads ── */}
        <div style={{ marginTop: "32px" }}>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#8f8f8f",
            marginBottom: "16px",
            paddingLeft: "4px"
          }}>
            Recent Uploads
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {recentUploads.filter(u => u.status !== "Processing").length === 0 ? (
              <div style={{
                background: "#f5f5f5",
                border: "1px dashed rgba(0,0,0,0.12)",
                borderRadius: "12px",
                padding: "24px 20px",
                textAlign: "center",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "12px",
                color: "#8f8f8f"
              }}>
                No uploads yet - run a model above and your results will appear here.
              </div>
            ) : (
              recentUploads.filter(u => u.status !== "Processing").map((upload) => {
                const clickable = upload.status !== "Failed" && upload.status !== "Cancelled";
                const openSession = () => {
                  if (!clickable) return;
                  navigate(`/${upload.isReconstruction ? "reconstruction" : "session"}/${upload.sessionId}`);
                };
                return (
                  <div key={upload.sessionId} onClick={openSession} style={{
                    background: "#f5f5f5",
                    border: "1px solid rgba(0,0,0,0.06)",
                    borderRadius: "12px",
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: clickable ? "pointer" : "default"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                      <div style={{
                        width: "36px", height: "36px", borderRadius: "8px",
                        background: "rgba(0,0,0,0.06)", border: "1px solid rgba(0,0,0,0.12)",
                        display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                          <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "14px", fontWeight: 600, color: "#111111" }}>
                          {upload.label}
                        </div>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "#6a6a6a", marginTop: "2px" }}>
                          {upload.model ? `${upload.model} · ` : ""}{formatRelativeTime(upload.timestamp)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "12px", fontWeight: 500, color: recentStatusColor(upload.status) }}>
                        {upload.status}
                      </span>
                      {clickable && (
                        <button onClick={(e) => { e.stopPropagation(); openSession(); }} style={{
                          background: "transparent", border: "1px solid rgba(0,0,0,0.1)",
                          borderRadius: "6px", padding: "6px 12px", color: "#111111",
                          fontFamily: "'Space Grotesk', sans-serif", fontSize: "11px", cursor: "pointer"
                        }}>
                          View
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setRecentUploads(removeRecentUpload(upload.sessionId)); }}
                        title="Remove"
                        style={{
                          background: "transparent", border: "none", padding: "4px",
                          cursor: "pointer", color: "rgba(0,0,0,0.2)", lineHeight: 0,
                          borderRadius: "4px", transition: "color 0.15s",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                        onMouseLeave={e => (e.currentTarget.style.color = "rgba(0,0,0,0.2)")}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadPage;
