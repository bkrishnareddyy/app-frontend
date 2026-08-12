# Document Intelligence

How an uploaded trade document becomes evidence-backed, filing-ready facts.

## Flow

```text
Upload (HTTP 202, no parsing)
  -> Object storage (immutable original + SHA-256)
  -> Durable processing run (Postgres: DocumentParseVersion)
  -> Qubere document worker (cron tick or long-running loop)
  -> DocumentParserProvider
  -> IbmHostedDoclingProvider  -> IBM hosted Docling
  -> Durable status polling
  -> Result retrieval
  -> Artifact persistence (object storage) + artifact index (Postgres)
  -> Document quality gate
  -> Active-version promotion (stale-run protected)
  -> QubereDocumentContextV1
  -> Classification / extraction (versioned separately)
  -> Deterministic validation -> reconciliation -> filing readiness
```

Nothing expensive happens in the user's request. Upload validates, stores, hashes,
creates one durable run, audits, and returns 202. Everything after that is the
worker's job, against state that survives a restart.

## Architectural boundary

Qubere owns the Document Intelligence domain. Docling is a parser provider.

`src/modules/documents/parser/contracts.ts` is the provider-neutral seam. No file
outside `parser/ibm/` mentions IBM's endpoints, headers, request shape, or status
vocabulary, and no downstream agent sees a Docling type. Three contracts are
versioned independently, so any one can move without the others:

| Contract | Version constant | Where |
| --- | --- | --- |
| IBM provider wire format | `ibm.docling.serve/v1` | `parser/ibm/doclingWire.ts` |
| Qubere parser normalisation | `qubere.parser/1` | `parser/contracts.ts` |
| Agent-facing document context | `QubereDocumentContextV1` | `context/qubereDocumentContext.ts` |
| Chunking algorithm | `qubere.chunk/1` | `parser/chunking.ts` |

A future `SelfHostedDoclingProvider` would be a new class implementing
`DocumentParserProvider` and a new entry in `parser/registry.ts`. Nothing else
changes. **It is not implemented, by design: this MVP introduces no separate
Docling service.**

## Data model

No new tables. `DocumentParseVersion` became the durable processing run through
additive nullable columns; `ShipmentDocument` gained the original's size, media
type, and an active-run pointer. See
`prisma/migrations/20260810180000_document_processing_runs/`.

| Concern | Where it lives |
| --- | --- |
| Document + immutable original | `ShipmentDocument` (`checksum` = SHA-256, `byteSize`, `mimeType`) |
| Processing run | `DocumentParseVersion` (status, profile, provider, external task id, poll/retry state, quality, artifact index) |
| Active version | `ShipmentDocument.activeParseVersionId` |
| Artifacts | Object storage under `processing/<tenant>/<document>/<run>/`, indexed in `DocumentParseVersion.artifactsJson` |
| Quality assessment | `DocumentParseVersion.qualityJson` |
| Chunks + context | Derived on demand from the stored normalised artifact; not persisted |
| Extraction run | `AgentExecutionRecord` (extractor, model version, status, duration) |
| Facts + provenance | `ExtractionField` (value, page, bbox, source) |
| Reconciliation | `ReconciliationIssue`, `ExceptionItem` |
| Audit | `AuditLog` |

## Processing profiles

Profiles are Qubere concepts. `parser/config.ts` maps each onto the Docling
conversion options the documented `/convert/source/async` contract exposes, and
nothing else — an option a hosted deployment silently ignores would make the
profile a lie.

| Profile | `do_ocr` | `force_ocr` | `do_table_structure` | When |
| --- | --- | --- | --- | --- |
| `STANDARD` | true | **false** | true | Default. Born-digital and mixed documents; the provider's own heuristics handle image-only pages. Never re-OCRs an existing text layer. |
| `OCR_FALLBACK` | true | false | true | First quality-gate retry, after objective signals show insufficient text. Same provider options as STANDARD; the difference is the recorded reason and that Qubere only reaches it deliberately. |
| `FULL_PAGE_OCR` | true | **true** | true | Explicitly scanned/image documents, manual reprocess, or a second quality retry. Forces OCR over pages that already claim a text layer. Never applied by default. |

