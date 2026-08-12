import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AccountContext } from "@/lib/auth";
import type {
  CopilotModelClient,
  CopilotModelContent,
  CopilotPlanRequest,
  CopilotPlanResult,
  CopilotComposeRequest,
  CopilotTokenUsage,
} from "@/modules/copilot/copilotModel";

/**
 * Orchestration: the tool loop, the two-phase split, and every failure path.
 *
 * The model is a stub, which is what makes these tests worth having — they pin
 * the behaviour of the code around the model, including the parts that exist to
 * survive a model behaving badly: inventing a tool, citing a record it never
 * retrieved, returning prose instead of JSON, looping, or not answering at all.
 */

const dbMock = {
  product: { findFirst: vi.fn() },
  productEvidence: { findMany: vi.fn(), count: vi.fn() },
  party: { findFirst: vi.fn() },
  shipment: { findFirst: vi.fn() },
  shipmentDocument: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  agentDecision: { findMany: vi.fn() },
  // The usage meter writes through raw SQL. Present here so a turn's token
  // accounting runs for real against the mock rather than falling into
  // recordAiTokens' fail-open path, which would hide a wiring mistake.
  $executeRaw: vi.fn().mockResolvedValue(1),
  $queryRaw: vi.fn().mockResolvedValue([]),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const createAuditLog = vi.fn();
vi.mock("@/lib/audit", () => ({ createAuditLog }));

const { askCopilot } = await import("@/modules/copilot/copilotService");
const { COPILOT_LIMITS, copilotEnabled } = await import("@/modules/copilot/copilotConfig");
const { COPILOT_AUDIT_ACTIONS } = await import("@/modules/copilot/copilotAudit");
const { CopilotModelError } = await import("@/modules/copilot/copilotModel");
const { GLOBAL_PAGE_CONTEXT, copilotAnswerSchema } = await import(
  "@/modules/copilot/copilotContract"
);

const ACCOUNT = "acct_alpha";

function accountContext(overrides: Partial<AccountContext> = {}): AccountContext {
  return {
    userId: "user_1",
    clerkUserId: "clerk_1",
    email: "broker@example.com",
    isPlatformAdmin: false,
    platformRoles: [],
    accountId: ACCOUNT,
    accountName: "Alpha Customs",
    accountSlug: "alpha",
    accountType: "BROKER",
    dataMode: "LIVE",
    membershipId: "mem_1",
    roleIds: ["role_1"],
    roleNames: ["MEMBER"],
    permissions: [],
    memberships: [],
    ...overrides,
  } as unknown as AccountContext;
}

/** A plan a test wants the model to return. Usage is optional: absent means the
 *  provider reported nothing, which the orchestrator must keep as null. */
type StubPlan = Omit<CopilotPlanResult, "usage"> & { usage?: CopilotTokenUsage | null };

interface StubBehaviour {
  plans?: StubPlan[];
  answer?: unknown;
  composeRaw?: string;
  composeError?: Error;
  planError?: Error;
  composeUsage?: CopilotTokenUsage | null;
}

interface Stub extends CopilotModelClient {
  planCalls: CopilotPlanRequest[];
  composeCalls: CopilotComposeRequest[];
}

/** A model that says exactly what a test needs it to say, and records what it saw. */
function stubModel(behaviour: StubBehaviour): Stub {
  const planCalls: CopilotPlanRequest[] = [];
  const composeCalls: CopilotComposeRequest[] = [];
  let round = 0;

  return {
    provider: "stub",
    model: "stub-1",
    planCalls,
    composeCalls,
    async plan(request) {
      planCalls.push({ ...request, contents: request.contents.map((item) => ({ ...item })) });
      if (behaviour.planError) throw behaviour.planError;
      // One plan per round, then nothing more to ask for.
      const plan = behaviour.plans?.[round] ?? { toolCalls: [], text: "" };
      round += 1;
      return { ...plan, usage: plan.usage ?? null };
    },
    async compose(request) {
      composeCalls.push(request);
      if (behaviour.composeError) throw behaviour.composeError;
      const usage = behaviour.composeUsage ?? null;
      if (behaviour.composeRaw !== undefined) return { text: behaviour.composeRaw, usage };
      return {
        text: JSON.stringify(
          behaviour.answer ?? {
            status: "ANSWERED",
            answer: "Nothing to report.",
            entities: [],
            evidence: [],
            suggestedActions: [],
            warnings: [],
          }
        ),
        usage,
      };
    },
  };
}

function ask(model: CopilotModelClient, request: Partial<Parameters<typeof askCopilot>[0]["request"]> = {}) {
  return askCopilot({
    accountId: ACCOUNT,
    userId: "user_1",
    context: accountContext(),
    model,
    now: new Date("2026-08-12T09:00:00.000Z"),
    request: {
      question: "What is the status of shipment SHP-0001?",
      context: GLOBAL_PAGE_CONTEXT,
      history: [],
      ...request,
    },
  });
}

function auditActions(): string[] {
  return createAuditLog.mock.calls.map((call) => String(call[0].action));
}

function documentRow() {
  return {
    id: "doc_1",
    fileName: "invoice-4471.pdf",
    docType: "Commercial Invoice",
    status: "Received",
    confidence: 0.9,
    pageCount: 1,
    source: "EMAIL",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    shipmentId: null,
    shipment: null,
    extractionFields: [
      { fieldName: "exporterName", value: "Acme GmbH", confidence: 0.9, pageNumber: 1, source: "X" },
    ],
    exceptionItems: [],
  };
}

let logLines: string[] = [];
let logSpy: { mockRestore: () => void };

beforeEach(() => {
  vi.clearAllMocks();
  createAuditLog.mockResolvedValue(undefined);
  dbMock.$executeRaw.mockResolvedValue(1);
  dbMock.$queryRaw.mockResolvedValue([]);
  logLines = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  vi.useRealTimers();
});

function events(): { event: string; reason?: string; status?: string }[] {
  return logLines.map((line) => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// A normal turn
// ---------------------------------------------------------------------------

describe("a retrieved answer", () => {
  it("runs the requested tool, grounds the citation and audits the turn", async () => {
    dbMock.shipmentDocument.findFirst.mockResolvedValue(documentRow());
    const model = stubModel({
      plans: [{ toolCalls: [{ id: "c1", name: "getDocument", args: { documentId: "doc_1" } }], text: "" }],
      answer: {
        status: "ANSWERED",
        answer: "invoice-4471.pdf was received and names Acme GmbH as exporter.",
        entities: [{ type: "DOCUMENT", id: "doc_1", label: "invoice-4471.pdf" }],
        evidence: [],
        suggestedActions: [{ type: "OPEN_DOCUMENT", entityId: "doc_1", label: "Open document" }],
        warnings: [],
      },
    });

    const answer = await ask(model);

    expect(() => copilotAnswerSchema.parse(answer)).not.toThrow();
    expect(answer.status).toBe("ANSWERED");
    expect(answer.entities).toEqual([
      { type: "DOCUMENT", id: "doc_1", label: "invoice-4471.pdf" },
    ]);
    expect(answer.suggestedActions[0].href).toBe("/app/documents?documentId=doc_1");
    expect(answer.steps).toEqual(["Reading document"]);
    expect(answer.requestId).toMatch(/^[0-9a-f-]{36}$/);

    expect(auditActions()).toEqual([
      COPILOT_AUDIT_ACTIONS.conversationStarted,
      COPILOT_AUDIT_ACTIONS.toolExecuted,
      COPILOT_AUDIT_ACTIONS.query,
    ]);
    expect(events().map((entry) => entry.event)).toEqual([
      "copilot.started",
      "copilot.tool_called",
      "copilot.tool_completed",
      "copilot.answer_completed",
    ]);
  });

  it("records the question but neither the answer prose nor the tool arguments", async () => {
    dbMock.shipmentDocument.findFirst.mockResolvedValue(documentRow());
    const model = stubModel({
      plans: [{ toolCalls: [{ id: "c1", name: "getDocument", args: { documentId: "doc_1" } }], text: "" }],
      answer: {
        status: "ANSWERED",
        answer: "The exporter on that invoice is Acme GmbH.",
        entities: [],
        evidence: [],
        suggestedActions: [],
        warnings: [],
      },
    });

    await ask(model, { question: "Who is the exporter on invoice 4471?" });

    const query = createAuditLog.mock.calls
      .map((call) => call[0])
      .find((entry) => entry.action === COPILOT_AUDIT_ACTIONS.query);

    expect(query.metadata.question).toBe("Who is the exporter on invoice 4471?");
    const serialized = JSON.stringify(createAuditLog.mock.calls);
    expect(serialized).not.toContain("The exporter on that invoice");
    expect(serialized).not.toContain("doc_1");
    // Nor the prompt.
    expect(serialized).not.toContain("You are the Qubere AI Copilot");
  });

  it("does not start a second conversation record on a follow-up turn", async () => {
    const model = stubModel({});

    await ask(model, {
      history: [
        { role: "user", content: "What is open on SHP-0001?" },
        { role: "assistant", content: "Two exceptions are open." },
      ],
    });

    expect(auditActions()).not.toContain(COPILOT_AUDIT_ACTIONS.conversationStarted);
    expect(auditActions()).toContain(COPILOT_AUDIT_ACTIONS.query);
  });
});

// ---------------------------------------------------------------------------
// No hidden chain-of-thought
// ---------------------------------------------------------------------------

describe("the retrieval phase's prose does not survive the turn", () => {
  const REASONING =
    "Let me think. The user probably means the German shipment, so I will guess the origin is Germany.";

  it("is not returned, not audited, and not replayed to the model", async () => {
    dbMock.shipmentDocument.findFirst.mockResolvedValue(documentRow());
    const model = stubModel({
      plans: [
        {
          toolCalls: [{ id: "c1", name: "getDocument", args: { documentId: "doc_1" } }],
          text: REASONING,
        },
        { toolCalls: [], text: REASONING },
      ],
      answer: {
        status: "ANSWERED",
        answer: "invoice-4471.pdf was received on 1 August 2026.",
        entities: [],
        evidence: [],
        suggestedActions: [],
        warnings: [],
      },
    });

    const answer = await ask(model);

    expect(JSON.stringify(answer)).not.toContain("Let me think");
    expect(JSON.stringify(createAuditLog.mock.calls)).not.toContain("Let me think");
    expect(JSON.stringify(events())).not.toContain("Let me think");

    // Nor does it reach the composition phase: only the calls and their results
    // continue into the transcript.
    const composed = model.composeCalls[0].contents;
    expect(JSON.stringify(composed)).not.toContain("Let me think");
    expect(composed.map((item) => item.role)).toEqual([
      "user",
      "toolCalls",
      "toolResults",
      "user",
    ]);
  });

  it("carries only neutral progress labels into the answer", async () => {
    dbMock.shipmentDocument.findFirst.mockResolvedValue(documentRow());
    dbMock.agentDecision.findMany.mockResolvedValue([]);
    const model = stubModel({
      plans: [
        {
          toolCalls: [
            { id: "c1", name: "getDocument", args: { documentId: "doc_1" } },
            { id: "c2", name: "listDecisions", args: {} },
          ],
          text: REASONING,
        },
      ],
    });

    const answer = await ask(model);

    expect(answer.steps).toEqual(["Reading document", "Reading agent decisions"]);
  });
});

// ---------------------------------------------------------------------------
// Page context
// ---------------------------------------------------------------------------

describe("page context is a hint, resolved server-side", () => {
  const context = {
    page: "PRODUCT_DETAIL" as const,
    entityType: "PRODUCT" as const,
    entityId: "prod_1",
    label: "Client-supplied label",
  };

  it("tells the model the label the database holds, not the one the browser sent", async () => {
    dbMock.product.findFirst.mockResolvedValue({
      productName: "Industrial Widget",
      internalSku: "WID-1",
    });
    const model = stubModel({});

    await ask(model, { context });

    expect(dbMock.product.findFirst.mock.calls[0][0].where).toEqual({
      id: "prod_1",
      accountId: ACCOUNT,
      deletedAt: null,
    });

    const prompt = model.planCalls[0].systemPrompt;
    expect(prompt).toContain('The user is viewing the Global Product Master record for "Industrial Widget"');
    expect(prompt).not.toContain("Client-supplied label");
    expect(prompt).toContain("It grants no access");
  });

  it("drops a context that does not resolve in this account, and answers globally", async () => {
    // A product id from another tenant: the scoped read simply misses.
    dbMock.product.findFirst.mockResolvedValue(null);
    const model = stubModel({});

    const answer = await ask(model, {
      context: { ...context, entityId: "prod_from_another_account" },
    });

    const prompt = model.planCalls[0].systemPrompt;
    expect(prompt).toContain("The user is not on a record detail page");
    expect(prompt).not.toContain("prod_from_another_account");
    // The turn still answers; it is not an authorization error to be reported.
    expect(answer.status).toBe("ANSWERED");

    const started = createAuditLog.mock.calls
      .map((call) => call[0])
      .find((entry) => entry.action === COPILOT_AUDIT_ACTIONS.conversationStarted);
    expect(started.metadata.resolvedEntityId).toBeNull();
  });

  it("drops a context whose read fails rather than failing the question", async () => {
    dbMock.product.findFirst.mockRejectedValue(new Error("connection reset"));
    const model = stubModel({});

    const answer = await ask(model, { context });

    expect(answer.status).toBe("ANSWERED");
    expect(model.planCalls[0].systemPrompt).toContain("The user is not on a record detail page");
  });

  it("sends nothing resembling page state — only a type, an id and the date", async () => {
    dbMock.product.findFirst.mockResolvedValue({ productName: "Industrial Widget", internalSku: null });
    const model = stubModel({});

    await ask(model, { context });

    const prompt = model.planCalls[0].systemPrompt;
    expect(prompt).toContain("Today's date is 2026-08-12");
    expect(prompt).not.toContain("<div");
    expect(prompt).not.toContain("window.");
  });
});

// ---------------------------------------------------------------------------
// Conversation context
// ---------------------------------------------------------------------------

describe("conversation history is bounded", () => {
  it("replays at most the configured number of turns, each truncated", async () => {
    const history = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `turn ${index} ${"z".repeat(3000)}`,
    }));
    const model = stubModel({});

    await ask(model, { history });

    const sent = model.planCalls[0].contents;
    // The bounded history plus the question itself.
    expect(sent).toHaveLength(COPILOT_LIMITS.maxHistoryTurns + 1);
    for (const item of sent.slice(0, -1)) {
      const text = (item as Extract<CopilotModelContent, { role: "user" }>).text;
      expect(text.length).toBeLessThanOrEqual(COPILOT_LIMITS.maxHistoryTurnChars);
    }
    // The most recent turns are the ones kept.
    expect(JSON.stringify(sent)).toContain("turn 29");
    expect(JSON.stringify(sent)).not.toContain("turn 0 ");
  });

  it("replays assistant turns as plain text with no tool results attached", async () => {
    const model = stubModel({});

    await ask(model, {
      history: [{ role: "assistant", content: "Two exceptions are open on SHP-0001." }],
    });

    const sent = model.planCalls[0].contents;
    expect(sent[0]).toEqual({ role: "assistant", text: "Two exceptions are open on SHP-0001." });
  });
});

