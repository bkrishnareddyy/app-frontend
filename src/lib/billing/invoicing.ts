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

export async function createInvoiceFromCharges(input: CreateInvoiceInput) {
  if (!input.chargeIds.length) throw new Error("At least one charge is required");

  const charges = await db.shipmentCharge.findMany({
    where: {
      id: { in: input.chargeIds },
      accountId: input.accountId,
      invoiceLineId: null,
      status: "RATED",
      shipment: {
        clientId: input.clientId,
        ...(input.importerId ? { importerId: input.importerId } : {}),
      },
    },
  });

  if (charges.length !== new Set(input.chargeIds).size) {
    throw new Error("One or more selected charges are invalid, already invoiced, or belong to another client/account");
  }

  return db.$transaction(async (tx) => {
    // Re-check inside the transaction to prevent concurrent invoice creation from
    // attaching the same charge to two invoices.
    const lockedCharges = await tx.shipmentCharge.findMany({
      where: {
        id: { in: input.chargeIds },
        accountId: input.accountId,
        invoiceLineId: null,
        status: "RATED",
      },
    });
    if (lockedCharges.length !== charges.length) throw new Error("Selected charges changed while the invoice was being created");

    const count = await tx.invoice.count({ where: { accountId: input.accountId } });
    const yearMonth = new Date().toISOString().slice(0, 7).replace("-", "");
    const invoiceNumber = `INV-${yearMonth}-${String(count + 1).padStart(5, "0")}`;

    const subtotal = charges.reduce((sum, c) => sum + Number(c.grossAmount), 0);
    const totalDiscounts = charges.reduce((sum, c) => sum + Number(c.discountAmount), 0);
    const totalAmount = subtotal - totalDiscounts;

    const invoice = await tx.invoice.create({
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

    const groupedCharges = new Map<string, typeof charges>();
    for (const charge of charges) {
      const existing = groupedCharges.get(charge.description) ?? [];
      groupedCharges.set(charge.description, [...existing, charge]);
    }

    for (const [description, chargeList] of groupedCharges.entries()) {
      const lineQty = chargeList.reduce((sum, c) => sum + Number(c.quantity), 0);
      const lineAmount = chargeList.reduce((sum, c) => sum + Number(c.netAmount), 0);
      const firstCharge = chargeList[0];

      const line = await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          description,
          quantity: new Prisma.Decimal(lineQty),
          unitPrice: firstCharge.unitPrice,
          amount: new Prisma.Decimal(lineAmount),
        },
      });

      await tx.shipmentCharge.updateMany({
        where: { id: { in: chargeList.map((c) => c.id) }, accountId: input.accountId, invoiceLineId: null },
        data: { invoiceLineId: line.id, status: "INVOICED" },
      });
    }

    return invoice;
  });
}

export async function recordInvoicePayment(params: {
  accountId: string;
  invoiceId: string;
  amount: number;
  paymentMethod: string;
  referenceNo?: string;
  notes?: string;
}) {
  if (!Number.isFinite(params.amount) || params.amount <= 0) throw new Error("Payment amount must be greater than zero");

  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: params.invoiceId, accountId: params.accountId },
    });
    if (!invoice) throw new Error("Invoice not found");

    const paymentAmount = new Prisma.Decimal(params.amount);
    if (paymentAmount.gt(invoice.balanceDue)) throw new Error("Payment cannot exceed the outstanding invoice balance");

    const newPaid = invoice.paidAmount.add(paymentAmount);
    const newBalance = invoice.totalAmount.sub(newPaid);
    const newStatus = newBalance.lte(0) ? "PAID" : "PARTIALLY_PAID";

    const payment = await tx.payment.create({
      data: {
        accountId: params.accountId,
        invoiceId: params.invoiceId,
        amount: paymentAmount,
        paymentMethod: params.paymentMethod,
        referenceNo: params.referenceNo,
        notes: params.notes,
      },
    });

    await tx.invoice.update({
      where: { id: params.invoiceId },
      data: { paidAmount: newPaid, balanceDue: newBalance, status: newStatus },
    });

    return payment;
  });
}
