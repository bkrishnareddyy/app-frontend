import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { getDocumentParserProvider } from "@/modules/documents/parser/registry";
import {
  MockDoclingProvider,
  resetMockParserTasks,
} from "@/modules/documents/parser/mock/mockDoclingProvider";
import { DocumentParserError } from "@/modules/documents/parser/contracts";
import { assessQuality } from "@/modules/documents/parser/qualityGate";

/**
 * Properties that are easy to regress in a route and expensive to discover in
 * production: parsing must not creep back into the upload request, GET endpoints
 * must not write, tenant scoping must stay in the query rather than becoming a
 * post-hoc check, secrets and document contents must stay out of logs and
 * responses, and the mock provider must remain unusable in production.
 */

async function source(relative: string): Promise<string> {
  return readFile(new URL(`../${relative}`, import.meta.url), "utf8");
}

/**
 * Source with comments removed.
 *
 * These assertions are about what the code does, and a comment explaining why a
 * route returns 404 rather than 403 must not read as the route returning 403.
 */
async function code(relative: string): Promise<string> {
  return (await source(relative))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const UPLOAD = "src/app/api/documents/upload/route.ts";
const WORKER = "src/modules/documents/processing/documentProcessingWorker.ts";
const PROCESSING = "src/app/api/documents/[id]/processing/route.ts";
const CONTEXT = "src/app/api/documents/[id]/context/route.ts";
const ARTIFACTS = "src/app/api/documents/[id]/artifacts/route.ts";
const REPROCESS = "src/app/api/documents/[id]/reprocess/route.ts";
const CRON = "src/app/api/cron/document-processing/route.ts";

describe("upload does no parsing", () => {
  it("never calls a parser provider from the request path", async () => {
    const upload = await source(UPLOAD);
    // It used to run Gemini vision on the raw buffer and kick off a ten-agent
    // pipeline inline, inside the user's request.
    expect(upload).not.toMatch(/getDocumentParserProvider/);
    expect(upload).not.toMatch(/DocumentIntelligenceAgent/);
    expect(upload).not.toMatch(/AgentOrchestrator/);
    expect(upload).not.toMatch(/runFullPipeline/);
  });

  it("queues a durable run and answers 202 instead of waiting", async () => {
    const upload = await source(UPLOAD);
    expect(upload).toMatch(/enqueueDocumentParse/);
    expect(upload).toMatch(/status: 202/);
  });

  it("takes the tenant from the authenticated context, never from the payload", async () => {
    const upload = await source(UPLOAD);
    expect(upload).toMatch(/const accountId = ctx\.accountId/);
    expect(upload).not.toMatch(/formData\.get\(["']accountId["']\)/);
    expect(upload).not.toMatch(/body\.accountId/);
  });

  it("resolves the target shipment through the tenant-scoped resolver", async () => {
    const upload = await source(UPLOAD);
    expect(upload).toMatch(/resolveTenantShipmentId/);
    expect(upload).not.toMatch(/shipment\.findUnique/);
  });

  it("records the original's hash, size and media type", async () => {
    const upload = await source(UPLOAD);
    expect(upload).toMatch(/checksum: storageResult\.checksum/);
    expect(upload).toMatch(/byteSize: file\.size/);
    expect(upload).toMatch(/mimeType:/);
  });

  it("writes an audit event carrying the hash but not the contents or the URL", async () => {
    const upload = await code(UPLOAD);
    expect(upload).toMatch(/createAuditLog/);

    // Only the audit metadata blocks are examined: the document row legitimately
    // stores fileUrl, while an audit record must not, because a storage URL in a
    // log is a credentialled location in a log.
    const metadataBlocks = [...upload.matchAll(/metadata:\s*\{([\s\S]*?)\n\s{4}\}/g)].map(
      (match) => match[1]
    );
    expect(metadataBlocks.length).toBeGreaterThan(0);
    expect(metadataBlocks.join("\n")).toMatch(/sha256: storageResult\.checksum/);
    for (const block of metadataBlocks) {
      expect(block).not.toMatch(/storageResult\.url/);
      expect(block).not.toMatch(/rawContent|extractedJson|fileBuffer/);
    }
  });

  it("does not fake a malware scan", async () => {
    const upload = await source(UPLOAD);
    expect(upload).toMatch(/screenUploadForMalware/);
    const policy = await source("src/modules/documents/processing/malwarePolicy.ts");
    // The only CLEAN verdict must come from a scanner that actually ran.
    expect(policy).toMatch(/PRODUCTION REQUIREMENT/);
    expect(policy).not.toMatch(/verdict: "CLEAN"/);
  });

  it("refuses an unparseable file before creating a run for it", async () => {
    const upload = await source(UPLOAD);
    expect(upload).toMatch(/assertParseableFormat/);
  });
});

describe("read endpoints have no side effects", () => {
  const readRoutes = [PROCESSING, CONTEXT];

  it("no GET route writes to the database", async () => {
    for (const route of readRoutes) {
      const text = await source(route);
      expect(text, `${route} must not create rows`).not.toMatch(/\.create\(/);
      expect(text, `${route} must not update rows`).not.toMatch(/\.update\(|\.updateMany\(/);
      expect(text, `${route} must not upsert rows`).not.toMatch(/\.upsert\(/);
    }
  });

  it("no GET route seeds demo data or generates exceptions", async () => {
    for (const route of [...readRoutes, ARTIFACTS, CRON]) {
      const text = await source(route);
      expect(text, route).not.toMatch(/exceptionItem\.create/);
      expect(text, route).not.toMatch(/reconciliationIssue\.create/);
      expect(text, route).not.toMatch(/assertDemoSeedingAllowed|isDemoSeedingAllowed/);
      expect(text, route).not.toMatch(/seedDemo|demoData/i);
    }
  });

  it("no GET route triggers a parse", async () => {
    for (const route of readRoutes) {
      const text = await source(route);
      expect(text, route).not.toMatch(/enqueueDocumentParse|runWorkerTick/);
    }
  });

  it("the artifact route writes only its own access audit record", async () => {
    const text = await source(ARTIFACTS);
    // Reading a full parsed customs document is worth recording; nothing else is written.
    expect(text).toMatch(/createAuditLog/);
    expect(text).not.toMatch(/documentParseVersion\.update/);
    expect(text).not.toMatch(/shipmentDocument\.update/);
  });
});

describe("tenant scoping", () => {
  it("every document route filters by the caller's account in the query itself", async () => {
    for (const route of [PROCESSING, CONTEXT, ARTIFACTS, REPROCESS]) {
      const text = await source(route);
      expect(text, `${route} must scope by accountId`).toMatch(/accountId: ctx\.accountId/);
      // A findUnique on a caller-supplied id cannot carry a tenant filter.
      expect(text, `${route} must not use findUnique on a supplied id`).not.toMatch(
        /shipmentDocument\.findUnique/
      );
    }
  });

  it("returns 404 rather than 403 for another tenant's document", async () => {
    for (const route of [PROCESSING, ARTIFACTS, REPROCESS]) {
      const text = await source(route);
      expect(text, route).toMatch(/404, "NOT_FOUND"/);
    }
    // Confirming that a resource exists in another tenant is itself a disclosure.
    const contextService = await code("src/modules/documents/context/documentContextService.ts");
    expect(contextService).toMatch(/"NOT_FOUND", 404/);
    expect(contextService).not.toMatch(/403/);
  });

  it("the artifact route reaches the run only through a document the tenant owns", async () => {
    const text = await source(ARTIFACTS);
    expect(text).toMatch(/document: \{ accountId: ctx\.accountId \}/);
  });

  it("reprocessing is gated on a capability viewers do not hold", async () => {
    const text = await source(REPROCESS);
    expect(text).toMatch(/permission: "decisions\.reevaluate"/);
    expect(text).toMatch(/write: true/);
  });

  it("the cron worker endpoint is gated on the shared cron secret", async () => {
    const text = await source(CRON);
    expect(text).toMatch(/CRON_SECRET/);
    expect(text).toMatch(/Bearer \$\{cronSecret\}/);
    expect(text).toMatch(/status: 401/);
  });
});

describe("secrets and document contents stay out of logs and responses", () => {
  it("the worker logs identifiers and codes, never payloads", async () => {
    const worker = await source(WORKER);
    expect(worker).not.toMatch(/console\.log\([^)]*bytes/);
    expect(worker).not.toMatch(/JSON\.stringify\(parsed/);
    expect(worker).not.toMatch(/markdown/);
    expect(worker).not.toMatch(/DOCLING_API_KEY/);
  });

  it("no processing module logs a credential or a storage URL", async () => {
    for (const file of [
      WORKER,
      "src/modules/documents/parser/ibm/ibmHostedDoclingProvider.ts",
      "src/modules/documents/parser/artifactStore.ts",
    ]) {
      const text = await source(file);
      expect(text, file).not.toMatch(/console\.\w+\([^)]*apiKey/);
      expect(text, file).not.toMatch(/console\.\w+\([^)]*storageRef/);
      expect(text, file).not.toMatch(/console\.\w+\([^)]*Authorization/);
    }
  });

  it("the processing status response exposes no storage location", async () => {
    const text = await source(PROCESSING);
    expect(text).not.toMatch(/storageRef/);
    // Artifact types, sizes and hashes are returned; locations are not.
    expect(text).toMatch(/sha256: artifact\.sha256/);
  });

  it("the context route never returns the raw provider payload", async () => {
    const text = await code(CONTEXT);
    expect(text).not.toMatch(/canonical/);
    expect(text).not.toMatch(/DOCLING_JSON/);
    expect(text).not.toMatch(/loadNormalizedResult|readProcessingArtifact/);
  });
});

describe("mock provider safety", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    resetMockParserTasks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("cannot be constructed in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => new MockDoclingProvider()).toThrowError(DocumentParserError);
    vi.unstubAllEnvs();
  });

  it("cannot be selected in a production environment", () => {
    process.env.DOCUMENT_PARSER_PROVIDER = "mock";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.qubere.ai";
    expect(() => getDocumentParserProvider()).toThrowError(/not permitted in a production/);
  });

  it("throws rather than returning null when nothing is configured", () => {
    delete process.env.DOCUMENT_PARSER_PROVIDER;
    // A null return would let a caller skip parsing silently, and an unparsed
    // document would just look slow.
    expect(() => getDocumentParserProvider()).toThrowError(/No document parser provider/);
  });

  it("labels every result it produces as not being Docling", async () => {
    const provider = new MockDoclingProvider({ pollsBeforeSuccess: 0 });
    const ack = await provider.submit({
      runId: "run_1",
      correlationId: "c",
      profile: "STANDARD",
      source: {
        kind: "inline",
        filename: "invoice.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("Invoice No: INV-1\nShipper: ACME"),
      },
    });

    const result = await provider.getResult(
      { runId: "run_1", externalTaskId: ack.externalTaskId, correlationId: "c" },
      "STANDARD"
    );
    expect(result.normalized.metadata.provider).toBe("MOCK_PARSER");
    expect(result.normalized.warnings.map((w) => w.code)).toContain("MOCK_PROVIDER");
    expect(JSON.stringify(result.canonical)).toContain("NOT a Docling result");
  });

  it("exercises the polling path before reporting success", async () => {
    const provider = new MockDoclingProvider({ pollsBeforeSuccess: 2 });
    const ack = await provider.submit({
      runId: "run_2",
      correlationId: "c",
      profile: "STANDARD",
      source: {
        kind: "inline",
        filename: "a.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("hello"),
      },
    });
    const ref = { runId: "run_2", externalTaskId: ack.externalTaskId, correlationId: "c" };
    expect((await provider.getStatus(ref)).state).toBe("POLLING");
    expect((await provider.getStatus(ref)).state).toBe("POLLING");
    expect((await provider.getStatus(ref)).state).toBe("SUCCEEDED");
  });

  it("produces an empty parse for a PDF, which the quality gate sends to OCR", async () => {
    // The mock has no parser, so a PDF yields no text. That is the honest
    // outcome, and it usefully drives the OCR escalation path.
    const provider = new MockDoclingProvider({ pollsBeforeSuccess: 0 });
    const ack = await provider.submit({
      runId: "run_3",
      correlationId: "c",
      profile: "STANDARD",
      source: {
        kind: "inline",
        filename: "scan.pdf",
        mimeType: "application/pdf",
        bytes: Buffer.from("%PDF-1.7 binary-ish\n%%EOF"),
      },
    });
    const result = await provider.getResult(
      { runId: "run_3", externalTaskId: ack.externalTaskId, correlationId: "c" },
      "STANDARD"
    );
    expect(result.normalized.sections).toHaveLength(0);

    const assessment = assessQuality({
      result: result.normalized,
      expectedPageCount: null,
      isOcrRetry: false,
      usedFullPageOcr: false,
    });
    expect(assessment.outcome).toBe("RETRY_WITH_OCR");
  });

  it("reports a lost task honestly after a restart rather than inventing a result", async () => {
    const provider = new MockDoclingProvider({ pollsBeforeSuccess: 0 });
    resetMockParserTasks();
    const status = await provider.getStatus({
      runId: "run_4",
      externalTaskId: "mock_gone",
      correlationId: "c",
    });
    expect(status.state).toBe("FAILED");
    expect(status.error?.message).toMatch(/does not survive a restart/);
  });
});

describe("worker discipline", () => {
  it("does not hold a request open waiting for the parser", async () => {
    const worker = await source(WORKER);
    // A bounded tick: submit what is due, poll what is due, return.
    expect(worker).toMatch(/export async function runWorkerTick/);
    expect(worker).not.toMatch(/while \(true\)/);
    expect(worker).not.toMatch(/setTimeout\([^)]*poll/i);
  });

  it("gates promotion on the quality outcome rather than mere completion", async () => {
    const worker = await code(WORKER);
    expect(worker).toMatch(/qualifiesAsActive\(quality\.outcome\)/);
    expect(worker).toMatch(/promoteToActive/);
  });

  it("creates a new run for an OCR retry instead of rerunning the old one", async () => {
    const worker = await code(WORKER);
    expect(worker).toMatch(/reason: "OCR_RETRY"/);
    expect(worker).toMatch(/enqueueDocumentParse/);
    // Never a transition out of an accepted run: reprocessing makes a new one.
    expect(worker).not.toMatch(/from: "SUCCEEDED"/);
  });

  it("never swallows a failure silently", async () => {
    const worker = await code(WORKER);
    expect(worker).toMatch(/handleRunFailure/);
    expect(worker).not.toMatch(/catch \{\s*\}/);
  });
});
