# Qubere Platform Data Refresh Policy & Dataset Master Architecture

## 1. Overview & Operational Principles

The Qubere Platform relies on authoritative trade data, tariff schedules, sanctions lists, regulatory notices, and rules of origin to power classification, landed cost calculations, trade agreement qualification, screening, and audit defense.

To guarantee maximum fidelity, transparency, and operational readiness:

- **No Synthetic Fallbacks in Production**: Operational calculations derive strictly from verified government and multilateral sources.
- **100% Authentic Ingestion Wiring**: All 18 datasets carry a `readinessStatus` of `LIVE` with dedicated cron ingestion routes (`/api/cron/...`). The Platform Admin `<Data>` tab provides manual execution ("Run Now") and real-time execution status backed by `DatasetRefreshLog`. Un-wired synthetic responses are strictly forbidden.
- **Staging & Approval Workflow**: High-impact rate modifications (HTSUS schedule, Section 301/232 annex revisions, AD/CVD company rates, Section 301 exclusions) stage as `PENDING`/`DRAFT` for platform administrator review before affecting production calculations. Same pattern applied to LLM-extracted data.
- **Point-in-Time Versioning for Screening**: `ScreeningEntity` (OFAC SDN, BIS CSL) uses `DRAFT → PUBLISHED → SUPERSEDED` versioning — enabling "what was this party's sanction status on date X?" queries for audit defensibility.
- **Zero-Downtime Delta Processing**: Differential updates compute SHA-256 node hashes and audit changes (`HtsChange`) without blocking live calculation engines.
- **Circuit Breaker Protection**: Ingestion pipelines automatically reject empty payloads (0-item yields) to prevent database truncation or corruption.
- **Single Dispatcher Cron**: Vercel Hobby plan supports 2 cron entries. One entry (`/api/cron/data-dispatcher` at `0 2 * * *`) fans out to all `LIVE` datasets based on `scheduledFrequencyHours` vs `lastSuccessAt` from the `DatasetRefreshLog` table.
- **Staleness Alerting**: The dispatcher checks `staleThresholdHours` for every dataset on each run. Any dataset exceeding its threshold triggers a `Notification` (`dataset_staleness_alert`) and an `AuditLog` event.
- **Heavy Parses via Inngest**: XML streaming (OFAC), PDF/OCR extraction (Section 301), and LLM batch extraction (AD/CVD company rates) run as durable Inngest background functions with retry semantics — not synchronously in POST handlers at risk of Vercel timeout.
- **Persistent Run Log**: `DatasetRefreshLog` DB table is the source of truth for last-run timestamps and status displayed in the `<Data>` tab. There is no in-memory state.

---

## 2. Dataset Master Registry (18 Datasets)

Below is the comprehensive operational policy for all 18 datasets required across the platform.

### Group A: Free — Public Government Sources (Machine-Readable APIs)

