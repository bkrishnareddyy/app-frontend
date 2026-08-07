"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  FileCheck2,
  ScanText,
  Boxes,
  Scale,
  Globe2,
  Calculator,
  ShieldAlert,
  CheckCircle2,
  Send,
  Receipt,
  Search,
  ArrowRight,
  Sparkles,
  Bot,
  Layers,
  ChevronRight,
  X,
  Code2,
  Check,
  ShieldCheck,
  Brain,
  SlidersHorizontal,
  ExternalLink,
  Cpu,
  Lock,
  Workflow
} from "lucide-react";
import { LandingPageHeader } from "@/components/LandingPageHeader";

// Definition of Qubere's 10 AI Agents
interface AgentSpec {
  id: string;
  stepNumber: number;
  name: string;
  category: "Intake & Intelligence" | "Classification & Tariff" | "Risk & Compliance Audit" | "ACE Filing & Response";
  iconName: string;
  tagline: string;
  description: string;
  latency: string;
  accuracy: string;
  regulation: string;
  capabilities: string[];
  inputPayload: string;
  outputPayload: string;
  reasoningChain: string;
  humanInTheLoopRule: string;
}

const AGENTS: AgentSpec[] = [
  {
    id: "document-intake",
    stepNumber: 1,
    name: "Document Intake Agent",
    category: "Intake & Intelligence",
    iconName: "FileCheck2",
    tagline: "Automated document ingestion, packet stitching, and format normalization",
    description:
      "Ingests unstructured commercial invoices, bills of lading, packing lists, and certificates of origin in any format (PDF, PNG, TIFF, Email). Stitches multi-page files into unified digital filing packets.",
    latency: "< 120ms",
    accuracy: "99.8%",
    regulation: "19 CFR § 141.86 (Invoice Requirements)",
    capabilities: [
      "Multi-file packet stitching & classification",
      "Automated document orientation & de-skewing",
      "Illegible stamp & handwriting detection",
      "Instant indexing into Qubere Document Store"
    ],
    inputPayload: `{
  "file_name": "Commercial_Invoice_INV-88421.pdf",
  "source": "email_attachment",
  "mime_type": "application/pdf",
  "page_count": 4
}`,
    outputPayload: `{
  "packet_id": "pkt_992148102",
  "documents": [
    { "type": "COMMERCIAL_INVOICE", "pages": [1, 2], "confidence": 0.99 },
    { "type": "BILL_OF_LADING", "pages": [3], "confidence": 0.98 },
    { "type": "PACKING_LIST", "pages": [4], "confidence": 0.99 }
  ],
  "status": "PACKET_STITCHED"
}`,
    reasoningChain:
      "Packet ingested -> Identified 3 distinct trade documents. Stitched Pages 1-2 as Commercial Invoice #INV-88421. Stitched Page 3 as Master Bill of Lading. Verified zero missing document pages.",
    humanInTheLoopRule: "Triggers human review if document blurriness or OCR confidence falls below 90%."
  },
  {
    id: "document-intelligence",
    stepNumber: 2,
    name: "Document Intelligence Agent",
    category: "Intake & Intelligence",
    iconName: "ScanText",
    tagline: "Deep multi-modal extraction of trade attributes and line item hierarchies",
    description:
      "Uses vision-language models to extract line-item product descriptions, unit quantities, currencies, Incoterms, line net weights, manufacturer IDs (MID), and invoice totals with sub-pixel field boundary mapping.",
    latency: "< 280ms",
    accuracy: "99.6%",
    regulation: "19 CFR § 141.89 (Additional Information Requirements)",
    capabilities: [
      "Complex tabular multi-page line item extraction",
      "Currency auto-conversion via CBP daily FX rates",
      "Algorithmic Manufacturer Identification (MID) builder",
      "Incoterm & Freight/Insurance split extraction"
    ],
    inputPayload: `{
  "packet_id": "pkt_992148102",
  "extract_fields": ["line_items", "incoterms", "mid", "values"]
}`,
    outputPayload: `{
  "header": {
    "exporter": "Shenzhen Precision Hardware Corp",
    "mid": "CNSHEPRE123SHE",
    "incoterm": "FOB SHENZHEN",
    "currency": "USD",
    "total_amount": 48500.00
  },
  "line_items": [
    { "line": 1, "description": "Stainless Steel Fasteners 1/4-20", "qty": 10000, "unit_price": 4.85 }
  ]
}`,
    reasoningChain:
      "Extracted Header: Exporter 'Shenzhen Precision Hardware Corp'. Generated MID 'CNSHEPRE123SHE' according to 19 CFR § 102 MID rules. Parsed 1 line item with 100% field alignment.",
    humanInTheLoopRule: "Flags for broker verification if invoice total deviates from line-item sum math by > $0.05."
  },
  {
    id: "product-intelligence",
    stepNumber: 3,
    name: "Product Intelligence Agent",
    category: "Intake & Intelligence",
    iconName: "Boxes",
    tagline: "SKU catalog enrichment & material composition breakdown for tariff logic",
    description:
      "Enriches raw commercial descriptions with technical specifications, material composition ratios (e.g., 70% steel / 30% rubber), end-use application, CAS registry numbers, and historical SKU classification memory.",
    latency: "< 190ms",
    accuracy: "99.2%",
    regulation: "General Rules of Interpretation (GRI 1 & GRI 3)",
    capabilities: [
      "Material composition breakdown & CAS lookup",
      "Technical specification & datasheet parsing",
      "Historical classification memory graph lookup",
      "Ambiguity flagger for incomplete material descriptions"
    ],
    inputPayload: `{
  "sku": "SKU-992-FAST",
  "raw_description": "Stainless Steel Fasteners 1/4-20"
}`,
    outputPayload: `{
  "enriched_profile": {
    "material": "Cold-Forged Austenitic Stainless Steel (Grade 304)",
    "essential_character": "Threaded steel fastener for structural assembly",
    "finish": "Passivated",
    "carbon_content": "< 0.08%",
    "end_use": "Industrial machinery component"
  }
}`,
    reasoningChain:
      "Queried Product Knowledge Graph -> Matched SKU-992-FAST. Identified material composition: 18% Cr, 8% Ni Grade 304 Stainless Steel. Established essential character under GRI 3(b) as threaded steel fastener.",
    humanInTheLoopRule: "Prompts user for spec sheet upload if material composition percentage is absent for multi-material goods."
  },
  {
    id: "hts-classification",
    stepNumber: 4,
    name: "HTS Classification Agent",
    category: "Classification & Tariff",
    iconName: "Scale",
    tagline: "Automated 10-digit HTS code resolution with legal GRI citations & rulings",
    description:
      "Classifies products into precise 10-digit Harmonized Tariff Schedule (HTS) codes. Provides full legal rationale backed by General Rules of Interpretation (GRI 1-6), Section/Chapter notes, and CBP CROSS Customs Rulings.",
    latency: "< 350ms",
    accuracy: "99.4%",
    regulation: "19 U.S.C. § 1202 & CBP CROSS Rulings",
    capabilities: [
      "10-Digit HTS Code resolution with GRI 1-6 legal reasoning",
      "CBP CROSS Customs Rulings vector search & precedent matching",
      "Chapter/Section note legal boundary validation",
      "Alternative candidate scoring & confidence ranking"
    ],
    inputPayload: `{
  "product_profile": {
    "essential_character": "Threaded steel fastener",
    "material": "Stainless Steel Grade 304"
  }
}`,
    outputPayload: `{
  "hts_code": "7318.15.2065",
  "description": "Screws and bolts of stainless steel, having shanks or threads with diameter of 6 mm or more",
  "duty_rate": "6.2%",
  "gri_cited": ["GRI 1", "GRI 6"],
  "cross_rulings": ["HQ H293841", "NY N304912"],
  "confidence": 0.987
}`,
    reasoningChain:
      "Applied GRI 1 to Chapter 73 (Articles of iron or steel). Heading 7318 (Screws, bolts, nuts). Subheading 7318.15 (Other screws and bolts). GRI 6 applied for 10-digit resolution 7318.15.2065. Cross-referenced CROSS Ruling HQ H293841.",
    humanInTheLoopRule: "Requires licensed Customs Broker sign-off if HTS confidence is < 85% or if item falls under anti-dumping scope."
  },
  {
    id: "origin-rules",
    stepNumber: 5,
    name: "Origin & Trade Agreement Agent",
    category: "Classification & Tariff",
    iconName: "Globe2",
    tagline: "Country of origin rules engine & FTA / USMCA preference qualification",
    description:
      "Evaluates substantial transformation rules, tariff shift requirements (CC, CTH, CTSH), and Regional Value Content (RVC) calculations to qualify shipments for USMCA, CAFTA-DR, GSP, or other Free Trade Agreements.",
    latency: "< 210ms",
    accuracy: "99.5%",
    regulation: "19 CFR Part 102 & 19 CFR Part 181 (USMCA)",
    capabilities: [
      "Tariff Shift Rules Engine (CC, CTH, CTSH qualification)",
      "USMCA Regional Value Content (RVC) net cost calculation",
      "Country of Origin marking & 19 CFR § 134 compliance",
      "Section 301 / 232 tariff exception & exclusion analysis"
    ],
    inputPayload: `{
  "hts_code": "7318.15.2065",
  "manufacturing_country": "MX",
  "raw_material_origin": "JP",
  "requested_program": "USMCA"
}`,
    outputPayload: `{
  "country_of_origin": "MX",
  "fta_program": "USMCA",
  "spi_code": "S",
  "preference_criterion": "B",
  "tariff_shift_met": true,
  "duty_rate_with_fta": "0.0%",
  "duty_savings": "$3,007.00 USD"
}`,
    reasoningChain:
      "Evaluated USMCA Annex 4-B rule for Chapter 73. Requirement: Change from Subheading 7213 to 7318 (CTH met). Manufacturing process in Mexico constituted substantial transformation. SPI 'S' granted.",
    humanInTheLoopRule: "Prompts for Certificate of Origin document upload prior to applying 0% preferential duty."
  },
  {
    id: "valuation-assists",
    stepNumber: 6,
    name: "Valuation & Assists Agent",
    category: "Classification & Tariff",
    iconName: "Calculator",
    tagline: "CBP transaction valuation, assists, tooling, and freight adjustment engine",
    description:
      "Calculates appraised customs value in accordance with CBP Transaction Value principles. Audits tooling assists, buyer-furnished materials, royalties, international freight/insurance deductions, and related-party pricing.",
    latency: "< 180ms",
    accuracy: "99.9%",
    regulation: "19 U.S.C. § 1401a & 19 CFR § 152.103",
    capabilities: [
      "Transaction Value calculation (19 U.S.C. 1401a)",
      "Tooling assist allocation & buyer rebate adjustment",
      "Nondutiable international freight & insurance deductions",
      "Related-party transfer pricing audit (19 CFR 152.103)"
    ],
    inputPayload: `{
  "invoice_subtotal": 48500.00,
  "ocean_freight_included": 3200.00,
  "buyer_assists": 1500.00
}`,
    outputPayload: `{
  "entered_customs_value": 46800.00,
  "deductions": [{ "type": "OCEAN_FREIGHT", "amount": 3200.00 }],
  "additions": [{ "type": "TOOLING_ASSIST", "amount": 1500.00 }],
  "valuation_method": "1 - TRANSACTION VALUE"
}`,
    reasoningChain:
      "Invoice Subtotal $48,500. Deducted $3,200 non-dutiable ocean freight per 19 CFR 152.103. Added $1,500 tooling assist furnished by buyer. Appraised Entered Value: $46,800.00 USD.",
    humanInTheLoopRule: "Triggers audit alert if transaction involves related-party pricing without pre-approved transfer pricing study."
  },
  {
    id: "compliance-audit",
    stepNumber: 7,
    name: "Compliance & Audit Risk Agent",
    category: "Risk & Compliance Audit",
    iconName: "ShieldAlert",
    tagline: "Automated 50+ pre-filing compliance audits & partner agency screening",
    description:
      "Runs automated pre-filing compliance checks across 50+ CBP audit parameters. Screens against FDA, EPA, CITES, FCC Partner Government Agencies (PGAs), Anti-Dumping/Countervailing Duty (ADD/CVD) scopes, and UFLPA forced labor risk lists.",
    latency: "< 230ms",
    accuracy: "99.7%",
    regulation: "19 U.S.C. § 1592 (Penalties) & UFLPA Guidelines",
    capabilities: [
      "50+ CBP Pre-Filing Audit Rules execution",
      "PGA Flagging (FDA, EPA, FCC, USDA, TSCA)",
      "ADD/CVD Case Number matching & deposit rate verification",
      "UFLPA & Entity List forced labor supply chain screening"
    ],
    inputPayload: `{
  "hts_code": "7318.15.2065",
  "origin_country": "MX",
  "manufacturer": "Shenzhen Precision Hardware Corp"
}`,
    outputPayload: `{
  "risk_score": 0,
  "status": "PASSED_ALL_AUDITS",
  "pga_requirements": [],
  "add_cvd_applicable": false,
  "uflpa_status": "CLEARED_NO_MATCH",
  "audit_trail_id": "aud_88301924"
}`,
    reasoningChain:
      "Executed 52 pre-filing audit rules. Verified HTS 7318.15.2065 does not require FDA/EPA clearance. Checked CBP ADD/CVD order database (no active cases for Mexico origin). Screened supplier against UFLPA entity list (0 matches).",
    humanInTheLoopRule: "Hard-blocks automated transmission if an ADD/CVD order or UFLPA entity match is flagged."
  },
  {
    id: "filing-readiness",
    stepNumber: 8,
    name: "Filing Readiness & Verification Agent",
    category: "Risk & Compliance Audit",
    iconName: "CheckCircle2",
    tagline: "CBP Form 7501 field-level verification and broker sign-off engine",
    description:
      "Performs end-to-end data integrity validation on draft CBP Form 7501 entry summaries. Evaluates confidence scores across all lines; automatically routes low-confidence fields to licensed customs brokers before transmission.",
    latency: "< 150ms",
    accuracy: "100%",
    regulation: "19 CFR § 141.61 (Form 7501 Completion)",
    capabilities: [
      "CBP Form 7501 entry summary schema validation",
      "Automated confidence scoring & broker queue routing",
      "Header-to-line mathematical validation (Entered Value, Duty, HTS)",
      "Missing document indicator & Importer of Record bond validation"
    ],
    inputPayload: `{
  "filing_packet_id": "pkt_992148102",
  "entry_type": "01",
  "importer_number": "12-3456789"
}`,
    outputPayload: `{
  "readiness_score": 98.8,
  "ready_for_transmission": true,
  "broker_signoff_required": false,
  "form_7501_preview": {
    "total_entered_value": 46800.00,
    "total_duty_due": 0.00,
    "line_items_count": 1
  }
}`,
    reasoningChain:
      "Readiness score calculated: 98.8/100. Verified active CBP Continuous Bond for Importer #12-3456789. All 1 line item values, HTS codes, and origin codes mathematically reconciled. Approved for transmission.",
    humanInTheLoopRule: "Routes filing packet to Licensed Customs Broker queue if overall filing readiness score is below 90%."
  },
  {
    id: "customs-filing",
    stepNumber: 9,
    name: "Customs Filing Agent",
    category: "ACE Filing & Response",
    iconName: "Send",
    tagline: "Direct electronic ABI/ACE CBP entry transmission & status listener",
    description:
      "Communicates directly with U.S. Customs and Border Protection Automated Commercial Environment (ACE) via Automated Broker Interface (ABI). Transmits Entry Type 01, 11, 86, and 06 filings and processes instant CBP response messages.",
    latency: "< 450ms",
    accuracy: "99.9%",
    regulation: "19 CFR Part 143 (Electronic Entry Processing)",
    capabilities: [
      "Direct CBP ACE / ABI EDI transmission",
      "Real-time CBP Status Listener (1C Released, 1A Doc Required, Holds)",
      "Multi-line PGA message set transmission (FDA, EPA)",
      "Electronic In-Bond & ISF (Importer Security Filing) integration"
    ],
    inputPayload: `{
  "abi_header": { "filer_code": "QBR", "port": "3501" },
  "entry_summary": { "type": "01", "value": 46800.00, "duty": 0.00 }
}`,
    outputPayload: `{
  "ace_acknowledgment": {
    "status": "ACCEPTED",
    "cbp_entry_number": "QBR-2026-8849102",
    "cbp_action": "1C - CARGO RELEASED",
    "timestamp": "2026-08-06T15:47:00Z"
  }
}`,
    reasoningChain:
      "Transmitted ABI EDIFACT packet to CBP ACE Gateway. Received immediate ACK response. Message 1C (Cargo Released) received without holds or intensive examination requests.",
    humanInTheLoopRule: "Alerts compliance team instantly if CBP returns a 1A (Documents Required) or 1H (Customs Hold) notice."
  },
  {
    id: "response-management",
    stepNumber: 10,
    name: "Response & Post-Summary Agent",
    category: "ACE Filing & Response",
    iconName: "ReceiptCheck",
    tagline: "Automated CBP Form 28/29 response, PSC filing, and Duty Drawback refunds",
    description:
      "Continuously monitors post-entry events. Automatically drafts evidence-backed responses to CBP Form 28 (Request for Information) & Form 29 (Notice of Action), prepares Post-Summary Corrections (PSC), and claims duty drawback refunds.",
    latency: "< 310ms",
    accuracy: "99.3%",
    regulation: "19 CFR § 173 (PSC) & 19 CFR Part 190 (Drawback)",
    capabilities: [
      "CBP Form 28 / 29 automated legal response drafting",
      "Post-Summary Correction (PSC) delta engine",
      "Duty Drawback matching & refund opportunity identification",
      "5-year CBP liquidation tracking & protest filing assistant"
    ],
    inputPayload: `{
  "cbp_entry_number": "QBR-2026-8849102",
  "event_type": "POST_ENTRY_AUDIT"
}`,
    outputPayload: `{
  "refund_opportunities_found": [
    { "type": "SECTION_301_EXCLUSION_PSC", "potential_refund": 2902.40 }
  ],
  "psc_draft_status": "READY_FOR_SUBMISSION"
}`,
    reasoningChain:
      "Scanned entry history against newly published USTR Section 301 exclusions. Identified retroactive exclusion for line #1. Drafted PSC payload claiming $2,902.40 refund.",
    humanInTheLoopRule: "Requires human review before filing any Post-Summary Correction or Protest with CBP."
  }
];