// ---------------------------------------------------------------------------
// Budget and loop control
// ---------------------------------------------------------------------------

describe("the tool loop is bounded", () => {
  it("stops at the iteration cap and says the answer may be incomplete", async () => {
    dbMock.agentDecision.findMany.mockResolvedValue([]);
    // A model that asks for one more lookup every round, forever.
    let round = 0;
    const model = stubModel({});
    model.plan = async () => {
      round += 1;
      return {
        toolCalls: [{ id: `c${round}`, name: "listDecisions", args: { agentName: `agent_${round}` } }],
        text: "",
        usage: null,
      };
    };

    const answer = await ask(model);

    expect(round).toBe(COPILOT_LIMITS.maxToolIterations);
    expect(answer.status).toBe("ANSWERED");
    expect(answer.warnings.join(" ")).toContain("lookup limit");
  });

  it("refuses a tool the model invented and keeps going", async () => {
    const model = stubModel({
      plans: [
        {
          toolCalls: [{ id: "c1", name: "executeSql", args: { sql: "select * from products" } }],
          text: "",
        },
        { toolCalls: [], text: "" },
      ],
      answer: {
        status: "INSUFFICIENT_DATA",
        answer: "I could not retrieve that.",
        entities: [],
        evidence: [],
        suggestedActions: [],
        warnings: [],
      },
    });

    const answer = await ask(model);

    expect(answer.status).toBe("INSUFFICIENT_DATA");
    // The refusal is what the model is told, in place of any result.
    const toolResults = model.composeCalls[0].contents.find(
      (item): item is Extract<CopilotModelContent, { role: "toolResults" }> =>
        item.role === "toolResults"
    );
    const error = toolResults?.results[0].payload.error as { code: string; message: string };
    expect(error.code).toBe("INVALID_ARGUMENTS");
    expect(error.message).toContain('There is no tool named "executeSql"');

    const toolAudit = createAuditLog.mock.calls
      .map((call) => call[0])
      .find((entry) => entry.action === COPILOT_AUDIT_ACTIONS.toolExecuted);
    expect(toolAudit.metadata.tool).toBe("executeSql");
    expect(toolAudit.success).toBe(false);
    // The rejected SQL is not written to the audit trail either.
    expect(JSON.stringify(toolAudit)).not.toContain("select *");
  });

  it("does not audit a cached repeat as a second read", async () => {
    dbMock.shipmentDocument.findFirst.mockResolvedValue(documentRow());
    const model = stubModel({
      plans: [
        {
          toolCalls: [
            { id: "c1", name: "getDocument", args: { documentId: "doc_1" } },
            { id: "c2", name: "getDocument", args: { documentId: "doc_1" } },
          ],
          text: "",
        },
      ],
    });

    await ask(model);

    const toolAudits = auditActions().filter((a) => a === COPILOT_AUDIT_ACTIONS.toolExecuted);
    expect(toolAudits).toHaveLength(1);
    expect(dbMock.shipmentDocument.findFirst).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Grounding through the service
// ---------------------------------------------------------------------------

describe("an answer citing what was never retrieved is corrected", () => {
  it("drops the citation, warns, and still shows the prose", async () => {
    const model = stubModel({
      plans: [{ toolCalls: [], text: "" }],
      answer: {
        status: "ANSWERED",
        answer: "Product WID-9 is classified under 8471.30.",
        entities: [{ type: "PRODUCT", id: "prod_never_retrieved", label: "WID-9" }],
        evidence: [{ evidenceId: "ev_invented", label: "Classification ruling", detail: null }],
        suggestedActions: [
          { type: "OPEN_PRODUCT", entityId: "prod_never_retrieved", label: "Open product" },
        ],
        warnings: [],
      },
    });

    const answer = await ask(model);

    expect(answer.entities).toEqual([]);
    expect(answer.evidence).toEqual([]);
    expect(answer.suggestedActions).toEqual([]);
    expect(answer.warnings).toHaveLength(2);
    expect(answer.answer).toContain("Product WID-9");

    const query = createAuditLog.mock.calls
      .map((call) => call[0])
      .find((entry) => entry.action === COPILOT_AUDIT_ACTIONS.query);
    expect(query.metadata.droppedCitations).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

describe("every failure path returns a valid, honest answer", () => {
  it("reports an unparseable answer as an error rather than showing it", async () => {
    const model = stubModel({
      composeRaw: "Sure! Here's what I found: the origin is probably Germany.",
    });

    const answer = await ask(model);

    expect(() => copilotAnswerSchema.parse(answer)).not.toThrow();
    expect(answer.status).toBe("ERROR");
    expect(answer.answer).toContain("could not produce a valid answer");
    // Unvalidated model output is not rendered in any form.
    expect(answer.answer).not.toContain("Germany");

    expect(auditActions()).toContain(COPILOT_AUDIT_ACTIONS.error);
    expect(events().find((entry) => entry.event === "copilot.failed")?.reason).toBe(
      "invalid_answer_schema"
    );
  });

  it("rejects an answer whose status is not one Qubere defined", async () => {
    const model = stubModel({
      answer: { status: "PROBABLY", answer: "Maybe.", entities: [], evidence: [], suggestedActions: [], warnings: [] },
    });

    const answer = await ask(model);

    expect(answer.status).toBe("ERROR");
  });

  it("reports a provider outage without blaming the user's data", async () => {
    const model = stubModel({ composeError: new CopilotModelError("upstream 503") });

    const answer = await ask(model);

    expect(answer.status).toBe("ERROR");
    expect(answer.answer).toContain("underlying Qubere screens are unaffected");
    expect(answer.answer).not.toContain("503");
    expect(events().find((entry) => entry.event === "copilot.failed")?.reason).toBe(
      "model_unavailable"
    );
  });

  it("reports an orchestration failure without leaking the exception", async () => {
    const model = stubModel({ planError: new Error("TypeError: cannot read property of undefined") });

    const answer = await ask(model);

    expect(answer.status).toBe("ERROR");
    expect(JSON.stringify(answer)).not.toContain("TypeError");
    expect(events().find((entry) => entry.event === "copilot.failed")?.reason).toBe(
      "orchestration_failure"
    );
  });

  it("stops a turn that exceeds the deadline and suggests a narrower question", async () => {
    vi.useFakeTimers();
    const model = stubModel({});
    model.plan = (request) =>
      new Promise((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });

    const pending = ask(model);
    await vi.advanceTimersByTimeAsync(COPILOT_LIMITS.requestTimeoutMs + 10);
    const answer = await pending;

    expect(answer.status).toBe("ERROR");
    expect(answer.answer).toContain("took too long");
    expect(events().find((entry) => entry.event === "copilot.failed")?.reason).toBe("timeout");
  });

  it("says so plainly when no provider is configured, instead of faking an answer", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("COPILOT_MODEL", "");

    const answer = await askCopilot({
      accountId: ACCOUNT,
      userId: "user_1",
      context: accountContext(),
      request: { question: "Anything?", context: GLOBAL_PAGE_CONTEXT, history: [] },
    });

    expect(answer.status).toBe("ERROR");
    expect(answer.answer).toContain("not configured on this environment yet");
    expect(answer.answer).toContain("available directly in Products");
    expect(events().find((entry) => entry.event === "copilot.failed")?.reason).toBe(
      "not_configured"
    );
    expect(auditActions()).toEqual([COPILOT_AUDIT_ACTIONS.error]);

    vi.unstubAllEnvs();
  });

  it("refuses to answer at all when the deployment has the Copilot switched off", async () => {
    vi.stubEnv("GEMINI_API_KEY", "key-is-present");
    vi.stubEnv("COPILOT_ENABLED", "false");

    const answer = await askCopilot({
      accountId: ACCOUNT,
      userId: "user_1",
      context: accountContext(),
      request: { question: "Anything?", context: GLOBAL_PAGE_CONTEXT, history: [] },
    });

    expect(answer.status).toBe("ERROR");
    expect(answer.answer).toContain("switched off for this environment");
    expect(events().find((entry) => entry.event === "copilot.failed")?.reason).toBe("disabled");
    // No conversation was started and no tool ran: the switch is checked first.
    expect(auditActions()).toEqual([COPILOT_AUDIT_ACTIONS.error]);
    expect(dbMock.shipmentDocument.findFirst).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });
});

// ---------------------------------------------------------------------------
// The kill switch itself
// ---------------------------------------------------------------------------

describe("COPILOT_ENABLED", () => {
  const env = (value: string): NodeJS.ProcessEnv =>
    ({ COPILOT_ENABLED: value }) as unknown as NodeJS.ProcessEnv;

  it("treats an absent variable as on, so existing deployments are unchanged", () => {
    expect(copilotEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(copilotEnabled(env(""))).toBe(true);
  });

  it("accepts the spellings an operator would actually type", () => {
    for (const value of ["0", "false", "FALSE", "off", "no", " false "]) {
      expect(copilotEnabled(env(value))).toBe(false);
    }
    for (const value of ["1", "true", "on", "yes"]) {
      expect(copilotEnabled(env(value))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Cost accounting
// ---------------------------------------------------------------------------

describe("token usage", () => {
  it("sums what every model call cost and records it in telemetry and the audit trail", async () => {
    dbMock.shipmentDocument.findFirst.mockResolvedValue(documentRow());
    const model = stubModel({
      plans: [
        {
          toolCalls: [{ id: "c1", name: "getDocument", args: { documentId: "doc_1" } }],
          text: "",
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
        // Second round: nothing left to ask, and this provider call reported
        // nothing — a null must not be read as a free call.
        { toolCalls: [], text: "" },
      ],
      composeUsage: { inputTokens: 300, outputTokens: 40, totalTokens: 340 },
    });

    await ask(model);

    const completed = events().find((entry) => entry.event === "copilot.answer_completed") as
      | Record<string, unknown>
      | undefined;
    expect(completed).toMatchObject({
      modelCalls: 3,
      inputTokens: 400,
      outputTokens: 60,
      totalTokens: 460,
    });

    const query = createAuditLog.mock.calls
      .map((call) => call[0])
      .find((entry) => entry.action === COPILOT_AUDIT_ACTIONS.query);
    expect(query?.metadata).toMatchObject({
      modelCalls: 3,
      inputTokens: 400,
      outputTokens: 60,
      totalTokens: 460,
    });
  });

  it("keeps unreported usage as null rather than reporting a free turn", async () => {
    const model = stubModel({});

    await ask(model);

    const completed = events().find((entry) => entry.event === "copilot.answer_completed") as
      | Record<string, unknown>
      | undefined;
    expect(completed).toMatchObject({
      modelCalls: 2,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
  });

  it("still reports what a failed turn cost", async () => {
    const model = stubModel({
      plans: [{ toolCalls: [], text: "", usage: { inputTokens: 90, outputTokens: 10, totalTokens: 100 } }],
      composeError: new CopilotModelError("upstream 503"),
    });

    await ask(model);

    const failed = events().find((entry) => entry.event === "copilot.failed") as
      | Record<string, unknown>
      | undefined;
    expect(failed).toMatchObject({ modelCalls: 1, inputTokens: 90, totalTokens: 100 });
  });

  it("adds the turn's spend to the account's daily total", async () => {
    dbMock.shipmentDocument.findFirst.mockResolvedValue(documentRow());
    const model = stubModel({
      plans: [
        {
          toolCalls: [{ id: "c1", name: "getDocument", args: { documentId: "doc_1" } }],
          text: "",
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
        { toolCalls: [], text: "" },
      ],
      composeUsage: { inputTokens: 300, outputTokens: 40, totalTokens: 340 },
    });

    await ask(model);

    // Two rows per turn: this user's, and the account-wide "*" row the daily
    // budget is checked against. The totals are the same ones the audit trail got,
    // so a spend report and an audit reconcile.
    const written = dbMock.$executeRaw.mock.calls.map((call) => call.slice(1));
    expect(written).toHaveLength(2);
    expect(written[0]).toContain("user_1");
    expect(written[1]).toContain("*");
    for (const row of written) {
      expect(row).toContain(ACCOUNT);
      expect(row).toContain("copilot");
      expect(row).toContain(400);
      expect(row).toContain(60);
    }
  });

  it("still records the spend when the turn failed", async () => {
    // A turn that died halfway was still billed by the provider. A budget that
    // counted only successful turns would be the wrong number to bill against.
    const model = stubModel({
      plans: [{ toolCalls: [], text: "", usage: { inputTokens: 90, outputTokens: 10, totalTokens: 100 } }],
      composeError: new CopilotModelError("upstream 503"),
    });

    await ask(model);

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(2);
    expect(dbMock.$executeRaw.mock.calls[0].slice(1)).toContain(90);
  });

  it("answers normally when the usage table cannot be written to", async () => {
    // The pre-migration state. Accounting is not allowed to cost an answer.
    dbMock.$executeRaw.mockRejectedValue(new Error('relation "AiUsageWindow" does not exist'));
    dbMock.shipmentDocument.findFirst.mockResolvedValue(documentRow());
    const model = stubModel({});

    const answer = await ask(model);

    expect(answer.status).not.toBe("ERROR");
  });
});
