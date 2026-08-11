import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IbmHostedDoclingProvider } from "@/modules/documents/parser/ibm/ibmHostedDoclingProvider";
import { DocumentParserError } from "@/modules/documents/parser/contracts";
import { readIbmDoclingConfig } from "@/modules/documents/parser/config";

/**
 * IBM provider contract tests.
 *
 * The provider is exercised against a stubbed transport rather than the real
 * hosted API: these tests pin the mapping (what we send, what we make of what
 * comes back), which is the part that must not drift. They are NOT evidence that
 * the real endpoint behaves this way — that is what the opt-in live test in
 * `ibm-docling-live.test.ts` is for, and it is skipped without credentials.
 */

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let captured: Captured[] = [];

function stubFetch(handler: (call: Captured) => { status?: number; body?: unknown; text?: string }) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>)
    );
    const call: Captured = {
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    captured.push(call);

    const response = handler(call);
    const status = response.status ?? 200;
    const text = response.text ?? JSON.stringify(response.body ?? {});
    return new Response(text, {
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

const DOC_JSON = {
  schema_name: "DoclingDocument",
  version: "1.3.0",
  texts: [{ self_ref: "#/texts/0", label: "text", text: "Invoice No: INV-1", prov: [{ page_no: 1 }] }],
  tables: [],
  pages: { "1": { page_no: 1 } },
};

function submission(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run_1",
    correlationId: "corr_1",
    profile: "STANDARD" as const,
    source: {
      kind: "inline" as const,
      filename: "INV-1.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7 fake\n%%EOF"),
    },
    ...overrides,
  };
}

const REFERENCE = { runId: "run_1", externalTaskId: "task_abc", correlationId: "corr_1" };

beforeEach(() => {
  captured = [];
  process.env.DOCUMENT_PARSER_PROVIDER = "ibm-docling";
  process.env.DOCLING_API_BASE_URL = "https://docling.example.invalid/api";
  process.env.DOCLING_API_KEY = "test-secret-key";
  delete process.env.DOCLING_SOURCE_ENVELOPE;
  delete process.env.DOCLING_SOURCE_DELIVERY;
  delete process.env.DOCLING_AUTH_HEADER_NAME;
  delete process.env.DOCLING_AUTH_HEADER_SCHEME;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe("submission mapping", () => {
  it("posts to the configured submit path on the configured base URL", async () => {
    stubFetch(() => ({ body: { task_id: "task_abc", task_status: "pending" } }));
    await new IbmHostedDoclingProvider().submit(submission());

    expect(captured[0].method).toBe("POST");
    // Nothing is hard-coded from the supplied examples: the URL comes from config.
    expect(captured[0].url).toBe("https://docling.example.invalid/api/v1/convert/source/async");
  });

  it("sends the credential in the configured header and scheme", async () => {
    stubFetch(() => ({ body: { task_id: "t", task_status: "pending" } }));
    await new IbmHostedDoclingProvider().submit(submission());
    expect(captured[0].headers.Authorization).toBe("Bearer test-secret-key");
  });

  it("honours a deployment that wants a bare key in a custom header", async () => {
    process.env.DOCLING_AUTH_HEADER_NAME = "X-API-Key";
    process.env.DOCLING_AUTH_HEADER_SCHEME = "";
    stubFetch(() => ({ body: { task_id: "t", task_status: "pending" } }));
    await new IbmHostedDoclingProvider().submit(submission());
    expect(captured[0].headers["X-API-Key"]).toBe("test-secret-key");
    expect(captured[0].headers.Authorization).toBeUndefined();
  });

  it("forwards the correlation id so a run can be traced into provider logs", async () => {
    stubFetch(() => ({ body: { task_id: "t", task_status: "pending" } }));
    await new IbmHostedDoclingProvider().submit(submission());
    expect(captured[0].headers["X-Correlation-Id"]).toBe("corr_1");
  });

  it("delivers the document inline as base64, with no URL for the provider to fetch", async () => {
    stubFetch(() => ({ body: { task_id: "t", task_status: "pending" } }));
    await new IbmHostedDoclingProvider().submit(submission());

    const body = captured[0].body as { sources: Array<{ kind: string; base64_string: string }> };
    expect(body.sources[0].kind).toBe("file");
    expect(Buffer.from(body.sources[0].base64_string, "base64").toString()).toContain("%PDF");
    // Inline delivery has no SSRF surface at all: there is no URL in the request.
    expect(JSON.stringify(body)).not.toContain("http");
  });

  it("supports the alternative typed source envelope some deployments require", async () => {
    process.env.DOCLING_SOURCE_ENVELOPE = "typed";
    stubFetch(() => ({ body: { task_id: "t", task_status: "pending" } }));
    await new IbmHostedDoclingProvider().submit(submission());
    const body = captured[0].body as { file_sources?: unknown[]; sources?: unknown[] };
    expect(body.file_sources).toHaveLength(1);
    expect(body.sources).toBeUndefined();
  });

  it("asks for JSON and Markdown, and never for page images", async () => {
    stubFetch(() => ({ body: { task_id: "t", task_status: "pending" } }));
    await new IbmHostedDoclingProvider().submit(submission());
    const options = (captured[0].body as { options: Record<string, unknown> }).options;
    expect(options.to_formats).toEqual(["json", "md"]);
    expect(options.include_images).toBe(false);
    expect(options.do_table_structure).toBe(true);
  });

  it("maps STANDARD to OCR without forcing it, and FULL_PAGE_OCR to forcing it", async () => {
    stubFetch(() => ({ body: { task_id: "t", task_status: "pending" } }));
    const provider = new IbmHostedDoclingProvider();

    await provider.submit(submission());
    expect((captured[0].body as { options: { force_ocr: boolean } }).options.force_ocr).toBe(false);

    captured = [];
    await provider.submit(submission({ profile: "FULL_PAGE_OCR" }));
    expect((captured[0].body as { options: { force_ocr: boolean } }).options.force_ocr).toBe(true);
  });

  it("captures the external task id and reports what the provider cannot confirm", async () => {
    stubFetch(() => ({ body: { task_id: "task_abc", task_status: "pending" } }));
    const ack = await new IbmHostedDoclingProvider().submit(submission());

    expect(ack.externalTaskId).toBe("task_abc");
    expect(ack.state).toBe("SUBMITTED");
    // The hosted contract does not report OCR usage back, so the profile's
    // effect is explicitly unverifiable rather than assumed.
    expect(ack.unsupportedOptions).toContain("ocrUsed");
    expect(ack.unsupportedOptions).toContain("parserConfidence");
  });

  it("flags an OCR profile as requested-but-unconfirmed", async () => {
    stubFetch(() => ({ body: { task_id: "t", task_status: "pending" } }));
    const ack = await new IbmHostedDoclingProvider().submit(submission({ profile: "FULL_PAGE_OCR" }));
    expect(ack.unsupportedOptions).toContain("ocrRequestedButNotConfirmedByProvider");
  });

  it("fails when the provider accepts the submission but names no task", async () => {
    stubFetch(() => ({ body: { accepted: true } }));
    await expect(new IbmHostedDoclingProvider().submit(submission())).rejects.toMatchObject({
      code: "PARSER_SUBMISSION_FAILED",
      retryable: false,
    });
  });

  it("refuses to hand the provider a URL that is not Qubere storage", async () => {
    process.env.DOCLING_SOURCE_DELIVERY = "signed-url";
    stubFetch(() => ({ body: { task_id: "t" } }));
    await expect(
      new IbmHostedDoclingProvider().submit(
        submission({
          source: {
            kind: "signed-url",
            filename: "x.pdf",
            mimeType: "application/pdf",
            url: "https://attacker.example.com/internal",
            expiresAt: new Date(),
          },
        })
      )
    ).rejects.toMatchObject({ code: "UNTRUSTED_STORAGE_ORIGIN" });
    // The request was never sent.
    expect(captured).toHaveLength(0);
  });

  it("accepts an allowlisted Qubere storage URL in signed-url mode", async () => {
    process.env.DOCLING_SOURCE_DELIVERY = "signed-url";
    stubFetch(() => ({ body: { task_id: "t", task_status: "pending" } }));
    await new IbmHostedDoclingProvider().submit(
      submission({
        source: {
          kind: "signed-url",
          filename: "x.pdf",
          mimeType: "application/pdf",
          url: "https://store.public.blob.vercel-storage.com/documents/x.pdf",
          expiresAt: new Date(),
        },
      })
    );
    const body = captured[0].body as { sources: Array<{ kind: string; url: string }> };
    expect(body.sources[0].kind).toBe("http");
  });
});

describe("multipart submission (/convert/file endpoints)", () => {
  /** A full endpoint URL as an IBM console hands it out, instance id and all. */
  const IBM_CONSOLE_URL =
    "https://api.aws-c1.dcls.saas.ibm.com/20260811-0343-1366-403f-b83be199fb33/v1/convert/file/async";

  beforeEach(() => {
    process.env.DOCLING_API_BASE_URL = IBM_CONSOLE_URL;
    delete process.env.DOCLING_SUBMIT_PATH;
    delete process.env.DOCLING_SUBMIT_ENCODING;
  });

  it("splits a full endpoint URL into base and submit path", () => {
    const config = readIbmDoclingConfig();
    expect(config.baseUrl).toBe(
      "https://api.aws-c1.dcls.saas.ibm.com/20260811-0343-1366-403f-b83be199fb33"
    );
    expect(config.submitPath).toBe("/v1/convert/file/async");
  });

  it("resolves status and result against the same instance prefix", async () => {
    stubFetch(() => ({ body: { task_id: "task_abc", task_status: "pending" } }));
    await new IbmHostedDoclingProvider().getStatus(REFERENCE);
    expect(captured[0].url).toBe(
      "https://api.aws-c1.dcls.saas.ibm.com/20260811-0343-1366-403f-b83be199fb33/v1/status/poll/task_abc"
    );
  });

  it("infers multipart encoding from a /convert/file path", () => {
    expect(readIbmDoclingConfig().submitEncoding).toBe("multipart");
  });

  it("infers JSON encoding from a /convert/source path", () => {
    process.env.DOCLING_API_BASE_URL = "https://docling.example.invalid/v1/convert/source/async";
    expect(readIbmDoclingConfig().submitEncoding).toBe("json");
  });

  it("sends the document as a multipart upload, not a JSON body", async () => {
    let contentType: string | undefined;
    let form: FormData | undefined;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === "string" ? input : input.toString(),
        method: init?.method ?? "GET",
        headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
        body: undefined,
      });
      contentType = (init?.headers as Record<string, string> | undefined)?.["Content-Type"];
      form = init?.body as FormData;
      return new Response(JSON.stringify({ task_id: "t", task_status: "pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    await new IbmHostedDoclingProvider().submit(submission());

    expect(form).toBeInstanceOf(FormData);
    // Never set by hand: fetch has to add the multipart boundary itself.
    expect(contentType).toBeUndefined();
    expect(captured[0].url).toContain("/v1/convert/file/async");
  });

  it("puts the file and every conversion option in the form", async () => {
    let form: FormData | undefined;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      form = init?.body as FormData;
      return new Response(JSON.stringify({ task_id: "t", task_status: "pending" }), { status: 200 });
    }) as typeof globalThis.fetch;

    await new IbmHostedDoclingProvider().submit(submission({ profile: "FULL_PAGE_OCR" }));

    // A list-valued option is repeated once per value.
    expect(form?.getAll("to_formats")).toEqual(["json", "md"]);
    expect(form?.get("do_ocr")).toBe("true");
    expect(form?.get("force_ocr")).toBe("true");
    expect(form?.get("do_table_structure")).toBe("true");
    expect(form?.get("include_images")).toBe("false");

    const file = form?.get("files");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("INV-1.pdf");
    expect(await (file as Blob).text()).toContain("%PDF");
  });

  it("refuses signed-url delivery against a multipart endpoint, with a fix in the message", async () => {
    process.env.DOCLING_SOURCE_DELIVERY = "signed-url";
    const error = await new IbmHostedDoclingProvider()
      .submit(
        submission({
          source: {
            kind: "signed-url",
            filename: "x.pdf",
            mimeType: "application/pdf",
            url: "https://store.public.blob.vercel-storage.com/x.pdf",
            expiresAt: new Date(),
          },
        })
      )
      .catch((e) => e);
    expect((error as DocumentParserError).code).toBe("PARSER_SUBMISSION_FAILED");
    expect((error as Error).message).toContain("DOCLING_SOURCE_DELIVERY=inline");
  });

  it("lets an explicit override beat the inferred encoding", () => {
    process.env.DOCLING_SUBMIT_ENCODING = "json";
    expect(readIbmDoclingConfig().submitEncoding).toBe("json");
  });
});

describe("status translation", () => {
  it("keeps polling while the provider reports work in progress", async () => {
    for (const providerStatus of ["pending", "started", "running", "queued"]) {
      stubFetch(() => ({ body: { task_id: "task_abc", task_status: providerStatus } }));
      const status = await new IbmHostedDoclingProvider().getStatus(REFERENCE);
      expect(status.state, providerStatus).toBe("POLLING");
      expect(status.providerStatus).toBe(providerStatus);
    }
  });

  it("reads the status from the configured template with the task id substituted", async () => {
    stubFetch(() => ({ body: { task_id: "task_abc", task_status: "pending" } }));
    await new IbmHostedDoclingProvider().getStatus(REFERENCE);
    expect(captured[0].url).toBe("https://docling.example.invalid/api/v1/status/poll/task_abc");
    expect(captured[0].method).toBe("GET");
  });

  it("treats a provider-side conversion failure as non-retryable", async () => {
    stubFetch(() => ({ body: { task_id: "task_abc", task_status: "failure" } }));
    const status = await new IbmHostedDoclingProvider().getStatus(REFERENCE);
    expect(status.state).toBe("FAILED");
    // Resubmitting the same bytes with the same options will fail the same way.
    expect(status.error?.retryable).toBe(false);
    expect(status.error?.code).toBe("PARSER_PROVIDER_ERROR");
  });

  it("keeps polling an unrecognised status rather than guessing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(() => ({ body: { task_id: "task_abc", task_status: "rehydrating" } }));
    const status = await new IbmHostedDoclingProvider().getStatus(REFERENCE);
    expect(status.state).toBe("POLLING");
    // Surfaced, so an unfamiliar vocabulary does not silently extend every run.
    expect(warn).toHaveBeenCalled();
  });

  it("reports success so the result may be fetched", async () => {
    stubFetch(() => ({ body: { task_id: "task_abc", task_status: "success" } }));
    expect((await new IbmHostedDoclingProvider().getStatus(REFERENCE)).state).toBe("SUCCEEDED");
  });

  it("rejects an unrecognisable status payload", async () => {
    stubFetch(() => ({ body: { nothing: "useful" } }));
    await expect(new IbmHostedDoclingProvider().getStatus(REFERENCE)).rejects.toMatchObject({
      code: "PARSER_RESULT_INVALID",
    });
  });
});

describe("result retrieval", () => {
  it("fetches the configured result path and normalises the payload", async () => {
    stubFetch(() => ({
      body: {
        status: "success",
        document: { md_content: "# Invoice", json_content: DOC_JSON },
        processing_time: 1.5,
      },
    }));

    const result = await new IbmHostedDoclingProvider().getResult(REFERENCE, "STANDARD");
    expect(captured[0].url).toBe("https://docling.example.invalid/api/v1/result/task_abc");
    expect(result.normalized.contractVersion).toBe("qubere.parser/1");
    expect(result.normalized.sections[0].content).toContain("INV-1");
    expect(result.normalized.metadata.processingDurationMs).toBe(1500);
  });

  it("rejects a malformed provider result without retrying it", async () => {
    stubFetch(() => ({ body: { status: "success", document: { md_content: null, json_content: null } } }));
    await expect(
      new IbmHostedDoclingProvider().getResult(REFERENCE, "STANDARD")
    ).rejects.toMatchObject({ code: "PARSER_RESULT_INCOMPLETE" });
  });

  it("rejects a non-JSON response", async () => {
    stubFetch(() => ({ text: "<html>gateway error</html>" }));
    await expect(
      new IbmHostedDoclingProvider().getResult(REFERENCE, "STANDARD")
    ).rejects.toMatchObject({ code: "PARSER_RESULT_INVALID", retryable: false });
  });

  it("is safe to call twice: retrieval is a read and carries no state", async () => {
    stubFetch(() => ({
      body: { status: "success", document: { md_content: "# x", json_content: DOC_JSON } },
    }));
    const provider = new IbmHostedDoclingProvider();
    const first = await provider.getResult(REFERENCE, "STANDARD");
    const second = await provider.getResult(REFERENCE, "STANDARD");
    // Identical normalisation, including ids, so duplicate completion handling
    // cannot produce two different sets of evidence references.
    expect(second.normalized.sections.map((s) => s.id)).toEqual(
      first.normalized.sections.map((s) => s.id)
    );
  });
});

describe("transport failures", () => {
  it("classifies a transient upstream error as retryable", async () => {
    for (const status of [429, 500, 502, 503]) {
      stubFetch(() => ({ status, body: { error: "later" } }));
      const error = await new IbmHostedDoclingProvider().submit(submission()).catch((e) => e);
      expect(error, String(status)).toBeInstanceOf(DocumentParserError);
      expect((error as DocumentParserError).retryable, String(status)).toBe(true);
    }
  });

  it("classifies a rejected credential as a configuration problem, not a retry", async () => {
    for (const status of [401, 403]) {
      stubFetch(() => ({ status, body: { error: "nope" } }));
      const error = await new IbmHostedDoclingProvider().submit(submission()).catch((e) => e);
      expect((error as DocumentParserError).code).toBe("PARSER_NOT_CONFIGURED");
      expect((error as DocumentParserError).retryable).toBe(false);
    }
  });

  it("classifies a gateway timeout as a parser timeout", async () => {
    stubFetch(() => ({ status: 504, body: {} }));
    const error = await new IbmHostedDoclingProvider().submit(submission()).catch((e) => e);
    expect((error as DocumentParserError).code).toBe("PARSER_TIMEOUT");
    expect((error as DocumentParserError).retryable).toBe(true);
  });

  it("never puts the provider's response body in the error message", async () => {
    // A provider echoing document content into an error must not turn that
    // content into a persisted, user-visible string.
    stubFetch(() => ({ status: 500, body: { detail: "Shipper: ACME GmbH, invoice INV-1" } }));
    const error = await new IbmHostedDoclingProvider().submit(submission()).catch((e) => e);
    expect((error as Error).message).not.toContain("ACME");
    expect((error as Error).message).not.toContain("INV-1");
  });

  it("never puts the credential in an error message", async () => {
    stubFetch(() => ({ status: 500, body: {} }));
    const error = await new IbmHostedDoclingProvider().submit(submission()).catch((e) => e);
    expect((error as Error).message).not.toContain("test-secret-key");
  });

  it("times out a request that never responds", async () => {
    process.env.DOCUMENT_PARSER_REQUEST_TIMEOUT_MS = "1000";
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      // Resolve only when the provider's own AbortController fires.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as typeof globalThis.fetch;

    const error = await new IbmHostedDoclingProvider().submit(submission()).catch((e) => e);
    expect((error as DocumentParserError).code).toBe("PARSER_TIMEOUT");
    expect((error as DocumentParserError).retryable).toBe(true);
  }, 15_000);

  it("classifies an unreachable host as retryable", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const error = await new IbmHostedDoclingProvider().submit(submission()).catch((e) => e);
    expect((error as DocumentParserError).code).toBe("PARSER_PROVIDER_ERROR");
    expect((error as DocumentParserError).retryable).toBe(true);
  });
});

