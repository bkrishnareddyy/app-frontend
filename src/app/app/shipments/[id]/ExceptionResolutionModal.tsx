"use client";

import { useState, useEffect } from "react";
import { X, CheckCircle2, FileText, AlertTriangle, Scale, ShieldAlert, Sparkles, Upload, Check } from "lucide-react";

interface ExceptionItem {
  id: string;
  dbId: string;
  version: number;
  category: string;
  title: string;
  desc: string;
  actionText: string;
  actionType: string;
}

interface ExceptionResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  exception: ExceptionItem | null;
  shipmentId: string;
  lineItems: any[];
}

export function ExceptionResolutionModal({
  isOpen,
  onClose,
  exception,
  shipmentId,
  lineItems,
}: ExceptionResolutionModalProps) {
  const [saveLoading, setSaveLoading] = useState(false);
  
  // HTS resolution state
  const [editHts, setEditHts] = useState("");
  const [htsSuggestions, setHtsSuggestions] = useState<any[]>([]);
  const [searchingHts, setSearchingHts] = useState(false);

  // Origin resolution state
  const [editCoo, setEditCoo] = useState("");

  // Quantity mismatch state
  const [selectedQuantity, setSelectedQuantity] = useState<number | "CUSTOM">(20);
  const [customQtyVal, setCustomQtyVal] = useState("");

  // POA state
  const [poaSignedName, setPoaSignedName] = useState("");

  // Certificate upload state
  const [fileName, setFileName] = useState("");
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  // Sync initial values
  useEffect(() => {
    if (exception && lineItems.length > 0) {
      const targetItem = lineItems[1] || lineItems[0];
      setEditHts(targetItem?.htsCode || "");
      setEditCoo(targetItem?.countryOfOrigin || "");
      setSelectedQuantity(20);
      setCustomQtyVal("");
      setPoaSignedName("");
      setFileName("");
    }
  }, [exception, lineItems]);

  // HTS Search autocomplete debouncing
  useEffect(() => {
    if (exception?.actionType === "HTS" && editHts.trim().length >= 2) {
      setSearchingHts(true);
      const timer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/v1/hts/search?q=${encodeURIComponent(editHts.trim())}&limit=5`);
          if (res.ok) {
            const data = await res.json();
            setHtsSuggestions(data.items || []);
          }
        } catch (err) {
          console.error("Failed to query HTS suggestions:", err);
        } finally {
          setSearchingHts(false);
        }
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setHtsSuggestions([]);
    }
  }, [editHts, exception]);

  if (!isOpen || !exception) return null;

  const handleResolve = async () => {
    setSaveLoading(true);
    try {
      // 1. Perform backend mutations depending on the exception category
      if (exception.actionType === "HTS") {
        const targetItem = lineItems.find(item => item.description.toLowerCase().includes("controller")) 
          || lineItems[1] 
          || lineItems[0]
          || null;
        const payload = targetItem 
          ? { id: targetItem.id, htsCode: editHts.trim() }
          : { htsCode: editHts.trim() };

        const res = await fetch(`/api/shipments/${shipmentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lineItems: [payload],
          }),
        });
        if (!res.ok) throw new Error("Failed to save HTS classification");
      } 
      
      else if (exception.actionType === "COO") {
        const targetItem = lineItems.find(item => item.description.toLowerCase().includes("controller")) 
          || lineItems[1] 
          || lineItems[0]
          || null;
        const payload = targetItem 
          ? { id: targetItem.id, countryOfOrigin: editCoo.trim() }
          : { countryOfOrigin: editCoo.trim() };

        const res = await fetch(`/api/shipments/${shipmentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lineItems: [payload],
          }),
        });
        if (!res.ok) throw new Error("Failed to save Country of Origin");
      } 
      
      else if (exception.actionType === "MISMATCH") {
        const targetItem = lineItems.find(item => item.description.toLowerCase().includes("controller")) 
          || lineItems[1] 
          || lineItems[0]
          || null;
        const finalQuantity = selectedQuantity === "CUSTOM" ? parseInt(customQtyVal, 10) : selectedQuantity;
        if (isNaN(finalQuantity) || finalQuantity <= 0) {
          throw new Error("Please enter a valid positive quantity");
        }
        const payload = targetItem 
          ? { id: targetItem.id, quantity: finalQuantity }
          : { quantity: finalQuantity };

        const res = await fetch(`/api/shipments/${shipmentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lineItems: [payload],
          }),
        });
        if (!res.ok) throw new Error("Failed to save quantity");
      } 
      
      else if (exception.actionType === "UPLOAD") {
        if (!fileName.trim()) throw new Error("Please select a file to attach");
        // Simulate uploading a document
        const uploadRes = await fetch("/api/documents/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shipmentId,
            fileName: fileName.trim(),
            fileUrl: "#",
            docType: "GENERAL_CERTIFICATE_OF_ORIGIN",
          }),
        });
        if (!uploadRes.ok) throw new Error("Failed to upload certificate document");
      } 
      
      else if (exception.actionType === "POA") {
        if (!poaSignedName.trim()) throw new Error("Customs Broker Signature is required for POA renewal");
      }

      // 2. PATCH the ExceptionItem status to "RESOLVED"
      const resEx = await fetch(`/api/exceptions/${exception.dbId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "RESOLVED",
          resolutionReason: `Resolved via Exception Resolution Hub modal for issue: ${exception.title}`,
          expectedVersion: exception.version,
        }),
      });

      if (!resEx.ok) {
        const errData = await resEx.json();
        throw new Error(errData.error || "Failed to resolve database exception item");
      }

      onClose();
      // Silently reload the page to refresh metrics and drop the resolved card
      window.location.reload();
    } catch (err: any) {
      alert(err.message || "Failed to resolve exception");
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl border border-[#E5E5EA] shadow-2xl max-w-xl w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E5EA] pb-3 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-[#1D1D1F]">{exception.title}</h3>
              <p className="text-xs text-[#86868B]">Resolve exception item directly in Qubere Workspace</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-[#F5F5F7] text-[#86868B] hover:text-[#1D1D1F] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning Details Panel */}
        <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200 text-xs text-amber-800 leading-normal flex items-start space-x-2.5">
          <AlertTriangle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-extrabold text-[12px]">Issue: {exception.title}</p>
            <p className="text-[11px] mt-0.5">{exception.desc}</p>
          </div>
        </div>

        {/* Core Resolution Fields depending on Exception Category */}
        <div className="py-2">
          {/* 1. HTS Code resolution UI */}
          {exception.actionType === "HTS" && (
            <div className="space-y-3 relative text-xs">
              <label className="font-bold text-[#1D1D1F]">Override HTS Classification Code</label>
              <div className="relative">
                <input
                  type="text"
                  value={editHts}
                  onChange={(e) => setEditHts(e.target.value)}
                  placeholder="Type product type or HTS number..."
                  className="w-full px-3.5 py-2.5 border border-[#E5E5EA] focus:border-[#0071E3] rounded-xl outline-none font-mono font-bold bg-[#F5F5F7] focus:bg-white text-[12px]"
                  disabled={saveLoading}
                />
                
                {/* Autocomplete suggestions */}
                {htsSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 z-50 bg-white border border-[#E5E5EA] rounded-xl shadow-lg mt-1 p-1.5 space-y-1 max-h-48 overflow-y-auto">
                    <p className="text-[9px] text-[#86868B] font-bold px-1.5 uppercase tracking-wider">HTS Autocomplete Results</p>
                    {htsSuggestions.map((sugg) => (
                      <button
                        key={sugg.id}
                        onClick={() => {
                          setEditHts(sugg.htsNumberDisplay);
                          setHtsSuggestions([]);
                        }}
                        className="w-full text-left p-2 rounded-lg hover:bg-[#F5F5F7] text-[10px] space-y-0.5 block transition-colors cursor-pointer"
                      >
                        <span className="font-mono font-bold text-[#0071E3]">{sugg.htsNumberDisplay}</span>
                        <span className="text-[#86868B] block truncate leading-snug">{sugg.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-[#86868B] leading-relaxed">
                Provide correct 10-digit Harmonized Tariff Schedule classification. Autocomplete searches database in real-time.
              </p>
            </div>
          )}

          {/* 2. Country of Origin resolution UI */}
          {exception.actionType === "COO" && (
            <div className="space-y-3 text-xs">
              <label className="font-bold text-[#1D1D1F]">Specify Declared Country of Origin</label>
              <input
                type="text"
                value={editCoo}
                onChange={(e) => setEditCoo(e.target.value)}
                placeholder="e.g. Germany"
                className="w-full px-3.5 py-2.5 border border-[#E5E5EA] focus:border-[#0071E3] rounded-xl outline-none font-bold bg-[#F5F5F7] focus:bg-white text-[12px]"
                disabled={saveLoading}
              />
              <p className="text-[10px] text-[#86868B] leading-relaxed">
                Provide the correct Country of Origin as verified on shipment documents to determine preferential duty qualifiers.
              </p>
            </div>
          )}

          {/* 3. Certificate of Origin Missing upload UI */}
          {exception.actionType === "UPLOAD" && (
            <div className="space-y-3 text-xs">
              <label className="font-bold text-[#1D1D1F]">Upload Trade Certificate</label>
              <div className="border-2 border-dashed border-[#E5E5EA] rounded-2xl p-5 text-center bg-[#F9F9FB] space-y-2">
                <Upload className="w-8 h-8 text-[#0071E3] mx-auto opacity-70" />
                <div>
                  <p className="font-bold text-[#1D1D1F]">Drag and drop certificate file</p>
                  <p className="text-[10px] text-[#86868B] mt-0.5">Supports PDF, PNG, JPG up to 10MB</p>
                </div>
                <input
                  type="text"
                  placeholder="Or enter filename (e.g. cert_origin_shp001.pdf)"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="w-full max-w-xs mx-auto px-3 py-1.5 border border-[#E5E5EA] focus:border-[#0071E3] rounded-lg text-xs bg-white text-center font-bold"
                />
              </div>
            </div>
          )}

          {/* 4. Side by Side Quantity Mismatch Resolution */}
          {exception.actionType === "MISMATCH" && (
            <div className="space-y-3 text-xs">
              <label className="font-bold text-[#1D1D1F]">Resolve Document Mismatch</label>
              
              <div className="grid grid-cols-2 gap-3">
                <div
                  onClick={() => setSelectedQuantity(20)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer space-y-2 ${
                    selectedQuantity === 20
                      ? "bg-blue-50/80 border-[#0071E3] ring-1 ring-[#0071E3]/20"
                      : "bg-[#F9F9FB] border-[#E5E5EA] hover:border-[#0071E3]"
                  }`}
                >
                  <div className="flex justify-between items-center text-[9px] uppercase font-bold text-[#86868B]">
                    <span>Commercial Invoice</span>
                    <span className="text-[#0071E3]">Doc 1</span>
                  </div>
                  <p className="font-extrabold text-[#1D1D1F] text-sm font-mono">20 PCS</p>
                </div>

                <div
                  onClick={() => setSelectedQuantity(18)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer space-y-2 ${
                    selectedQuantity === 18
                      ? "bg-blue-50/80 border-[#0071E3] ring-1 ring-[#0071E3]/20"
                      : "bg-[#F9F9FB] border-[#E5E5EA] hover:border-[#0071E3]"
                  }`}
                >
                  <div className="flex justify-between items-center text-[9px] uppercase font-bold text-[#86868B]">
                    <span>Packing List</span>
                    <span className="text-purple-700">Doc 2</span>
                  </div>
                  <p className="font-extrabold text-[#1D1D1F] text-sm font-mono">18 PCS</p>
                </div>
              </div>

              <div className="p-3 bg-[#F5F5F7] rounded-xl border border-[#E5E5EA] space-y-2">
                <label className="flex items-center space-x-2 font-bold cursor-pointer">
                  <input
                    type="radio"
                    checked={selectedQuantity === "CUSTOM"}
                    onChange={() => setSelectedQuantity("CUSTOM")}
                    className="w-4 h-4 text-[#0071E3]"
                  />
                  <span>Specify Custom Correct Quantity</span>
                </label>
                {selectedQuantity === "CUSTOM" && (
                  <div className="flex items-center space-x-2 pl-6">
                    <input
                      type="number"
                      value={customQtyVal}
                      onChange={(e) => setCustomQtyVal(e.target.value)}
                      placeholder="e.g. 19"
                      className="w-20 px-2.5 py-1 border border-[#0071E3] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0071E3] bg-white font-mono text-xs"
                      disabled={saveLoading}
                    />
                    <span className="font-bold text-[#86868B]">PCS</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 5. Importer POA Expired renewal UI */}
          {exception.actionType === "POA" && (
            <div className="space-y-3 text-xs">
              <label className="font-bold text-[#1D1D1F]">Renew Importer Power of Attorney</label>
              <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 flex items-start space-x-2 text-blue-900 leading-normal">
                <ShieldAlert className="w-5 h-5 text-[#0071E3] shrink-0 mt-0.5" />
                <div>
                  <p className="font-extrabold">POA Electronic Consent Renewal</p>
                  <p className="text-[11px] mt-0.5">
                    Sign off to renew the active Power of Attorney consent for Target Enterprise. The renewal extends POA credentials for 1 year per CBP regulation 19 CFR § 141.46.
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="font-bold text-[#1D1D1F]">Broker / Officer Signature Name</p>
                <input
                  type="text"
                  value={poaSignedName}
                  onChange={(e) => setPoaSignedName(e.target.value)}
                  placeholder="Sign as Joe Admin / Licensed Customs Broker"
                  className="w-full px-3.5 py-2.5 border border-[#E5E5EA] focus:border-[#0071E3] rounded-xl outline-none font-bold bg-[#F5F5F7] focus:bg-white text-[12px]"
                  disabled={saveLoading}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-[#E5E5EA]">
          <button
            onClick={onClose}
            disabled={saveLoading}
            className="px-4 py-2 border border-[#E5E5EA] hover:bg-[#F5F5F7] rounded-xl text-xs font-semibold text-[#1D1D1F] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            disabled={saveLoading}
            className="px-5 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-xl flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer"
          >
            {saveLoading ? "Saving..." : "Resolve & Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
