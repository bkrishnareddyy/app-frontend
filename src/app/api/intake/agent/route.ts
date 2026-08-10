import { NextResponse } from "next/server";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { storeDocumentFile } from "@/lib/storage";
import {
  resolveTenantShipmentId,
  shipmentResolutionStatus,
  ShipmentResolutionError,
} from "@/modules/shipments/resolveShipment";
import { recordUnassignedIntake } from "@/modules/intake/unassignedIntake";
import { DocumentType } from "@/modules/intake/documentIntake.service";

export const POST = withAuthenticatedRoute(async ({ req, ctx }) => {
  const accountId = ctx.accountId;
  const userId = ctx.userId;

  const contentType = req.headers.get("content-type") || "";

  // Intake only ever acts on a file this route received and stored itself. The
  // previous defaults invented a name at https://storage.qubere.ai/docs/..., so
  // a request with no file still wrote a document row pointing at an origin the
  // file proxy refuses to fetch. A caller-supplied fileUrl is not accepted
  // either: the proxy later fetches stored URLs with the storage credential.
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      {
        error: "FILE_REQUIRED",
        message:
          "Document intake requires a multipart/form-data upload containing the file to read.",
      },
      { status: 400 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const shipmentId = formData.get("shipmentId") as string | null;
  const rawDocType = formData.get("docType") as string | null;

  if (!file) {
    return NextResponse.json(
      { error: "FILE_REQUIRED", message: "No file was included in the upload." },
      { status: 400 }
    );
  }

  const docTypeOverride: DocumentType | undefined =
    rawDocType && rawDocType !== "AUTO_DETECT"
      ? (rawDocType.toUpperCase().replace(/\s+/g, "_") as DocumentType)
      : undefined;

  const fileName = file.name;
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const storageResult = await storeDocumentFile(file, file.name);
  const fileUrl = storageResult.url;

  let targetShipmentId: string;
  try {
    targetShipmentId = await resolveTenantShipmentId(accountId, shipmentId);
  } catch (err) {
    if (err instanceof ShipmentResolutionError) {
      if (err.code === "TARGET_NOT_DETERMINED") {
        const intake = await recordUnassignedIntake(accountId, {
          source: "intake_agent",
          fileName,
          docType: docTypeOverride ?? null,
        });
        return NextResponse.json(
          {
            error: err.code,
            message: `${err.message} It was raised as an exception for someone to assign.`,
            exceptionId: intake.id,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: shipmentResolutionStatus(err.code) }
      );
    }
    throw err;
  }

  // Invoke Document Intake Agent directly with fileBuffer
  const { DocumentIntakeAgent } = await import("@/modules/intake/documentIntakeAgent");
  const result = await DocumentIntakeAgent.execute({
    accountId,
    userId,
    shipmentId: targetShipmentId,
    fileName,
    fileUrl,
    fileBuffer,
    docTypeOverride,
  });

  return NextResponse.json({
    success: true,
    result,
  });
}, { write: true });
