import { randomUUID } from "crypto";
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

function generateInvoiceNumber() {
  const yearMonth = new Date().toISOString().slice(0, 7).replace("-", "");
  return `INV-${yearMonth}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export async function createInvoiceFromCharges(input: CreateInvoiceInput) {
  if (!input.chargeIds.length) throw new Error("At least one charge is required");

  const uniqueChargeIds = [...new Set(input.chargeIds)];
  const charges = await db.shipmentCharge.findMany({
    where: {
      id: { in: uniqueChargeIds },
      accountId: input.accountId,
      invoiceLineId: null,
      status: "RATED",
      shipment: {
        accountId: input.accountId,
        clientId: input.clientId,
        ...(input.importerId ? { importerOfRecordId: input.importerId } : {}),
      },
    },
  });

  if (charges.length !== uniqueChargeIds.length) {
    throw new Error("One or more selected charges are invalid, already invoiced, or belong to another client/account");
  }

  return db.$transaction(async (tx) => {
    const lockedCharges = await tx.shipmentCharge.findMany({
      where: {
        id: { in: uniqueChargeIds },
        accountId: input.accountId,
        invoiceLineId: null,
        status: "RATED",
        shipment: {
          accountId: input.accountId,
          clientId: input.clientId,
          ...(input.importerId ? { importerOfRecordId: input.importerId } : {}),
        },
      },
    });
    if (lockedCharges.length !== uniqueChargeIds.length) {
      throw new Error("Selected charges changed while the invoice was being created");
    }

    const subtotal = lockedCharges.reduce((sum, c) => sum + Number(c.grossAmount), 0);
    const totalDiscounts = lockedCharges.reduce((sum, c) => sum + Number(c.discountAmount), 0);
    const totalAmount = subtotal - totalDiscounts;

    const invoice = await tx.invoice.create({
      data: {
        accountId: input.accountId,
        clientId: input.clientId,
        importerId: input.importerId,
        invoiceNumber: generateInvoiceNumber(),
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

    const groupedCharges = new Map<string, typeof lockedCharges>();
    for (const charge of lockedCharges) {
      const existing = groupedCharges.get(charge.description) ?? [];
      groupedCharges.set(charge.description, [...existing, charge]);
    }

    for (const [description, chargeList] of groupedCharges.entries()) {
      const lineQty = chargeList.reduce((sum, c) => sum + Number(c.quantity), 0);
      const lineAmount = chargeList.reduce((sum, c) => sum + Number(c.netAmount), 0);
      const firstCharge = chargeList[0];
      const shipmentIds = [...new Set(chargeList.map((c) => c.shipmentId))];

      const line = await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          shipmentId: shipmentIds.length === 1 ? shipmentIds[0] : null,
          description,
          quantity: new Prisma.Decimal(lineQty),
          unitPrice: firstCharge.unitPrice,
          amount: new Prisma.Decimal(lineAmount),
        },
      });

      const result = await tx.shipmentCharge.updateMany({
        where: {
          id: { in: chargeList.map((c) => c.id) },
          accountId: input.accountId,
          invoiceLineId: null,
          status: "RATED",
        },
        data: { invoiceLineId: line.id, status: "INVOICED" },
      });
      if (result.count !== chargeList.length) {
        throw new Error("A selected charge was invoiced concurrently; invoice creation was rolled back");
      }
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
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({ where: { id: params.invoiceId, accountId: params.accountId } });
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
