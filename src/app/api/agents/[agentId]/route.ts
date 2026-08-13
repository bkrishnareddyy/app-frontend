import { NextResponse } from "next/server";
import type { AiSurface } from "@/lib/ai/aiQuota";
import { aiQuotaGate } from "@/lib/ai/aiQuotaGate";
import { handleApiError } from "@/lib/api/error";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import {
  resolveTenantShipmentId,
  shipmentResolutionStatus,
  ShipmentResolutionError,
} from "@/modules/shipments/resolveShipment";
import { DocumentIntakeAgent } from "@/modules/intake/documentIntakeAgent";
import { DocumentIntelligenceAgent } from "@/modules/agents/documentIntelligenceAgent";
import { ProductIntelligenceAgent } from "@/modules/agents/productIntelligenceAgent";
import { HTSClassificationAgent } from "@/modules/agents/htsClassificationAgent";
import { OriginRulesAgent } from "@/modules/agents/originRulesAgent";
import { ValuationAssistsAgent } from "@/modules/agents/valuationAssistsAgent";
import { ComplianceAuditAgent } from "@/modules/agents/complianceAuditAgent";
import { FilingReadinessAgent } from "@/modules/agents/filingReadinessAgent";
import { CustomsFilingAgent } from "@/modules/demo/customsFilingAgent";
import { ResponseManagementAgent } from "@/modules/demo/responseManagementAgent";
import { z } from "zod";

const paramsSchema = z.object({ agentId: z.string().min(1) });

/**
 * Which agents spend model tokens, for quota accounting. Origin Rules, Valuation
 * & Assists and Filing Readiness are absent because they are deterministic — they
 * call no model, so counting them would put a rate limit on arithmetic.
 *
 * The numeric aliases are the ones the UI still posts.
 */
const AGENT_AI_SURFACE: Record<string, AiSurface> = {
  "document-intake": "document-intake",
  "1": "document-intake",
  "document-intelligence": "document-intelligence",
  "2": "document-intelligence",
  "product-intelligence": "product-intelligence",
  "3": "product-intelligence",
  "hts-classification": "hts-classification",
  "4": "hts-classification",
  "compliance-audit": "compliance-audit",
  "7": "compliance-audit",
};

