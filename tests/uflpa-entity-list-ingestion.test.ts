import { describe, it, expect } from "vitest";
import { parseUflpaEntityListHtml, parseEntityNameCell } from "@/modules/screening/uflpaEntityListIngestionService";

// Real markup trimmed directly from https://www.dhs.gov/uflpa-entity-list
// (fetched 2026-08-20) -- two of the page's four statutory-clause tables,
// each with a couple of representative rows, not synthetic data.
const REAL_TRIMMED_HTML = `
<html><body>
<table><thead><tr><th>Name of Entity</th><th>Effective Date</th></tr></thead><tbody>
<tr><td>Baoding LYSZD Trade and Business Co., Ltd.</td><td>June 21, 2022</td></tr>
<tr><td>Hetian Haolin Hair Accessories Co. Ltd. (and two aliases: Hotan Haolin Hair Accessories; and Hollin Hair Accessories)</td><td>June 21, 2022</td></tr>
</tbody></table>
<table><thead><tr><th>Name of Entity</th><th>Effective Date</th></tr></thead><tbody>
<tr><td>Aksu Huafu Color Spinning Co., Ltd. (also known as Aksu Huafu Textiles Co., Ltd.; Akesu Huafu; Aksu Huafu Dyed Melange Yarn; and Akesu Huafu Melange Yarn Co., Ltd.)</td><td>January 15, 2025</td></tr>
<tr><td>Camel Group Co., Ltd.</td><td>August 2, 2023</td></tr>
</tbody></table>
</body></html>
`;

describe("UFLPA Entity List HTML parsing", () => {
  it("parses entities from every statutory-clause table with the correct citation", () => {
    const entries = parseUflpaEntityListHtml(REAL_TRIMMED_HTML);

    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      name: "Baoding LYSZD Trade and Business Co., Ltd.",
      citation: "UFLPA Section 2(d)(2)(B)(i)",
    });
    expect(entries[0].effectiveDate?.toISOString()).toContain("2022-06-21");

    expect(entries[2]).toMatchObject({
      name: "Aksu Huafu Color Spinning Co., Ltd.",
      citation: "UFLPA Section 2(d)(2)(B)(ii)",
    });
  });

  it("extracts 'also known as' aliases into alternateNames", () => {
    const { name, alternateNames } = parseEntityNameCell(
      "Aksu Huafu Color Spinning Co., Ltd. (also known as Aksu Huafu Textiles Co., Ltd.; Akesu Huafu; Aksu Huafu Dyed Melange Yarn; and Akesu Huafu Melange Yarn Co., Ltd.)"
    );

    expect(name).toBe("Aksu Huafu Color Spinning Co., Ltd.");
    expect(alternateNames).toEqual([
      "Aksu Huafu Textiles Co., Ltd.",
      "Akesu Huafu",
      "Aksu Huafu Dyed Melange Yarn",
      "Akesu Huafu Melange Yarn Co., Ltd.",
    ]);
  });

  it("extracts 'and N aliases:' style parentheticals too", () => {
    const { name, alternateNames } = parseEntityNameCell(
      "Hetian Haolin Hair Accessories Co. Ltd. (and two aliases: Hotan Haolin Hair Accessories; and Hollin Hair Accessories)"
    );

    expect(name).toBe("Hetian Haolin Hair Accessories Co. Ltd.");
    expect(alternateNames).toEqual(["Hotan Haolin Hair Accessories", "Hollin Hair Accessories"]);
  });

  it("refuses to ingest a near-empty parse", () => {
    const entries = parseUflpaEntityListHtml("<html><body><table><tbody></tbody></table></body></html>");
    expect(entries).toHaveLength(0);
  });
});
