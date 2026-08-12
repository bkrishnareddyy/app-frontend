import { describe, it, expect } from "vitest";
import { normalizeSenderEmail, recipientMatches } from "@/modules/inbound/emailNormalization";

describe("inbound email normalization", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeSenderEmail("  jane@acme.com  ")).toBe("jane@acme.com");
  });

  it("lowercases the whole address", () => {
    expect(normalizeSenderEmail("Jane.Doe@ACME.COM")).toBe("jane.doe@acme.com");
  });

  it("does not collapse Gmail dots", () => {
    // Two distinct-looking addresses must stay distinct: Gmail's own dot-
    // insensitivity is not this system's business to reimplement, since
    // doing so would let one authorized sender's route silently also match
    // an address nobody explicitly authorized.
    expect(normalizeSenderEmail("j.a.n.e@gmail.com")).not.toBe(normalizeSenderEmail("jane@gmail.com"));
  });

  it("does not strip plus-tags", () => {
    expect(normalizeSenderEmail("jane+invoices@acme.com")).not.toBe(normalizeSenderEmail("jane@acme.com"));
  });

  it("does not rewrite aliases", () => {
    expect(normalizeSenderEmail("jane+billing@acme.com")).not.toBe(normalizeSenderEmail("jane+invoices@acme.com"));
  });

  describe("recipientMatches", () => {
    it("matches after normalizing the candidate", () => {
      expect(recipientMatches("  Docs@Inbound.Qubere.AI  ", "docs@inbound.qubere.ai")).toBe(true);
    });

    it("rejects a different local part on the same domain", () => {
      expect(recipientMatches("random@inbound.qubere.ai", "docs@inbound.qubere.ai")).toBe(false);
    });
  });
});
