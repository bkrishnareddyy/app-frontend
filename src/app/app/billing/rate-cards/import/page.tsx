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
      // Mock parsed XLSX lines for mapping preview
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
          <h2 className="text-xl font-bold text-white">Import Customer Rate Card (XLSX / CSV)</h2>
          <p className="text-sm text-slate-400">
            Upload customer rate card spreadsheets and map commercial line items to Qubere capabilities.
          </p>
        </div>
        <Link
          href="/app/billing/rate-cards"
          className="text-xs text-slate-400 hover:text-white transition-colors"
        >
          ← Back to Rate Cards
        </Link>
      </div>

      {step === "UPLOAD" && (
        <div className="p-12 rounded-xl bg-slate-900/60 border-2 border-dashed border-slate-700 hover:border-emerald-500/50 transition-colors text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto text-xl font-bold border border-emerald-500/20">
            ↑
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Select or Drag & Drop Rate Card Spreadsheet</h3>
            <p className="text-xs text-slate-400 mt-1">Supports .xlsx, .xls, and .csv format rate cards</p>
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
            className="inline-block px-4 py-2 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer transition-colors shadow-sm"
          >
            Browse Spreadsheet Files
          </label>
        </div>
      )}

      {step === "MAP" && (
        <div className="space-y-6 p-6 rounded-xl bg-slate-900/60 border border-slate-800">
          <h3 className="text-base font-semibold text-white border-b border-slate-800 pb-3">
            Map Uploaded Spreadsheet Columns to Qubere Billing Capabilities
          </h3>

          <div className="space-y-4">
            {mappedLines.map((line, idx) => (
              <div key={idx} className="p-4 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-white">{line.customerDescription}</div>
                  <div className="text-xs text-slate-400 font-mono">
                    Rate: ${line.rate.toFixed(2)} / {line.unit}
                  </div>
                </div>
                <div className="w-64">
                  <select
                    defaultValue={line.mappedCapability}
                    className="w-full px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
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

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              onClick={() => setStep("PREVIEW")}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-sm"
            >
              Preview & Activate Rate Card Version →
            </button>
          </div>
        </div>
      )}

      {step === "PREVIEW" && (
        <div className="p-6 rounded-xl bg-slate-900/60 border border-emerald-500/30 space-y-6">
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-emerald-400" />
            <h3 className="text-base font-semibold text-emerald-300">
              Rate Card Verified & Ready to Activate
            </h3>
          </div>
          <p className="text-xs text-slate-300">
            Once activated, this rate card version (v1) will become immutable and apply to all matching operational events.
          </p>
          <div className="flex justify-end gap-3">
            <Link
              href="/app/billing/rate-cards"
              className="px-4 py-2 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-sm"
            >
              Activate Rate Card
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
