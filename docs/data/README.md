# Platform Dataset Master Documentation

Welcome to the Qubere Platform Data Architecture and Ingestion Policy documentation.

The Qubere Platform relies on authoritative trade data, tariff schedules, sanctions lists, regulatory notices, and rules of origin. Operational calculations derive strictly from verified government and multilateral sources. **No synthetic data, mock fallbacks, or fabricated counts are ever returned.**

---

## 📊 Core Datasets Status & Implementation Matrix

| Dataset (`<data>`) | Current State (`<current state>`) | Technical Architecture & Implementation Breakdown (`<if not implemented then why - why is it hard>`) |
| :--- | :--- | :--- |
| **HTSUS Schedule (Full Tariff Schedule)** | `LIVE` | **Fully Implemented**: Automated JSON REST API fetcher (`HtsUsitcFetcher`) fetching all 99 chapters from `hts.usitc.gov/reststop/exportList`. Tree builder checksums SHA-256 node hashes and stages releases (`DRAFT`) into `HtsRelease` for mandatory admin review before going live. |
| **Federal Register (CBP Notices)** | `LIVE` | **Fully Implemented**: Fetches live CBP notices directly via `federalregister.gov/api/v1/documents.json`. Documents undergo Gemini AI structured extraction to detect tariff changes and auto-create `RefundOpportunity` records. |
| **BIS Consolidated Screening List (CSL)** | `LIVE` | **Fully Implemented**: Real REST API fetcher (`BisCslIngestionService`) querying `https://api.trade.gov/v1/consolidated_screening_list/search` with offset pagination across 10 agency lists (SDN, DPL, Entity List, UVL, ISN, SSI, FSE, PLC, NS-MBS), computing SHA-256 entity hashes, and upserting into `ScreeningEntity` with `PUBLISHED` status. |
| **CBP CROSS Rulings** | `LIVE` | **Fully Implemented**: Real REST API fetcher (`CbpCrossFetchService`) querying `https://rulings.cbp.gov/api/search`, storing ruling numbers, titles, issued dates, HTS classifications, and legal fragments in `Ruling` / `RulingFragment` tables. |
| **OFAC SDN + Consolidated Non-SDN** | `LIVE` | **Fully Implemented**: Streaming SAX XML parser (`OfacSdnIngestionService`, using `saxes`) reads Treasury's `sdn.xml` (~29MB, ~19,700 entries) and `consolidated.xml` directly — never buffers the raw file, extracts name/AKAs/addresses/programs per `sdnEntry`. Runs as a durable Inngest background function (own native cron, no `vercel.json` slot) to stay clear of Vercel's function timeout. Circuit breaker: the parsed entry count must match the feed's own `Record_Count` header or nothing is written; delisted entities are marked `SUPERSEDED` rather than deleted, preserving point-in-time screening history. |
| **USITC Trade Remedy Database (AD/CVD Orders)** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: AD/CVD case orders are published across un-structured HTML tables and CSV dumps. Requires a Cheerio DOM / CSV stream scraper parsing case numbers (e.g., A-570-979), country flags, product scopes, and staging into `AdCvdOrder` with a `PENDING` review gate before affecting duty stack calculations. |
| **ACE Port Codes** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: Published quarterly as fixed-width/CSV directory files by CBP. Requires fixed-width text parsing, 4-digit code mapping, transport mode extraction (Vessel/Air/Truck/Rail), and upserts into `AcePortCode`. |
| **CBP Import Trade Trend Statistics** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: Published as monthly multi-tab Excel workbooks (`.xlsx`). Requires binary stream parsing (SheetJS), extracting Customs Values, Duty Collected, and entry counts per commodity chapter into `CbpImportTrend` time-series tables. |
| **USITC DataWeb (Import Statistics)** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: USITC DataWeb API requires OAuth token authentication, dynamic GraphQL/REST query transformers for 10-digit HTS codes, and aggregating customs values into landed cost benchmark tables. |
| **WTO Tariff Download Facility** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: Multi-gigabyte bulk CSV dumps spanning 160+ WTO member states. Requires streaming CSV parsing, HS-6 subheading harmonization across MFN bound, applied, and preferential rate schedules into `WtoTariffRate`. |
| **Census Schedule B (Export Codes)** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: Annual fixed-width text file containing ~9,000 10-digit export codes and HTSUS concordance maps. Requires fixed-width column parsing, quantity unit normalization (PCS, KGS, NO), and concordance mapping into `ScheduleBCode`. |
| **Section 301 Tariff Rates (Lists 1-4B)** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: Spread across 100+ Federal Register PDF/HTML annexes covering ~7,500 HTS codes with retroactive rate modifications (7.5%, 25%). Requires Gemini OCR / PDF table extraction, versioning List 1-4B tranche rates, and staging as `PENDING` for mandatory platform admin review. |
| **Section 301 Exclusions (Granted & Expired)** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: HTS-level exclusion grants described in legal prose across hundreds of USTR notices. Requires LLM structured text extraction to generate compiled regex rules, effective date windows, and automated `RefundOpportunity` triggers upon admin approval. |
| **Section 232 (Steel/Aluminum) Rates & Exclusions** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: Involves 25% Steel and 10% Aluminum rates, Tariff-Rate Quotas (TRQ) by country, and General Approved Exclusions (GAE). Requires HTML scraper parsing Department of Commerce BIS notices and tracking quota cap thresholds in `Section232Rate`. |
| **USMCA Rules of Origin (Annex 4-B)** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: Contains ~2,000 Product-Specific Rules (PSR) in legal agreement text. Requires building a complex tariff shift parser (CC, CTH, CTSH) and Regional Value Content (RVC %) graph tree in `TradeAgreementRule` to power `qualify/route.ts`. |
| **CAFTA-DR Rules of Origin** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: Annex 4.1 legal text detailing tariff shift rules and RVC rules for Central American countries. Requires structured rule tree parsing matching the USMCA graph architecture. |
| **AD/CVD Company-Specific Rates** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: Annual review administrative notices published in the Federal Register detailing manufacturer-specific cash deposit rates. Requires LLM tabular extraction of Case Numbers, Exporter Names, Period of Review, and staging as `PENDING` for mandatory admin review before flowing into `dutyStack.ts`. |
| **PGA Requirements by HTS** | `NOT_YET_IMPLEMENTED` | **Why it's hard / Planned**: Mapped in CBP ACE CATAIR Appendix PGA fixed-width text files across 15+ Partner Government Agencies (FDA, EPA, DOT, USDA, TTB). Requires fixed-width text parsing, agency program code mapping, and populating `HtsPgaRequirement` for pre-filing entry validation. |

---

## 🛡 Platform Admin Controls & Zero-Fabrication Policy

All datasets can be monitored and executed on demand via the Platform Admin Console:
- **Console URL**: `/platform-admin` -> **`<Data>`** tab.
- **LIVE Datasets**: Can be triggered manually via **Run Now** or automatically via the single daily dispatcher cron (`/api/cron/data-dispatcher`). Execution status is written to the persistent `DatasetRefreshLog` DB table.
- **NOT_YET_IMPLEMENTED Datasets**: Clearly display the `⚠ On Roadmap` badge in the UI. Triggering an un-wired dataset via API returns HTTP `422 Unprocessable Entity` and writes **no database log row**. No synthetic data or fake success responses are ever returned.
