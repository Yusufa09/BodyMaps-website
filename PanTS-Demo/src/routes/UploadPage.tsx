import React, { useEffect, useRef, useState } from 'react';
import './UploadPage.css';
import {
  IconPlus,
  IconArrowUp,
  // IconDownload
} from "@tabler/icons-react";
import { API_BASE } from '../helpers/constants';

interface UploadPageProps {}

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

const UploadPage: React.FC<UploadPageProps> = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inferencePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
  // const [, setInferenceStarted] = useState(false);
  // const [, setZipFilename] = useState<string | null>(null);

  const allowedExtensions = [".nii", ".nii.gz"];

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

  const handlePlusClick = () => {
    fileInputRef.current?.click();
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const stopInferencePolling = () => {
    if (inferencePollRef.current) {
      clearInterval(inferencePollRef.current);
      inferencePollRef.current = null;
    }
  };

  const startInferencePolling = (sid: string) => {
    stopInferencePolling();
    setIsInferencing(true);
    setInferenceProgress(5);

    inferencePollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/inference-status/${sid}`);
        const data = await parseApiResponse(res);

        if (!res.ok) {
          throw new Error(data.error || data.status || "Status check failed");
        }

        const status = (data.status || "").toLowerCase();
        if (status === "completed") {
          setInferenceProgress(100);
          setIsInferencing(false);
          stopInferencePolling();
          return;
        }

        if (status === "failed") {
          setIsInferencing(false);
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
    return () => {
      stopInferencePolling();
    };
  }, []);

  // Step 0: Upload files to server
  const CHUNK_SIZE = 512 * 1024; // 512 KB per chunk (safer for strict proxy limits)

  const handleUploadClick = async () => {
    if (selectedFiles.length === 0) return alert("No files selected!");

    const file = selectedFiles[0];
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const sessionId = crypto.randomUUID(); // generate unique session ID

    setIsUploading(true);
    setUploadProgress(0);
    setMessage(`Uploading ${file.name} in ${totalChunks} chunks...`);

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const formData = new FormData();
        formData.append("session_id", sessionId);
        formData.append("chunk_index", i.toString());
        formData.append("total_chunks", totalChunks.toString());
        formData.append("file", chunk);

        const res = await fetch(`${API_BASE}/api/upload-inference-chunk`, {
          method: "POST",
          body: formData,
        });

        if (res.status === 413) {
          throw new Error("Upload chunk too large for server/proxy limit (HTTP 413). Please reduce proxy upload limit or keep smaller chunks.");
        }

        const data = await parseApiResponse(res);
        if (!res.ok) throw new Error(data.error || "Chunk upload failed");
        setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
      }

      setMessage("All chunks uploaded, combining...");

      // Combine chunks on the backend
      const finalizeRes = await fetch(`${API_BASE}/api/finalize-upload`, {
        method: "POST",
        body: new URLSearchParams({
          session_id: sessionId,
          total_chunks: totalChunks.toString(),
          output_filename: file.name,
          ...(bdmapId.trim() ? { bdmap_id: bdmapId.trim() } : {}),
        }),
      });

      const finalizeData = await parseApiResponse(finalizeRes);
      if (!finalizeRes.ok) throw new Error(finalizeData.error);

      setSessionId(sessionId);
      setUploadedFilename(finalizeData.uploaded_filename || file.name);
      setServerPath(finalizeData.path || "");
      setUploadProgress(100);
      setMessage(`Upload complete! File ready at ${finalizeData.path}${finalizeData.bdmap_id ? ` (Case: ${finalizeData.bdmap_id})` : ""}`);
    } catch (err) {
      console.error(err);
      setMessage("Upload failed: " + (err as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRunEpaiInference = async () => {
    if (!sessionId && !serverPath && selectedFiles.length === 0) {
      alert("Provide a server file path or upload/select a file first.");
      return;
    }

    setMessage("Starting ePAI inference...");
    setInferenceProgress(0);
    setIsInferencing(true);

    const formData = new FormData();
    formData.append("session_id", sessionId || crypto.randomUUID());

    if (serverPath.trim()) {
      formData.append("INPUT_SERVER_PATH", serverPath.trim());
    } else if (uploadedFilename) {
      formData.append("uploaded_filename", uploadedFilename);
    } else if (selectedFiles.length > 0) {
      formData.append("MAIN_NIFTI", selectedFiles[0]);
    }

    try {
      const res = await fetch(`${API_BASE}/api/run-epai-inference`, {
        method: "POST",
        body: formData,
      });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || "Failed to start ePAI inference");

      const sid = data.session_id || formData.get("session_id")?.toString() || "";
      setSessionId(sid);
      setMessage(`ePAI inference started. Session: ${sid}`);
      if (sid) {
        startInferencePolling(sid);
      }
    } catch (err) {
      console.error(err);
      setIsInferencing(false);
      setMessage("Failed to start inference: " + (err as Error).message);
    }
  };

  const handleCheckStatus = async () => {
    if (!sessionId) {
      setMessage("No session id yet.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/inference-status/${sessionId}`);
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || data.status || "Status check failed");
      setMessage(`Status: ${data.status}${data.error ? ` (${data.error})` : ""}`);
      const status = (data.status || "").toLowerCase();
      if (status === "completed") {
        setInferenceProgress(100);
        setIsInferencing(false);
        stopInferencePolling();
      } else if (status === "running") {
        if (!isInferencing) {
          startInferencePolling(sessionId);
        }
      }
    } catch (err) {
      console.error(err);
      setMessage("Status check failed: " + (err as Error).message);
    }
  };

  const handleDownloadResult = async () => {
    if (!sessionId) {
      setMessage("No session id yet.");
      return;
    }

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

  // // Step 1: Run inference
  // const handleRunInference = async () => {
  //   setMessage("Running inference...");
  //   try {
  //     const res = await fetch("/run-inference", { method: "POST" });
  //     const data = await res.json();
  //     if (res.ok) {
  //       setMessage(data.status || "Inference started");
  //       setInferenceStarted(true);
  //       setZipFilename(null);
  //     } else {
  //       setMessage(data.error || "Inference failed");
  //     }
  //   } catch (err) {
  //     console.error(err);
  //     setMessage("Inference failed: network error");
  //   }
  // };

  // // Step 2: Prepare zip download
  // const handlePrepareDownload = async () => {
  //   if (!inferenceStarted) {
  //     setMessage("Run inference first");
  //     return;
  //   }

  //   setMessage("Preparing output zip...");
  //   try {
  //     const res = await fetch("/prepare-download", { method: "POST" });
  //     const data = await res.json();

  //     if (res.ok && data.filename) {
  //       setZipFilename(data.filename);
  //       setMessage(`Output prepared: ${data.filename}. Ready to download.`);
  //     } else {
  //       setMessage("Failed to prepare output zip");
  //       console.error(data);
  //     }
  //   } catch (err) {
  //     console.error(err);
  //     setMessage("Error preparing download");
  //   }
  // };

  // // Step 3: Download zip
  // const handleDownload = async () => {
  //   if (!zipFilename) {
  //     setMessage("No prepared file available. Prepare download first.");
  //     return;
  //   }

  //   try {
  //     const res = await fetch(`/download-prepared-output?filename=${zipFilename}`);
  //     const data = await res.json();

  //     if (res.ok && data.url) {
  //       const link = document.createElement("a");
  //       link.href = data.url;
  //       link.download = data.filename || zipFilename;
  //       document.body.appendChild(link);
  //       link.click();
  //       document.body.removeChild(link);
  //       setMessage(`Download started: ${data.filename || zipFilename}`);
  //     } else {
  //       setMessage("Download failed");
  //       console.error(data);
  //     }
  //   } catch (err) {
  //     console.error(err);
  //     setMessage("Download failed");
  //   }
  // };

  return (
    <div className="upload-page">

      {/* Selected files */}
      <div className="file-tags">
        {selectedFiles.map((file, index) => (
          <div key={index} className="file-tag">
            {file.name}
            <span className="remove-tag" onClick={() => removeFile(index)}>×</span>
          </div>
        ))}
      </div>

      {/* Upload / input bar */}
      <div className="upload-bar">
        <button className="plus-button" onClick={handlePlusClick}>
          <IconPlus />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="*/*"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        <input
          type="text"
          readOnly
          placeholder="Click + to select .nii or .nii.gz files"
          className="upload-input"
          onClick={handlePlusClick}
          value={selectedFiles.map(f => f.name).join(', ')}
        />

        <button className="upload-button" onClick={handleUploadClick}>
          <IconArrowUp />
        </button>
      </div>

      <div className="upload-bar" style={{ marginTop: "0.75rem" }}>
        <input
          type="text"
          className="upload-input"
          placeholder="Or input server CT path: /path/to/xxx.nii.gz"
          value={serverPath}
          onChange={(e) => setServerPath(e.target.value)}
        />
      </div>

      <div className="upload-bar" style={{ marginTop: "0.75rem" }}>
        <input
          type="text"
          className="upload-input"
          placeholder="Optional BDMAP ID (e.g. BDMAP_00000338 or 00000338)"
          value={bdmapId}
          onChange={(e) => setBdmapId(e.target.value)}
        />
      </div>

      <div className="upload-actions">
        <button className="upload-button" onClick={handleRunEpaiInference}>Run ePAI</button>
        <button className="upload-button" onClick={handleCheckStatus}>Check Status</button>
        <button className="upload-button" onClick={handleDownloadResult}>Download</button>
      </div>

      {(isUploading || uploadProgress > 0) && (
        <div className="progress-wrap">
          <p className="upload-meta">Upload Progress: {uploadProgress}%</p>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {(isInferencing || inferenceProgress > 0) && (
        <div className="progress-wrap">
          <p className="upload-meta">Inference Progress: {inferenceProgress}%</p>
          <div className="progress-track">
            <div className="progress-fill progress-fill-inference" style={{ width: `${inferenceProgress}%` }} />
          </div>
        </div>
      )}

      {sessionId && <p className="upload-meta">Session: {sessionId}</p>}
      {message && <p className="upload-meta">{message}</p>}
    </div>
  );
};

export default UploadPage;
