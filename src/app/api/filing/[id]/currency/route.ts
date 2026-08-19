import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { createAuditLog, AuditAction } from "@/lib/audit";
import { extractedCurrencies } from "@/modules/documents/extractedCurrency";
import {
  getCustomsValuationCurrency,
  normalizeCurrencyCode,
  resolveFilingCurrencyContext,
} from "@/lib/canonicalMessaging/currencyContext";

const paramsSchema = z.object({ id: z.string().min(1) });
const bodySchema = z.object({
  commercialCurrency: z.string().trim().length(3),
  customsCurrency: z.string().trim().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  exchangeRateSource: z.string().trim().min(1).optional(),
  exchangeRateEffectiveDate: z.string().datetime().optional(),
});

function normalizeFilingFinancialJson(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { fees: value };
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export const GET = withAuthenticatedRoute<{ id: string }>(async ({ ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  const filing = await db.customsFiling.findFirst({
    where: { id: paramsVal.data.id, accountId: ctx.accountId },
    include: {
      shipment: {
        select: {
          destinationCountry: true,
          documents: { select: { extractedJson: true } },
        },
      },
    },
  });
  if (!filing) return NextResponse.json({ error: "Filing not found" }, { status: 404 });

  const dutyData = normalizeFilingFinancialJson(filing.dutyBreakdown);
  const storedContext = dutyData.currencyContext as Record<string, unknown> | undefined;
  const country = filing.country || filing.shipment?.destinationCountry || "US";
  const customsCurrency = storedContext?.customsCurrency
    ? normalizeCurrencyCode(storedContext.customsCurrency)
    : getCustomsValuationCurrency(country);
  const detectedCurrencies = filing.shipment ? extractedCurrencies(filing.shipment.documents) : [];
  const detectedCommercialCurrency = detectedCurrencies.length === 1 ? detectedCurrencies[0] : null;
  const currencyConflict = detectedCurrencies.length > 1;

  const commercialCurrency = storedContext?.commercialCurrency
    ? normalizeCurrencyCode(storedContext.commercialCurrency)
    : detectedCommercialCurrency ?? customsCurrency;
  const crossCurrency = commercialCurrency !== customsCurrency;
  const currencyContext = {
    commercialCurrency,
    customsCurrency,
    exchangeRate: Number(storedContext?.exchangeRate ?? (crossCurrency ? 0 : 1)),
    exchangeRateSource: String(storedContext?.exchangeRateSource ?? (crossCurrency ? "" : "IDENTITY")),
    exchangeRateEffectiveDate: String(storedContext?.exchangeRateEffectiveDate ?? new Date().toISOString()),
  };

  return NextResponse.json({
    currencyContext,
    country,
    detectedCommercialCurrency,
    detectedCurrencies,
    currencyConflict,
    locked: filing.submittedAt !== null,
  });
});

export const PATCH = withAuthenticatedRoute<{ id: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid currency configuration", details: parsed.error.flatten() }, { status: 400 });
  }

  const filing = await db.customsFiling.findFirst({
    where: { id: paramsVal.data.id, accountId: ctx.accountId },
    include: { shipment: { select: { destinationCountry: true } } },
  });
  if (!filing) return NextResponse.json({ error: "Filing not found" }, { status: 404 });
  if (filing.submittedAt) {
    return NextResponse.json({ error: "Currency configuration is locked after filing submission" }, { status: 409 });
  }

  const country = filing.country || filing.shipment?.destinationCountry || "US";
  const customsCurrency = parsed.data.customsCurrency
    ? normalizeCurrencyCode(parsed.data.customsCurrency)
    : getCustomsValuationCurrency(country);
  const commercialCurrency = normalizeCurrencyCode(parsed.data.commercialCurrency);
  const requiresConversion = commercialCurrency !== customsCurrency;

  if (requiresConversion && parsed.data.exchangeRate == null) {
    return NextResponse.json({ error: "Exchange rate is required for cross-currency filings" }, { status: 400 });
  }
  if (requiresConversion && !parsed.data.exchangeRateSource) {
    return NextResponse.json({ error: "Exchange-rate source is required for cross-currency filings" }, { status: 400 });
  }
  if (requiresConversion && !parsed.data.exchangeRateEffectiveDate) {
    return NextResponse.json({ error: "Exchange-rate effective date is required for cross-currency filings" }, { status: 400 });
  }

  const currencyContext = resolveFilingCurrencyContext(country, {
    currencyContext: {
      commercialCurrency,
      customsCurrency,
      exchangeRate: parsed.data.exchangeRate ?? 1,
      exchangeRateSource: parsed.data.exchangeRateSource ?? "IDENTITY",
      exchangeRateEffectiveDate: parsed.data.exchangeRateEffectiveDate ?? new Date().toISOString(),
    },
  });

  const existingDutyData = normalizeFilingFinancialJson(filing.dutyBreakdown);
  const dutyBreakdown = asInputJson({ ...existingDutyData, currencyContext });

  await db.customsFiling.update({ where: { id: filing.id }, data: { dutyBreakdown } });
  await createAuditLog({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: AuditAction.FILING_UPDATED,
    entity: "CustomsFiling",
    entityId: filing.id,
    metadata: { fields: ["currencyContext"], currencyContext },
  });

  return NextResponse.json({ success: true, currencyContext });
}, { permission: "filings.create", write: true });
