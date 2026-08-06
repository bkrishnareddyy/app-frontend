import { db } from "@/lib/db";
import { assertDemoSeedingAllowed } from "@/lib/environment";

export async function seedHtsMaster() {
  assertDemoSeedingAllowed();

  const count = await db.hTSCode.count();
  if (count === 0) {
    await db.hTSCode.createMany({
      data: [
        {
          htsCode10: "8481.80.5090",
          description: "Taps, cocks, valves and similar appliances for pipes, boiler shells, tanks, vats or the like: Valves for oleohydraulic or pneumatic transmissions",
          chapterNumber: "84",
          headingNumber: "8481",
          subheadingNumber: "8481.80",
          unitOfQuantity: "PCS",
          generalDutyRate: "2.8%",
          specialRatePrograms: { USMCA: "Free", KORUS: "Free", AU: "Free" },
          column2DutyRate: "35%",
          section301Applicable: true,
          section301AdditionalRate: 7.5,
          sourceRevision: "HTSUS 2026 Rev 1",
        },
        {
          htsCode10: "8537.10.2030",
          description: "Boards, panels, consoles, desks, cabinets and other bases, equipped with two or more apparatus of heading 8535 or 8536, for electric control or the distribution of electricity: For a voltage not exceeding 1,000 V",
          chapterNumber: "85",
          headingNumber: "8537",
          subheadingNumber: "8537.10",
          unitOfQuantity: "PCS",
          generalDutyRate: "2.7%",
          specialRatePrograms: { USMCA: "Free", KORUS: "Free" },
          column2DutyRate: "35%",
          section301Applicable: true,
          section301AdditionalRate: 25.0,
          sourceRevision: "HTSUS 2026 Rev 1",
        },
        {
          htsCode10: "7318.15.2065",
          description: "Screws, bolts, nuts, coach screws, screw hooks, rivets, cotters, cotter pins, washers and similar articles, of iron or steel: Other screws and bolts",
          chapterNumber: "73",
          headingNumber: "7318",
          subheadingNumber: "7318.15",
          unitOfQuantity: "KG",
          generalDutyRate: "6.2%",
          specialRatePrograms: { USMCA: "Free" },
          column2DutyRate: "45%",
          section232Applicable: true,
          section232AdditionalRate: 25.0,
          sourceRevision: "HTSUS 2026 Rev 1",
        },
      ],
      skipDuplicates: true,
    });
    console.log("Seeded HTS Master database successfully.");
  }
}
