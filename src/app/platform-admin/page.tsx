import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { PlatformAdminConsole } from "./PlatformAdminConsole";
import { ShieldAlert, Shield } from "lucide-react";
import Link from "next/link";

export default async function PlatformAdminPage() {
  const context = await getAccountContext();

  if (!context || !context.isPlatformAdmin) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] flex items-center justify-center p-6">
        <div className="apple-card p-8 rounded-3xl border border-red-200 bg-white max-w-md text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-extrabold text-[#1D1D1F]">Platform Admin Access Restricted</h1>
          <p className="text-sm text-[#86868B]">
            You do not have Qubere Platform Administrator privileges required to access this area.
          </p>
          <Link
            href="/app/dashboard"
            className="inline-block px-5 py-2.5 bg-[#0071E3] hover:bg-[#0077ED] text-white rounded-full text-xs font-semibold shadow-md shadow-[#0071E3]/20"
          >
            Return to App Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const allAccounts = await db.account.findMany({
    include: {
      memberships: {
        where: { status: "ACTIVE" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const formattedAccounts = allAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    memberCount: a.memberships.length,
  }));

  // HTS Master Data admin tab: real per-country release/row/status data,
  // no fabricated placeholders.
  const [publishedReleases, draftReleases, nodeCounts, mostRecentRelease] = await Promise.all([
    db.htsRelease.findMany({
      where: { publicationStatus: "PUBLISHED" },
      orderBy: { effectiveFrom: "desc" },
    }),
    db.htsRelease.findMany({
      where: { publicationStatus: "DRAFT" },
      orderBy: { retrievedAt: "desc" },
    }),
    db.htsNode.groupBy({
      by: ["releaseId"],
      _count: { _all: true },
    }),
    db.htsRelease.findFirst({
      orderBy: { retrievedAt: "desc" },
      select: { retrievedAt: true },
    }),
  ]);

  const nodeCountByRelease = new Map(nodeCounts.map((n) => [n.releaseId, n._count._all]));

  const countryVersions = publishedReleases.map((r) => ({
    country: r.country,
    releaseId: r.id,
    releaseName: r.releaseName,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    effectiveFrom: r.effectiveFrom.toISOString(),
    rowCount: nodeCountByRelease.get(r.id) || 0,
  }));

  const pendingDrafts = draftReleases.map((r) => ({
    releaseId: r.id,
    country: r.country,
    releaseName: r.releaseName,
    retrievedAt: r.retrievedAt.toISOString(),
    rowCount: nodeCountByRelease.get(r.id) || 0,
  }));

  const htsAdmin = {
    countryVersions,
    pendingDrafts,
    totalRowCount: countryVersions.reduce((sum, c) => sum + c.rowCount, 0),
    lastRefreshAt: mostRecentRelease?.retrievedAt.toISOString() || null,
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] p-8 selection:bg-[#0071E3]/20 selection:text-[#0071E3]">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E5E5EA] pb-6">
          <div>
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold mb-3">
              <Shield className="w-3.5 h-3.5 text-amber-600" />
              <span>Internal Qubere Platform Administration</span>
            </div>
            <h1 className="text-3xl font-extrabold text-[#1D1D1F] tracking-tight">Platform Admin Console</h1>
            <p className="text-[#86868B] text-sm mt-1">
              Global customer account provisioning, platform monitoring, and enterprise invitations.
            </p>
          </div>

          <Link
            href="/app/dashboard"
            className="px-4 py-2 bg-white hover:bg-slate-50 text-[#1D1D1F] border border-[#E5E5EA] rounded-full text-xs font-semibold self-start sm:self-auto shadow-2xs"
          >
            ← Back to App Console
          </Link>
        </div>

        <PlatformAdminConsole accounts={formattedAccounts} htsAdmin={htsAdmin} />
      </div>
    </div>
  );
}