**The provider does not report whether OCR ran.** A `FULL_PAGE_OCR` run records
that full-page OCR was *requested*, never that it happened: `ocrUsed` and
`fullPageOcrUsed` stay `null`, and the run carries a
`PROVIDER_OPTION_NOT_VERIFIABLE` warning naming what could not be confirmed.

## Quality gate

`parser/qualityGate.ts` decides whether a parse may become the document's active
version, from counts and parser-set flags only. There is no invented score.

| Outcome | Meaning | Becomes active? |
| --- | --- | --- |
| `PASS` | Text recovered across the document | Yes |
| `PASS_WITH_WARNINGS` | Usable, with blank pages / warnings / unknown page coverage | Yes |
| `RETRY_WITH_OCR` | Objectively insufficient text; a new run is queued under an OCR profile | No |
| `NEEDS_REVIEW` | OCR already exhausted, or the parser reported an error | No |
| `FAILED` | Nothing usable | No |

Signals: page count, per-page text length, text coverage, blank/low-text page
counts, table count, section count, parser warnings, and any independently known
page count. Thresholds: a page under 40 extracted characters is "low text"; below
60% page coverage triggers an OCR retry. Escalation is bounded —
`OCR_FALLBACK`, then `FULL_PAGE_OCR`, then a person.

## Provenance

The lineage a customs field is traced back through:

```text
Customs filing field
  -> ExtractionField (value, page, bbox, source)
  -> QubereDocumentContextV1 section/table id     (cited by the agent)
  -> sourceElementId                              (parser section/table id)
  -> provenance[].elementRef                      (Docling self_ref, e.g. #/texts/7)
  -> page + bounding box (with the parser's own coordinate origin)
  -> canonical Docling JSON artifact
  -> immutable original document (SHA-256 verified on every read)
```

Absence is preserved at every hop. A `null` page or bbox means the parser did not
report one — never a default. A bounding box is never synthesised.

## Confidence

Four separate, never-merged things:

- **parser confidence** / **OCR confidence** — only when the parser genuinely
  emits them. **The IBM hosted deployment does emit them**, verified live: each
  converted document carries `parse_score`, `layout_score`, `table_score`,
  `ocr_score`, `mean_score`, `low_score` and letter grades. `mean_score` becomes
  `parserConfidence` and `ocr_score` becomes `ocrConfidence`. A null score means
  the service did not measure that dimension (no tables present, or no OCR pass)
  and stays null — "not measured" is not zero.
- **agent confidence** — the extraction model's own number.
- **deterministic validation status** — rule outcome, independent of any model.
- **human review status** — a person's decision.

`ocrUsed` is derived from whether an OCR score exists: a number means an OCR pass
ran and was scored. A null does *not* prove OCR was skipped, so that case reports
unknown rather than false.

## Result delivery

This deployment returns a **batch envelope whose content sits behind presigned
object-storage URLs**, not inline:

```jsonc
{ "num_converted": 1, "processing_time": 0.35,
  "documents": [{ "status": "success", "confidence": { … },
    "artifacts": [ { "artifact_type": "json",     "uri": "https://s3…", "url_expires_at": "…" },
                   { "artifact_type": "markdown", "uri": "https://s3…", "url_expires_at": "…" } ] }] }
```

