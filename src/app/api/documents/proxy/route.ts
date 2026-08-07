import { NextResponse } from "next/server";
import { getAccountContext } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const ctx = await getAccountContext().catch(() => null);
    if (!ctx || !ctx.accountId || !ctx.userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const blobUrl = searchParams.get("url");

    if (!blobUrl || !blobUrl.startsWith("https://")) {
      return new NextResponse("Invalid URL", { status: 400 });
    }

    // Allow all Vercel Blob Storage URLs (public and private buckets)
    if (!blobUrl.includes("vercel-storage.com")) {
      return new NextResponse("Invalid URL Host", { status: 403 });
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return new NextResponse("Server configuration error", { status: 500 });
    }

    // Fetch the private blob using the auth token
    const res = await fetch(blobUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return new NextResponse("Failed to fetch document", { status: res.status });
    }

    // Proxy the response
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/pdf",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