describe("provider identity and configuration hash", () => {
  it("declares itself as the IBM provider and not a mock", () => {
    const provider = new IbmHostedDoclingProvider();
    expect(provider.providerId).toBe("IBM_DOCLING");
    expect(provider.isMockProvider()).toBe(false);
  });

  it("hashes configuration per profile, so a profile change is a new run", () => {
    const provider = new IbmHostedDoclingProvider();
    expect(provider.configurationHash("STANDARD")).not.toBe(
      provider.configurationHash("FULL_PAGE_OCR")
    );
  });

  it("changes the hash when the endpoint changes", () => {
    const before = new IbmHostedDoclingProvider().configurationHash("STANDARD");
    process.env.DOCLING_API_BASE_URL = "https://docling-2.example.invalid";
    const after = new IbmHostedDoclingProvider(readIbmDoclingConfig()).configurationHash("STANDARD");
    expect(after).not.toBe(before);
  });

  it("does not change the hash when only the credential rotates", () => {
    // Rotating a key does not change the parse, and hashing a secret into a
    // stored column would be a needless exposure.
    const before = new IbmHostedDoclingProvider().configurationHash("STANDARD");
    process.env.DOCLING_API_KEY = "a-completely-different-key";
    const after = new IbmHostedDoclingProvider(readIbmDoclingConfig()).configurationHash("STANDARD");
    expect(after).toBe(before);
  });
});
