"use client";

import { useState, useRef } from "react";
import { UploadCloud, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface UploadFormProps {
  token: string;
  documentType: string;
  shipmentRef: string;
}

type Phase = "idle" | "uploading" | "done" | "error";

export function UploadForm({ token, documentType, shipmentRef }: UploadFormProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => setSelectedFile(file);

  const handleSubmit = async () => {
    if (!selectedFile) return;
    setPhase("uploading");
    setErrorMsg(null);

    const body = new FormData();
    body.append("file", selectedFile);

    try {
      const res = await fetch(`/api/upload/${token}`, { method: "POST", body });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error || `Upload failed (${res.status})`);
      }
      setPhase("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setPhase("error");
    }
  };

  if (phase === "done") {
    return (
      <div className="text-center space-y-4 py-8">
        <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
        <div>
          <h2 className="text-xl font-bold text-gray-900">Document submitted</h2>
          <p className="text-sm text-gray-500 mt-1">
            {documentType} for shipment {shipmentRef} has been received and is being processed.
          </p>
        </div>
        <p className="text-xs text-gray-400">You may close this window.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div
        className={`relative border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
          dragging ? "border-indigo-500 bg-indigo-50" : "border-gray-300 hover:border-indigo-400"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        <UploadCloud className="w-10 h-10 text-indigo-400 mx-auto mb-3" />
        {selectedFile ? (
          <div>
            <p className="text-sm font-semibold text-gray-800">{selectedFile.name}</p>
            <p className="text-xs text-gray-400 mt-1">{(selectedFile.size / 1024).toFixed(1)} KB</p>
          </div>
        ) : (
          <div>
            <p className="text-sm font-semibold text-gray-700">Drag &amp; drop your file here</p>
            <p className="text-xs text-gray-400 mt-1">PDF, JPEG, PNG, TIFF, XLSX, or CSV — max 50 MB</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-4 text-sm font-semibold text-indigo-600 hover:underline cursor-pointer"
        >
          {selectedFile ? "Choose a different file" : "Browse files"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.xlsx,.xls,.csv,.txt"
          className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {phase === "error" && errorMsg && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{errorMsg}</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!selectedFile || phase === "uploading"}
        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-sm py-3 rounded-xl transition-colors cursor-pointer shadow"
      >
        {phase === "uploading" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <UploadCloud className="w-4 h-4" />
            Submit Document
          </>
        )}
      </button>
    </div>
  );
}
