import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The shared AI quota.
 *
 * Two properties matter more than any individual number here, and most of these
 * tests exist to hold them:
 *
 *   1. **A limit that is not configured is not enforced.** Nothing in this
 *      repository sets the agent quota variables, so metering an agent must count
 *      the call and allow it. If that ever regresses, every agent on the platform
 *      starts refusing work.
 *   2. **Failure is not enforcement.** If the counter table is missing — which is
 *      the state of any deployment where the migration has not been applied yet —
 *      or the database is briefly unreachable, calls are allowed and flagged.
 *
 * The database is a mock, and the raw statements are inspected through their
 * interpolated values rather than their SQL text: what matters is which account,
 * user, surface and window a statement was aimed at, not how it was spelled.
 */

const dbMock = {
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
};
vi.mock("@/lib/db", () => ({ db: dbMock }));

const {
  ACCOUNT_WIDE,
  aiQuotaLimits,
  checkAiQuota,
  dayWindow,
  minuteWindow,
  pruneAiUsageWindows,
  recordAiTokens,
  resetAiQuotaReporting,
} = await import("@/lib/ai/aiQuota");

const ACCOUNT = "acct_alpha";
const USER = "user_1";

/** Interpolated values of a tagged-template raw call, in order. */
function values(call: unknown[]): unknown[] {
  return call.slice(1);
}

/** Every `$queryRaw` call's values, in call order. */
function queryValues(): unknown[][] {
  return dbMock.$queryRaw.mock.calls.map((call) => values(call as unknown[]));
}

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as unknown as NodeJS.ProcessEnv;
}

beforeEach(() => {
  // Spies first: restoreAllMocks would otherwise undo the db defaults set below.
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  dbMock.$queryRaw.mockReset();
  dbMock.$executeRaw.mockReset();
  dbMock.$executeRaw.mockResolvedValue(1);
  resetAiQuotaReporting();
});

// ---------------------------------------------------------------------------

describe("aiQuotaLimits", () => {
  it("leaves agent surfaces unlimited when nothing is configured", () => {
    // The property that keeps this feature from changing agent behaviour on any
    // existing deployment. Both request ceilings and the token ceiling are off.
    const limits = aiQuotaLimits("hts-classification", env({}));
    expect(limits).toEqual({
      userRequestsPerMinute: null,
      accountRequestsPerMinute: null,
      accountTokensPerDay: null,
    });
  });

  it("keeps the Copilot's shipped request ceilings", () => {
    // Moving the Copilot onto the shared counter changes where the count is kept,
    // not what the count is.
    const limits = aiQuotaLimits("copilot", env({}));
    expect(limits.userRequestsPerMinute).toBe(15);
    expect(limits.accountRequestsPerMinute).toBe(60);
    expect(limits.accountTokensPerDay).toBeNull();
  });

  it("reads the account's overrides for both agents and the Copilot", () => {
    const configured = env({
      AI_AGENT_USER_REQUESTS_PER_MIN: "4",
      AI_AGENT_ACCOUNT_REQUESTS_PER_MIN: "20",
      AI_ACCOUNT_TOKENS_PER_DAY: "1000000",
      COPILOT_USER_REQUESTS_PER_MIN: "5",
      COPILOT_ACCOUNT_REQUESTS_PER_MIN: "25",
    });

    expect(aiQuotaLimits("normalization", configured)).toEqual({
      userRequestsPerMinute: 4,
      accountRequestsPerMinute: 20,
      accountTokensPerDay: 1_000_000,
    });
    expect(aiQuotaLimits("copilot", configured)).toEqual({
      userRequestsPerMinute: 5,
      accountRequestsPerMinute: 25,
      accountTokensPerDay: 1_000_000,
    });
  });

  it("treats an unusable value as unset rather than as zero", () => {
    // A misconfigured "0" or "unlimited" must not become a ceiling of zero, which
    // would refuse every request on the platform.
    for (const bad of ["0", "-5", "unlimited", "", "  "]) {
      expect(
        aiQuotaLimits("copilot", env({ AI_ACCOUNT_TOKENS_PER_DAY: bad })).accountTokensPerDay
      ).toBeNull();
    }
    expect(
      aiQuotaLimits("compliance-audit", env({ AI_AGENT_USER_REQUESTS_PER_MIN: "0" }))
        .userRequestsPerMinute
    ).toBeNull();
  });
});

