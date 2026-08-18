import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { generateSimplePdfBuffer } from "@/lib/pdf/pdfGenerator";
import ExcelJS from "exceljs";

type DetailLevel = "summary" | "detailed" | "full";

async function fetchInvoiceForExport(invoiceId: string, accountId: string) {
  return db.invoice.findFirst({
    where: { id: invoiceId, accountId },
    include: {
      client: { select: { name: true } },
      importer: { select: { name: true } },
      payments: { orderBy: { paymentDate: "asc" } },
      lines: {
        include: {
          shipment: { select: { id: true, shipmentNumber: true } },
          charges: {
            include: {
              usageEvent: { select: { id: true, eventCode: true, occurredAt: true, sourceAgent: true } },
            },
          },
        },
      },
    },
  });
}

function buildLineRows(invoice: NonNullable<Awaited<ReturnType<typeof fetchInvoiceForExport>>>, detail: DetailLevel) {
  const rows: Array<Record<string, string | number>> = [];
  for (const line of invoice.lines) {
    if (detail === "summary") {
      rows.push({
        "Description": line.description,
        "Quantity": Number(line.quantity),
        "Unit Price": Number(line.unitPrice),
        "Amount": Number(line.amount),
      });
    } else if (detail === "detailed") {
      for (const charge of line.charges) {
        rows.push({
          "Description": line.description,
          "Shipment": line.shipment?.shipmentNumber ?? "",
          "Charge Gross": Number(charge.grossAmount),
          "Charge Net": Number(charge.netAmount),
          "Line Amount": Number(line.amount),
        });
      }
      if (line.charges.length === 0) {
        rows.push({
          "Description": line.description,
          "Shipment": line.shipment?.shipmentNumber ?? "",
          "Charge Gross": Number(line.amount),
          "Charge Net": Number(line.amount),
          "Line Amount": Number(line.amount),
        });
      }
    } else {
      // full — transaction-level with usage event detail
      for (const charge of line.charges) {
        rows.push({
          "Description": line.description,
          "Shipment": line.shipment?.shipmentNumber ?? "",
          "Usage Event Code": charge.usageEvent?.eventCode ?? "",
          "Usage Event Date": charge.usageEvent ? new Date(charge.usageEvent.occurredAt).toISOString() : "",
          "Source Agent": charge.usageEvent?.sourceAgent ?? "",
          "Charge Gross": Number(charge.grossAmount),
          "Charge Net": Number(charge.netAmount),
          "Line Amount": Number(line.amount),
        });
      }
    }
  }
  return rows;
}

export const GET = withAuthenticatedRoute<{ id: string }>(
  async ({ req, ctx, params }) => {
    const { id } = params;
    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "pdf";
    const detail = (url.searchParams.get("detail") ?? "summary") as DetailLevel;

    const invoice = await fetchInvoiceForExport(id, ctx.accountId);
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    const clientName = invoice.client?.name ?? invoice.importer?.name ?? "Customer";

    if (format === "pdf") {
      const rows = buildLineRows(invoice, detail);
      const buffer = generateSimplePdfBuffer({
        title: `Invoice ${invoice.invoiceNumber}`,
        subtitle: clientName,
        metadata: {
          "Invoice Number": invoice.invoiceNumber,
          "Client": clientName,
          "Issue Date": new Date(invoice.issueDate).toLocaleDateString(),
          "Due Date": new Date(invoice.dueDate).toLocaleDateString(),
          "Status": invoice.status,
          "Total Amount": `$${Number(invoice.totalAmount).toFixed(2)}`,
          "Paid Amount": `$${Number(invoice.paidAmount).toFixed(2)}`,
          "Balance Due": `$${Number(invoice.balanceDue).toFixed(2)}`,
        },
        sections: rows.map((row) => ({
          heading: String(row["Description"] ?? ""),
          items: Object.entries(row)
            .filter(([k]) => k !== "Description")
            .map(([label, value]) => ({ label, value: typeof value === "number" ? `$${value.toFixed(2)}` : String(value) })),
        })),
      });
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
        },
      });
    }

    if (format === "csv") {
      const rows = buildLineRows(invoice, detail);
      if (!rows.length) return new Response("", { headers: { "Content-Type": "text/csv" } });
      const headers = Object.keys(rows[0]);
      const csvLines = [
        headers.join(","),
        ...rows.map((row) =>
          headers.map((h) => {
            const val = String(row[h] ?? "");
            return val.includes(",") || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
          }).join(",")
        ),
      ];
      return new Response(csvLines.join("\r\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.csv"`,
        },
      });
    }

    if (format === "xlsx") {
      const rows = buildLineRows(invoice, detail);
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(invoice.invoiceNumber);

      // Header metadata block
      sheet.addRow(["Invoice Number", invoice.invoiceNumber]);
      sheet.addRow(["Client", clientName]);
      sheet.addRow(["Issue Date", new Date(invoice.issueDate).toLocaleDateString()]);
      sheet.addRow(["Due Date", new Date(invoice.dueDate).toLocaleDateString()]);
      sheet.addRow(["Total Amount", Number(invoice.totalAmount)]);
      sheet.addRow(["Paid Amount", Number(invoice.paidAmount)]);
      sheet.addRow(["Balance Due", Number(invoice.balanceDue)]);
      sheet.addRow([]);

      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true };
        for (const row of rows) {
          sheet.addRow(headers.map((h) => row[h] ?? ""));
        }
      }

      const arrayBuffer = await workbook.xlsx.writeBuffer();
      return new Response(arrayBuffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.xlsx"`,
        },
      });
    }

    return NextResponse.json({ error: "Unsupported format. Use ?format=pdf|csv|xlsx" }, { status: 400 });
  },
  { permission: "billing.invoice.manage" }
);
