import { describe, it, expect } from "vitest";
import { parseOfacXmlStream } from "@/modules/screening/ofacSdnIngestionService";

// Real entries trimmed directly from Treasury's live sdn.xml and
// consolidated.xml (fetched 2026-08-14) -- not synthetic. Only the
// Record_Count header is adjusted to match this trimmed subset (5), since
// the real files report their own full-list totals (19199 / 481).
const REAL_TRIMMED_SDN_XML = `<?xml version="1.0" standalone="yes"?>
<sdnList xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML">
  <publshInformation>
    <Publish_Date>08/07/2026</Publish_Date>
    <Record_Count>5</Record_Count>
  </publshInformation>
  <sdnEntry>
    <uid>36</uid>
    <lastName>AEROCARIBBEAN AIRLINES</lastName>
    <sdnType>Entity</sdnType>
    <programList>
      <program>CUBA</program>
    </programList>
    <akaList>
      <aka>
        <uid>12</uid>
        <type>a.k.a.</type>
        <category>strong</category>
        <lastName>AERO-CARIBBEAN</lastName>
      </aka>
    </akaList>
    <addressList>
      <address>
        <uid>25</uid>
        <city>Havana</city>
        <country>Cuba</country>
      </address>
    </addressList>
  </sdnEntry>
  <sdnEntry>
    <uid>173</uid>
    <lastName>ANGLO-CARIBBEAN CO., LTD.</lastName>
    <sdnType>Entity</sdnType>
    <programList>
      <program>CUBA</program>
    </programList>
    <akaList>
      <aka>
        <uid>57</uid>
        <type>a.k.a.</type>
        <category>strong</category>
        <lastName>AVIA IMPORT</lastName>
      </aka>
    </akaList>
    <addressList>
      <address>
        <uid>129</uid>
        <address1>Ibex House, The Minories</address1>
        <city>London</city>
        <postalCode>EC3N 1DY</postalCode>
        <country>United Kingdom</country>
      </address>
    </addressList>
  </sdnEntry>
  <sdnEntry>
    <uid>306</uid>
    <lastName>BANCO NACIONAL DE CUBA</lastName>
    <sdnType>Entity</sdnType>
    <programList>
      <program>CUBA</program>
    </programList>
    <akaList>
      <aka>
        <uid>219</uid>
        <type>a.k.a.</type>
        <category>weak</category>
        <lastName>BNC</lastName>
      </aka>
      <aka>
        <uid>220</uid>
        <type>a.k.a.</type>
        <category>strong</category>
        <lastName>NATIONAL BANK OF CUBA</lastName>
      </aka>
    </akaList>
    <addressList>
      <address>
        <uid>199</uid>
        <address1>Zweierstrasse 35</address1>
        <city>Zurich</city>
        <postalCode>CH-8022</postalCode>
        <country>Switzerland</country>
      </address>
      <address>
        <uid>200</uid>
        <address1>Avenida de Concha Espina 8</address1>
        <city>Madrid</city>
        <postalCode>E-28036</postalCode>
        <country>Spain</country>
      </address>
    </addressList>
  </sdnEntry>
  <sdnEntry>
    <uid>424</uid>
    <lastName>BOUTIQUE LA MAISON</lastName>
    <sdnType>Entity</sdnType>
    <programList>
      <program>CUBA</program>
    </programList>
    <addressList>
      <address>
        <uid>247</uid>
        <address1>42 Via Brasil</address1>
        <city>Panama City</city>
        <country>Panama</country>
      </address>
    </addressList>
  </sdnEntry>
  <sdnEntry>
    <uid>9640</uid>
    <firstName>Mohammed</firstName>
    <lastName>ABU TEIR</lastName>
    <sdnType>Individual</sdnType>
    <programList>
      <program>NS-PLC</program>
    </programList>
    <akaList>
      <aka>
        <uid>9152</uid>
        <type>a.k.a.</type>
        <category>strong</category>
        <lastName>ABU TAIR</lastName>
        <firstName>Mohammed Mahmud</firstName>
      </aka>
    </akaList>
    <dateOfBirthList>
      <dateOfBirthItem>
        <uid>4698</uid>
        <dateOfBirth>1951</dateOfBirth>
        <mainEntry>true</mainEntry>
      </dateOfBirthItem>
    </dateOfBirthList>
    <placeOfBirthList>
      <placeOfBirthItem>
        <uid>4699</uid>
        <placeOfBirth>Umm Tuba</placeOfBirth>
        <mainEntry>true</mainEntry>
      </placeOfBirthItem>
    </placeOfBirthList>
  </sdnEntry>
</sdnList>`;

