import crypto from "crypto";

/**
 * Deterministic SHA-256 hash for ScreeningEntity dedup, shared across all
 * screening-list ingesters (BIS CSL, OFAC SDN, ...). Same formula everywhere
 * so the same real-world entity collides to one row regardless of which
 * government source most recently republished it.
 */
export function computeEntityHash(sourceList: string, name: string, country?: string): string {
  const normName = name.trim().toLowerCase();
  const normCountry = (country || "").trim().toLowerCase();
  const normList = sourceList.trim().toUpperCase();
  return crypto
    .createHash("sha256")
    .update(`${normList}:${normName}:${normCountry}`)
    .digest("hex");
}
