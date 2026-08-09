/**
 * Central control for whether a workspace holds real operational data or
 * clearly-labelled demonstration data.
 *
 * Demo behaviour is decided here and nowhere else. Pages must not re-implement
 * it with per-field fallback values.
 */
export type DataMode = "PRODUCTION" | "DEMO" | "SANDBOX";

export const DATA_MODES: readonly DataMode[] = ["PRODUCTION", "DEMO", "SANDBOX"] as const;

export function isDataMode(value: unknown): value is DataMode {
  return typeof value === "string" && (DATA_MODES as readonly string[]).includes(value);
}

/** True when the workspace must never display fabricated or seeded content. */
export function isProductionWorkspace(mode: DataMode): boolean {
  return mode === "PRODUCTION";
}

/** True when the workspace must carry a visible non-production banner. */
export function requiresDataModeBanner(mode: DataMode): boolean {
  return mode !== "PRODUCTION";
}

/**
 * Whether demo/sample records may be written into this workspace.
 * Seeding is refused for production workspaces regardless of environment.
 */
export function isDemoSeedingAllowedForWorkspace(mode: DataMode): boolean {
  return mode === "DEMO" || mode === "SANDBOX";
}

export function assertDemoSeedingAllowedForWorkspace(mode: DataMode, accountId: string): void {
  if (!isDemoSeedingAllowedForWorkspace(mode)) {
    throw new Error(
      `SECURITY_VIOLATION: refusing to seed demo data into PRODUCTION workspace ${accountId}.`
    );
  }
}

export interface DataModeBannerCopy {
  label: string;
  description: string;
}

export function dataModeBannerCopy(mode: DataMode): DataModeBannerCopy | null {
  switch (mode) {
    case "DEMO":
      return {
        label: "Demo data",
        description:
          "This workspace contains sample data for demonstration. Nothing here is a real shipment, filing, or customs response.",
      };
    case "SANDBOX":
      return {
        label: "Sandbox",
        description:
          "This is a test workspace. Filings are simulated and are never transmitted to CBP.",
      };
    default:
      return null;
  }
}
