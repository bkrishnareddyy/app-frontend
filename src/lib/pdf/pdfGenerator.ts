/**
 * Shared server-side PDF generator.
 * Produces valid %PDF-1.4 binary streams containing structured document headers,
 * key-value metadata tables, and data rows.
 */
export function generateSimplePdfBuffer(options: {
  title: string;
  subtitle?: string;
  metadata?: Record<string, string>;
  sections?: Array<{
    heading: string;
    items: Array<{ label: string; value: string }>;
  }>;
}): Buffer {
  const sanitize = (text?: string | number | null) => {
    if (text === null || text === undefined) return "-";
    return String(text).replace(/[()\\]/g, "");
  };

  const title = sanitize(options.title);
  const subtitle = sanitize(options.subtitle || "Compliance Record");

  const linesStreamCommands: string[] = [];
  let y = 700;

  if (options.metadata) {
    for (const [key, val] of Object.entries(options.metadata)) {
      if (y < 80) break;
      const k = sanitize(key);
      const v = sanitize(val);
      linesStreamCommands.push(
        `BT /F1 9 Tf 50 ${y} Td (${k}:) Tj /F2 9 Tf 180 ${y} Td (${v}) Tj ET`
      );
      y -= 16;
    }
    y -= 10;
  }

  if (options.sections) {
    for (const sec of options.sections) {
      if (y < 100) break;
      linesStreamCommands.push(
        `0.9 0.9 0.95 rg 40 ${y - 4} 532 18 re f 0 0 0 rg`,
        `BT /F1 10 Tf 45 ${y} Td (${sanitize(sec.heading)}) Tj ET`
      );
      y -= 22;

      for (const item of sec.items) {
        if (y < 80) break;
        linesStreamCommands.push(
          `BT /F1 8.5 Tf 50 ${y} Td (${sanitize(item.label)}:) Tj /F2 8.5 Tf 200 ${y} Td (${sanitize(item.value)}) Tj ET`
        );
        y -= 15;
      }
      y -= 10;
    }
  }

  const streamContent = [
    "q",
    "0.15 0.25 0.55 rg 40 730 532 45 re f",
    `1 1 1 rg BT /F1 14 Tf 55 750 Td (${title}) Tj ET`,
    `1 1 1 rg BT /F2 9 Tf 55 738 Td (${subtitle}) Tj ET`,
    "0 0 0 rg",
    ...linesStreamCommands,
    "Q",
  ].join("\n");

  const pdf = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >> endobj",
    `4 0 obj << /Length ${Buffer.byteLength(streamContent)} >> stream`,
    streamContent,
    "endstream endobj",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj",
    "6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "xref",
    "0 7",
    "0000000000 65535 f ",
    "0000000009 00000 n ",
    "0000000058 00000 n ",
    "0000000115 00000 n ",
    "0000000260 00000 n ",
    "0000000350 00000 n ",
    "0000000425 00000 n ",
    "trailer << /Size 7 /Root 1 0 R >>",
    "startxref",
    "495",
    "%%EOF",
  ].join("\n");

  return Buffer.from(pdf, "utf-8");
}
