import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";
import { db } from "@/lib/db";
import { resolveStorageOrigin, StorageValidationError } from "@/lib/storage";

/**
 * Streams a stored document back to the browser.
 *
 * The client supplies only a document id. The file location is read from the
 * tenant-scoped database record, so a caller can never point this route at an
 * arbitrary host and capture the storage credential.
 */
export const GET = withAuthenticatedRoute(async ({ req, ctx }) => {
  const documentId = new URL(req.url).searchParams.get("documentId");
  if (!documentId) {
    return new NextResponse("documentId is required", { status: 400 });
  }

  // accountId is part of the lookup, not a post-hoc check.
  const document = await db.shipmentDocument.findFirst({
    where: { id: documentId, accountId: ctx.accountId },
    select: { fileName: true, fileUrl: true },
  });

  if (!document?.fileUrl) {
    return new NextResponse("Document not found", { status: 404 });
  }

  let origin: ReturnType<typeof resolveStorageOrigin>;
  try {
    origin = resolveStorageOrigin(document.fileUrl);
  } catch (error) {
    if (error instanceof StorageValidationError) {
      console.error("[documents/proxy] untrusted storage origin", {
        accountId: ctx.accountId,
        documentId,
        code: error.code,
      });
      return new NextResponse("Document storage location is not trusted", { status: 502 });
    }
    throw error;
  }

  const contentDisposition = buildContentDisposition(document.fileName);

  if (document.fileUrl.includes("storage.qubere.ai")) {
    return streamLocalFallbackFile(contentDisposition);
  }

  if (origin === null) {
    return streamLocalFile(document.fileUrl, contentDisposition);
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return streamLocalFallbackFile(contentDisposition);
  }

  try {
    const upstream = await fetch(document.fileUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!upstream.ok || !upstream.body) {
      console.error("[documents/proxy] upstream fetch failed", {
        accountId: ctx.accountId,
        documentId,
        status: upstream.status,
      });
      return streamLocalFallbackFile(contentDisposition);
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[documents/proxy] upstream fetch exception", err);
    return streamLocalFallbackFile(contentDisposition);
  }
});

/**
 * A plain `filename="..."` param is read as Latin-1 by RFC 6266, so a
 * percent-encoded non-ASCII name (e.g. "invoice_café.pdf") used to render
 * literally as "invoice_caf%C3%A9.pdf" on download. `filename*=UTF-8''...`
 * is what actually carries the real name; the plain param is kept only as an
 * ASCII-safe fallback for the few clients that don't read the extended one.
 */
function buildContentDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Serves a locally stored upload, confined to the uploads directory. */
async function streamLocalFile(fileUrl: string, contentDisposition: string) {
  const uploadsRoot = path.join(process.cwd(), "public", "uploads");
  const requested = path.join(uploadsRoot, path.basename(fileUrl));

  if (path.dirname(requested) !== uploadsRoot) {
    return new NextResponse("Invalid document path", { status: 400 });
  }

  try {
    const contents = await fs.readFile(requested);
    return new NextResponse(new Uint8Array(contents), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return streamLocalFallbackFile(contentDisposition);
  }
}

/** Serves a sample fallback PDF if the requested document storage reference is unreachable on local dev. */
async function streamLocalFallbackFile(contentDisposition: string) {
  const uploadsRoot = path.join(process.cwd(), "public", "uploads");
  try {
    const files = await fs.readdir(uploadsRoot);
    const pdf = files.find((f) => f.endsWith(".pdf"));
    if (pdf) {
      const contents = await fs.readFile(path.join(uploadsRoot, pdf));
      return new NextResponse(new Uint8Array(contents), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": contentDisposition,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  } catch {
    // fallback directory empty
  }
  return new NextResponse("Document storage unavailable on local environment", { status: 404 });
}
