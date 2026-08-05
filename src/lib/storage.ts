import { put } from "@vercel/blob";
import fs from "fs";
import path from "path";

export interface StorageUploadResult {
  url: string;
  filename: string;
  size: number;
  provider: "vercel-blob" | "local-fs";
}

export async function storeDocumentFile(
  file: File,
  filename: string
): Promise<StorageUploadResult> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const isProd = process.env.NODE_ENV === "production" || Boolean(token);

  // Buffer conversion
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Provider 1: Vercel Blob Storage
  if (token) {
    try {
      console.log(`[Storage] Uploading ${filename} (${file.size} bytes) to Vercel Blob Storage...`);
      const blob = await put(`documents/${Date.now()}-${filename}`, buffer, {
        access: "public",
        token,
      });

      return {
        url: blob.url,
        filename,
        size: file.size,
        provider: "vercel-blob",
      };
    } catch (err) {
      console.warn("[Storage] Vercel Blob upload failed, falling back to local storage:", err);
    }
  }

  // Provider 2: Local Filesystem Storage (public/uploads/)
  try {
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const safeFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const filePath = path.join(uploadDir, safeFilename);

    fs.writeFileSync(filePath, buffer);
    const publicUrl = `/uploads/${safeFilename}`;

    console.log(`[Storage] Saved ${filename} locally to ${publicUrl}`);

    return {
      url: publicUrl,
      filename,
      size: file.size,
      provider: "local-fs",
    };
  } catch (err) {
    console.error("[Storage] Local filesystem write error:", err);
    // Fallback data URL if filesystem write is blocked
    const base64 = buffer.toString("base64");
    const mimeType = file.type || "application/octet-stream";
    return {
      url: `data:${mimeType};base64,${base64}`,
      filename,
      size: file.size,
      provider: "local-fs",
    };
  }
}
