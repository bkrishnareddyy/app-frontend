import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { withAuthenticatedRoute } from "@/lib/api/auth-guards";

export interface RouteEntry {
  path: string;
  methods: string[];
  isPublic: boolean;
  requiresWrite: boolean;
  permission: string | null;
}

export interface ApiCollection {
  name: string;
  tag: string;
  color: string;
  routes: RouteEntry[];
}

export interface ApiCatalogResponse {
  collections: ApiCollection[];
  totalRoutes: number;
  totalEndpoints: number;
  generatedAt: string;
}

const COLLECTION_META: Record<string, { name: string; color: string }> = {
  admin: { name: "Admin", color: "amber" },
  advisory: { name: "Advisory", color: "violet" },
  agents: { name: "Agents", color: "indigo" },
  assistant: { name: "Assistant / Chat", color: "sky" },
  audit: { name: "Audit", color: "slate" },
  auth: { name: "Auth", color: "gray" },
  bonds: { name: "Bonds", color: "stone" },
  classification: { name: "Classification", color: "blue" },
  clients: { name: "Clients", color: "cyan" },
  compliance: { name: "Compliance", color: "orange" },
  cron: { name: "Cron Jobs", color: "zinc" },
  dashboard: { name: "Dashboard", color: "neutral" },
  decisions: { name: "Decisions", color: "purple" },
  demo: { name: "Demo / Screening", color: "pink" },
  documents: { name: "Documents", color: "teal" },
  drawback: { name: "Drawback", color: "emerald" },
  exceptions: { name: "Exceptions", color: "red" },
  exports: { name: "Exports", color: "lime" },
  filing: { name: "Filing", color: "green" },
  findings: { name: "Findings", color: "rose" },
  "legal-entities": { name: "Legal Entities", color: "fuchsia" },
  notifications: { name: "Notifications", color: "yellow" },
  parties: { name: "Parties", color: "orange" },
  "platform-admin": { name: "Platform Admin", color: "amber" },
  products: { name: "Products", color: "blue" },
  reconcile: { name: "Reconcile", color: "violet" },
  refunds: { name: "Refunds", color: "green" },
  regulatory: { name: "Regulatory", color: "red" },
  risk: { name: "Risk", color: "rose" },
  screening: { name: "Screening", color: "orange" },
  settings: { name: "Settings", color: "slate" },
  shipments: { name: "Shipments", color: "indigo" },
  simulator: { name: "Simulator / Tariff", color: "cyan" },
  telemetry: { name: "Telemetry", color: "zinc" },
  "trade-intel": { name: "Trade Intel", color: "blue" },
  v1: { name: "API v1 (Public)", color: "emerald" },
  webhooks: { name: "Webhooks", color: "purple" },
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

function extractMethods(content: string): string[] {
  return HTTP_METHODS.filter((m) =>
    new RegExp(`export\\s+(?:const|async function)\\s+${m}\\b`).test(content)
  );
}

function isPublicRoute(content: string): boolean {
  return content.includes("withPublicRoute");
}

function requiresWrite(content: string): boolean {
  return content.includes("write: true");
}

function extractPermission(content: string): string | null {
  const m = content.match(/permission:\s*["']([^"']+)["']/);
  return m ? m[1] : null;
}

function scanRoutes(apiDir: string): RouteEntry[] {
  const routes: RouteEntry[] = [];

  function walk(dir: string, prefix: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, `${prefix}/${entry.name}`);
      } else if (entry.name === "route.ts") {
        let content = "";
        try {
          content = fs.readFileSync(fullPath, "utf8");
        } catch {
          continue;
        }
        const methods = extractMethods(content);
        if (methods.length === 0) continue;

        routes.push({
          path: `/api${prefix}`,
          methods,
          isPublic: isPublicRoute(content),
          requiresWrite: requiresWrite(content),
          permission: extractPermission(content),
        });
      }
    }
  }

  walk(apiDir, "");
  return routes;
}

function groupIntoCollections(routes: RouteEntry[]): ApiCollection[] {
  const groups = new Map<string, RouteEntry[]>();

  for (const route of routes) {
    // /api/v1/hts/codes/[code]/rates → segment = "v1"
    // /api/shipments/[id] → segment = "shipments"
    const segment = route.path.split("/")[2] ?? "other";
    if (!groups.has(segment)) groups.set(segment, []);
    groups.get(segment)!.push(route);
  }

  const collections: ApiCollection[] = [];
  for (const [tag, tagRoutes] of groups) {
    const meta = COLLECTION_META[tag] ?? { name: tag, color: "gray" };
    // Sort: shorter paths first
    tagRoutes.sort((a, b) => a.path.localeCompare(b.path));
    collections.push({
      name: meta.name,
      tag,
      color: meta.color,
      routes: tagRoutes,
    });
  }

  return collections.sort((a, b) => a.name.localeCompare(b.name));
}

export const GET = withAuthenticatedRoute(async ({ ctx, requestId }) => {
  if (!ctx.isPlatformAdmin) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Platform Admin only", requestId } }, { status: 403 });
  }

  const apiDir = path.join(process.cwd(), "src", "app", "api");
  const routes = scanRoutes(apiDir);
  const collections = groupIntoCollections(routes);

  const totalEndpoints = routes.reduce((sum, r) => sum + r.methods.length, 0);

  const payload: ApiCatalogResponse = {
    collections,
    totalRoutes: routes.length,
    totalEndpoints,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(payload);
});