The provider fetches those artifacts and normalises them. Because the URLs come
from the provider's response, their host is checked against an allowlist first
(`DOCLING_ARTIFACT_HOSTS`, defaulting to the AWS/IBM object-storage hosts plus the
parser's own host) — a result payload must never be able to make the server fetch
an arbitrary address. The URLs are short-lived, are never logged or persisted, and
re-reading the task result mints fresh ones, which is what makes duplicate result
retrieval safe.

The self-hosted `/convert/source` shape (content inlined as `md_content` /
`json_content`) is still supported; the provider detects which arrived.

## Idempotency, retries, recovery

- **Run identity** = SHA-256 of `tenant | content hash | provider | profile |
  config hash | parser contract version`, enforced by a unique database index.
  Duplicate queue delivery, a re-upload of identical bytes, or a double-clicked
  reprocess all find the existing run.
- **Retries** are bounded (`DOCUMENT_PARSER_MAX_ATTEMPTS`, default 4) with
  exponential backoff and full jitter, applied only to retryable codes. Network
  failures, provider timeouts and transient 5xx retry; empty, encrypted,
  corrupted, oversized, unsupported and quarantined files never do.
- **Polling** is durable: external task id, last provider status, `lastPolledAt`,
  `nextPollAt` and `pollAttemptCount` are all in Postgres. Bounded interval with
  backoff, capped by `DOCUMENT_POLL_MAX_ATTEMPTS`. No browser polls the provider,
  and no HTTP request is held open on it.
- **Stale recovery**: a run whose heartbeat lapses is reclaimed. If it still has
  a provider task id it resumes polling — resubmitting would pay twice. If it
  never got one, it returns to `QUEUED`.
- **Stale-run protection**: promotion to active requires that no newer run is
  already accepted. A slow older run that finishes after a newer one is persisted
  in full for audit but does not claim the pointer.
- **Duplicate completion** is safe: every transition is a conditional update on
  the current status, so the second worker finds zero rows changed.

## State machine

```text
QUEUED ──> SUBMITTED ──> POLLING ──> SUCCEEDED
                    │           ├──> NEEDS_REVIEW
                    └───────────┴──> FAILED ──(retryable, attempts left)──> QUEUED

SUCCEEDED / NEEDS_REVIEW: terminal. Reprocess creates a NEW run at a higher version.
```

## Local development

```bash
npm install
npx prisma generate
npx prisma migrate deploy          # or `db push` against a scratch database

# .env — the mock provider, which is unmistakably not IBM
DOCUMENT_PARSER_PROVIDER=mock

npm run dev                        # in one terminal
npm run worker:documents           # in another: the processing worker loop
```

The mock provider (`parser/mock/mockDoclingProvider.ts`) exists so the queue,
worker, artifact store, quality gate and context builder can be exercised without
IBM credentials. It is **not** a Docling emulator: it does not read PDFs, so a PDF
yields an empty parse and drives the OCR escalation path. Every result it produces
is stamped `MOCK_PARSER` and carries a `MOCK_PROVIDER` warning, and three separate
guards keep it out of production.

Instead of the worker loop you can drive one tick by hand:

```bash
curl -X POST http://localhost:3000/api/cron/document-processing \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Production configuration

```env
DOCUMENT_PARSER_PROVIDER=ibm-docling
DOCLING_API_BASE_URL=https://<your-ibm-docling-host>
DOCLING_API_KEY=<credential>
CRON_SECRET=<shared secret for /api/cron/*>
BLOB_READ_WRITE_TOKEN=<object storage credential>
```

Everything else has a working default; see the table in the engineering report.
Endpoint paths, the auth header name and scheme, and the source-envelope shape are
all configurable because hosted deployments differ, and none of it is guessed from
an example.

The worker runs either way:

- **Serverless (Vercel)** — the request path drives it, and cron is a daily
  backstop. See "What advances a run on Vercel" below. `CRON_SECRET` must be set.
- **Long-running host** — `npm run worker:documents`. Safe to run alongside the
  cron and alongside the request-path drains; all three advance the same durable
  runs and cannot double-apply a transition.

### What advances a run on Vercel

Vercel's Hobby plan schedules cron **once a day**, so cron cannot be the
pipeline. It is worse than slow: submission sets `nextPollAt` a few seconds
ahead, so the poll that retrieves the result belongs to a *later* tick, and a
daily cron therefore parses a document two days after it was uploaded.

So three things advance a run, in descending order of how much work they do:

| Trigger | When | What it does |
| --- | --- | --- |
| `advanceDocumentProcessing()` after an upload or a reprocess | Immediately, after the 202 is sent | Submits the new run to the parser and keeps polling for up to 30s. A quick conversion finishes inside this invocation. |
| The same call on `GET /api/documents/[id]/processing` | While a client polls a document that is still in flight | Drains again, throttled to one drain per 4s per instance |
| `/api/cron/document-processing` | Daily (`0 9 * * *`) | The backstop: runs abandoned by a crashed worker, and conversions that outlived the invocation that started them. Also carries the inbound-email backstop tick, because Hobby allows only two cron entries in total |

The drain runs in Next's [`after()`](https://nextjs.org/docs/app/api-reference/functions/after),
which Vercel implements with `waitUntil` — the response has already been sent, so
the user waits for nothing, and the invocation stays alive to finish the work. It
is the same `runWorkerTick()` in every case; every transition is a conditional
update, so overlapping callers cannot double-apply one.

Two consequences worth knowing:

- The drain is **not** scoped to the caller's tenant. It is a system worker
  started by a request, and each run is processed in its own account's context.
  Scoping it per tenant would strand an idle tenant's documents.
- The budget is bounded by the route's `maxDuration`, set to **60s** — the Hobby
  ceiling. On Pro, raise `maxDuration` to 300 and `DEFAULT_BUDGET_MS` in
  `processing/advanceProcessing.ts` to match, or restore a per-minute cron in
  `vercel.json`, which Pro allows.

If a document must be parsed within seconds regardless of who is watching, run
the long-lived worker on an always-on host instead. That is what it is for.

**No Python service, no self-hosted Docling deployment, and no Docling
microservice is introduced or required.**

## Security

- Tenant comes from the authenticated context. A tenant id in a request payload is
  never authorization.
- Every document, run, artifact and context read is filtered by `accountId` inside
  the query, not checked afterwards. A resource in another tenant returns 404, so
  the response does not confirm it exists.
- Reprocessing requires `decisions.reevaluate`; viewers do not hold it.
- Artifacts are reachable only through `/api/documents/[id]/artifacts`, which
  resolves the storage location from the tenant's own records and audits the
  access. Storage references are never returned to a browser or a model.
- **SSRF**: source delivery defaults to `inline`, so no URL is handed to the
  provider at all. In `signed-url` mode the URL must pass
  `assertQubereStorageUrl` — a Qubere-minted, allowlisted storage host. A
  client-supplied URL can never reach the provider.
- Never logged: document bytes, extracted text, credentials, signed URLs,
  authorization headers, storage references. Provider error bodies are never
  copied into a persisted message, because a provider may echo document content
  into one.

## Known limitations

1. **Live IBM verification: done.** Confirmed end to end against
   `api.aws-c1.dcls.saas.ibm.com` on 2026-08-11 — submit, poll, result, artifact
   fetch, normalisation, provenance and the quality gate. `tests/ibm-docling-live.test.ts`
   is the opt-in test; with `DOCUMENT_PARSER_LIVE_TEST=true` and no credentials it
   **fails** rather than skipping. Everything else stubs the transport and proves
   the mapping, not the endpoint.
2. **Docling version observed: `1.10.0`** (from the DoclingDocument's own
   `version`). The **OCR engine name and version are still not exposed** by the
   result contract and are reported as `null`. Nothing here guesses them.
3. **Endpoint shape is deployment-specific.** This deployment uses
   `/v1/convert/file/async` (a multipart upload), authenticates with a bare
   `X-Api-Key` header — not `Authorization: Bearer` — and returns artifact URLs.
   It advertises its supported endpoints in the error body of an unsupported
   route, which is a quick way to check a new deployment:
   `curl -H "X-Api-Key: $KEY" $BASE/v1/health`.
4. **Table captions are reported as absent.** Docling stores them as `$ref`s into
   `texts`; resolving those is not reliable across versions, so a caption is
   reported absent rather than guessed from nearby text.
5. **Token counts are estimates**, at 4 characters per token — deliberately
   conservative, so a real payload lands under budget rather than over it.
6. **Malware scanning is a policy hook with no scanner behind it.** The verdict is
   `NOT_SCANNED` and is audited on every upload. Set
   `DOCUMENT_MALWARE_SCAN_MODE=block` to refuse uploads until one is integrated.
7. **Document role is not modelled**, so `documentRole` in a context is always
   `null`. Adding it means a new column, which was out of scope here.
8. **Page images and thumbnails are not produced.** `include_images` is off and no
   consumer needs them.
