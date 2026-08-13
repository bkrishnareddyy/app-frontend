import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { parseAndValidateBody, validatePathParams } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { buildErrorResponse } from "@/lib/api/error";
import { Resend } from "resend";
import { signUploadToken } from "@/lib/uploadToken";
import { z } from "zod";

const paramsSchema = z.object({ id: z.string().min(1) });

const bodySchema = z.object({
  documentType: z.string().min(1).max(200),
  recipientEmail: z.string().email(),
});

export const POST = withAuthenticatedRoute<{ id: string }>(
  async ({ req, ctx, requestId, params }) => {
    const paramsVal = validatePathParams(params, paramsSchema, requestId);
    if ("response" in paramsVal) return paramsVal.response;
    const { id: shipmentId } = paramsVal.data;

    const body = await parseAndValidateBody(req, bodySchema, requestId);
    if ("response" in body) return body.response;
    const { documentType, recipientEmail } = body.data;

    const shipment = await db.shipment.findFirst({
      where: { id: shipmentId, accountId: ctx.accountId },
      select: { id: true, shipmentNumber: true },
    });
    if (!shipment) {
      return buildErrorResponse(404, "NOT_FOUND", "Shipment not found", undefined, requestId);
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return buildErrorResponse(500, "CONFIG_ERROR", "Email service not configured", undefined, requestId);
    }

    const token = await signUploadToken({
      shipmentId,
      accountId: ctx.accountId,
      documentType,
      recipientEmail,
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.qubere.ai";
    const uploadUrl = `${appUrl}/upload/${token}`;
    const shipmentRef = shipment.shipmentNumber ?? shipmentId.slice(0, 8).toUpperCase();
    const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "noreply@qubere.ai";

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: [recipientEmail],
      subject: `Document Request: ${documentType} — Shipment ${shipmentRef}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1a1a2e">
          <h2 style="margin:0 0 16px;font-size:20px;font-weight:700">Document Upload Request</h2>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6">
            You have been asked to provide the following document for customs entry processing:
          </p>
          <div style="background:#f4f4f8;border-radius:10px;padding:16px 20px;margin:0 0 20px;border-left:4px solid #4f46e5">
            <strong style="font-size:15px">${documentType}</strong><br/>
            <span style="color:#666;font-size:13px">Shipment reference: ${shipmentRef}</span>
          </div>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#444">
            Please upload the document using the secure link below. The link is valid for <strong>7 days</strong>.
          </p>
          <a href="${uploadUrl}"
             style="display:inline-block;background:#4f46e5;color:white;font-weight:600;font-size:15px;
                    padding:12px 28px;border-radius:8px;text-decoration:none">
            Upload ${documentType} →
          </a>
          <p style="margin:24px 0 0;font-size:12px;color:#999;line-height:1.5">
            If the button does not work, paste this URL into your browser:<br/>
            <a href="${uploadUrl}" style="color:#4f46e5;word-break:break-all">${uploadUrl}</a>
          </p>
          <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
          <p style="margin:0;font-size:12px;color:#999">
            Sent by Qubere · Customs &amp; Trade Compliance Platform
          </p>
        </div>
      `,
    });

    if (error) {
      return buildErrorResponse(502, "EMAIL_SEND_FAILED", error.message, undefined, requestId);
    }

    return NextResponse.json({ sent: true, recipientEmail, documentType });
  },
  { write: true }
);