| Dataset | Powers / Purpose | Source & Provider | Cost | How Refreshed | Frequency | SLA & Failure Policy |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **HTSUS Schedule** | HTS classification, duty rates, tariff scenarios, landed cost calculation engine | `hts.usitc.gov/reststop/exportList` (USITC REST API) | Free | Automated JSON REST API fetcher & hierarchical tree builder. Node hash comparison detects changes. Staged into `HtsRelease` (`DRAFT`) for review. | Daily (02:00 UTC) | 0-item circuit breaker; auto-retries 3x with exponential backoff. Admin alert on failure. |
| **CBP CROSS Rulings** | Legal precedent retrieval, classification evidence matching, AI citation reasoning | `rulings.cbp.gov/api/search` (CBP REST API, 1k req/day) | Free | Incremental date-window query fetching new ruling numbers, HQ/NY locations, text body, and HTS classifications. Indexed into `pgvector`. | Daily (06:00 UTC) | API quota throttling protection (max 10 req/sec); rate-limit awareness fallback. |
| **BIS Consolidated Screening List (CSL)** | Denied party screening, restricted entity checks, sanctions compliance engine | `api.trade.gov/v1/consolidated_screening_list/search` | Free | Standardized JSON transformer normalizing 10 agency lists (SDN, DPL, Entity List, UVL, ISN, SSI, FSE, PLC, NS-MBS) into unified entity schema. | Daily (04:00 UTC) | Atomic table swap; fuzzy index (Levenshtein + token set ratio) re-indexed post-ingest. |
| **OFAC SDN + Consolidated Non-SDN** | Specially Designated Nationals (SDN) screening, sanctions enforcement | `ofac.treasury.gov/ofac-data-download-files` | Free | Streaming XML parser (`Fast-XML-Parser`) converting `sdn.xml` and `consolidated.xml` + daily delta XML feeds into search index. | Daily (05:00 UTC) | Version-stamped XML publication check; continuous background worker sync. |
| **Federal Register (CBP Notices)** | Regulatory monitoring, AD/CVD alerts, tariff changes, retroactive exclusion detection | `federalregister.gov/api/v1/documents.json` | Free | REST API document fetch + Gemini 3.6 Flash AI structured extraction (`extractionSchema`). Auto-generates `RefundOpportunity` records. | Daily (08:00 UTC) | Duplicate document number check; heuristic fallback if AI extraction API is unreachable. |
| **USITC Trade Remedy Database (AD/CVD Orders)** | Anti-Dumping & Countervailing Duty scope screening, duty stack calculations | `usitc.gov/trade_remedy` | Free | Automated DOM (Cheerio) and CSV stream reader extracting AD/CVD Case Numbers, Country, Product Scope, and mapped 10-digit HTS codes. | Weekly (Sun 01:00 UTC) | Stored in `AdCvdOrder` table; cross-validated against ACE scope ruling releases. |
| **ACE Port Codes** | Pre-filing entry validation, valid port code verification for ISF and CBP Form 7501 | `cbp.gov/document/guidance/ace-port-codes` | Free | Automated CSV file downloader and validator mapping 4-digit Port Codes, Port Names, Modes of Transport, and Field Office IDs. | Quarterly | Active/Inactive status flag toggling; invalid code rejection in `filingValidator.ts`. |
| **CBP Import Trade Trend Statistics** | Audit population analytics benchmarks, macro volume profiling | `cbp.gov/trade/trade-community/import-statistics` | Free | Monthly XLSX report stream parser extracting entry counts, customs values, duty collected, and top commodity sectors. | Monthly | Populates `CbpImportTrend` time-series table; feeds risk scoring engine. |
| **USITC DataWeb (Import Statistics)** | Duty opportunity benchmarking, landed cost optimization | `dataweb.usitc.gov/api/v1/imports` | Free | REST API query transformer mapping 10-digit HTS codes, Country of Origin, Customs Value, Calculated Duties, and Quantity. | Monthly | Aggregated into historical benchmarking table `UsitcImportStats`. |
| **WTO Tariff Download Facility** | Tariff scenario modeling, non-US sourcing alternatives, global trade agreement comparison | `tariffdata.wto.org` | Free | Bulk CSV & REST API converter mapping 6-digit HS subheadings, MFN bound/applied rates, and preferential rates across 160+ countries. | Semi-Annually | Populates `WtoTariffMatrix` for global supply chain shift modeling. |
| **Census Schedule B (Export Codes)** | Export document intake, AES filing validation, duty drawback matching | `census.gov/foreign-trade/scheduleB` | Free | Fixed-width text parser mapping 10-digit Schedule B codes, description, quantity units, and HTS 10-digit concordance. | Annually (Jan + Mid-year) | Populates `ScheduleBCode` table; validates export intake files and drawback entries. |

---

### Group B: Free Public Documents Requiring Custom Parsing & Structuring

