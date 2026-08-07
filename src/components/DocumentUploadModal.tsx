"use client";

import { useState } from "react";
import { Upload, X, FileText, CheckCircle2, AlertCircle, Loader2, Sparkles } from "lucide-react";

interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  shipmentId: string;
  shipments?: any[];
  onUploadSuccess?: () => void;
}

export function DocumentUploadModal({
  isOpen,
  onClose,
  shipmentId: initialShipmentId,
  shipments = [],
  onUploadSuccess,
}: DocumentUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<string>("Commercial Invoice");
  const [selectedShipmentId, setSelectedShipmentId] = useState<string>(initialShipmentId);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a document file to upload.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      if (!selectedShipmentId) {
        throw new Error("Please select a shipment.");
      }
      
      const formData = new FormData();
      formData.append("file", file);
      formData.append("docType", docType);
      formData.append("shipmentId", selectedShipmentId);

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setSuccessMsg(`Document "${file.name}" uploaded successfully!`);
      setIsUploading(false);
      setFile(null);

      if (onUploadSuccess) {
        onUploadSuccess();
      }

      setTimeout(() => {
        setSuccessMsg(null);
        onClose();
        window.location.reload();
      }, 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload document");
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3]">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#1D1D1F]">Upload Trade Document</h3>
              <p className="text-xs text-[#86868B]">Add a commercial invoice, bill of lading, or certificate</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

          {/* Shipment Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1D1D1F] ml-1">Target Shipment</label>
            <select
              value={selectedShipmentId}
              onChange={(e) => setSelectedShipmentId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[#E5E5EA] bg-white text-xs text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:ring-2 focus:ring-[#0071E3]/20 transition-all"
            >
              <option value="" disabled>Select a Shipment</option>
              {shipments.map((shp: any) => (
                <option key={shp.id} value={shp.id}>
                  {shp.shipmentNumber || shp.referenceNumber || shp.id} ({shp.status || "Unknown"})
                </option>
              ))}
            </select>
          </div>

          {/* Document Type Dropdown */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-[#1D1D1F]">Document Type</label>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="w-full p-3 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-xs text-[#1D1D1F] focus:outline-hidden focus:border-[#0071E3] font-medium"
          >
            <option value="AUTO_DETECT">✨ Auto-Detect Document Type (AI Agent Classification)</option>
            <option value="Bill of Lading">Bill of Lading (B/L)</option>
            <option value="Commercial Invoice">Commercial Invoice</option>
            <option value="Packing List">Packing List</option>
            <option value="Arrival Notice">Arrival Notice</option>
            <option value="Insurance Certificate">Insurance Certificate</option>
            <option value="Certificate of Origin">Certificate of Origin</option>
            <option value="Customs Entry Summary">Customs Entry Summary (CBP 7501)</option>
          </select>
        </div>

        {/* Drag and Drop File Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-[#1D1D1F]">Select File</label>
          <div className="relative border-2 border-dashed border-[#E5E5EA] hover:border-[#0071E3] rounded-2xl p-6 text-center bg-[#F5F5F7] transition-all cursor-pointer group">
            <input
              type="file"
              onChange={handleFileChange}
              accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.edi"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#0071E3] group-hover:scale-110 transition-transform">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-[#1D1D1F]">
                  {file ? file.name : "Click to upload or drag & drop"}
                </p>
                <p className="text-[10px] text-[#86868B] mt-0.5">
                  {file
                    ? `${(file.size / 1024).toFixed(1)} KB`
                    : "PDF, PNG, JPG, XLSX or EDI up to 25MB"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* AI Auto-Extraction Notice */}
        <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-[#0071E3] shrink-0" />
          <span>
            Uploaded documents will be automatically parsed by the <strong>Document Intelligence Agent</strong>.
          </span>
        </div>

        {/* Modal Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            onClick={onClose}
            disabled={isUploading}
            className="px-4 py-2.5 bg-white border border-[#E5E5EA] hover:bg-[#F5F5F7] text-[#1D1D1F] text-xs font-semibold rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={isUploading || !file}
            className="px-5 py-2.5 bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-xs flex items-center space-x-2 transition-all"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Uploading...</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>Upload & Parse</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
