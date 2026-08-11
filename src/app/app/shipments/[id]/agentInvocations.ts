// Merges two agent-execution logging tables into a single list of
// "invocations" (one entry per orchestration call) for the Agent Executions
// & Audit Log waterfall view.
//
// PipelineOrchestrator (every trigger -- upload, field edits, reattach,
// reconcile) writes only AgentExecutionRecord going forward. AgentExecutionLog
// rows are historical, from the two separate orchestrators it replaced
// (ComplianceWorkflowEngine and AgentDependencyOrchestrator); both tables are
// still read here so old runs keep showing up in the waterfall. Both carry a
// shared `runId` so every step fired by one orchestration call groups together.
//
// Rows written before that column existed (runId === null) don't carry an
// explicit group, but a single pipeline call still fires its agent steps
// seconds apart -- so they're clustered by time proximity per source table:
// consecutive legacy rows within LEGACY_CLUSTER_GAP_MS of each other are
// treated as one run, same as if they'd shared a real runId.
const LEGACY_CLUSTER_GAP_MS = 2 * 60 * 1000; // 2 minutes

export interface InvocationStep {
  id: string;
  agentName: string;
  status: "COMPLETED" | "FAILED" | "REVIEW" | "RUNNING";
  rawStatus: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  summary?: string;
  confidence?: number | null;
  modelVersion?: string | null;
  error?: string;
  /** Exactly what buildAgentContext() handed this agent for this step -- answers "what did it actually see" without re-deriving it from code. Undefined on rows written before this column existed. */
  inputSnapshot?: unknown;
  /** The agent's raw output for this step. */
  outputSnapshot?: unknown;
}

export interface AgentInvocation {
  runId: string;
  invokedBy: string;
  triggerEvent: string;
  startedAt: string;
  completedAt: string | null;
  totalDurationMs: number;
  status: "COMPLETED" | "FAILED" | "REVIEW" | "RUNNING";
  steps: InvocationStep[];
}

function normalizeRecordStatus(status: string): InvocationStep["status"] {
  if (status === "FAILED") return "FAILED";
  if (status === "RUNNING") return "RUNNING";
  return "COMPLETED";
}

function normalizeLogStatus(status: string): InvocationStep["status"] {
  if (status === "Completed") return "COMPLETED";
  if (status === "BLOCKED") return "FAILED";
  return "REVIEW"; // "Review Required" | "Attention"
}

// Groups items lacking a real runId by time proximity: a new cluster starts
// whenever the gap since the previous item's start exceeds the threshold.
// Object identity is used as the map key since callers always pass back the
// exact same array elements they clustered.
function clusterLegacyByTime<T>(items: T[], getStartMs: (item: T) => number, sourcePrefix: string): Map<T, string> {
  const sorted = [...items].sort((a, b) => getStartMs(a) - getStartMs(b));
  const clusterOf = new Map<T, string>();
  let clusterIndex = -1;
  let lastStart: number | null = null;
  for (const item of sorted) {
    const t = getStartMs(item);
    if (lastStart === null || t - lastStart > LEGACY_CLUSTER_GAP_MS) {
      clusterIndex++;
    }
    clusterOf.set(item, `${sourcePrefix}-cluster-${clusterIndex}`);
    lastStart = t;
  }
  return clusterOf;
}

/**
 * An `AgentExecutionRecord` row: a selective agent re-run.
 *
 * `runId` is nullable because rows written before run grouping existed have none,
 * which is exactly what `clusterLegacyByTime` reconstructs a grouping for.
 */
export interface AgentExecutionRecordRow {
  id: string;
  agentName: string;
  status: string;
  startedAt: Date | string;
  completedAt?: Date | string | null;
  durationMs?: number | null;
  runId?: string | null;
  invokedBy?: string | null;
  triggerEvent?: string | null;
  nextStep?: string | null;
  summary?: string | null;
  confidence?: unknown;
  modelVersion?: string | null;
  error?: string | null;
  /** Prisma `Json` snapshots of what the step was given and produced. */
  inputSnapshot?: unknown;
  outputSnapshot?: unknown;
}

/**
 * An `AgentExecutionLog` row: one step of the upload pipeline.
 *
 * Unlike a record, this stores only `timestamp` (taken after the step finished),
 * so a start time has to be derived from `durationMs`.
 */
