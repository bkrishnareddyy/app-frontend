# F02 · Document Intelligence Pipeline
> Depends on: F01 (ExtractionField persistence requires pipeline fixes from F01)
> Branch: `feat/document-intelligence`
> Features covered: #1 Multi-channel intake, #2 Automated classification, #3 Structured data extraction, #4 Source-linked evidence viewer

---

## Capability A — Secure Multi-Channel Document Intake

### API gaps
- Upload is public storage; no MIME type restriction; no file size limit; no malware scan gate
- No API-ingest endpoint for external systems (ERP, 3PL) to push documents
- Bulk upload workflow missing (upload multiple files, attach to one shipment)

### Tasks
* **Task A-1**: Harden `POST /api/documents/upload`: validate MIME type (allow: `application/pdf`, `image/png`, `image/jpeg`, `image/tiff`); reject files > 50MB with 422; add `Content-Disposition` header to Vercel Blob URL to prevent inline execution.
* **Task A-2**: Add `POST /api/v1/intake/document` — external API-ingest endpoint. Accepts multipart or JSON with `{ url: string, documentType?: DocumentType, shipmentReference?: string }`. Authenticates via API key (stored in `Account.apiKeys` — new model). Returns `{ documentId, processingStatus: "QUEUED" }`.
* **Task A-3**: Create `Account.apiKey` model: `{ id, accountId, keyHash, label, lastUsedAt, expiresAt, permissions[] }`. Keys authenticate the external ingest endpoint. Key is shown once at creation; stored as bcrypt hash.
* **Task A-4**: Bulk upload UI in `DocumentUploadModal.tsx`: accept multiple files via drag-and-drop or file picker; show per-file upload progress; after all uploads complete, show attach-to-shipment selection. Max 20 files per bulk operation.
* **Task A-5**: Email ingest via Resend webhook (`/api/webhooks/resend/inbound`): validate signature, create `InboundEmail` + `InboundAttachment` rows, enqueue each attachment as a document upload via Inngest. Route to shipment based on `InboundSenderRoute` matching. Already partially wired — verify end-to-end and add error handling for unmatched senders.
* **Task A-6**: Vitest: upload rejects PDF > 50MB, rejects non-PDF MIME, accepts valid PDF. Integration: external API key auth works; invalid key returns 401.

## Capability B — Automated Document Classification

### API gaps
- Document type is stored as free text in `ShipmentDocument.documentType`
- AI agent guesses type from filename/content but writes unvalidated string
- No confidence threshold for routing to human review

### Tasks
* **Task B-1**: Add Prisma migration: replace `ShipmentDocument.documentType String?` with `documentType DocumentType?` where `DocumentType` is a new enum: `COMMERCIAL_INVOICE | PACKING_LIST | BILL_OF_LADING | AIR_WAYBILL | CERTIFICATE_OF_ORIGIN | PHYTOSANITARY_CERTIFICATE | FUMIGATION_CERTIFICATE | CUSTOMS_BOND | POWER_OF_ATTORNEY | ENTRY_SUMMARY | ISF | OTHER`. Add `documentTypeConfidence Float?`.
* **Task B-2**: Update `packages/ai/ocr/ocrAgent.ts` classification step: output must be a valid `DocumentType` enum value (or `OTHER` if uncertain). Confidence < 0.7 → set `status: "NEEDS_CLASSIFICATION"` on the `ShipmentDocument`, enqueue for human review.
* **Task B-3**: Add `GET /api/documents?status=NEEDS_CLASSIFICATION` filter. Add a "Unclassified Documents" count badge to the sidebar notification area.
* **Task B-4**: UI: in `DocumentsClient.tsx`, add a classification column showing document type as a badge + confidence percentage. For `NEEDS_CLASSIFICATION` docs, show a dropdown to manually select type (updates via PATCH and clears `NEEDS_CLASSIFICATION` status).
* **Task B-5**: Vitest: `DocumentType` enum covers all expected document types; confidence < 0.7 produces `NEEDS_CLASSIFICATION` status.

## Capability C — Structured Data Extraction with Field-Level Provenance

### The core gap
The AI pipeline extracts field values and writes them to `ShipmentDocument.extractedJson` (unstructured `Text` blob). It discards the `bbox` and `pageNumber` that docling produces. `ExtractionField` model has `bbox`, `pageNumber`, `confidence`, `source` — the pipeline never writes to it.

