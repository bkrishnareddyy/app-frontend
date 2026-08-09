"use client";

import { useState } from "react";
import { AlertOctagon, CheckCircle2, ChevronDown, ChevronUp, Clock, FileText, HelpCircle, ShieldAlert, User } from "lucide-react";

interface ComplianceEvidence {
  sourceName: string;
  fields: { label: string; value: string }[];
  documentName?: string;
  documentUrl?: string;
  documentId?: string;
}

interface CategoryDetail {
  id: string;
  name: string;
  status: "Ready" | "Needs Information" | "Needs Review" | "Blocked" | "Not Applicable";
  result: string;
  details: string;
  whyItMatters: string;
  actionOwner: string;
  actionRequired: string;
  source: string;
  timestamp: string;
  questionnaire?: string[];
  evidence?: ComplianceEvidence;
}

interface PreFilingReadinessProps {
  categories: CategoryDetail[];
  overallStatus: {
    text: string;
    subtext: string;
    type: "BLOCKED" | "REVIEW_REQUIRED" | "INFO_REQUIRED" | "WARNINGS" | "READY";
  };
}

export function PreFilingReadiness({ categories, overallStatus }: PreFilingReadinessProps) {
  const [isTableExpanded, setIsTableExpanded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleEvidenceId, setVisibleEvidenceId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const toggleEvidence = (id: string) => {
    setVisibleEvidenceId(visibleEvidenceId === id ? null : id);
  };

  const getStatusBadge = (status: CategoryDetail["status"]) => {
    switch (status) {
      case "Blocked":
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-rose-50 text-rose-700 border border-rose-200">
            Blocked
          </span>
        );
      case "Needs Review":
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-amber-50 text-amber-700 border border-amber-200">
            Needs Review
          </span>
        );
      case "Needs Information":
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-blue-50 text-blue-700 border border-blue-200">
            Needs Info
          </span>
        );
      case "Ready":
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
            Ready
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase bg-slate-50 text-slate-500 border border-slate-200">
            N/A
          </span>
        );
    }
  };

  const getOverallIcon = (type: typeof overallStatus.type) => {
    switch (type) {
      case "BLOCKED":
        return <AlertOctagon className="w-5 h-5 text-rose-600 shrink-0" />;
      case "REVIEW_REQUIRED":
        return <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />;
      case "INFO_REQUIRED":
        return <Clock className="w-5 h-5 text-blue-600 shrink-0" />;
      default:
        return <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />;
    }
  };

  const getOverallStyles = (type: typeof overallStatus.type) => {
    switch (type) {
      case "BLOCKED":
        return "bg-rose-50 border-rose-200 text-rose-900";
      case "REVIEW_REQUIRED":
        return "bg-amber-50 border-amber-200 text-amber-900";
      case "INFO_REQUIRED":
        return "bg-blue-50 border-blue-200 text-blue-900";
      default:
        return "bg-emerald-50 border-emerald-200 text-emerald-900";
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E5E5EA] shadow-2xs overflow-hidden transition-all">
      {/* Header Banner Ribbon */}
      <div 
        onClick={() => setIsTableExpanded(!isTableExpanded)}
        className={`p-4 flex items-center justify-between flex-wrap gap-4 cursor-pointer select-none transition-colors ${getOverallStyles(overallStatus.type)} ${isTableExpanded ? 'border-b' : ''}`}
      >
        <div className="flex items-center space-x-3">
          {getOverallIcon(overallStatus.type)}
          <div>
            <h3 className="text-sm font-extrabold uppercase tracking-wider">{overallStatus.text}</h3>
            <p className="text-xs opacity-80">{overallStatus.subtext}</p>
          </div>
        </div>
        <button 
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-current text-xs font-semibold hover:bg-black/5 transition-colors cursor-pointer"
        >
          <span>{isTableExpanded ? "Hide Details" : "Show Details"}</span>
          {isTableExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Categories Table */}
      {isTableExpanded && (
        <div className="divide-y divide-[#E5E5EA]">
          {categories.map((cat) => {
            const isExpanded = expandedId === cat.id;
            return (
              <div key={cat.id} className="transition-all hover:bg-[#F9F9FB]">
                <div
                  onClick={() => toggleExpand(cat.id)}
                  className="flex items-center justify-between p-4 cursor-pointer select-none text-xs"
                >
                  <div className="flex items-center space-x-4 min-w-0 pr-4">
                    <div className="w-48 font-bold text-[#1D1D1F] shrink-0 truncate">{cat.name}</div>
                    <div className="text-[#86868B] truncate">{cat.result}</div>
                  </div>
                  <div className="flex items-center space-x-3 shrink-0">
                    {getStatusBadge(cat.status)}
                    {(cat.status === "Ready" || cat.status === "Not Applicable") && cat.evidence && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleEvidence(cat.id);
                        }}
                        className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-[10px] font-bold uppercase rounded-md flex items-center space-x-1 transition-colors cursor-pointer"
                      >
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>{visibleEvidenceId === cat.id ? "Hide Evidence" : "Evidence"}</span>
                      </button>
                    )}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-[#86868B]" /> : <ChevronDown className="w-4 h-4 text-[#86868B]" />}
                  </div>
                </div>

                {/* Evidence Details Collapsible (Toggled by "Evidence" button next to "Ready" status) */}
                {visibleEvidenceId === cat.id && cat.evidence && (
                  <div className="mx-4 mb-4 p-4 bg-emerald-50/40 border border-emerald-200 rounded-2xl text-xs space-y-3 shadow-2xs text-[#1D1D1F]">
                    <div className="flex justify-between items-center">
                      <div>
                        <h5 className="font-extrabold text-[10px] text-emerald-800 uppercase tracking-wider mb-0.5">Auditable Data Source</h5>
                        <p className="font-bold">{cat.evidence.sourceName}</p>
                      </div>
                      <span className="text-[9px] uppercase font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">Compliance Audit Evidence</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t border-[#E5E5EA]">
                      {cat.evidence.fields.map((f, idx) => (
                        <div key={idx} className="space-y-0.5">
                          <p className="text-[9px] text-[#86868B] font-extrabold uppercase">{f.label}</p>
                          <p className="font-bold truncate">{f.value || "N/A"}</p>
                        </div>
                      ))}
                    </div>

                    {cat.evidence.documentName && (
                      <div className="pt-2.5 border-t border-[#E5E5EA] flex items-center justify-between text-[10px]">
                        <span className="text-[#86868B]">Supporting Document Reference</span>
                        {cat.evidence.documentUrl ? (
                          <a
                            href={cat.evidence.documentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold text-[#0071E3] hover:underline flex items-center space-x-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <FileText className="w-3.5 h-3.5 text-[#0071E3]" />
                            <span>{cat.evidence.documentName}</span>
                          </a>
                        ) : (
                          <span className="font-bold text-[#0071E3] flex items-center space-x-1">
                            <FileText className="w-3.5 h-3.5 text-[#0071E3]" />
                            <span>{cat.evidence.documentName}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {isExpanded && (
                  <div className="p-4 bg-[#F5F5F7] border-t border-[#E5E5EA] text-xs space-y-4">
                    {/* Detailed columns */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                      {/* Findings & Why It Matters */}
                      <div className="md:col-span-8 space-y-3">
                        <div>
                          <h4 className="font-extrabold text-[#1D1D1F] uppercase text-[10px] tracking-wider mb-1">Finding Description</h4>
                          <p className="text-[#1D1D1F] leading-relaxed">{cat.details}</p>
                        </div>
                        <div>
                          <h4 className="font-extrabold text-[#1D1D1F] uppercase text-[10px] tracking-wider mb-1">Why It Matters</h4>
                          <p className="text-[#86868B] leading-relaxed">{cat.whyItMatters}</p>
                        </div>

                        {/* HTS Questionnaire Checklist */}
                        {cat.questionnaire && cat.questionnaire.length > 0 && (
                          <div className="pt-2">
                            <h4 className="font-extrabold text-amber-800 uppercase text-[10px] tracking-wider mb-2 flex items-center space-x-1.5">
                              <HelpCircle className="w-3.5 h-3.5" />
                              <span>HTS Classification Verification Questionnaire</span>
                            </h4>
                            <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-3 space-y-2">
                              {cat.questionnaire.map((q, idx) => (
                                <label key={idx} className="flex items-start space-x-2 text-[#1D1D1F] cursor-pointer">
                                  <input type="checkbox" className="mt-0.5 rounded text-amber-600 focus:ring-amber-500 border-[#E5E5EA]" />
                                  <span>{q}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Action & Owner */}
                      <div className="md:col-span-4 space-y-3 border-t md:border-t-0 md:border-l border-[#E5E5EA] pt-3 md:pt-0 md:pl-4">
                        <div className="flex items-center space-x-2">
                          <User className="w-4 h-4 text-[#86868B]" />
                          <div>
                            <h4 className="font-extrabold text-[#1D1D1F] uppercase text-[10px] tracking-wider">Action Owner</h4>
                            <p className="font-bold text-[#1D1D1F]">{cat.actionOwner}</p>
                          </div>
                        </div>
                        <div>
                          <h4 className="font-extrabold text-[#1D1D1F] uppercase text-[10px] tracking-wider mb-1">Resolution Required</h4>
                          <p className="text-[#1D1D1F] leading-relaxed bg-white border border-[#E5E5EA] rounded-lg p-2 font-medium">
                            {cat.actionRequired || "No action required. Category is compliant."}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Audit Metadata Footer */}
                    <div className="flex justify-between items-center text-[10px] text-[#86868B] pt-2 border-t border-[#E5E5EA]">
                      <span>Source: {cat.source}</span>
                      <span>Last Evaluated: {new Date(cat.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