export interface AgentExecutionLogRow {
  id: string;
  agentName: string;
  status: string;
  timestamp: Date | string;
  durationMs?: number | null;
  runId?: string | null;
  invokedBy?: string | null;
  triggerEvent?: string | null;
  summary?: string;
  /** Prisma `Json` snapshots of what the step was given and produced. */
  inputSnapshot?: unknown;
  outputSnapshot?: unknown;
}

export function buildAgentInvocations(
  records: AgentExecutionRecordRow[],
  logs: AgentExecutionLogRow[]
): AgentInvocation[] {
  const groups = new Map<string, AgentInvocation>();

  const ensureGroup = (runId: string, invokedBy: string, triggerEvent: string) => {
    let g = groups.get(runId);
    if (!g) {
      g = { runId, invokedBy, triggerEvent, startedAt: "", completedAt: null, totalDurationMs: 0, status: "COMPLETED", steps: [] };
      groups.set(runId, g);
    }
    return g;
  };

  const legacyRecords = (records || []).filter((r) => !r.runId);
  const legacyRecordClusters = clusterLegacyByTime(legacyRecords, (r) => new Date(r.startedAt).getTime(), "legacy-record");

  const legacyLogs = (logs || []).filter((l) => !l.runId);
  const legacyLogClusters = clusterLegacyByTime(
    legacyLogs,
    (l) => new Date(l.timestamp).getTime() - (l.durationMs || 0),
    "legacy-log"
  );

  for (const rec of records || []) {
    const runId = rec.runId || legacyRecordClusters.get(rec)!;
    const g = ensureGroup(runId, rec.invokedBy || rec.triggerEvent || "SYSTEM", rec.triggerEvent || "UNKNOWN");
    const confidenceNum = typeof rec.confidence === "number" ? rec.confidence : null;
    g.steps.push({
      id: rec.id,
      agentName: rec.agentName,
      status: normalizeRecordStatus(rec.status),
      rawStatus: rec.status,
      startedAt: new Date(rec.startedAt).toISOString(),
      completedAt: rec.completedAt ? new Date(rec.completedAt).toISOString() : null,
      durationMs: rec.durationMs || 0,
      summary: rec.summary || undefined,
      confidence: confidenceNum,
      modelVersion: rec.modelVersion || undefined,
      error: rec.error || undefined,
      inputSnapshot: rec.inputSnapshot ?? undefined,
      outputSnapshot: rec.outputSnapshot ?? undefined,
    });
  }

  for (const log of logs || []) {
    const runId = log.runId || legacyLogClusters.get(log)!;
    const g = ensureGroup(runId, log.invokedBy || "Document Upload", log.triggerEvent || "DOCUMENT_UPLOADED");
    // AgentExecutionLog only stores a single "recorded at" timestamp (taken
    // right after the step finishes), so startedAt is derived by walking
    // back the step's own durationMs -- an approximation, not a stored fact.
    const completedAt = new Date(log.timestamp);
    const durationMs = log.durationMs || 0;
    const startedAt = new Date(completedAt.getTime() - durationMs);
    g.steps.push({
      id: log.id,
      agentName: log.agentName,
      status: normalizeLogStatus(log.status),
      rawStatus: log.status,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      summary: log.summary,
      inputSnapshot: log.inputSnapshot ?? undefined,
      outputSnapshot: log.outputSnapshot ?? undefined,
    });
  }

  const invocations = Array.from(groups.values()).map((g) => {
    g.steps.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const startTimes = g.steps.map((s) => new Date(s.startedAt).getTime()).filter((t) => !Number.isNaN(t));
    const endTimes = g.steps
      .map((s) => (s.completedAt ? new Date(s.completedAt).getTime() : null))
      .filter((t): t is number => t !== null && !Number.isNaN(t));
    const startedAt = startTimes.length ? new Date(Math.min(...startTimes)).toISOString() : new Date().toISOString();
    const completedAt = endTimes.length ? new Date(Math.max(...endTimes)).toISOString() : null;
    const totalDurationMs = completedAt ? new Date(completedAt).getTime() - new Date(startedAt).getTime() : 0;
    const status: AgentInvocation["status"] = g.steps.some((s) => s.status === "FAILED")
      ? "FAILED"
      : g.steps.some((s) => s.status === "RUNNING")
      ? "RUNNING"
      : g.steps.some((s) => s.status === "REVIEW")
      ? "REVIEW"
      : "COMPLETED";
    return { ...g, startedAt, completedAt, totalDurationMs, status };
  });

  invocations.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return invocations;
}
