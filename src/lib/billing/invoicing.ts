import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

export interface CreateInvoiceInput {
  accountId: string;
  clientId: string;
  importerId?: string;
  dueDate: Date;
  chargeIds: string[];
  notes?: string;
}

/**
 * Generates an invoice grouping selected unbilled shipment charges.
 */
export async function createInvoiceFromCharges(input: CreateInvoiceInput) {
  const charges = await db.shipmentCharge.findMany({
    where: {
      id: { in: input.chargeIds },
      accountId: input.accountId,
      invoiceLineId: null, // Must be unbilled
    },
  });

  if (charges.length === 0) {
    throw new Error("No unbilled charges selected for invoice generation.");
  }

  // Generate unique invoice number: INV-YYYYMM-[Count+1]
  const count = await db.invoice.count({ where: { accountId: input.accountId } });
  const yearMonth = new Date().toISOString().slice(0, 7).replace("-", "");
  const invoiceNumber = `INV-${yearMonth}-${String(count + 1).padStart(5, "0")}`;

  let subtotal = 0;
  let totalDiscounts = 0;

  for (const c of charges) {
    subtotal += Number(c.grossAmount);
    totalDiscounts += Number(c.discountAmount);
  }

  const totalAmount = subtotal - totalDiscounts;

  const invoice = await db.invoice.create({
    data: {
      accountId: input.accountId,
      clientId: input.clientId,
      importerId: input.importerId,
      invoiceNumber,
      status: "DRAFT",
      dueDate: input.dueDate,
      subtotal: new Prisma.Decimal(subtotal),
      totalDiscounts: new Prisma.Decimal(totalDiscounts),
      totalAmount: new Prisma.Decimal(totalAmount),
      paidAmount: new Prisma.Decimal(0),
      balanceDue: new Prisma.Decimal(totalAmount),
      notes: input.notes,
    },
  });

  // Group charges by description to create InvoiceLines
  const groupedCharges = new Map<string, typeof charges>();
  for (const charge of charges) {
    const key = charge.description;
    const existing = groupedCharges.get(key) ?? [];
    groupedCharges.set(key, [...existing, charge]);
  }

  for (const [description, chargeList] of groupedCharges.entries()) {
    let lineQty = 0;
    let lineAmount = 0;
    const firstCharge = chargeList[0];

    for (const c of chargeList) {
      lineQty += Number(c.quantity);
      lineAmount += Number(c.netAmount);
    }

    const line = await db.invoiceLine.create({
      data: {
        invoiceId: invoice.id,
        description,
        quantity: new Prisma.Decimal(lineQty),
        unitPrice: firstCharge.unitPrice,
        amount: new Prisma.Decimal(lineAmount),
      },
    });

    // Link charges to this invoice line and mark status INVOICED
    await db.shipmentCharge.updateMany({
      where: { id: { in: chargeList.map((c) => c.id) } },
      data: {
        invoiceLineId: line.id,
        status: "INVOICED",
      },
    });
  }

  return invoice;
}

/**
 * Records a customer payment against an invoice and updates remaining balance due.
 */
export async function recordInvoicePayment(params: {
  accountId: string;
  invoiceId: string;
  amount: number;
  paymentMethod: string;
  referenceNo?: string;
  notes?: string;
}) {
  const invoice = await db.invoice.findUnique({
    where: { id: params.invoiceId },
  });

  if (!invoice) throw new Error("Invoice not found");

  const paymentAmount = new Prisma.Decimal(params.amount);
  const newPaid = invoice.paidAmount.add(paymentAmount);
  const newBalance = invoice.totalAmount.sub(newPaid);

  let newStatus = invoice.status;
  if (newBalance.lte(0)) {
    newStatus = "PAID";
  } else if (newPaid.gt(0)) {
    newStatus = "PARTIALLY_PAID";
  }

  const payment = await db.payment.create({
    data: {
      accountId: params.accountId,
      invoiceId: params.invoiceId,
      amount: paymentAmount,
      paymentMethod: params.paymentMethod,
      referenceNo: params.referenceNo,
      notes: params.notes,
    },
  });

  await db.invoice.update({
    where: { id: params.invoiceId },
    data: {
      paidAmount: newPaid,
      balanceDue: newBalance,
      status: newStatus,
    },
  });

  return payment;
}
