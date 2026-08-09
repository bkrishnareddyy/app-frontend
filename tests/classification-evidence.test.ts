import { describe, it, expect } from "vitest";
import {
  additionalDuties,
  compareDutyRates,
  htsDigits,
  parseDutyRate,
} from "@/modules/decisions/classificationEvidence";

describe("parseDutyRate", () => {
  it("reads Free as a published zero, not a missing value", () => {
    expect(parseDutyRate("Free")).toEqual({ kind: "free", percent: 0, raw: "Free" });
    expect(parseDutyRate("free")).toMatchObject({ kind: "free", percent: 0 });
  });

  it("reads an ad valorem rate", () => {
    expect(parseDutyRate("2.5%")).toEqual({ kind: "adValorem", percent: 2.5, raw: "2.5%" });
    expect(parseDutyRate(" 17.6 % ")).toMatchObject({ kind: "adValorem", percent: 17.6 });
  });

  it("keeps a real 0% as a rate rather than treating it as absent", () => {
    expect(parseDutyRate("0%")).toEqual({ kind: "adValorem", percent: 0, raw: "0%" });
  });

  it("refuses to turn a specific rate into a percentage", () => {
    const rate = parseDutyRate("13.2c/kg");
    expect(rate.kind).toBe("notAdValorem");
    expect(rate.percent).toBeNull();
    expect(rate.raw).toBe("13.2c/kg");
  });

  it("refuses to reduce a compound rate to its ad valorem part", () => {
    expect(parseDutyRate("6.5% + 3.5c/kg")).toMatchObject({
      kind: "notAdValorem",
      percent: null,
    });
  });

  it("reports an absent or non-text rate as not recorded", () => {
    expect(parseDutyRate("")).toMatchObject({ kind: "notRecorded", percent: null, raw: null });
    expect(parseDutyRate("   ")).toMatchObject({ kind: "notRecorded" });
    expect(parseDutyRate(null)).toMatchObject({ kind: "notRecorded" });
    expect(parseDutyRate(undefined)).toMatchObject({ kind: "notRecorded" });
    expect(parseDutyRate(2.5)).toMatchObject({ kind: "notRecorded" });
  });
});

describe("compareDutyRates", () => {
  it("computes the difference between two ad valorem rates", () => {
    const result = compareDutyRates("2.5%", "6.5%");
    expect(result.comparable).toBe(true);
    expect(result.deltaPercent).toBe(4);
    expect(result.reason).toBeNull();
  });

  it("reports a reduction as a negative difference", () => {
    expect(compareDutyRates("6.5%", "2.5%").deltaPercent).toBe(-4);
  });

  it("treats Free as zero on either side", () => {
    expect(compareDutyRates("Free", "3%")).toMatchObject({ comparable: true, deltaPercent: 3 });
    expect(compareDutyRates("3%", "Free")).toMatchObject({ comparable: true, deltaPercent: -3 });
  });

  it("reports no change as zero rather than as nothing to say", () => {
    const result = compareDutyRates("4%", "4%");
    expect(result.comparable).toBe(true);
    expect(result.deltaPercent).toBe(0);
  });

  it("does not round a real difference away", () => {
    expect(compareDutyRates("2.5%", "6.4%").deltaPercent).toBe(3.9);
  });

  it("refuses to compare when either rate is specific or compound", () => {
    const result = compareDutyRates("2.5%", "13.2c/kg");
    expect(result.comparable).toBe(false);
    expect(result.deltaPercent).toBeNull();
    expect(result.reason).toMatch(/specific or compound/);
  });

  it("names which side has no rate on file", () => {
    expect(compareDutyRates(null, "2.5%").reason).toMatch(/current code/);
    expect(compareDutyRates("2.5%", null).reason).toMatch(/proposed code/);
    expect(compareDutyRates(null, null).reason).toMatch(/Neither/);
  });
});

describe("additionalDuties", () => {
  const base = {
    section301Applicable: false,
    section301AdditionalRate: null,
    section232Applicable: false,
    section232AdditionalRate: null,
  };

  it("lists nothing when no programme applies", () => {
    expect(additionalDuties(base)).toEqual([]);
  });

  it("lists an applicable programme with its rate", () => {
    expect(
      additionalDuties({ ...base, section301Applicable: true, section301AdditionalRate: "25" })
    ).toEqual([{ programme: "Section 301", percent: 25 }]);
  });

  it("keeps a stored rate of zero as zero", () => {
    expect(
      additionalDuties({ ...base, section232Applicable: true, section232AdditionalRate: "0" })
    ).toEqual([{ programme: "Section 232", percent: 0 }]);
  });

  it("reports an applicable programme with no rate rather than assuming zero", () => {
    expect(
      additionalDuties({ ...base, section301Applicable: true, section301AdditionalRate: null })
    ).toEqual([{ programme: "Section 301", percent: null }]);
  });

  it("ignores a rate recorded against a programme that does not apply", () => {
    expect(additionalDuties({ ...base, section301AdditionalRate: "25" })).toEqual([]);
  });

  it("lists both programmes when both apply", () => {
    expect(
      additionalDuties({
        section301Applicable: true,
        section301AdditionalRate: "7.5",
        section232Applicable: true,
        section232AdditionalRate: "10",
      })
    ).toHaveLength(2);
  });
});

describe("htsDigits", () => {
  it("strips punctuation from a published code", () => {
    expect(htsDigits("8471.30.0100")).toBe("8471300100");
  });

  it("leaves a bare code alone", () => {
    expect(htsDigits("8471300100")).toBe("8471300100");
  });

  it("returns null when there is nothing to look up", () => {
    expect(htsDigits("")).toBeNull();
    expect(htsDigits("....")).toBeNull();
    expect(htsDigits(null)).toBeNull();
    expect(htsDigits(8471)).toBeNull();
  });
});
