import { describe, it, expect } from "vitest";
import { RateParser } from "../src/modules/hts/rateParser";

describe("HTS Master Engine Test Suite", () => {
  describe("RateParser Engine", () => {
    it("correctly parses Free rates", () => {
      const parsed = RateParser.parse("Free");
      expect(parsed.rateType).toBe("Free");
      expect(parsed.isFree).toBe(true);
      expect(parsed.adValoremPercent).toBe(0);
    });

    it("correctly parses Ad Valorem percentage rates", () => {
      const parsed = RateParser.parse("2.8%");
      expect(parsed.rateType).toBe("AdValorem");
      expect(parsed.adValoremPercent).toBe(2.8);
      expect(parsed.isFree).toBe(false);
    });

    it("correctly parses Specific rates (cents to dollars)", () => {
      const parsed = RateParser.parse("1.5¢/kg");
      expect(parsed.rateType).toBe("Specific");
      expect(parsed.specificAmount).toBe(0.015);
      expect(parsed.specificUnit).toBe("kg");
    });

    it("correctly parses Compound rates", () => {
      const parsed = RateParser.parse("2.8% + 15¢/kg");
      expect(parsed.rateType).toBe("Compound");
      expect(parsed.adValoremPercent).toBe(2.8);
      expect(parsed.specificAmount).toBe(0.15);
      expect(parsed.specificUnit).toBe("kg");
    });

    it("safely handles complex unparsed expressions without silent fallbacks", () => {
      const parsed = RateParser.parse("Variable rate based on tariff note 12(b)");
      expect(parsed.rateType).toBe("Unparsed");
      expect(parsed.parseStatus).toBe("UNPARSED_FALLBACK");
    });
  });
});