### Tasks
* **Task C-1**: Update the extraction step in the Inngest pipeline (`packages/ai/extraction/extractionAgent.ts`): after extraction, write one `ExtractionField` row per extracted value with: `fieldName`, `value`, `confidence`, `pageNumber`, `bbox` (JSON: `{x, y, w, h}` in PDF points), `source: "AI"`, `documentId`. Keep `extractedJson` as a raw cache only.
* **Task C-2**: Define extraction field schemas per document type in `src/lib/documents/extractionSchemas.ts`. Invoice fields: `seller_name`, `buyer_name`, `invoice_number`, `invoice_date`, `currency`, `total_value`, `incoterm`, `line_items[]`. Packing list fields: `carton_count`, `gross_weight`, `net_weight`, `package_marks`. Bill of lading fields: `bl_number`, `vessel_name`, `voyage`, `port_of_loading`, `port_of_discharge`, `container_numbers[]`, `on_board_date`. Each field has a required flag and a type.
* **Task C-3**: `GET /api/documents/[id]/extractions` returns `ExtractionField[]` rows (not seeded synthetic data). Include `pageNumber`, `bbox`, `confidence`, `source`, `correctedAt`, `correctedBy`.
* **Task C-4**: `PATCH /api/documents/[id]/extractions/fields/[fieldId]`: human correction endpoint. Writes `source: "HUMAN"`, `correctedFromValue`, `correctedByUserId`, `correctedAt`. Triggers re-reconciliation on the parent shipment via Inngest event.
* **Task C-5**: Extraction field validation: after extraction, validate required fields per document type. Missing required fields create `ExceptionItem` rows with `category: "MISSING_DATA"` and `fieldName`.
* **Task C-6**: Vitest: extraction schema covers all document types; missing required field creates exception; human correction updates field and emits reconciliation event.

## Capability D — Source-Linked Evidence Viewer (PDF with Highlights)

### The blocker
`DocumentReviewPanel.tsx` uses `<iframe>` — browser PDF viewer cannot host React overlays. No highlights are possible.

### Tasks
* **Task D-1**: Replace `<iframe>` with `pdfjs-dist` (add to dependencies). Create `src/components/PdfCanvas.tsx`: renders a PDF page to `<canvas>`, accepts an array of `HighlightRect[]` (`{x, y, w, h, pageNumber, color, label}`), draws highlights as semi-transparent overlays scaled from PDF-point to canvas-pixel coordinates. Supports page navigation, zoom (fit-width, fit-page, manual%).
* **Task D-2**: Update `DocumentReviewPanel.tsx`: left pane is `PdfCanvas`; right pane is the extracted field list. Each field row shows: field name, extracted value, confidence badge, page number, "view source" icon. Clicking a field scrolls the PDF to that page and flashes the bbox highlight. Clicking a bbox in the PDF selects the corresponding field row.
* **Task D-3**: Keyboard navigation: `n` / `p` move to next/previous unreviewed field (using `nextReviewIndex` from `extractionReview.ts` — already implemented, just wire it up).
* **Task D-4**: Degrade honestly: fields with no `bbox` (e.g. from before C-1 shipped) show "location not recorded" instead of an incorrect highlight.
* **Task D-5**: Evidence viewer in decision cards: when an `AgentDecision` references a `documentId` + `ExtractionField`, clicking "view evidence" in `ActionsClient.tsx` opens a slide-over with `PdfCanvas` pre-scrolled to the relevant page and field highlighted.
* **Task D-6**: Vitest: `PdfCanvas` renders without crashing; bbox scaling formula is correct for 1x, 2x DPR.

## Capability E — Shipment-Document Candidate Matching

### Tasks
* **Task E-1**: After document classification, the pipeline runs a shipment matching step: compare extracted fields (`bl_number`, `invoice_number`, `po_reference`) against open shipments in the account. Write top-3 candidates to `DocumentShipmentCandidate` with `confidenceScore`. Already has a model — wire the actual matching logic.
* **Task E-2**: UI: unattached documents (`GET /api/documents/unattached`) show a "suggested shipments" list. One-click attach. Dismiss to mark as intentionally unattached.
* **Task E-3**: Auto-attach if single candidate with confidence ≥ 0.9 and no conflicting document of the same type already attached. Write `AuditLog` row with `action: "AUTO_ATTACH"`.

## Data gaps
- No malware scanning capability (Vercel Blob is pass-through). Acceptable for v1 if documented. Add to enterprise upgrade path.
- No OCR for handwritten documents. Gemini Vision handles printed; handwritten is out of scope for v1.
