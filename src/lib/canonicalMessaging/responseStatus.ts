import type { CanonicalFilingResponseData } from "./types";

/**
 * Extract the canonical status from the declaration-shaped response introduced
 * by the wrapper schema. Legacy responses with a top-level status remain
 * readable during migration.
 */
export function extractCanonicalResponseStatus(data: CanonicalFilingResponseData): string {
  const legacyStatus = (data as CanonicalFilingResponseData & { status?: string }).status;
  if (legacyStatus) return legacyStatus;

  const declaration = data.declaration as Record<string, any>;
  const wrapped = declaration.ImportDeclaration ?? declaration.ExportDeclaration ?? declaration;
  const goodsDeclaration = wrapped?.GoodsDeclaration;
  return goodsDeclaration?.StatusCode ?? goodsDeclaration?.ResponseCode ?? "UNKNOWN";
}
