import { IconCloudUpload } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../helpers/constants";

const CHUNK_SIZE = 256 * 1024;

type Model = "ePAI" | "SuPreM" | "MedFormer" | "R-Super" | "OpenVAE" | "Atlas-Net" | "";

const parseApiResponse = async (res: Response): Promise<any> => {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  const text = await res.text();
  const short = text.slice(0, 200).replace(/\s+/g, " ").trim();
  throw new Error(`Expected JSON but got ${contentType} (HTTP ${res.status}). Body: ${short}`);
};

export default function InferenceUpload() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedModel, setSelectedModel] = useState<Model>("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "inferencing" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [_sessionId, setSessionId] = useState("");
  const [dropHover, setDropHover] = useState(false);

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => () => stopPoll(), []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropHover(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".nii") || file.name.endsWith(".nii.gz"))) {
      setSelectedFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const startPolling = (sid: string, model: Model) => {
    stopPoll();
    setPhase("inferencing");
    setProgress(5);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/inference-status/${sid}`);
        const data = await parseApiResponse(res);
        const status = (data.status || "").toLowerCase();
        if (status === "completed") {
          setProgress(100);
          setPhase("done");
          stopPoll();
          setTimeout(() => {
            if (model === "OpenVAE") {
              navigate(`/reconstruction/${sid}`);
            } else {
              navigate(`/session/${sid}`);
            }
          }, 600);
        } else if (status === "failed") {
          setPhase("idle");
          setStatusText(`Inference failed: ${data.error || "unknown error"}`);
          stopPoll();
        } else {
          setProgress(p => Math.min(95, p + 7));
        }
      } catch {
        setProgress(p => Math.min(95, p + 3));
      }
    }, 2500);
  };

  const handleRun = async () => {
    if (!selectedFile || !selectedModel) return;

    const sid = crypto.randomUUID();
    const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);

    setPhase("uploading");
    setProgress(0);
    setStatusText(`Uploading ${selectedFile.name}…`);

    try {
      for (let i = 0; i < totalChunks; i++) {
        const chunk = selectedFile.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, selectedFile.size));
        const fd = new FormData();
        fd.append("session_id", sid);
        fd.append("chunk_index", i.toString());
        fd.append("total_chunks", totalChunks.toString());
        fd.append("file", chunk);
        const res = await fetch(`${API_BASE}/api/upload-inference-chunk`, { method: "POST", body: fd });
        const data = await parseApiResponse(res);
        if (!res.ok) throw new Error(data.error || "Chunk upload failed");
        setProgress(Math.round(((i + 1) / totalChunks) * 100));
      }

      const finalFd = new URLSearchParams({
        session_id: sid,
        total_chunks: totalChunks.toString(),
        output_filename: selectedFile.name,
      });
      const finalRes = await fetch(`${API_BASE}/api/finalize-upload`, { method: "POST", body: finalFd });
      const finalData = await parseApiResponse(finalRes);
      if (!finalRes.ok) throw new Error(finalData.error);

      setStatusText(`Running ${selectedModel}…`);
      const inferFd = new FormData();
      inferFd.append("session_id", sid);
      inferFd.append("model_name", selectedModel);
      inferFd.append("uploaded_filename", finalData.uploaded_filename || selectedFile.name);
      const inferRes = await fetch(`${API_BASE}/api/run-epai-inference`, { method: "POST", body: inferFd });
      const inferData = await parseApiResponse(inferRes);
      if (!inferRes.ok) throw new Error(inferData.error || "Failed to start inference");

      setSessionId(sid);
      startPolling(sid, selectedModel);
    } catch (err) {
      setPhase("idle");
      setStatusText("Error: " + (err as Error).message);
    }
  };

  const isRunning = phase === "uploading" || phase === "inferencing";
  const canRun = !!selectedFile && !!selectedModel && !isRunning;

  const phaseLabel =
    phase === "uploading"
      ? `Uploading… ${progress}%`
      : phase === "inferencing"
      ? `Running ${selectedModel}… ${progress}%`
      : phase === "done"
      ? "Done! Opening viewer…"
      : "";

  const hasFile = !!selectedFile;
  const isActive = dropHover || hasFile;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Drop zone */}
      <div
        className="w-full rounded-xl flex flex-col items-center gap-2 cursor-pointer transition-all duration-200"
        style={{
          padding: "28px 20px",
          border: `1.5px dashed ${isActive ? "rgba(45,212,191,0.55)" : "rgba(255,255,255,0.12)"}`,
          background: isActive
            ? "rgba(45,212,191,0.05)"
            : "rgba(255,255,255,0.02)",
          boxShadow: isActive
            ? "0 0 24px rgba(45,212,191,0.06) inset"
            : "none",
        }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDropHover(true); }}
        onDragLeave={() => setDropHover(false)}
        onDrop={handleDrop}
      >
        <IconCloudUpload
          size={36}
          style={{ color: hasFile ? "rgb(45,212,191)" : "rgba(255,255,255,0.3)" }}
        />
        {selectedFile ? (
          <span
            className="font-medium text-center break-all"
            style={{ fontSize: "12px", color: "rgb(45,212,191)" }}
          >
            {selectedFile.name}
          </span>
        ) : (
          <>
            <span
              className="font-medium"
              style={{ fontSize: "13px", color: "rgba(255,255,255,0.65)" }}
            >
              Click or drag to upload
            </span>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.28)" }}>
              .nii or .nii.gz
            </span>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".nii,.gz"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Model selector + Run */}
      <div className="flex gap-2 w-full">
        <select
          className="flex-1 rounded-lg text-sm cursor-pointer outline-none"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: selectedModel ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)",
            padding: "9px 12px",
          }}
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value as Model)}
          disabled={isRunning}
        >
          <option value="" disabled style={{ background: "#0f1a2e" }}>
            Select a model
          </option>
          {["ePAI", "SuPreM", "MedFormer", "R-Super", "OpenVAE", "Atlas-Net"].map((m) => (
            <option key={m} value={m} style={{ background: "#0f1a2e" }}>
              {m}
            </option>
          ))}
        </select>

        <button
          className="rounded-lg text-sm font-semibold transition-all duration-200"
          style={{
            padding: "9px 22px",
            background: canRun
              ? "linear-gradient(135deg, rgba(45,212,191,0.9), rgba(34,211,238,0.85))"
              : "rgba(255,255,255,0.07)",
            color: canRun ? "#050c1a" : "rgba(255,255,255,0.22)",
            cursor: canRun ? "pointer" : "not-allowed",
            boxShadow: canRun ? "0 0 20px rgba(45,212,191,0.25)" : "none",
            border: "none",
          }}
          onClick={handleRun}
          disabled={!canRun}
        >
          Run
        </button>
      </div>

      {/* Progress / status */}
      {isRunning || phase === "done" ? (
        <div className="flex flex-col gap-1.5">
          <div
            style={{
              fontSize: "11px",
              color: "rgba(255,255,255,0.4)",
              textAlign: "center",
            }}
          >
            {phaseLabel}
          </div>
          <div
            className="w-full rounded-full overflow-hidden"
            style={{ height: "3px", background: "rgba(255,255,255,0.07)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress}%`,
                background:
                  "linear-gradient(90deg, rgb(45,212,191), rgb(34,211,238))",
                boxShadow: "0 0 8px rgba(45,212,191,0.5)",
              }}
            />
          </div>
        </div>
      ) : statusText ? (
        <p
          className="text-center"
          style={{ fontSize: "11px", color: "rgba(239,68,68,0.85)" }}
        >
          {statusText}
        </p>
      ) : null}
    </div>
  );
}
