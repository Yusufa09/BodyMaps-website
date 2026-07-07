import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './UploadPage.css';

// Lazy so NiiVue isn't pulled into the upload bundle until a file is actually previewed.
const CtPreview = lazy(() => import('../components/CtPreview/CtPreview'));
import { API_BASE } from '../helpers/constants';
import {
  addRecentUpload,
  formatRelativeTime,
  loadRecentUploads,
  recentStatusColor,
  updateRecentUploadStatus,
  type RecentUpload,
} from '../helpers/recentUploads';
import Header from '../components/Header';
import { looksLikeDicom, setLocalDicomFiles } from '../helpers/dicomLocal';

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

const UploadPage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dicomInputRef = useRef<HTMLInputElement | null>(null);
  const inferencePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Local DICOM: stash the picked folder's files and open the viewer's /dicom
  // route. Nothing is uploaded — the viewer reads the File objects directly.
  const handleDicomFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same folder later
    const candidates = files.filter(looksLikeDicom);
    if (!candidates.length) {
      alert("No DICOM files (.dcm) found in the selected folder.");
      return;
    }
    setLocalDicomFiles(candidates);
    navigate("/dicom");
  };

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [message, setMessage] = useState<string>("");
  const [serverPath, setServerPath] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [uploadedFilename, setUploadedFilename] = useState<string>("");
  const [bdmapId, setBdmapId] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [inferenceProgress, setInferenceProgress] = useState<number>(0);
  const [isInferencing, setIsInferencing] = useState<boolean>(false);
  const [inferenceCompleted, setInferenceCompleted] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<"ePAI" | "SuPreM" | "OpenVAE" | "MedFormer" | "R-Super" | "Atlas-Net" | "">("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [recentUploads, setRecentUploads] = useState<RecentUpload[]>(() => loadRecentUploads());

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
    setSelectedFiles(prev => [...prev, ...filteredFiles]);
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
    setSelectedFiles(prev => [...prev, ...filteredFiles]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  /* ── Inference polling ── */
  const stopInferencePolling = () => {
    if (inferencePollRef.current) {
      clearInterval(inferencePollRef.current);
      inferencePollRef.current = null;
    }
  };

  const startInferencePolling = (sid: string, model: string) => {
    stopInferencePolling();
    setIsInferencing(true);
    setInferenceProgress(5);

    inferencePollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/inference-status/${sid}`);
        const data = await parseApiResponse(res);
        if (!res.ok) throw new Error(data.error || data.status || "Status check failed");

        const status = (data.status || "").toLowerCase();
        if (status === "completed") {
          setInferenceProgress(100);
          setIsInferencing(false);
          setInferenceCompleted(true);
          setRecentUploads(updateRecentUploadStatus(sid, "Completed"));
          stopInferencePolling();

          setTimeout(() => {
            if (model === "OpenVAE") {
              navigate(`/reconstruction/${sid}`);
            } else {
              navigate(`/session/${sid}`);
            }
          }, 600);
          return;
        }
        if (status === "failed") {
          setIsInferencing(false);
          setRecentUploads(updateRecentUploadStatus(sid, "Failed"));
          stopInferencePolling();
          setMessage(`Inference failed${data.error ? `: ${data.error}` : ""}`);
          return;
        }
        setInferenceProgress(prev => Math.min(95, Math.max(prev + 7, 10)));
      } catch (err) {
        setInferenceProgress(prev => Math.min(95, Math.max(prev + 3, 10)));
        console.error(err);
      }
    }, 2500);
  };

  useEffect(() => {
    return () => { stopInferencePolling(); };
  }, []);

  /* ── Upload (chunked) ── */
  const CHUNK_SIZE = 256 * 1024;

  /* ── Run inference ── */
  const handleRunEpaiInference = async () => {
    if (!sessionId && !serverPath.trim() && selectedFiles.length === 0) {
      alert("Provide a server file path or upload/select a file first.");
      return;
    }

    let currentSessionId = sessionId;
    let currentUploadedFilename = uploadedFilename;

    try {
      // If files selected but not yet uploaded, upload first
      if (!currentSessionId && !serverPath.trim() && selectedFiles.length > 0) {
        const file = selectedFiles[0];
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const newSessionId = crypto.randomUUID();

        setIsUploading(true);
        setUploadProgress(0);
        setMessage(`Uploading ${file.name}...`);

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);

          const formData = new FormData();
          formData.append("session_id", newSessionId);
          formData.append("chunk_index", i.toString());
          formData.append("total_chunks", totalChunks.toString());
          formData.append("file", chunk);

          const res = await fetch(`${API_BASE}/api/upload-inference-chunk`, {
            method: "POST",
            body: formData,
          });

          if (res.status === 413) {
            throw new Error("Upload chunk too large for server/proxy limit (HTTP 413).");
          }

          const data = await parseApiResponse(res);
          if (!res.ok) throw new Error(data.error || "Chunk upload failed");
          setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
        }

        setMessage("Finalizing upload...");

        const finalizeRes = await fetch(`${API_BASE}/api/finalize-upload`, {
          method: "POST",
          body: new URLSearchParams({
            session_id: newSessionId,
            total_chunks: totalChunks.toString(),
            output_filename: file.name,
            ...(bdmapId.trim() ? { bdmap_id: bdmapId.trim() } : {}),
          }),
        });

        const finalizeData = await parseApiResponse(finalizeRes);
        if (!finalizeRes.ok) throw new Error(finalizeData.error);

        currentSessionId = newSessionId;
        currentUploadedFilename = finalizeData.uploaded_filename || file.name;
        
        setSessionId(currentSessionId);
        setUploadedFilename(currentUploadedFilename);
        setServerPath(finalizeData.path || "");
        setUploadProgress(100);
        setIsUploading(false);
      }

      setMessage(`Starting ${selectedModel} inference...`);
      setInferenceProgress(0);
      setIsInferencing(true);

      const formData = new FormData();
      formData.append("session_id", currentSessionId || crypto.randomUUID());
      formData.append("model_name", selectedModel);

      if (serverPath.trim()) {
        formData.append("INPUT_SERVER_PATH", serverPath.trim());
      } else if (currentUploadedFilename) {
        formData.append("uploaded_filename", currentUploadedFilename);
      }

      const res = await fetch(`${API_BASE}/api/run-epai-inference`, {
        method: "POST",
        body: formData,
      });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || "Failed to start inference");

      const sid = data.session_id || formData.get("session_id")?.toString() || "";
      setSessionId(sid);
      setMessage(`${selectedModel} inference started. Session: ${sid}`);
      if (sid) {
        setRecentUploads(
          addRecentUpload({
            sessionId: sid,
            label: bdmapId.trim() || currentUploadedFilename || selectedFiles[0]?.name || sid,
            model: selectedModel,
            status: "Processing",
            timestamp: Date.now(),
            isReconstruction: selectedModel === "OpenVAE",
          })
        );
        startInferencePolling(sid, selectedModel);
      }
    } catch (err) {
      console.error(err);
      setIsUploading(false);
      setIsInferencing(false);
      setMessage("Failed: " + (err as Error).message);
    }
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
        setInferenceProgress(100);
        setIsInferencing(false);
        setInferenceCompleted(true);
        setRecentUploads(updateRecentUploadStatus(sessionId, "Completed"));
        stopInferencePolling();
      } else if (status === "running") {
        if (!isInferencing) startInferencePolling(sessionId, selectedModel);
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
      setInferenceProgress(100);
      setIsInferencing(false);
      stopInferencePolling();

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
    setInferenceProgress(0);
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
      if (sid) startInferencePolling(sid, "ePAI");
    } catch (err) {
      console.error(err);
      setMessage("Failed to start ePAI on reconstruction: " + (err as Error).message);
    }
  };

  /* ── Render ── */
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
            <svg className="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div className="dropzone-text">Click or drag to upload</div>
            <div className="dropzone-sub">.nii or .nii.gz</div>
          </div>

          {/* ── Local DICOM: view a folder of .dcm slices in-browser, nothing uploaded ── */}
          <input
            ref={dicomInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            // Non-standard folder picker (Chrome/Edge/Safari); TS doesn't know it.
            {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
            onChange={handleDicomFolderSelect}
          />
          <button className="dicom-open-link" onClick={() => dicomInputRef.current?.click()}>
            …or open a local DICOM folder in the viewer
            <span>view only — the files never leave your browser</span>
          </button>

          {/* ── File chips ── */}
          {selectedFiles.length > 0 && (
            <div className="file-chips">
              {selectedFiles.map((file, index) => (
                <div key={index} className="file-chip">
                  {file.name}
                  <button className="file-chip-remove" onClick={() => removeFile(index)}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* ── Pre-inference preview: inspect the selected scan before running a model ── */}
          {selectedFiles.length > 0 && !isUploading && !isInferencing && !inferenceCompleted && (
            <>
              <div className="ct-preview-label">Preview · {selectedFiles[0].name}</div>
              <Suspense fallback={<div className="ct-preview ct-preview--msg">Loading preview…</div>}>
                <CtPreview file={selectedFiles[0]} />
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
              <select className="pipeline-select" defaultValue="">
                <option value="">None (skip)</option>
                <option value="OpenVAE">OpenVAE</option>
              </select>
            </div>

            <div className="pipeline-arrow">→</div>

            {/* Step 2: Model */}
            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <div className="pipeline-badge">2</div>
                <span className="pipeline-label">Model</span>
              </div>
              <select
                className={`pipeline-select${selectedModel ? ' has-value' : ''}`}
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as typeof selectedModel)}
              >
                <option value="" disabled>Select a model</option>
                <option value="ePAI">ePAI</option>
                <option value="SuPreM">SuPreM</option>
                <option value="MedFormer">MedFormer</option>
                <option value="R-Super">R-Super</option>
                <option value="Atlas-Net">Atlas-Net</option>
              </select>
            </div>

            <div className="pipeline-arrow">→</div>

            {/* Step 3: Postprocessing */}
            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <div className="pipeline-badge">3</div>
                <span className="pipeline-label">Postprocessing</span>
                <span className="pipeline-optional">optional</span>
              </div>
              <select className="pipeline-select" defaultValue="">
                <option value="">None (skip)</option>
                <option value="ShapeKit">ShapeKit</option>
              </select>
            </div>

            <button
              className="run-btn"
              onClick={handleRunEpaiInference}
              disabled={!selectedModel}
            >
              Run
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

          {/* ── Progress ── */}
          {(isUploading || uploadProgress > 0) && (
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

          {(isInferencing || inferenceProgress > 0) && (
            <div className="progress-section">
              <div className="progress-item">
                <div className="progress-label">
                  <span className="progress-label-text">Inference Progress</span>
                  <span className="progress-label-pct">{inferenceProgress}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill progress-fill-inference" style={{ width: `${inferenceProgress}%` }} />
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
            {recentUploads.length === 0 ? (
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
                No uploads yet — run a model above and your results will appear here.
              </div>
            ) : (
              recentUploads.map((upload) => {
                const openSession = () => {
                  if (upload.status === "Failed") return;
                  navigate(`/${upload.isReconstruction ? "reconstruction" : "session"}/${upload.sessionId}`);
                };
                const clickable = upload.status !== "Failed";
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
