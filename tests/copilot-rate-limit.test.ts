import { describe, it, expect, beforeEach } from "vitest";
import {
  checkCopilotRate,
  resetCopilotRateLimits,
} from "@/modules/copilot/copilotRateLimit";
import { COPILOT_RATE_LIMITS, type CopilotRateLimits } from "@/modules/copilot/copilotConfig";

/**
 * The question quota.
 *
 * Time is passed in rather than mocked, so these tests describe the window
 * arithmetic directly: a fixed `now` per call, no timers, no sleeping.
 */

const LIMITS: CopilotRateLimits = { perUser: 3, perAccount: 5, windowMs: 60_000 };
const T0 = 1_000_000;

beforeEach(() => {
  resetCopilotRateLimits();
});

function askAt(now: number, accountId = "acct_a", userId = "user_1") {
  return checkCopilotRate({ accountId, userId }, now, LIMITS);
}

describe("per-user window", () => {
  it("allows questions up to the limit and refuses the next one", () => {
    for (let index = 0; index < LIMITS.perUser; index += 1) {
      expect(askAt(T0 + index).allowed).toBe(true);
    }

    const refused = askAt(T0 + LIMITS.perUser);
    expect(refused.allowed).toBe(false);
    expect(refused.scope).toBe("user");
    expect(refused.retryAfterSeconds).toBe(60);
  });

  it("lets the caller back in once the oldest question falls out of the window", () => {
    askAt(T0);
    askAt(T0 + 1);
    askAt(T0 + 2);
    expect(askAt(T0 + 3).allowed).toBe(false);

    // A full window after the first question, exactly that one has aged out —
    // so one slot frees, and only one.
    const later = T0 + LIMITS.windowMs;
    expect(askAt(later).allowed).toBe(true);
    expect(askAt(later).allowed).toBe(false);
  });

  it("does not count refused questions, so retrying cannot extend the lockout", () => {
    askAt(T0);
    askAt(T0 + 1);
    askAt(T0 + 2);

    // A client hammering the endpoint through the whole window.
    for (let offset = 3; offset < LIMITS.windowMs; offset += 1_000) {
      expect(askAt(T0 + offset).allowed).toBe(false);
    }

    // The cool-off still ends when the original three age out, not later.
    expect(askAt(T0 + LIMITS.windowMs + 1).allowed).toBe(true);
  });

  it("counts each user separately", () => {
    askAt(T0, "acct_a", "user_1");
    askAt(T0 + 1, "acct_a", "user_1");
    askAt(T0 + 2, "acct_a", "user_1");
    expect(askAt(T0 + 3, "acct_a", "user_1").allowed).toBe(false);

    expect(askAt(T0 + 4, "acct_a", "user_2").allowed).toBe(true);
  });
});

describe("per-account window", () => {
  it("refuses once the account's users have collectively exhausted it", () => {
    // Two users, under the per-user limit each, together over the account limit.
    expect(askAt(T0, "acct_a", "user_1").allowed).toBe(true);
    expect(askAt(T0 + 1, "acct_a", "user_1").allowed).toBe(true);
    expect(askAt(T0 + 2, "acct_a", "user_1").allowed).toBe(true);
    expect(askAt(T0 + 3, "acct_a", "user_2").allowed).toBe(true);
    expect(askAt(T0 + 4, "acct_a", "user_2").allowed).toBe(true);

    const refused = askAt(T0 + 5, "acct_a", "user_3");
    expect(refused.allowed).toBe(false);
    expect(refused.scope).toBe("account");
    expect(refused.retryAfterSeconds).toBe(60);
  });

  it("does not let one account's traffic affect another", () => {
    for (let index = 0; index < LIMITS.perAccount; index += 1) {
      askAt(T0 + index, "acct_a", `user_${index}`);
    }
    expect(askAt(T0 + LIMITS.perAccount, "acct_a", "user_x").allowed).toBe(false);

    expect(askAt(T0 + LIMITS.perAccount, "acct_b", "user_1").allowed).toBe(true);
  });

  it("reports the user scope first when both windows are exhausted", () => {
    // user_1 hits the per-user limit while the account is also at its limit.
    askAt(T0, "acct_a", "user_1");
    askAt(T0 + 1, "acct_a", "user_1");
    askAt(T0 + 2, "acct_a", "user_1");
    askAt(T0 + 3, "acct_a", "user_2");
    askAt(T0 + 4, "acct_a", "user_2");

    expect(askAt(T0 + 5, "acct_a", "user_1").scope).toBe("user");
  });
});

describe("retry guidance", () => {
  it("counts from the oldest question in the window, not from now", () => {
    askAt(T0);
    askAt(T0 + 20_000);
    askAt(T0 + 20_001);

    // 30s after the first question: 30s of its window remain.
    expect(askAt(T0 + 30_000).retryAfterSeconds).toBe(30);
  });

  it("never advises retrying in zero seconds", () => {
    askAt(T0);
    askAt(T0 + 1);
    askAt(T0 + 2);

    // One millisecond before the oldest question ages out: rounding down would
    // tell the caller to retry immediately, which would be refused again.
    const refused = askAt(T0 + LIMITS.windowMs - 1);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(1);
  });
});

describe("shipped configuration", () => {
  it("leaves room for a person working hard while bounding a loop", () => {
    expect(COPILOT_RATE_LIMITS.windowMs).toBe(60_000);
    expect(COPILOT_RATE_LIMITS.perUser).toBeGreaterThanOrEqual(10);
    // An account must never be more restrictive than one of its users.
    expect(COPILOT_RATE_LIMITS.perAccount).toBeGreaterThan(COPILOT_RATE_LIMITS.perUser);
  });

  it("applies the shipped limits when none are passed", () => {
    for (let index = 0; index < COPILOT_RATE_LIMITS.perUser; index += 1) {
      expect(checkCopilotRate({ accountId: "acct_z", userId: "user_1" }, T0 + index).allowed).toBe(
        true
      );
    }
    expect(
      checkCopilotRate(
        { accountId: "acct_z", userId: "user_1" },
        T0 + COPILOT_RATE_LIMITS.perUser
      ).allowed
    ).toBe(false);
  });
});
