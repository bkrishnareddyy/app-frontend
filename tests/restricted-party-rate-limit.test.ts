import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRestrictedPartyRate,
  resetRestrictedPartyRateLimits,
} from "@/lib/api/restrictedPartyRateLimit";

// Restricted / Denied-Party Screening: restrictedPartyRateLimit.ts
// Sliding-window limiter scoped by API key id, modeled on copilotRateLimit.ts.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

beforeEach(() => {
  resetRestrictedPartyRateLimits();
});

describe("checkRestrictedPartyRate", () => {
  it("allows requests under the per-window cap", () => {
    const now = 1_000_000;
    for (let i = 0; i < MAX_PER_WINDOW; i++) {
      expect(checkRestrictedPartyRate("key_1", now + i).allowed).toBe(true);
    }
  });

  it("denies the request that exceeds the per-window cap", () => {
    const now = 1_000_000;
    for (let i = 0; i < MAX_PER_WINDOW; i++) {
      checkRestrictedPartyRate("key_1", now + i);
    }
    const decision = checkRestrictedPartyRate("key_1", now + MAX_PER_WINDOW);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("scopes the window independently per API key id", () => {
    const now = 1_000_000;
    for (let i = 0; i < MAX_PER_WINDOW; i++) {
      checkRestrictedPartyRate("key_1", now + i);
    }
    expect(checkRestrictedPartyRate("key_1", now + MAX_PER_WINDOW).allowed).toBe(false);
    expect(checkRestrictedPartyRate("key_2", now + MAX_PER_WINDOW).allowed).toBe(true);
  });

  it("allows requests again once the window has fully slid past the earlier hits", () => {
    const now = 1_000_000;
    for (let i = 0; i < MAX_PER_WINDOW; i++) {
      checkRestrictedPartyRate("key_1", now + i);
    }
    expect(checkRestrictedPartyRate("key_1", now + MAX_PER_WINDOW).allowed).toBe(false);
    expect(checkRestrictedPartyRate("key_1", now + WINDOW_MS + 1).allowed).toBe(true);
  });
});
