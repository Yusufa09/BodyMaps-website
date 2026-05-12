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

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => () => stopPoll(), []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
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

    // Upload
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

      // Run inference
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

  const phaseLabel = phase === "uploading"
    ? `Uploading… ${progress}%`
    : phase === "inferencing"
    ? `Running ${selectedModel}… ${progress}%`
    : phase === "done"
    ? "Done! Opening viewer…"
    : "";

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-md mx-auto">
      {/* Upload box */}
      <div
        className={`w-full border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-2 cursor-pointer transition-colors
          ${selectedFile ? "border-blue-400 bg-blue-950/30" : "border-gray-500 hover:border-gray-300 bg-gray-900/40"}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        <IconCloudUpload size={40} className={selectedFile ? "text-blue-400" : "text-gray-400"} />
        {selectedFile ? (
          <span className="text-sm text-blue-300 font-medium text-center break-all">{selectedFile.name}</span>
        ) : (
          <>
            <span className="text-sm text-gray-300 font-medium">Click or drag to upload</span>
            <span className="text-xs text-gray-500">.nii or .nii.gz</span>
          </>
        )}
        <input ref={fileInputRef} type="file" accept=".nii,.gz" className="hidden" onChange={handleFileChange} />
      </div>

      {/* Model selector + Run */}
      <div className="flex gap-2 w-full">
        <select
          className="flex-1 bg-gray-800 text-white border border-gray-600 rounded-lg px-3 py-2 text-sm cursor-pointer"
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value as Model)}
          disabled={isRunning}
        >
          <option value="" disabled>Select a model</option>
          <option value="ePAI">ePAI</option>
          <option value="SuPreM">SuPreM</option>
          <option value="MedFormer">MedFormer</option>
          <option value="R-Super">R-Super</option>
          <option value="OpenVAE">OpenVAE</option>
          <option value="Atlas-Net">Atlas-Net</option>
        </select>
        <button
          className={`px-5 py-2 rounded-lg text-sm font-bold transition-colors
            ${canRun ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer" : "bg-gray-700 text-gray-500 cursor-not-allowed"}`}
          onClick={handleRun}
          disabled={!canRun}
        >
          Run
        </button>
      </div>

      {/* Progress bar */}
      {isRunning || phase === "done" ? (
        <div className="w-full flex flex-col gap-1">
          <div className="text-xs text-gray-400 text-center">{phaseLabel}</div>
          <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : statusText ? (
        <p className="text-xs text-red-400 text-center">{statusText}</p>
      ) : null}
    </div>
  );
}