describe("windows", () => {
  it("truncates a minute window to the minute", () => {
    expect(minuteWindow(new Date("2026-08-12T14:37:42.913Z")).toISOString()).toBe(
      "2026-08-12T14:37:00.000Z"
    );
  });

  it("truncates a day window to UTC midnight", () => {
    // UTC, not local: two instances in different regions must agree on which day
    // a token was spent, or an account gets two allowances.
    expect(dayWindow(new Date("2026-08-12T23:59:59.999Z")).toISOString()).toBe(
      "2026-08-12T00:00:00.000Z"
    );
  });
});

// ---------------------------------------------------------------------------

describe("checkAiQuota with no limits configured", () => {
  const NOW = new Date("2026-08-12T14:37:42.000Z");
  const UNLIMITED = {
    userRequestsPerMinute: null,
    accountRequestsPerMinute: null,
    accountTokensPerDay: null,
  };

  it("counts the request and allows it", async () => {
    dbMock.$queryRaw.mockResolvedValue([{ requests: 9_001 }]);

    const decision = await checkAiQuota({
      accountId: ACCOUNT,
      userId: USER,
      surface: "hts-classification",
      now: NOW,
      limits: UNLIMITED,
    });

    expect(decision).toEqual({
      allowed: true,
      reason: "ok",
      scope: null,
      retryAfterSeconds: 0,
      degraded: false,
    });

    // Two rows: the user's and the account's aggregate. A count far above any
    // plausible ceiling still passes, because there is no ceiling.
    const calls = queryValues();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain(USER);
    expect(calls[1]).toContain(ACCOUNT_WIDE);
    for (const call of calls) {
      expect(call).toContain(ACCOUNT);
      expect(call).toContain("hts-classification");
      expect(call).toContainEqual(new Date("2026-08-12T14:37:00.000Z"));
    }
  });

  it("does not read the token total when no budget is set", async () => {
    dbMock.$queryRaw.mockResolvedValue([{ requests: 1 }]);

    await checkAiQuota({
      accountId: ACCOUNT,
      userId: USER,
      surface: "normalization",
      now: NOW,
      limits: UNLIMITED,
    });

    // Exactly the two increments — no SELECT, so an unconfigured budget costs no
    // extra round trip on the agent path.
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe("checkAiQuota request ceilings", () => {
  const NOW = new Date("2026-08-12T14:37:30.000Z");
  const LIMITS = {
    userRequestsPerMinute: 3,
    accountRequestsPerMinute: 10,
    accountTokensPerDay: null,
  };

  it("refuses when the user's window is full, and counts nothing", async () => {
    // Zero rows back from the conditional upsert: the limit had already been
    // reached, so nothing was written. That is what keeps a retrying client from
    // extending its own lockout.
    dbMock.$queryRaw.mockResolvedValueOnce([]);

    const decision = await checkAiQuota({
      accountId: ACCOUNT,
      userId: USER,
      surface: "copilot",
      now: NOW,
      limits: LIMITS,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("user_requests");
    expect(decision.scope).toBe("user");
    // 30 seconds into the minute, so the window frees in 30.
    expect(decision.retryAfterSeconds).toBe(30);
    // The account row was never touched, and nothing was rolled back.
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(dbMock.$executeRaw).not.toHaveBeenCalled();
  });

  it("gives the user's slot back when the account's window refuses", async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([{ requests: 1 }]).mockResolvedValueOnce([]);

    const decision = await checkAiQuota({
      accountId: ACCOUNT,
      userId: USER,
      surface: "copilot",
      now: NOW,
      limits: LIMITS,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("account_requests");
    expect(decision.scope).toBe("account");

    // The request never ran, so it must not shorten this user's next minute.
    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(1);
    const compensating = values(dbMock.$executeRaw.mock.calls[0] as unknown[]);
    expect(compensating).toContain(ACCOUNT);
    expect(compensating).toContain(USER);
    expect(compensating).not.toContain(ACCOUNT_WIDE);
  });

  it("never returns a retry-after of zero", async () => {
    // A refusal in the last millisecond of a window still tells the caller to
    // wait a second. "Retry after 0" invites an immediate retry that also fails.
    dbMock.$queryRaw.mockResolvedValueOnce([]);

    const decision = await checkAiQuota({
      accountId: ACCOUNT,
      userId: USER,
      surface: "copilot",
      now: new Date("2026-08-12T14:37:59.999Z"),
      limits: LIMITS,
    });

    expect(decision.retryAfterSeconds).toBe(1);
  });

  it("passes the configured ceiling into the statement", async () => {
    dbMock.$queryRaw.mockResolvedValue([{ requests: 1 }]);

    await checkAiQuota({
      accountId: ACCOUNT,
      userId: USER,
      surface: "copilot",
      now: NOW,
      limits: LIMITS,
    });

    const [userCall, accountCall] = queryValues();
    expect(userCall).toContain(3);
    expect(accountCall).toContain(10);
  });
});

describe("checkAiQuota daily token ceiling", () => {
  const NOW = new Date("2026-08-12T20:00:00.000Z");
  const LIMITS = {
    userRequestsPerMinute: null,
    accountRequestsPerMinute: null,
    accountTokensPerDay: 1_000,
  };

  it("refuses once the account has spent its allowance, before counting a request", async () => {
    // SUM() over a BIGINT column: the driver hands this back as a BigInt.
    dbMock.$queryRaw.mockResolvedValueOnce([{ total: BigInt(1_000) }]);

    const decision = await checkAiQuota({
      accountId: ACCOUNT,
      userId: USER,
      surface: "document-intelligence",
      now: NOW,
      limits: LIMITS,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("account_tokens");
    expect(decision.scope).toBe("account");
    // Four hours to UTC midnight.
    expect(decision.retryAfterSeconds).toBe(4 * 60 * 60);
    // Only the SELECT ran: a request refused on budget is not also counted as a
    // request made.
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("allows and counts while the account is under its allowance", async () => {
    // A numeric aggregate can also arrive as a string, depending on the driver's
    // conversion. Both must read as a number rather than as NaN.
    dbMock.$queryRaw
      .mockResolvedValueOnce([{ total: "999" }])
      .mockResolvedValue([{ requests: 1 }]);

    const decision = await checkAiQuota({
      accountId: ACCOUNT,
      userId: USER,
      surface: "document-intelligence",
      now: NOW,
      limits: LIMITS,
    });

    expect(decision.allowed).toBe(true);
    // The SELECT plus the two increments. The last request before the ceiling is
    // allowed in full and may overshoot it — bounded to one call, which is the
    // documented trade for not having to predict a call's cost.
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("treats an account that has spent nothing as under budget", async () => {
    // COALESCE returns 0 rather than null, and an account with no row at all
    // returns no rows; both must read as zero rather than as NaN.
    dbMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValue([{ requests: 1 }]);

    const decision = await checkAiQuota({
      accountId: ACCOUNT,
      userId: USER,
      surface: "document-intelligence",
      now: NOW,
      limits: LIMITS,
    });

    expect(decision.allowed).toBe(true);
  });

  it("reads the account-wide day row, not a user's", async () => {
    dbMock.$queryRaw
      .mockResolvedValueOnce([{ total: BigInt(0) }])
      .mockResolvedValue([{ requests: 1 }]);

    await checkAiQuota({
      accountId: ACCOUNT,
      userId: USER,
      surface: "document-intelligence",
      now: NOW,
      limits: LIMITS,
    });

    const select = queryValues()[0];
    expect(select).toContain(ACCOUNT);
    expect(select).toContain(ACCOUNT_WIDE);
    expect(select).toContainEqual(new Date("2026-08-12T00:00:00.000Z"));
  });
});

describe("checkAiQuota when the counter is unavailable", () => {
  it("allows the request and marks the decision degraded", async () => {
    // The pre-migration state, and any database blip. A metering table must not
    // be able to stop customs classification.
    dbMock.$queryRaw.mockRejectedValue(
      Object.assign(new Error('relation "AiUsageWindow" does not exist'), { code: "P2010" })
    );

    const decision = await checkAiQuota({
      accountId: ACCOUNT,
      userId: USER,
      surface: "hts-classification",
      limits: {
        userRequestsPerMinute: 1,
        accountRequestsPerMinute: 1,
        accountTokensPerDay: 1,
      },
    });

    // Note the limits above are as tight as they can be: even so, an unreachable
    // counter allows.
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("unavailable");
    expect(decision.degraded).toBe(true);
  });

  it("logs the outage once per process rather than once per request", async () => {
    dbMock.$queryRaw.mockRejectedValue(Object.assign(new Error("nope"), { code: "P2010" }));

    for (let i = 0; i < 5; i += 1) {
      await checkAiQuota({ accountId: ACCOUNT, userId: USER, surface: "copilot" });
    }

    const quotaLogs = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (call) => String(call[0]).includes("ai.quota_unavailable")
    );
    expect(quotaLogs).toHaveLength(1);
    // The class of failure is logged, never the message: a driver error can carry
    // a connection string.
    const logged = JSON.parse(String(quotaLogs[0][0]));
    expect(logged.code).toBe("P2010");
    expect(JSON.stringify(logged)).not.toContain("nope");
  });
});

// ---------------------------------------------------------------------------

describe("recordAiTokens", () => {
  const NOW = new Date("2026-08-12T14:37:42.000Z");

  it("adds the spend to the user's row and the account's row", async () => {
    await recordAiTokens({
      accountId: ACCOUNT,
      userId: USER,
      surface: "copilot",
      inputTokens: 400,
      outputTokens: 60,
      now: NOW,
    });

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(2);
    const [userRow, accountRow] = dbMock.$executeRaw.mock.calls.map((call) =>
      values(call as unknown[])
    );
    expect(userRow).toContain(USER);
    expect(accountRow).toContain(ACCOUNT_WIDE);
    for (const row of [userRow, accountRow]) {
      expect(row).toContain(ACCOUNT);
      expect(row).toContain(400);
      expect(row).toContain(60);
      // The day window, not the minute: token totals are a daily budget.
      expect(row).toContainEqual(new Date("2026-08-12T00:00:00.000Z"));
    }
  });

  it("records a call whose cost the provider did not report", async () => {
    // Zero tokens against a real request. The call happened; its cost is unknown.
    // Dropping it entirely would make the request count disagree with reality.
    await recordAiTokens({
      accountId: ACCOUNT,
      userId: USER,
      surface: "normalization",
      inputTokens: null,
      outputTokens: null,
      now: NOW,
    });

    expect(dbMock.$executeRaw).toHaveBeenCalledTimes(2);
    expect(values(dbMock.$executeRaw.mock.calls[0] as unknown[])).toContain(0);
  });

  it("never rejects, whatever the database does", async () => {
    // Called from inside agent code paths that must produce a customs answer
    // regardless. A throw here would surface as a failed classification.
    dbMock.$executeRaw.mockRejectedValue(new Error("connection reset"));

    await expect(
      recordAiTokens({
        accountId: ACCOUNT,
        userId: USER,
        surface: "hts-classification",
        inputTokens: 10,
        outputTokens: 20,
        now: NOW,
      })
    ).resolves.toBeUndefined();
  });
});

describe("pruneAiUsageWindows", () => {
  it("deletes windows older than the retention period", async () => {
    dbMock.$executeRaw.mockResolvedValue(42);
    const now = new Date("2026-08-12T00:00:00.000Z");

    const deleted = await pruneAiUsageWindows(35, now);

    expect(deleted).toBe(42);
    expect(values(dbMock.$executeRaw.mock.calls[0] as unknown[])).toContainEqual(
      new Date("2026-07-08T00:00:00.000Z")
    );
  });
});