function streamFromString(xml: string): ReadableStream<Uint8Array> {
  return new Response(xml).body as ReadableStream<Uint8Array>;
}

describe("parseOfacXmlStream — real trimmed OFAC SDN fixture", () => {
  it("parses the header Record_Count and Publish_Date", async () => {
    const result = await parseOfacXmlStream(streamFromString(REAL_TRIMMED_SDN_XML));
    expect(result.reportedTotal).toBe(5);
    expect(result.publishDate?.toISOString().slice(0, 10)).toBe("2026-08-07");
  });

  it("parses all 5 entries", async () => {
    const result = await parseOfacXmlStream(streamFromString(REAL_TRIMMED_SDN_XML));
    expect(result.entries).toHaveLength(5);
  });

  it("extracts an Entity with a single aka and single address", async () => {
    const { entries } = await parseOfacXmlStream(streamFromString(REAL_TRIMMED_SDN_XML));
    const aero = entries.find((e) => e.uid === "36")!;
    expect(aero.lastName).toBe("AEROCARIBBEAN AIRLINES");
    expect(aero.sdnType).toBe("Entity");
    expect(aero.programs).toEqual(["CUBA"]);
    expect(aero.akas).toEqual([{ lastName: "AERO-CARIBBEAN" }]);
    expect(aero.addresses).toEqual([{ city: "Havana", country: "Cuba" }]);
  });

  it("extracts multiple akas and multiple addresses on one entry", async () => {
    const { entries } = await parseOfacXmlStream(streamFromString(REAL_TRIMMED_SDN_XML));
    const banco = entries.find((e) => e.uid === "306")!;
    expect(banco.akas).toHaveLength(2);
    expect(banco.akas.map((a) => a.lastName)).toEqual(["BNC", "NATIONAL BANK OF CUBA"]);
    expect(banco.addresses).toHaveLength(2);
    expect(banco.addresses[0].country).toBe("Switzerland");
    expect(banco.addresses[1].country).toBe("Spain");
  });

  it("handles an entry with no akaList at all", async () => {
    const { entries } = await parseOfacXmlStream(streamFromString(REAL_TRIMMED_SDN_XML));
    const boutique = entries.find((e) => e.uid === "424")!;
    expect(boutique.akas).toEqual([]);
    expect(boutique.addresses).toHaveLength(1);
  });

  it("extracts an Individual with firstName, DOB/POB, and a firstName+lastName aka", async () => {
    const { entries } = await parseOfacXmlStream(streamFromString(REAL_TRIMMED_SDN_XML));
    const individual = entries.find((e) => e.uid === "9640")!;
    expect(individual.sdnType).toBe("Individual");
    expect(individual.firstName).toBe("Mohammed");
    expect(individual.lastName).toBe("ABU TEIR");
    expect(individual.akas).toEqual([{ lastName: "ABU TAIR", firstName: "Mohammed Mahmud" }]);
    expect(individual.dateOfBirth).toBe("1951");
    expect(individual.placeOfBirth).toBe("Umm Tuba");
  });

  it("exposes the raw material the circuit breaker acts on: a mismatched Record_Count is detectable", async () => {
    // Same 5 real entries, but the header claims a different total --
    // simulates a truncated/corrupted feed. fetchAndIngestList() throws
    // and writes nothing when entries.length !== reportedTotal; this test
    // verifies the parser surfaces both numbers accurately so that check
    // is meaningful rather than testing the DB-touching method directly.
    const corrupted = REAL_TRIMMED_SDN_XML.replace("<Record_Count>5</Record_Count>", "<Record_Count>19199</Record_Count>");
    const result = await parseOfacXmlStream(streamFromString(corrupted));
    expect(result.entries.length).toBe(5);
    expect(result.reportedTotal).toBe(19199);
    expect(result.entries.length).not.toBe(result.reportedTotal);
  });

  it("returns null reportedTotal when the header is missing entirely", async () => {
    const noHeader = REAL_TRIMMED_SDN_XML.replace(
      /<publshInformation>[\s\S]*?<\/publshInformation>/,
      ""
    );
    const result = await parseOfacXmlStream(streamFromString(noHeader));
    expect(result.reportedTotal).toBeNull();
    expect(result.entries).toHaveLength(5);
  });
});
