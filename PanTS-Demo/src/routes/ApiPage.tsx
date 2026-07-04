import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './ApiPage.css';
import { API_BASE } from '../helpers/constants';
import Header from '../components/Header';

const CHUNK_SIZE = 256 * 1024;
const ALLOWED_EXTENSIONS = ['.nii', '.nii.gz'];

type JobStatus = 'queued' | 'uploading' | 'processing' | 'completed' | 'failed';

type ApiJob = {
  id: string;
  file: File;
  sessionId: string | null;
  status: JobStatus;
  uploadProgress: number;
  inferenceProgress: number;
  model: string;
  timestamp: number;
  error?: string;
};

const parseApiResponse = async (res: Response): Promise<any> => {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  const text = await res.text();
  throw new Error(`HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, ' ').trim()}`);
};

const ApiPage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const jobQueueRef = useRef<ApiJob[]>([]);
  const isProcessingRef = useRef(false);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedPreprocessing, setSelectedPreprocessing] = useState('');
  const [selectedPostprocessing, setSelectedPostprocessing] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [jobFilter, setJobFilter] = useState<'all' | JobStatus>('all');

  const [jobs, setJobs] = useState<ApiJob[]>([]);

  /* ── File selection ── */
  const addFiles = (files: File[]) => {
    const filtered = files.filter(f =>
      ALLOWED_EXTENSIONS.some(ext => f.name.toLowerCase().endsWith(ext))
    );
    if (filtered.length === 0) {
      alert('Please select .nii or .nii.gz files only.');
      return;
    }
    setPendingFiles(prev => [...prev, ...filtered]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      const filtered = Array.from(e.dataTransfer.files).filter(f =>
        ALLOWED_EXTENSIONS.some(ext => f.name.toLowerCase().endsWith(ext))
      );
      if (filtered.length === 0) { alert('Please drop .nii or .nii.gz files only.'); return; }
      setPendingFiles(prev => [...prev, ...filtered]);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const removePendingFile = (index: number) =>
    setPendingFiles(prev => prev.filter((_, i) => i !== index));

  /* ── Job state helpers ── */
  const patchJob = (id: string, patch: Partial<ApiJob>) =>
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)));

  /* ── Inference polling for a single job ── */
  const pollUntilDone = (sessionId: string, jobId: string): Promise<void> =>
    new Promise(resolve => {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/inference-status/${sessionId}`);
          const data = await parseApiResponse(res);
          const status = (data.status || '').toLowerCase();
          if (status === 'completed') {
            clearInterval(interval);
            patchJob(jobId, { status: 'completed', inferenceProgress: 100 });
            resolve();
          } else if (status === 'failed') {
            clearInterval(interval);
            patchJob(jobId, { status: 'failed', error: data.error || 'Inference failed' });
            resolve();
          } else {
            setJobs(prev =>
              prev.map(j =>
                j.id === jobId
                  ? { ...j, inferenceProgress: Math.min(95, j.inferenceProgress + 7) }
                  : j
              )
            );
          }
        } catch {
          // transient network error — keep polling
        }
      }, 2500);
    });

  /* ── Process one job: upload → finalize → infer → poll ── */
  const processJob = async (job: ApiJob): Promise<void> => {
    const sid = crypto.randomUUID();
    patchJob(job.id, { sessionId: sid, status: 'uploading', uploadProgress: 0 });

    const { file } = job;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    try {
      // 1. Chunked upload
      for (let i = 0; i < totalChunks; i++) {
        const chunk = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
        const fd = new FormData();
        fd.append('session_id', sid);
        fd.append('chunk_index', i.toString());
        fd.append('total_chunks', totalChunks.toString());
        fd.append('file', chunk);

        const res = await fetch(`${API_BASE}/api/upload-inference-chunk`, { method: 'POST', body: fd });
        const data = await parseApiResponse(res);
        if (!res.ok) throw new Error(data.error || 'Chunk upload failed');
        patchJob(job.id, { uploadProgress: Math.round(((i + 1) / totalChunks) * 100) });
      }

      // 2. Finalize
      const finalizeRes = await fetch(`${API_BASE}/api/finalize-upload`, {
        method: 'POST',
        body: new URLSearchParams({
          session_id: sid,
          total_chunks: totalChunks.toString(),
          output_filename: file.name,
        }),
      });
      const finalizeData = await parseApiResponse(finalizeRes);
      if (!finalizeRes.ok) throw new Error(finalizeData.error || 'Finalize failed');

      // 3. Start inference
      patchJob(job.id, { status: 'processing', inferenceProgress: 5 });

      const inferFd = new FormData();
      inferFd.append('session_id', sid);
      inferFd.append('model_name', job.model);
      inferFd.append('uploaded_filename', finalizeData.uploaded_filename || file.name);

      const inferRes = await fetch(`${API_BASE}/api/run-epai-inference`, { method: 'POST', body: inferFd });
      const inferData = await parseApiResponse(inferRes);
      if (!inferRes.ok) throw new Error(inferData.error || 'Failed to start inference');

      const actualSid = inferData.session_id || sid;
      if (actualSid !== sid) patchJob(job.id, { sessionId: actualSid });

      // 4. Poll
      await pollUntilDone(actualSid, job.id);
    } catch (err) {
      patchJob(job.id, { status: 'failed', error: (err as Error).message });
    }
  };

  /* ── Sequential queue runner ── */
  const drainQueue = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    while (jobQueueRef.current.length > 0) {
      const next = jobQueueRef.current.shift()!;
      await processJob(next);
    }
    isProcessingRef.current = false;
  };

  /* ── Queue batch ── */
  const handleQueueBatch = () => {
    if (!selectedModel) { alert('Please select a model first.'); return; }
    if (pendingFiles.length === 0) { alert('Please select at least one CT scan.'); return; }

    const newJobs: ApiJob[] = pendingFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      sessionId: null,
      status: 'queued',
      uploadProgress: 0,
      inferenceProgress: 0,
      model: selectedModel,
      timestamp: Date.now(),
    }));

    setJobs(prev => [...prev, ...newJobs]);
    jobQueueRef.current.push(...newJobs);
    setPendingFiles([]);
    drainQueue();
  };

  /* ── Download helpers ── */
  const downloadJob = async (job: ApiJob) => {
    if (!job.sessionId) return;
    try {
      const res = await fetch(`${API_BASE}/api/get_result/${job.sessionId}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `result_${job.sessionId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed: ' + (err as Error).message);
    }
  };

  const handleDownloadAll = () => {
    jobs.filter(j => j.status === 'completed').forEach(job => downloadJob(job));
  };

  /* ── Counters ── */
  const queuedCount = jobs.filter(j => j.status === 'queued').length;
  const processingCount = jobs.filter(j => j.status === 'uploading' || j.status === 'processing').length;
  const completedCount = jobs.filter(j => j.status === 'completed').length;
  const hasCompleted = completedCount > 0;

  /* ── Render ── */
  return (
    <div className="api-page-wrapper">
      <div className="ambient-orbs">
        <div className="orb orb-1" />
        <div className="orb orb-2" />
      </div>

      <Header />

      <div className="api-main">
        {/* ── Upload + Pipeline card ── */}
        <div className="api-card">
          <div className="api-card-label">Batch Upload</div>

          {/* Drop zone */}
          <div
            className={`api-dropzone${isDragOver ? ' drag-over' : ''}`}
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
              ref={folderInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
              {...({ webkitdirectory: '', mozdirectory: '' } as any)}
            />
            <svg
              className="api-dropzone-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div className="api-dropzone-text">Drag & drop files or a folder here</div>
            <div className="api-dropzone-sub">.nii or .nii.gz files only</div>
            <div className="api-dropzone-btns">
              <button
                className="api-dropzone-select-btn"
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
              >
                Select Files
              </button>
              <button
                className="api-dropzone-select-btn"
                onClick={e => { e.stopPropagation(); folderInputRef.current?.click(); }}
              >
                Select Folder
              </button>
            </div>
          </div>

          {/* Pending file chips */}
          {pendingFiles.length > 0 && (
            <div className="api-file-chips">
              {pendingFiles.map((file, index) => (
                <div key={index} className="api-file-chip">
                  {file.name}
                  <button
                    className="api-file-chip-remove"
                    onClick={e => { e.stopPropagation(); removePendingFile(index); }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Pipeline row */}
          <div className="api-pipeline-row">
            {/* Step 1: Preprocessing */}
            <div className="api-pipeline-step">
              <div className="api-pipeline-step-header">
                <div className="api-pipeline-badge">1</div>
                <span className="api-pipeline-label">Preprocessing</span>
                <span className="api-pipeline-optional">optional</span>
              </div>
              <select
                className={`api-pipeline-select${selectedPreprocessing ? ' has-value' : ''}`}
                value={selectedPreprocessing}
                onChange={e => setSelectedPreprocessing(e.target.value)}
              >
                <option value="">None (skip)</option>
                <option value="OpenVAE">OpenVAE</option>
              </select>
            </div>

            <div className="api-pipeline-arrow">→</div>

            {/* Step 2: Model */}
            <div className="api-pipeline-step">
              <div className="api-pipeline-step-header">
                <div className="api-pipeline-badge">2</div>
                <span className="api-pipeline-label">Model</span>
              </div>
              <select
                className={`api-pipeline-select${selectedModel ? ' has-value' : ''}`}
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
              >
                <option value="" disabled>Select a model</option>
                <option value="ePAI">ePAI</option>
                <option value="SuPreM">SuPreM</option>
                <option value="MedFormer">MedFormer</option>
                <option value="R-Super">R-Super</option>
                <option value="Atlas-Net">Atlas-Net</option>
              </select>
            </div>

            <div className="api-pipeline-arrow">→</div>

            {/* Step 3: Postprocessing */}
            <div className="api-pipeline-step">
              <div className="api-pipeline-step-header">
                <div className="api-pipeline-badge">3</div>
                <span className="api-pipeline-label">Postprocessing</span>
                <span className="api-pipeline-optional">optional</span>
              </div>
              <select
                className={`api-pipeline-select${selectedPostprocessing ? ' has-value' : ''}`}
                value={selectedPostprocessing}
                onChange={e => setSelectedPostprocessing(e.target.value)}
              >
                <option value="">None (skip)</option>
                <option value="ShapeKit">ShapeKit</option>
              </select>
            </div>

            <button
              className="api-run-btn"
              onClick={handleQueueBatch}
              disabled={!selectedModel || pendingFiles.length === 0}
            >
              Queue Batch
            </button>
          </div>
        </div>

        {/* ── Status counters ── */}
        <div className="api-counters">
          <div className="api-counter-card queued">
            <div className="api-counter-value">{queuedCount}</div>
            <div className="api-counter-label">Queued</div>
          </div>
          <div className="api-counter-card processing">
            <div className="api-counter-value">{processingCount}</div>
            <div className="api-counter-label">Processing</div>
          </div>
          <div className="api-counter-card completed">
            <div className="api-counter-value">{completedCount}</div>
            <div className="api-counter-label">Completed</div>
          </div>
        </div>

        {/* ── Job queue card ── */}
        <div className="api-card">
          <div className="api-queue-header">
            <div className="api-queue-title">Job Queue</div>
            <button
              className="api-download-all-btn"
              onClick={handleDownloadAll}
              disabled={!hasCompleted}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download All
            </button>
          </div>

          {/* Filter tabs */}
          <div className="api-filter-tabs">
            {(['all', 'queued', 'uploading', 'processing', 'completed', 'failed'] as const).map(f => {
              const count = f === 'all' ? jobs.length : jobs.filter(j => j.status === f).length;
              if (f !== 'all' && count === 0) return null;
              return (
                <button
                  key={f}
                  className={`api-filter-tab${jobFilter === f ? ' active' : ''}`}
                  onClick={() => setJobFilter(f)}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  <span className="api-filter-tab-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="api-job-list">
            {jobs.length === 0 ? (
              <div className="api-job-empty">
                No jobs yet — add CT scans above and click Queue Batch to begin.
              </div>
            ) : (
              [...jobs].reverse().filter(j => jobFilter === 'all' || j.status === jobFilter).map(job => {
                const isCompleted = job.status === 'completed';
                const isActive = job.status === 'uploading' || job.status === 'processing';
                const progress = job.status === 'uploading'
                  ? job.uploadProgress
                  : job.inferenceProgress;
                const statusLabel =
                  job.status === 'uploading' ? 'Uploading'
                    : job.status === 'processing' ? 'Processing'
                      : job.status === 'completed' ? 'Completed'
                        : job.status === 'failed' ? 'Failed'
                          : 'Queued';
                const statusClass =
                  job.status === 'uploading' || job.status === 'processing' ? 'processing'
                    : job.status;

                return (
                  <div
                    key={job.id}
                    className={`api-job-row${isCompleted ? ' clickable' : ''}`}
                    onClick={() => {
                      if (isCompleted && job.sessionId) {
                        navigate(`/session/${job.sessionId}`);
                      }
                    }}
                  >
                    {/* File icon */}
                    <div className="api-job-icon">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#6a6a6a"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                    </div>

                    {/* File name + meta */}
                    <div className="api-job-info">
                      <div className="api-job-name">{job.file.name}</div>
                      <div className="api-job-meta">
                        {job.model}
                        {job.status === 'failed' && job.error ? ` · ${job.error}` : ''}
                      </div>
                    </div>

                    {/* Progress bar while active */}
                    {isActive && (
                      <div className="api-job-progress-wrap">
                        <div className="api-job-progress-track">
                          <div
                            className="api-job-progress-fill"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="api-job-progress-pct">{progress}%</div>
                      </div>
                    )}

                    {/* Status badge */}
                    <span className={`api-status-badge ${statusClass}`}>{statusLabel}</span>

                    {/* Per-job actions */}
                    {isCompleted && (
                      <>
                        <button
                          className="api-job-dl-btn"
                          onClick={e => { e.stopPropagation(); navigate(`/session/${job.sessionId}`); }}
                        >
                          View
                        </button>
                        <button
                          className="api-job-dl-btn"
                          onClick={e => { e.stopPropagation(); downloadJob(job); }}
                        >
                          Download
                        </button>
                      </>
                    )}
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

export default ApiPage;
