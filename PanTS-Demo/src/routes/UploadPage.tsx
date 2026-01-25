import React, { useRef, useState } from 'react';
import './UploadPage.css';
import {
  IconPlus,
  IconArrowUp,
  IconDownload
} from "@tabler/icons-react";

interface UploadPageProps {}

const UploadPage: React.FC<UploadPageProps> = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [message, setMessage] = useState<string>("");
  const [inferenceStarted, setInferenceStarted] = useState(false);
  const [zipFilename, setZipFilename] = useState<string | null>(null);

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

  // Step 0: Upload files to server
  const handleUploadClick = async () => {
    if (selectedFiles.length === 0) {
      alert("No files selected!");
      return;
    }

    setMessage("Uploading files...");
    try {
      const formData = new FormData();
      selectedFiles.forEach(f => formData.append("files", f));

      const res = await fetch("/upload-files", {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      if (res.ok) {
        setMessage(`Upload successful: ${data.status}`);
        setInferenceStarted(false);
        setZipFilename(null);
      } else {
        setMessage(`Upload failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error(err);
      setMessage("Upload failed: network error");
    }
  };

  // Step 1: Run inference
  const handleRunInference = async () => {
    setMessage("Running inference...");
    try {
      const res = await fetch("/run-inference", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.status || "Inference started");
        setInferenceStarted(true);
        setZipFilename(null);
      } else {
        setMessage(data.error || "Inference failed");
      }
    } catch (err) {
      console.error(err);
      setMessage("Inference failed: network error");
    }
  };

  // Step 2: Prepare zip download
  const handlePrepareDownload = async () => {
    if (!inferenceStarted) {
      setMessage("Run inference first");
      return;
    }

    setMessage("Preparing output zip...");
    try {
      const res = await fetch("/prepare-download", { method: "POST" });
      const data = await res.json();

      if (res.ok && data.filename) {
        setZipFilename(data.filename);
        setMessage(`Output prepared: ${data.filename}. Ready to download.`);
      } else {
        setMessage("Failed to prepare output zip");
        console.error(data);
      }
    } catch (err) {
      console.error(err);
      setMessage("Error preparing download");
    }
  };

  // Step 3: Download zip
  const handleDownload = async () => {
    if (!zipFilename) {
      setMessage("No prepared file available. Prepare download first.");
      return;
    }

    try {
      const res = await fetch(`/download-prepared-output?filename=${zipFilename}`);
      const data = await res.json();

      if (res.ok && data.url) {
        const link = document.createElement("a");
        link.href = data.url;
        link.download = data.filename || zipFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setMessage(`Download started: ${data.filename || zipFilename}`);
      } else {
        setMessage("Download failed");
        console.error(data);
      }
    } catch (err) {
      console.error(err);
      setMessage("Download failed");
    }
  };

  return (
    <div className="upload-page">
      <h2>AI CT Segmentation</h2>

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

      {/* Action buttons */}
      <div className="action-buttons">
        <button onClick={handleRunInference} disabled={selectedFiles.length === 0}>
          Run Inference
        </button>
        <button onClick={handlePrepareDownload} disabled={!inferenceStarted}>
          Prepare Download
        </button>
        <button onClick={handleDownload} disabled={!zipFilename}>
          <IconDownload /> Download
        </button>
      </div>

      {/* Status message */}
      {message && <div className="status-message">{message}</div>}
    </div>
  );
};

export default UploadPage;
