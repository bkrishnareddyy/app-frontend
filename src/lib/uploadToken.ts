/**
 * Signed upload-request tokens for counterparty document submission.
 *
 * A token encodes {shipmentId, accountId, documentType, recipientEmail} and
 * is HMAC-SHA256 signed with NEXTAUTH_SECRET (min 256-bit key).  Tokens
 * expire in 7 days — long enough for an async counterparty to respond.
 */

import { SignJWT, jwtVerify } from "jose";

const EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface UploadTokenPayload {
  shipmentId: string;
  accountId: string;
  documentType: string;
  recipientEmail: string;
}

function getSecret(): Uint8Array {
  const raw = process.env.NEXTAUTH_SECRET ?? process.env.UPLOAD_TOKEN_SECRET;
  if (!raw) throw new Error("NEXTAUTH_SECRET is required to sign upload tokens");
  return new TextEncoder().encode(raw);
}

export async function signUploadToken(payload: UploadTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${EXPIRY_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyUploadToken(token: string): Promise<UploadTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  const { shipmentId, accountId, documentType, recipientEmail } = payload as Record<string, unknown>;
  if (
    typeof shipmentId !== "string" ||
    typeof accountId !== "string" ||
    typeof documentType !== "string" ||
    typeof recipientEmail !== "string"
  ) {
    throw new Error("Malformed upload token payload");
  }
  return { shipmentId, accountId, documentType, recipientEmail };
}