export const POST = withAuthenticatedRoute<{ agentId: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { agentId } = paramsVal.data;

  const accountId = ctx.accountId;
  const userId = ctx.userId;

  // Counted here, at the earliest point the surface is known and before any read
  // or write happens, because this is the last place a refusal is free: once an
  // agent starts persisting decisions and findings against a shipment, stopping
  // it leaves the shipment half-classified.
  //
  // With no AI quota variables configured this only counts and always allows, so
  // the agents behave exactly as they did before.
  const surface = AGENT_AI_SURFACE[agentId.toLowerCase()];
  if (surface) {
    const refused = await aiQuotaGate({ accountId, userId, surface, requestId });
    if (refused) return refused;
  }

  const body = await req.json().catch(() => ({}));

  let targetShipmentId: string;
  try {
    targetShipmentId = await resolveTenantShipmentId(accountId, body.shipmentId);
  } catch (err) {
    if (err instanceof ShipmentResolutionError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: shipmentResolutionStatus(err.code) }
      );
    }
    throw err;
  }

  try {
    let agentResult: unknown = null;
    let agentName = "";

    // Every agent below persists AgentDecision, ComplianceFinding, CustomsFiling
    // and ShipmentDocument rows against the caller's real tenant and shipment.
    // Missing input used to be filled with a hardcoded demo shipment (invoice
    // $48,500 of stainless fasteners from Shenzhen Hardware Manufacturing Corp),
    // so an under-specified request wrote fabricated compliance records onto a
    // live shipment. Reject instead.
    const missingInput = (fields: string[]) =>
      NextResponse.json(
        {
          error: "MISSING_AGENT_INPUT",
          message: `This agent requires ${fields.join(", ")}. Values are never substituted, because the agent writes to the shipment's compliance record.`,
          missingFields: fields,
        },
        { status: 400 }
      );

    switch (agentId.toLowerCase()) {
      case "document-intake":
      case "1":
        agentName = "Document Intake Agent";
        if (!body.fileName || !body.fileUrl) {
          return missingInput(["fileName", "fileUrl"]);
        }
        agentResult = await DocumentIntakeAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          fileName: body.fileName,
          fileUrl: body.fileUrl,
        });
        break;

      case "document-intelligence":
      case "2":
        agentName = "Document Intelligence Agent";
        agentResult = await DocumentIntelligenceAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          packetId: body.packetId,
        });
        break;

      case "product-intelligence":
      case "3":
        agentName = "Product Intelligence Agent";
        if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
          return missingInput(["lineItems"]);
        }
        agentResult = await ProductIntelligenceAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          lineItems: body.lineItems,
        });
        break;

      case "hts-classification":
      case "4":
        agentName = "HTS Classification Agent";
        if (!Array.isArray(body.productProfiles) || body.productProfiles.length === 0) {
          return missingInput(["productProfiles"]);
        }
        agentResult = await HTSClassificationAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          productProfiles: body.productProfiles,
        });
        break;

      case "origin-rules":
      case "5":
        agentName = "Origin & Trade Agreement Agent";
        if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
          return missingInput(["lineItems"]);
        }
        agentResult = await OriginRulesAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          lineItems: body.lineItems,
        });
        break;

      case "valuation-assists":
      case "6": {
        agentName = "Valuation & Assist Agent";
        const subtotal = Number.isFinite(body.invoiceSubtotal)
          ? body.invoiceSubtotal
          : Number.isFinite(body.invoiceTotal)
            ? body.invoiceTotal
            : null;
        if (subtotal === null) {
          return missingInput(["invoiceSubtotal"]);
        }
        agentResult = await ValuationAssistsAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          invoiceSubtotal: subtotal,
        });
        break;
      }

      case "compliance-audit":
      case "7":
        agentName = "Compliance & Audit Agent";
        if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
          return missingInput(["lineItems"]);
        }
        agentResult = await ComplianceAuditAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          lineItems: body.lineItems,
          destinationCountry: body.destinationCountry,
          importerName: body.importerName,
          incoterm: body.incoterm,
          exporterName: body.exporterName,
          supplierName: body.supplierName,
        });
        break;

      case "filing-readiness":
      case "8":
        agentName = "Filing Readiness Agent";
        if (!Number.isFinite(body.enteredValue) || !Number.isFinite(body.lineItemCount)) {
          return missingInput(["enteredValue", "lineItemCount"]);
        }
        agentResult = await FilingReadinessAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          enteredValue: body.enteredValue,
          // Unknown duty stays null; it must not be declared as $0.00.
          dutyDue: Number.isFinite(body.dutyDue) ? body.dutyDue : null,
          lineItemCount: body.lineItemCount,
          entryType: body.entryType,
        });
        break;

      case "customs-filing":
      case "9":
        agentName = "Customs Filing Agent (ACE/CBP)";
        if (!Number.isFinite(body.enteredValue)) {
          return missingInput(["enteredValue"]);
        }
        agentResult = await CustomsFilingAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          enteredValue: body.enteredValue,
          dutyDue: Number.isFinite(body.dutyDue) ? body.dutyDue : null,
        });
        break;

      case "response-management":
      case "10":
        agentName = "Response & Post-Summary Agent";
        if (!body.entryNumber) {
          return missingInput(["entryNumber"]);
        }
        agentResult = await ResponseManagementAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          entryNumber: body.entryNumber,
        });
        break;

      default:
        return NextResponse.json(
          {
            error: `Unknown Agent ID '${agentId}'. Valid options: document-intake, document-intelligence, product-intelligence, hts-classification, origin-rules, valuation-assists, compliance-audit, filing-readiness, customs-filing, response-management (or 1 to 10).`,
          },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      agentId,
      agentName,
      result: agentResult,
    });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}, { write: true });