| Dataset | Powers / Purpose | Source & Provider | Cost | How Refreshed | Frequency | Engineering Effort & Technical Architecture |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Section 301 Tariff Rates (Lists 1-4B)** | Duty stack calculation (`section301` layer), duty opportunity detection | USTR Federal Register Annexes (PDF/HTML) | Free | PDF/HTML table parser (PDF.js / Gemini OCR) parsing ~7,500 8/10-digit HTS codes into Lists 1-4B and duty rates (7.5%, 25%). | Notice-Based / Weekly | **High Effort**: Tabular extraction engine maps ~7,500 HTS codes to versioned `Section301Rate` matrix in `dutyStack.ts`. |
| **Section 301 Exclusions (Granted & Expired)** | Duty opportunity detection, refund readiness, retroactive claim identification | USTR & Federal Register Notices | Free | Gemini LLM structured text parser extracting HTS codes, exact product description regex rules, effective dates, and expiration dates. | Real-Time / Daily | **High Effort**: Hundreds of separate notices; matching engine evaluates product description text against filing line items to flag `RefundOpportunity`. |
| **Section 232 Rates & Exclusions** | Duty stack calculation (`section232` layer), steel/aluminum tariff compliance | Department of Commerce BIS & Federal Register | Free | HTML/CSV parser mapping 10-digit Steel (25%) and Aluminum (10%) HTS codes, Tariff-Rate Quotas (TRQ), and General Approved Exclusions (GAE). | Weekly | **Medium Effort**: `Section232Rate` table wired into `dutyStack.ts`; tracks quota cap thresholds. |
| **USMCA Rules of Origin (Annex 4-B)** | Trade agreement qualification engine (USMCA), preference determination | USTR Published Agreement Text (PDF/HTML) | Free | Complex regex/text parser extracting ~2,000 Product-Specific Rules (Tariff Shift rules CC, CTH, CTSH, RVC % under Transaction Value vs Net Cost). | Static Baseline / Annual Review | **Very High Effort**: Built into executable graph rule tree (`TradeAgreementRule` model) powering `qualify/route.ts`. |
| **CAFTA-DR Rules of Origin** | Central America FTA qualification engine, duty-free preference validation | USTR CAFTA-DR Agreement Text (Annex 4.1) | Free | Structured text parser converting tariff shift rules and RVC rules into decision trees by 6-digit HS Heading. | Static Baseline / Annual Review | **High Effort**: Interoperable qualification engine schema matching USMCA graph architecture. |
| **AD/CVD Company-Specific Rates** | Duty stack calculation (`adcvd` layer, manufacturer-specific matching) | Commerce ITAD Federal Register Notices | Free | Gemini LLM tabular parser extracting AD/CVD Case Number, Country, Manufacturer Name, Individual Rate %, All-Others Rate %, and Period of Review. | Notice-Based / Weekly | **Very High Effort**: `AdCvdCompanyRate` lookup table indexed by Manufacturer + HTS + Case Number; feeds landed cost duty engine. |
| **PGA Requirements by HTS** | PGA screening, pre-filing document completeness checks (FDA, EPA, DOT, etc.) | CBP ACE Reference Files (CATAIR Appendix PGA) | Free | Fixed-width text parser mapping 10-digit HTS codes to PGA Flags (FDA, EPA, DOT, USDA, TTB) and required form codes. | Quarterly | **Medium Effort**: `PgaRequirement` reference table powering customs pre-filing validator (`filingValidator.ts`). |

---

## 3. Maintenance, Circuit Breakers & Staging Policy

1. **Staging & Audit Trail**:
   - Updates to primary tariff schedules (HTSUS, Section 301, Section 232) are written as `DRAFT` releases. Platform administrators can inspect diffs (`HtsChange`) and execute automated regression tests before publishing to production.

2. **Circuit Breakers**:
   - If an automated fetch returns 0 records or a HTTP error status, the ingestion pipeline halts immediately and alerts administrators. Existing production data remains active and untouched.

3. **Manual Triggering ("Run Now")**:
   - Platform administrators can trigger immediate synchronization for any of the 18 datasets via the **Platform Admin Console** (`/platform-admin` -> `<Data>` tab).

4. **Audit Logging**:
   - Every refresh execution logs an `AuditLog` event (`DATASET_REFRESH`) recording dataset ID, execution duration, item count, status, and triggered user/cron context.
