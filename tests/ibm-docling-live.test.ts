import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Vitest does not load `.env`, so the parser settings are read from it here
 * before the config module is imported.
 *
 * Scoped to this opt-in file on purpose: loading `.env` for the whole suite
 * would let a developer's local provider settings leak into the deterministic
 * tests, several of which assert on the *absence* of configuration.
 *
 * Only the parser keys are taken, an already-exported value always wins, and
 * `.env` is parsed directly rather than sourced through a shell -- Git Bash
 * rewrites values like "/v1/convert/file/async" into Windows paths.
 */
function loadParserEnvFromDotEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(".env", "utf8");
  } catch {
    return; // No .env (CI); rely on whatever the environment already provides.
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(DOCLING_[A-Z0-9_]+|DOCUMENT_PARSER_[A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

loadParserEnvFromDotEnv();

const { IbmHostedDoclingProvider } = await import(
  "@/modules/documents/parser/ibm/ibmHostedDoclingProvider"
);
const { isIbmDoclingConfigured } = await import("@/modules/documents/parser/config");
const { assessQuality } = await import("@/modules/documents/parser/qualityGate");

/**
 * Opt-in live integration test against the real IBM-hosted Docling deployment.
 *
 * This is the ONLY test in the suite that proves the real endpoint behaves as the
 * provider expects. Everything else stubs the transport and therefore proves the
 * mapping, not the endpoint.
 *
 * It is skipped unless BOTH of the following are true, so it never runs by
 * accident and never reports a pass it did not earn:
 *
 *   DOCUMENT_PARSER_LIVE_TEST=true
 *   DOCLING_API_BASE_URL and DOCLING_API_KEY are set
 *
 * With the opt-in flag set but credentials missing, the test FAILS with an
 * explicit message rather than skipping — asking for a live test and getting a
 * silent skip is exactly how an unverified integration gets reported as verified.
 *
 * Run it with:
 *   DOCUMENT_PARSER_LIVE_TEST=true DOCLING_API_BASE_URL=... DOCLING_API_KEY=... \
 *     npx vitest run tests/ibm-docling-live.test.ts
 */

const OPTED_IN = process.env.DOCUMENT_PARSER_LIVE_TEST === "true";

/**
 * A valid born-digital PDF carrying a realistic amount of invoice text.
 *
 * Deliberately not a one-liner: the quality gate treats a page with almost no
 * extracted text as needing OCR, which is correct behaviour, so a near-empty
 * fixture would test the threshold rather than the "born-digital documents are
 * not pushed down an OCR path" property this file is here to check.
 */
function bornDigitalPdf(): Buffer {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  const lines = [
    "COMMERCIAL INVOICE INV-QBR-1",
    "Seller: Qubere Test Manufacturing GmbH, Hafenstrasse 14, 20457 Hamburg, Germany",
    "Buyer: Acme Imports LLC, 500 Harbor Boulevard, Newark, New Jersey 07102, USA",
    "Invoice Date: 2026-08-11    Purchase Order: PO-558231    Incoterm: FOB Hamburg",
    "Currency: USD    Country of Origin: Germany    Gross Weight: 1,240 kg",
    "Line 1  Stainless steel hydraulic valve 1/2 inch NPT  Qty 120  Unit 152.00  Total 18240.00",
    "Line 2  Electronic controller board assembly 24V      Qty  40  Unit 310.50  Total 12420.00",
    "Freight charges 1,450.00    Insurance 320.00    Invoice Total USD 32,430.00",
    "Bill of Lading MAEU558231    Container MSKU7754120    Vessel Northern Star Voyage 24E",
    "Port of Loading Hamburg    Port of Discharge Newark    Estimated Arrival 2026-09-02",
  ];

  // One Td per line, moving down the page; leading is applied via TL/T* so the
  // text objects land on distinct baselines rather than overprinting.
  const drawn = lines
    .map((line, index) => `BT /F1 11 Tf 54 ${720 - index * 22} Td (${line}) Tj ET`)
    .join("\n");
  const stream = `5 0 obj\n<< /Length ${drawn.length} >>\nstream\n${drawn}\nendstream\nendobj\n`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of [...objects, stream]) {
    offsets.push(body.length);
    body += object;
  }

  const xrefStart = body.length;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `${xref}trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

async function pollUntilTerminal(
  provider: InstanceType<typeof IbmHostedDoclingProvider>,
  reference: { runId: string; externalTaskId: string; correlationId: string },
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;
  let delay = 2_000;
  for (;;) {
    const status = await provider.getStatus(reference);
    if (status.state !== "POLLING") return status;
    if (Date.now() > deadline) {
      throw new Error(
        `IBM Docling did not finish within ${timeoutMs}ms (last provider status: ${status.providerStatus}).`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 15_000);
  }
}

describe("IBM hosted Docling: live integration", () => {
  it("refuses to be reported as passing when credentials are absent", () => {
    if (!OPTED_IN) {
      // Not opted in: nothing is claimed either way.
      expect(OPTED_IN).toBe(false);
      return;
    }
    // Opted in: a missing credential is a failure, not a skip.
    expect(
      isIbmDoclingConfigured(),
      "DOCUMENT_PARSER_LIVE_TEST=true was set but DOCLING_API_BASE_URL and/or DOCLING_API_KEY are missing. The live IBM integration was NOT exercised."
    ).toBe(true);
  });

  it.runIf(OPTED_IN && isIbmDoclingConfigured())(
    "converts a born-digital PDF end to end and reports what it actually observed",
    async () => {
      const provider = new IbmHostedDoclingProvider();
      const correlationId = `live_${Date.now()}`;

      const ack = await provider.submit({
        runId: "live_run",
        correlationId,
        profile: "STANDARD",
        source: {
          kind: "inline",
          filename: "live-invoice.pdf",
          mimeType: "application/pdf",
          bytes: bornDigitalPdf(),
        },
      });

      expect(ack.externalTaskId, "IBM must return a durable task id").toBeTruthy();

      const reference = {
        runId: "live_run",
        externalTaskId: ack.externalTaskId,
        correlationId,
      };
      const status = await pollUntilTerminal(provider, reference, 180_000);
      expect(status.state, `provider reported ${status.providerStatus}`).toBe("SUCCEEDED");

      const result = await provider.getResult(reference, "STANDARD");

      // Print exactly what the hosted deployment exposed. Any of these being null
      // is a real finding about the hosted contract, to be reported as such rather
      // than guessed at in documentation.
      console.log("[live] observed IBM Docling metadata", {
        parserName: result.normalized.metadata.parserName,
        parserVersion: result.normalized.metadata.parserVersion,
        ocrEngine: result.normalized.metadata.ocrEngine,
        ocrUsed: result.normalized.metadata.ocrUsed,
        // Genuinely emitted by this deployment, unlike the self-hosted contract.
        parserConfidence: result.normalized.metadata.parserConfidence,
        ocrConfidence: result.normalized.metadata.ocrConfidence,
        pageCount: result.normalized.metadata.pageCount,
        processingDurationMs: result.normalized.metadata.processingDurationMs,
        sectionCount: result.normalized.sections.length,
        tableCount: result.normalized.tables.length,
        warnings: result.normalized.warnings.map((w) => w.code),
      });

      // The service reports confidence, so it must be carried through rather
      // than reported as absent -- but only as far as it genuinely measured.
      expect(result.normalized.metadata.parserConfidence).toBeTypeOf("number");

      console.log(
        "[live] first section",
        JSON.stringify(result.normalized.sections[0], null, 2)?.slice(0, 600)
      );

      expect(result.normalized.contractVersion).toBe("qubere.parser/1");

      // The text is in the PDF's content stream, so a working parse must find
      // it. Heading text lands in headingPath rather than content -- Docling
      // labels a lone styled line as a heading -- so both are searched. Either
      // location proves the text was recovered; only its absence from both
      // would mean the parse missed it.
      const text = result.normalized.sections
        .map((s) => [...s.headingPath, s.content].join(" "))
        .join(" ");
      expect(text).toContain("INV-QBR-1");

      const quality = assessQuality({
        result: result.normalized,
        expectedPageCount: 1,
        isOcrRetry: false,
        usedFullPageOcr: false,
      });
      // A born-digital PDF must not be pushed down an OCR path under STANDARD.
      expect(quality.outcome, quality.reasons.join(" | ")).not.toBe("RETRY_WITH_OCR");
    },
    240_000
  );

  it.runIf(OPTED_IN && isIbmDoclingConfigured())(
    "returns the same normalisation when the result is fetched twice",
    async () => {
      const provider = new IbmHostedDoclingProvider();
      const correlationId = `live_dup_${Date.now()}`;
      const ack = await provider.submit({
        runId: "live_run_dup",
        correlationId,
        profile: "STANDARD",
        source: {
          kind: "inline",
          filename: "live-invoice.pdf",
          mimeType: "application/pdf",
          bytes: bornDigitalPdf(),
        },
      });

      const reference = { runId: "live_run_dup", externalTaskId: ack.externalTaskId, correlationId };
      await pollUntilTerminal(provider, reference, 180_000);

      const first = await provider.getResult(reference, "STANDARD");
      const second = await provider.getResult(reference, "STANDARD");
      // Duplicate result retrieval must be safe and produce identical evidence ids.
      expect(second.normalized.sections.map((s) => s.id)).toEqual(
        first.normalized.sections.map((s) => s.id)
      );
    },
    240_000
  );
});
