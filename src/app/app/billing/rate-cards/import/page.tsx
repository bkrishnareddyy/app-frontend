"use client";

import React, { useState } from "react";
import Link from "next/link";

interface MappedLine {
  customerDescription: string;
  rate: number;
  unit: string;
  mappedCapability: string;
}

export default function ImportRateCardPage() {
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"UPLOAD" | "MAP" | "PREVIEW">("UPLOAD");
  const [mappedLines, setMappedLines] = useState<MappedLine[]>([]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setMappedLines([
        { customerDescription: "Customs Entry Processing Fee", rate: 125.0, unit: "entry", mappedCapability: "CUSTOMS_ENTRY_COMPLETED" },
        { customerDescription: "Additional HTS Line Item", rate: 4.0, unit: "line", mappedCapability: "HTS_CLASSIFICATION_COMPLETED" },
        { customerDescription: "PGA Agency Filing", rate: 35.0, unit: "filing", mappedCapability: "PGA_PROCESSING_COMPLETED" },
        { customerDescription: "Manual HTS Broker Review", rate: 20.0, unit: "review", mappedCapability: "HTS_MANUAL_REVIEW_COMPLETED" },
      ]);
      setStep("MAP");
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Import Customer Rate Card (XLSX / CSV)</h2>
          <p className="text-sm text-ink-muted">
            Upload customer rate card spreadsheets and map commercial line items to Qubere capabilities.
          </p>
        </div>
        <Link
          href="/app/billing/rate-cards"
          className="text-xs font-semibold text-ink-muted hover:text-ink transition-colors"
        >
          ← Back to Rate Cards
        </Link>
      </div>

      {step === "UPLOAD" && (
        <div className="p-12 rounded-2xl bg-white border-2 border-dashed border-[#E5E5EA] hover:border-brand/50 transition-colors text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-brand flex items-center justify-center mx-auto text-xl font-bold border border-blue-100">
            ↑
          </div>
          <div>
            <h3 className="text-base font-bold text-ink">Select or Drag & Drop Rate Card Spreadsheet</h3>
            <p className="text-xs text-ink-muted mt-1">Supports .xlsx, .xls, and .csv format rate cards</p>
          </div>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="hidden"
            id="rate-card-upload"
          />
          <label
            htmlFor="rate-card-upload"
            className="inline-block px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white cursor-pointer transition-colors shadow-sm"
          >
            Browse Spreadsheet Files
          </label>
        </div>
      )}

      {step === "MAP" && (
        <div className="space-y-6 p-6 rounded-2xl bg-white border border-[#E5E5EA] shadow-sm">
          <h3 className="text-base font-bold text-ink border-b border-[#E5E5EA] pb-3">
            Map Uploaded Spreadsheet Columns to Qubere Billing Capabilities
          </h3>

          <div className="space-y-4">
            {mappedLines.map((line, idx) => (
              <div key={idx} className="p-4 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA] flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-bold text-ink">{line.customerDescription}</div>
                  <div className="text-xs text-ink-muted font-mono">
                    Rate: ${line.rate.toFixed(2)} / {line.unit}
                  </div>
                </div>
                <div className="w-64">
                  <select
                    defaultValue={line.mappedCapability}
                    className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#E5E5EA] text-xs text-ink focus:outline-none focus:border-brand font-mono"
                  >
                    <option value="CUSTOMS_ENTRY_COMPLETED">CUSTOMS_ENTRY_COMPLETED</option>
                    <option value="HTS_CLASSIFICATION_COMPLETED">HTS_CLASSIFICATION_COMPLETED</option>
                    <option value="HTS_MANUAL_REVIEW_COMPLETED">HTS_MANUAL_REVIEW_COMPLETED</option>
                    <option value="PGA_PROCESSING_COMPLETED">PGA_PROCESSING_COMPLETED</option>
                    <option value="DOCUMENT_PROCESSED">DOCUMENT_PROCESSED</option>
                  </select>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[#E5E5EA]">
            <button
              onClick={() => setStep("PREVIEW")}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand hover:bg-brand-hover text-white transition-colors shadow-sm"
            >
              Preview & Activate Rate Card Version →
            </button>
          </div>
        </div>
      )}

      {step === "PREVIEW" && (
        <div className="p-6 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-6">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
            <h3 className="text-base font-bold text-emerald-900">
              Rate Card Verified & Ready to Activate
            </h3>
          </div>
          <p className="text-xs text-emerald-800">
            Once activated, this rate card version (v1) will become immutable and apply to all matching operational events.
          </p>
          <div className="flex justify-end gap-3">
            <Link
              href="/app/billing/rate-cards"
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-sm"
            >
              Activate Rate Card
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
