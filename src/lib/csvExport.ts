/** Browser-only: builds a CSV from already-rendered row data and triggers a download. */

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(","));
  return lines.join("\r\n");
}

export function downloadCsv(filename: string, headers: readonly string[], rows: readonly (readonly string[])[]): void {
  const csv = toCsv(headers, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