const CATEGORIES = [
  "All Agents",
  "Intake & Intelligence",
  "Classification & Tariff",
  "Risk & Compliance Audit",
  "ACE Filing & Response"
] as const;

export default function AgentsPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>("All Agents");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeModalAgent, setActiveModalAgent] = useState<AgentSpec | null>(null);
  const [modalTab, setModalTab] = useState<"overview" | "reasoning" | "payloads" | "action">("overview");

  const [testInputJson, setTestInputJson] = useState<string>("");
  const [dropFile, setDropFile] = useState<File | null>(null);
  const [inputMode, setInputMode] = useState<"file" | "json">("file");
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  const handleOpenAgentModal = (agent: AgentSpec) => {
    setActiveModalAgent(agent);
    setModalTab("overview");
    setTestInputJson(agent.inputPayload);
    setDropFile(null);
    setInputMode(agent.id === "document-intake" ? "file" : "json");
    setTestResult(null);
    setExecutionTime(null);
  };

  const handleRunAgentTest = async () => {
    if (!activeModalAgent) return;
    setIsExecuting(true);
    setTestResult(null);
    setExecutionTime(null);
    const startTime = Date.now();

    try {
      if (inputMode === "file" && dropFile) {
        const formData = new FormData();
        formData.append("file", dropFile);
        formData.append("shipmentId", "shp_demo_default");
        formData.append("docType", "AUTO_DETECT");

        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        const elapsed = Date.now() - startTime;
        setExecutionTime(elapsed);
        setTestResult(data);
        return;
      }

      let parsedInput: any = {};
      try {
        parsedInput = JSON.parse(testInputJson);
      } catch (err) {
        parsedInput = { rawInput: testInputJson };
      }

      const endpoint = activeModalAgent.id === "document-intake" ? "/api/intake/agent" : `/api/agents/${activeModalAgent.id}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: "acc_demo_default",
          userId: "user_demo_default",
          shipmentId: "shp_demo_default",
          ...parsedInput,
        }),
      });

      const data = await res.json();
      const elapsed = Date.now() - startTime;
      setExecutionTime(elapsed);
      setTestResult(data);
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      setExecutionTime(elapsed);
      setTestResult({ error: err?.message || "Execution failed" });
    } finally {
      setIsExecuting(false);
    }
  };

  // Helper to map icon name string to Lucide component
  const renderAgentIcon = (iconName: string, className = "w-5 h-5") => {
    switch (iconName) {
      case "FileCheck2": return <FileCheck2 className={className} />;
      case "ScanText": return <ScanText className={className} />;
      case "Boxes": return <Boxes className={className} />;
      case "Scale": return <Scale className={className} />;
      case "Globe2": return <Globe2 className={className} />;
      case "Calculator": return <Calculator className={className} />;
      case "ShieldAlert": return <ShieldAlert className={className} />;
      case "CheckCircle2": return <CheckCircle2 className={className} />;
      case "Send": return <Send className={className} />;
      case "ReceiptCheck": return <Receipt className={className} />;
      default: return <Bot className={className} />;
    }
  };

  // Filtered agents list based on tab & search input
  const filteredAgents = useMemo(() => {
    return AGENTS.filter((agent) => {
      const matchesCategory =
        selectedCategory === "All Agents" || agent.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        agent.name.toLowerCase().includes(q) ||
        agent.tagline.toLowerCase().includes(q) ||
        agent.description.toLowerCase().includes(q) ||
        agent.regulation.toLowerCase().includes(q) ||
        agent.capabilities.some((c) => c.toLowerCase().includes(q));

      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] selection:bg-[#0071E3]/20 selection:text-[#0071E3] flex flex-col justify-between">
      {/* Header */}
      <LandingPageHeader />

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 pt-6 pb-12 space-y-10">

        {/* PIPELINE WORKFLOW VISUALIZER */}
        <section className="bg-white rounded-3xl p-6 sm:p-8 border border-[#E5E5EA] shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E5E5EA] pb-5">
            <div>
              <h2 className="text-xl font-bold text-[#1D1D1F] flex items-center space-x-2">
                <Workflow className="w-5 h-5 text-[#0071E3]" />
                <span>Autonomous Multi-Agent Orchestration Pipeline</span>
              </h2>
              <p className="text-xs text-[#86868B] mt-0.5">
                Click any agent in the pipeline below to inspect its operational spec and legal rationale.
              </p>
            </div>
            <span className="text-xs font-semibold px-3 py-1 bg-blue-50 text-[#0071E3] rounded-full border border-blue-200 self-start sm:self-auto">
              Sequential &amp; Parallel Orchestration
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-2">
            {AGENTS.map((agent) => (
              <button
                key={agent.id}
                onClick={() => handleOpenAgentModal(agent)}
                className="group flex flex-col items-center justify-between p-3 rounded-2xl bg-[#F5F5F7] hover:bg-[#0071E3]/10 border border-[#E5E5EA] hover:border-[#0071E3] transition-all cursor-pointer text-center relative"
              >
                <span className="text-[10px] font-bold text-[#86868B] group-hover:text-[#0071E3] mb-1">
                  Step {agent.stepNumber}
                </span>
                <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-[#0071E3] shadow-2xs group-hover:scale-110 transition-transform mb-2">
                  {renderAgentIcon(agent.iconName, "w-4 h-4")}
                </div>
                <p className="text-[11px] font-bold text-[#1D1D1F] leading-tight line-clamp-2">
                  {agent.name.replace(" Agent", "")}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* AGENTS ROSTER SECTION */}
        <section className="space-y-8">
          {/* Controls: Search & Category Filters */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            {/* Search Bar */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#86868B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents by capability, CFR rule, or keyword..."
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E5E5EA] rounded-full text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0071E3] focus:border-transparent transition-all shadow-2xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868B] hover:text-[#1D1D1F]"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-4 py-2 text-xs font-semibold rounded-full border transition-all whitespace-nowrap cursor-pointer ${
                    selectedCategory === cat
                      ? "bg-[#0071E3] text-white border-[#0071E3] shadow-2xs"
                      : "bg-white text-[#1D1D1F] border-[#E5E5EA] hover:bg-slate-50"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Agents Grid */}
          {filteredAgents.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-3xl border border-[#E5E5EA] space-y-3">
              <Bot className="w-10 h-10 text-[#86868B] mx-auto opacity-50" />
              <p className="text-base font-semibold text-[#1D1D1F]">No agents matched your search</p>
              <p className="text-xs text-[#86868B]">Try clearing your search query or switching categories.</p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("All Agents");
                }}
                className="px-4 py-2 text-xs font-semibold text-[#0071E3] bg-blue-50 rounded-full hover:bg-blue-100 transition-colors"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="group bg-white rounded-3xl border border-[#E5E5EA] hover:border-[#0071E3]/50 p-6 flex flex-col justify-between shadow-2xs hover:shadow-md transition-all space-y-5"
                >
                  <div className="space-y-4">
                    {/* Header Badge & Icon */}
                    <div className="flex items-start justify-between">
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center text-[#0071E3] group-hover:scale-105 transition-transform">
                        {renderAgentIcon(agent.iconName, "w-6 h-6")}
                      </div>
                      <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#F5F5F7] text-[#86868B] border border-[#E5E5EA]">
                        Step {agent.stepNumber} of 10
                      </span>
                    </div>

                    {/* Title & Tagline */}
                    <div>
                      <h3 className="text-lg font-bold text-[#1D1D1F] group-hover:text-[#0071E3] transition-colors">
                        {agent.name}
                      </h3>
                      <p className="text-xs font-medium text-[#86868B] mt-1 leading-snug">
                        {agent.tagline}
                      </p>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-[#1D1D1F]/80 leading-relaxed">
                      {agent.description}
                    </p>

                    {/* Capabilities bullets */}
                    <div className="space-y-1.5 pt-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-[#86868B]">
                        Key Capabilities
                      </p>
                      <ul className="space-y-1">
                        {agent.capabilities.map((cap, idx) => (
                          <li key={idx} className="flex items-center space-x-2 text-xs text-[#1D1D1F]">
                            <Check className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />
                            <span className="line-clamp-1">{cap}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Footer & Action */}
                  <div className="pt-4 border-t border-[#E5E5EA] space-y-3">
                    <div className="flex items-center justify-between text-[11px] font-medium text-[#86868B]">
                      <span>Latency: <strong className="text-[#1D1D1F]">{agent.latency}</strong></span>
                      <span>Accuracy: <strong className="text-emerald-700">{agent.accuracy}</strong></span>
                    </div>

                    <button
                      onClick={() => handleOpenAgentModal(agent)}
                      className="w-full py-2.5 px-4 bg-[#F5F5F7] hover:bg-[#0071E3] text-[#0071E3] hover:text-white font-semibold text-xs rounded-xl transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                    >
                      <span>Inspect Agent Spec</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* COMPARISON MATRIX SECTION */}
        <section className="bg-white rounded-3xl p-8 border border-[#E5E5EA] shadow-sm space-y-6">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-2xl font-bold text-[#1D1D1F]">
              Traditional Freight Brokerage vs. Qubere Autonomous Agents
            </h2>
            <p className="text-xs sm:text-sm text-[#86868B]">
              How autonomous multi-agent orchestration eliminates human latency and regulatory fines.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E5E5EA] bg-[#F5F5F7]">
                  <th className="py-3 px-4 font-bold text-[#1D1D1F]">Dimension</th>
                  <th className="py-3 px-4 font-bold text-rose-600">Traditional Manual Brokerage</th>
                  <th className="py-3 px-4 font-bold text-[#0071E3]">Qubere Multi-Agent System</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5EA]">
                <tr>
                  <td className="py-3.5 px-4 font-semibold text-[#1D1D1F]">Document Intake &amp; OCR</td>
                  <td className="py-3.5 px-4 text-[#86868B]">Manual PDF re-keying (48-72 hrs delay)</td>
                  <td className="py-3.5 px-4 text-[#1D1D1F] font-medium">Sub-second multi-page vision extraction (&lt; 300ms)</td>
                </tr>
                <tr>
                  <td className="py-3.5 px-4 font-semibold text-[#1D1D1F]">HTS Tariff Code Lookup</td>
                  <td className="py-3.5 px-4 text-[#86868B]">Rule-of-thumb guesswork; high audit penalty risk</td>
                  <td className="py-3.5 px-4 text-[#1D1D1F] font-medium">10-digit resolution with GRI 1-6 &amp; CROSS legal citations</td>
                </tr>
                <tr>
                  <td className="py-3.5 px-4 font-semibold text-[#1D1D1F]">USMCA &amp; FTA Qualification</td>
                  <td className="py-3.5 px-4 text-[#86868B]">Often ignored due to complex manual tariff shift math</td>
                  <td className="py-3.5 px-4 text-[#1D1D1F] font-medium">Automated Regional Value Content (RVC) &amp; CTH shift audit</td>
                </tr>
                <tr>
                  <td className="py-3.5 px-4 font-semibold text-[#1D1D1F]">Pre-Filing Compliance Audit</td>
                  <td className="py-3.5 px-4 text-[#86868B]">Sample checks (only ~5% of shipments audited)</td>
                  <td className="py-3.5 px-4 text-[#1D1D1F] font-medium">100% of entries audited against 50+ CBP rules prior to filing</td>
                </tr>
                <tr>
                  <td className="py-3.5 px-4 font-semibold text-[#1D1D1F]">ACE CBP Transmission</td>
                  <td className="py-3.5 px-4 text-[#86868B]">Batch uploads at end of business day</td>
                  <td className="py-3.5 px-4 text-[#1D1D1F] font-medium">Instant real-time ABI transmission with immediate release status</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* CALL TO ACTION */}
        <section className="bg-gradient-to-b from-[#0071E3] to-[#005bb5] rounded-3xl p-8 sm:p-12 text-center text-white space-y-6 shadow-xl">
          <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center mx-auto text-white">
            <Cpu className="w-6 h-6" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Ready to Deploy Autonomous Agents for Your Customs Pipeline?
          </h2>
          <p className="text-white/80 max-w-xl mx-auto text-sm sm:text-base leading-relaxed">
            Experience complete document-to-filing automation with 100% auditability and built-in licensed broker oversight.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Link
              href="/app/dashboard"
              className="w-full sm:w-auto px-8 py-3.5 bg-white text-[#0071E3] font-bold rounded-full shadow-lg hover:bg-slate-100 transition-all hover:scale-105"
            >
              Go to App Console
            </Link>
            <Link
              href="/sign-in"
              className="w-full sm:w-auto px-8 py-3.5 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-full border border-white/20 transition-all"
            >
              Sign In to Qubere
            </Link>
          </div>
        </section>
      </main>

      {/* AGENT SPEC MODAL */}
      {activeModalAgent && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-[#E5E5EA] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-[#E5E5EA] flex items-start justify-between bg-[#F5F5F7]">
              <div className="flex items-center space-x-3.5">
                <div className="w-12 h-12 rounded-2xl bg-[#0071E3] flex items-center justify-center text-white shadow-md">
                  {renderAgentIcon(activeModalAgent.iconName, "w-6 h-6")}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-100 text-[#0071E3]">
                      Step {activeModalAgent.stepNumber} of 10
                    </span>
                    <span className="text-xs font-semibold text-[#86868B]">
                      {activeModalAgent.category}
                    </span>
                  </div>
                  <h2 className="text-xl font-extrabold text-[#1D1D1F] mt-0.5">
                    {activeModalAgent.name}
                  </h2>
                </div>
              </div>

              <button
                onClick={() => setActiveModalAgent(null)}
                className="w-8 h-8 rounded-full bg-white hover:bg-slate-200 flex items-center justify-center text-[#86868B] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex border-b border-[#E5E5EA] px-6 bg-white">
              <button
                onClick={() => setModalTab("overview")}
                className={`py-3 px-4 text-xs font-bold border-b-2 cursor-pointer transition-colors ${
                  modalTab === "overview"
                    ? "border-[#0071E3] text-[#0071E3]"
                    : "border-transparent text-[#86868B] hover:text-[#1D1D1F]"
                }`}
              >
                Overview &amp; Capabilities
              </button>
              <button
                onClick={() => setModalTab("reasoning")}
                className={`py-3 px-4 text-xs font-bold border-b-2 cursor-pointer transition-colors ${
                  modalTab === "reasoning"
                    ? "border-[#0071E3] text-[#0071E3]"
                    : "border-transparent text-[#86868B] hover:text-[#1D1D1F]"
                }`}
              >
                Reasoning Engine &amp; Legal Framework
              </button>
              <button
                onClick={() => setModalTab("payloads")}
                className={`py-3 px-4 text-xs font-bold border-b-2 cursor-pointer transition-colors ${
                  modalTab === "payloads"
                    ? "border-[#0071E3] text-[#0071E3]"
                    : "border-transparent text-[#86868B] hover:text-[#1D1D1F]"
                }`}
              >
                Input / Output Schemas (JSON)
              </button>
              <button
                onClick={() => setModalTab("action")}
                className={`py-3 px-4 text-xs font-bold border-b-2 cursor-pointer transition-all flex items-center space-x-1.5 ${
                  modalTab === "action"
                    ? "border-[#0071E3] text-[#0071E3] bg-blue-50/50"
                    : "border-transparent text-[#0071E3] hover:bg-blue-50/30"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-[#0071E3]" />
                <span>✨ Agent in Action (Live Test)</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {modalTab === "overview" && (
                <div className="space-y-6">
                  <div>
                    <h4 className="font-bold text-[#1D1D1F] text-sm mb-1">Agent Description</h4>
                    <p className="text-[#86868B] leading-relaxed text-xs">
                      {activeModalAgent.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA]">
                      <span className="text-[10px] font-bold uppercase text-[#86868B]">Target Latency</span>
                      <p className="text-sm font-bold text-[#1D1D1F] mt-0.5">{activeModalAgent.latency}</p>
                    </div>
                    <div className="p-3 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA]">
                      <span className="text-[10px] font-bold uppercase text-[#86868B]">Accuracy Rating</span>
                      <p className="text-sm font-bold text-emerald-600 mt-0.5">{activeModalAgent.accuracy}</p>
                    </div>
                    <div className="p-3 rounded-2xl bg-[#F5F5F7] border border-[#E5E5EA]">
                      <span className="text-[10px] font-bold uppercase text-[#86868B]">Primary Regulation</span>
                      <p className="text-xs font-semibold text-[#0071E3] truncate mt-0.5">{activeModalAgent.regulation}</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-bold text-[#1D1D1F] text-sm mb-2">Core Technical Capabilities</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {activeModalAgent.capabilities.map((cap, idx) => (
                        <div key={idx} className="flex items-center space-x-2 p-2.5 rounded-xl bg-[#F5F5F7] border border-[#E5E5EA]">
                          <Check className="w-4 h-4 text-[#0071E3] shrink-0" />
                          <span className="font-semibold text-[#1D1D1F]">{cap}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {modalTab === "reasoning" && (
                <div className="space-y-6">
                  <div className="p-4 rounded-2xl bg-slate-900 text-slate-100 font-mono text-[11px] leading-relaxed space-y-2 border border-slate-800">
                    <div className="flex items-center space-x-2 text-slate-400 border-b border-slate-800 pb-2">
                      <Brain className="w-4 h-4 text-[#0071E3]" />
                      <span className="font-bold text-xs text-white">Agent Reasoning &amp; Chain of Thought</span>
                    </div>
                    <p className="text-slate-300 pt-1">
                      {activeModalAgent.reasoningChain}
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1.5">
                    <div className="flex items-center space-x-2 text-amber-800 font-bold text-xs">
                      <Lock className="w-4 h-4 text-amber-600" />
                      <span>Human-in-the-Loop Oversight Rule</span>
                    </div>
                    <p className="text-xs text-amber-800/90 leading-normal">
                      {activeModalAgent.humanInTheLoopRule}
                    </p>
                  </div>
                </div>
              )}

              {modalTab === "payloads" && (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-[#1D1D1F]">Input Contract Payload</span>
                      <span className="text-[10px] font-mono text-[#86868B]">JSON</span>
                    </div>
                    <pre className="p-4 rounded-2xl bg-slate-900 text-emerald-400 font-mono text-[11px] overflow-x-auto border border-slate-800">
                      {activeModalAgent.inputPayload}
                    </pre>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-[#1D1D1F]">Output Contract Payload</span>
                      <span className="text-[10px] font-mono text-[#86868B]">JSON</span>
                    </div>
                    <pre className="p-4 rounded-2xl bg-slate-900 text-blue-400 font-mono text-[11px] overflow-x-auto border border-slate-800">
                      {activeModalAgent.outputPayload}
                    </pre>
                  </div>
                </div>
              )}

              {modalTab === "action" && (
                <div className="space-y-4">
                  <div className="p-3 bg-blue-50/80 border border-blue-100 rounded-2xl text-xs text-[#0071E3] flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 shrink-0 text-[#0071E3]" />
                      <span>
                        <strong className="text-[#1D1D1F]">Interactive Agent Playground:</strong> Test {activeModalAgent.name} live with real inputs.
                      </span>
                    </div>
                    <span className="text-[10px] font-mono font-bold bg-white px-2 py-0.5 rounded-full border border-blue-200 text-[#0071E3]">
                      API: POST /api/agents/{activeModalAgent.id}
                    </span>
                  </div>

                  {/* Split Screen Playground */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-[420px]">
                    {/* Left Column: Input Data Panel */}
                    <div className="flex flex-col border border-[#E5E5EA] rounded-2xl overflow-hidden bg-white shadow-2xs">
                      <div className="px-4 py-2 bg-[#F5F5F7] border-b border-[#E5E5EA] flex items-center justify-between">
                        <span className="font-bold text-xs text-[#1D1D1F]">
                          {inputMode === "file" ? "Drop Trade Document (Vision OCR)" : "Input Contract Payload"}
                        </span>
                        <div className="flex items-center space-x-1 bg-white rounded-lg p-0.5 border border-[#E5E5EA]">
                          <button
                            onClick={() => setInputMode("file")}
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                              inputMode === "file"
                                ? "bg-[#0071E3] text-white shadow-2xs"
                                : "text-[#86868B] hover:text-[#1D1D1F]"
                            }`}
                          >
                            📄 Drop File
                          </button>
                          <button
                            onClick={() => setInputMode("json")}
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                              inputMode === "json"
                                ? "bg-[#0071E3] text-white shadow-2xs"
                                : "text-[#86868B] hover:text-[#1D1D1F]"
                            }`}
                          >
                            💻 JSON
                          </button>
                        </div>
                      </div>

                      <div className="p-3 flex-1 flex flex-col space-y-2 justify-between">
                        {inputMode === "file" ? (
                          <div className="flex-1 flex flex-col justify-center">
                            <div className="relative border-2 border-dashed border-[#E5E5EA] hover:border-[#0071E3] rounded-2xl p-6 text-center bg-[#F5F5F7] transition-all cursor-pointer group flex flex-col items-center justify-center space-y-2">
                              <input
                                type="file"
                                onChange={(e) => {
                                  if (e.target.files && e.target.files[0]) {
                                    setDropFile(e.target.files[0]);
                                  }
                                }}
                                accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.csv"
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              />
                              <div className="w-12 h-12 rounded-full bg-white border border-[#E5E5EA] flex items-center justify-center text-[#0071E3] group-hover:scale-110 transition-transform">
                                <FileCheck2 className="w-6 h-6" />
                              </div>
                              <div>
                                <p className="text-xs font-bold text-[#1D1D1F]">
                                  {dropFile ? dropFile.name : "Drop trade document here or click to browse"}
                                </p>
                                <p className="text-[10px] text-[#86868B] mt-0.5">
                                  {dropFile
                                    ? `${(dropFile.size / 1024).toFixed(1)} KB (${dropFile.type || "Document"})`
                                    : "PDF, PNG, JPG, WEBP, XLSX up to 25MB (Multi-Modal Vision Engine)"}
                                </p>
                              </div>
                              {dropFile && (
                                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Ready to Process with {activeModalAgent.name}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <textarea
                            value={testInputJson}
                            onChange={(e) => setTestInputJson(e.target.value)}
                            className="w-full flex-1 p-3 bg-slate-900 text-emerald-400 font-mono text-[11px] rounded-xl border border-slate-800 focus:outline-hidden focus:border-[#0071E3] resize-none"
                            placeholder="Paste JSON input payload here..."
                          />
                        )}

                        <button
                          onClick={handleRunAgentTest}
                          disabled={isExecuting || (inputMode === "file" && !dropFile)}
                          className="w-full py-2.5 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
                        >
                          {isExecuting ? (
                            <>
                              <Cpu className="w-4 h-4 animate-spin text-white" />
                              <span>Executing {activeModalAgent.name}...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-4 h-4" />
                              <span>⚡ Run {activeModalAgent.name} in Real-Time</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Right Column: Live Output & Provenance Panel */}
                    <div className="flex flex-col border border-[#E5E5EA] rounded-2xl overflow-hidden bg-white shadow-2xs">
                      <div className="px-4 py-2.5 bg-[#F5F5F7] border-b border-[#E5E5EA] flex items-center justify-between">
                        <span className="font-bold text-xs text-[#1D1D1F]">Agent Execution Output</span>
                        {executionTime !== null && (
                          <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            Latency: {executionTime}ms
                          </span>
                        )}
                      </div>
                      <div className="p-3 flex-1 overflow-y-auto bg-slate-950 text-slate-100 font-mono text-[11px]">
                        {isExecuting ? (
                          <div className="h-full flex flex-col items-center justify-center space-y-3 text-slate-400">
                            <Cpu className="w-8 h-8 text-[#0071E3] animate-pulse" />
                            <p className="text-xs font-sans text-slate-300">Agent reasoning and executing rules...</p>
                          </div>
                        ) : testResult ? (
                          <pre className="text-blue-300 whitespace-pre-wrap">
                            {JSON.stringify(testResult, null, 2)}
                          </pre>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center space-y-2 text-slate-500">
                            <Bot className="w-8 h-8 text-slate-600" />
                            <p className="text-xs font-sans">Click 'Run Agent in Real-Time' to trigger live execution.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[#E5E5EA] bg-[#F5F5F7] flex items-center justify-between">
              <span className="text-xs text-[#86868B] font-medium">
                Qubere AI Agent Architecture v2.4
              </span>
              <button
                onClick={() => setActiveModalAgent(null)}
                className="px-5 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold rounded-full shadow-xs cursor-pointer"
              >
                Close Spec
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-[#E5E5EA] py-6 px-6 text-center text-[#86868B] text-xs">
        <p>© {new Date().getFullYear()} Qubere Inc. All rights reserved. Trade Compliance AI Platform.</p>
      </footer>
    </div>
  );
}
