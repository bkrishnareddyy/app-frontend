import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
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

export const POST = withAuthenticatedRoute<{ agentId: string }>(async ({ req, ctx, requestId, params }) => {
  const paramsVal = validatePathParams(params, paramsSchema, requestId);
  if ("response" in paramsVal) return paramsVal.response;
  const { agentId } = paramsVal.data;

  const accountId = ctx.accountId;
  const userId = ctx.userId;

  const body = await req.json().catch(() => ({}));

  let targetShipmentId = body.shipmentId;

  if (targetShipmentId) {
    const existing = await db.shipment.findUnique({
      where: { id: targetShipmentId },
      select: { id: true },
    });
    if (!existing) {
      targetShipmentId = null;
    }
  }

  if (!targetShipmentId) {
    const activeShipment = await db.shipment.findFirst({
      where: { accountId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (activeShipment) {
      targetShipmentId = activeShipment.id;
    } else {
      const count = await db.shipment.count({ where: { accountId } });
      const shipmentNumber = `SHP-2026-${String(count + 1).padStart(6, "0")}`;
      const newShipment = await db.shipment.create({
        data: {
          accountId,
          shipmentNumber,
          importerName: "Demo Import Account",
          poReference: `PO-${Math.floor(100000 + Math.random() * 900000)}`,
          entryType: "Consumption Entry",
          incoterm: "FOB SHENZHEN",
          status: "In Progress",
          readinessScore: 85,
          riskScore: 20,
        },
      });
      targetShipmentId = newShipment.id;
    }
  }

  try {
    let agentResult: any = null;
    let agentName = "";

    switch (agentId.toLowerCase()) {
      case "document-intake":
      case "1":
        agentName = "Document Intake Agent";
        agentResult = await DocumentIntakeAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          fileName: body.fileName || "Commercial_Invoice_INV-88421.pdf",
          fileUrl: body.fileUrl || "https://storage.qubere.ai/docs/inv-88421.pdf",
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
        agentResult = await ProductIntelligenceAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          lineItems: body.lineItems || [
            { lineNumber: 1, sku: "SKU-992-FAST", description: "Stainless Steel Fasteners 1/4-20" },
          ],
        });
        break;

      case "hts-classification":
      case "4":
        agentName = "HTS Classification Agent";
        agentResult = await HTSClassificationAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          productProfiles: body.productProfiles || [
            { lineNumber: 1, rawDescription: "Stainless Steel Fasteners 1/4-20 Grade 304" },
          ],
        });
        break;

      case "origin-rules":
      case "5":
        agentName = "Origin & Trade Agreement Agent";
        agentResult = await OriginRulesAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          lineItems: body.lineItems || [
            { lineNumber: 1, htsCode: "7318.15.2065", manufacturingCountry: "MX" },
          ],
        });
        break;

      case "valuation-assists":
      case "6":
        agentName = "Valuation & Assist Agent";
        agentResult = await ValuationAssistsAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          invoiceSubtotal: body.invoiceSubtotal || body.invoiceTotal || 48500.0,
        });
        break;

      case "compliance-audit":
      case "7":
        agentName = "Compliance & Audit Agent";
        agentResult = await ComplianceAuditAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          htsCode: body.htsCode || "7318.15.2065",
          countryOfOrigin: body.countryOfOrigin || "MX",
          supplierName: body.supplierName || "Shenzhen Hardware Manufacturing Corp",
        });
        break;

      case "filing-readiness":
      case "8":
        agentName = "Filing Readiness Agent";
        agentResult = await FilingReadinessAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          enteredValue: body.enteredValue || 48500.0,
          dutyDue: body.dutyDue || 0.0,
          lineItemCount: body.lineItemCount || 1,
        });
        break;

      case "customs-filing":
      case "9":
        agentName = "Customs Filing Agent (ACE/CBP)";
        agentResult = await CustomsFilingAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          enteredValue: body.enteredValue || 46800.0,
          dutyDue: body.dutyDue || 0.0,
        });
        break;

      case "response-management":
      case "10":
        agentName = "Response & Post-Summary Agent";
        agentResult = await ResponseManagementAgent.execute({
          accountId,
          userId,
          shipmentId: targetShipmentId,
          entryNumber: body.entryNumber || "QBR-2026-8849102",
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
  } catch (error: any) {
    console.error("POST /api/agents/[agentId] error:", error);
    return NextResponse.json(
      {
        error: "Agent Execution Failed",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
});
