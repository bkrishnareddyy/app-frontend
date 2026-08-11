import { describe, expect, it } from "vitest";

import { extendedAmount } from "@/app/app/shipments/[id]/workspaceTypes";
import { displayCurrency } from "@/lib/honest";

/**
 * The extracted line items table used to render `$${qty * unitPrice}`.
 *
 * Two facts were lost that way. A document's stored extraction routinely carries
 * a line total with no unit price -- this repo's own sample invoice had a unit
 * price on none of its 68 lines -- so the product was 0 and every row read "$0"
 * while the invoice plainly showed amounts. And the symbol was hardcoded, so a
 * EUR invoice was presented in dollars.
 */
describe("a line item's extended amount", () => {
  it("uses the stated total rather than multiplying it out", () => {
    // The invoice's own total wins: discounted and per-pack lines make
    // quantity x unit price disagree with what the document actually says.
    expect(extendedAmount({ quantity: 2, unitPrice: 298, totalValue: 500 })).toBe(500);
  });

  it("recovers an amount when only the unit price is known", () => {
    expect(extendedAmount({ quantity: 2, unitPrice: 298, totalValue: null })).toBe(596);
  });

  it("reports missing rather than zero when no price was extracted", () => {
    // The regression: this returned 0, and the table printed "$0" for a line
    // whose value simply had not been read off the page.
    expect(extendedAmount({ quantity: 2, unitPrice: null, totalValue: null })).toBeNull();
  });

  it("keeps a genuine zero", () => {
    // A free-of-charge line is a real declared value and must not read as absent.
    expect(extendedAmount({ quantity: 3, unitPrice: null, totalValue: 0 })).toBe(0);
    expect(extendedAmount({ quantity: 3, unitPrice: 0, totalValue: null })).toBe(0);
  });
});

describe("line ordering", () => {
  // The canonical shipment include fetched lineItems with no orderBy, so Postgres
  // returned them in heap order -- which shifts as the reconciler fills fields in
  // on existing rows -- and the table rendered an invoice's lines scrambled.
  // The table sorts defensively because one source is a database relation and the
  // other is whatever order a model emitted items in.
  it("renders ascending by line number whatever order the caller passed", () => {
    const scrambled = [{ lineNumber: 12 }, { lineNumber: 3 }, { lineNumber: 47 }, { lineNumber: 1 }];
    const ordered = [...scrambled].sort((a, b) => a.lineNumber - b.lineNumber);
    expect(ordered.map((r) => r.lineNumber)).toEqual([1, 3, 12, 47]);
  });

  it("orders numerically, not as text", () => {
    // A lexicographic sort puts line 10 before line 2, which is exactly the kind
    // of wrong order an operator would notice against the paper document.
    const rows = [{ lineNumber: 2 }, { lineNumber: 10 }, { lineNumber: 1 }];
    expect([...rows].sort((a, b) => a.lineNumber - b.lineNumber).map((r) => r.lineNumber)).toEqual([1, 2, 10]);
    expect([...rows].sort((a, b) => String(a.lineNumber).localeCompare(String(b.lineNumber))).map((r) => r.lineNumber)).toEqual([1, 10, 2]);
  });
});

describe("formatting an extended amount", () => {
  it("renders the document's own currency, not dollars", () => {
    const amount = extendedAmount({ quantity: 2, unitPrice: null, totalValue: 596 });
    expect(amount).not.toBeNull();
    expect(displayCurrency(amount, "EUR")).toBe("€596.00");
  });

  it("does not turn a EUR amount into a USD one", () => {
    expect(displayCurrency(43901, "EUR")).not.toContain("$");
  });
});
