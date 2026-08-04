import { getAccountContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import {
  Building2,
  Users,
  ShieldCheck,
  Calendar,
  ArrowUpRight,
  User,
  FileText,
  Scale,
  CheckCircle2,
} from "lucide-react";

export default async function DashboardPage() {
  const context = await getAccountContext();

  if (!context) {
    return null;
  }

  const memberCount = await db.accountMembership.count({
    where: { accountId: context.accountId, status: "ACTIVE" },
  });

  const userName =
    context.firstName || context.lastName
      ? `${context.firstName ?? ""} ${context.lastName ?? ""}`.trim()
      : context.email;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Welcome Banner */}
      <div className="apple-card p-8 rounded-3xl border border-[#E5E5EA] relative overflow-hidden bg-white shadow-sm">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-[#0071E3]/10 via-[#0071E3]/5 to-transparent rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[#0071E3] text-xs font-semibold mb-3">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{context.accountType} Account Workspace</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-[#1D1D1F] tracking-tight">
              Welcome, {userName}
            </h1>
            <p className="text-[#86868B] text-sm mt-1">
              Active account environment: <strong className="text-[#1D1D1F]">{context.accountName}</strong>
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <Link
              href="/app/admin"
              className="px-5 py-3 bg-[#0071E3] hover:bg-[#0077ED] text-white rounded-full font-semibold text-sm shadow-md shadow-[#0071E3]/20 flex items-center space-x-2 transition-all hover:scale-[1.02]"
            >
              <span>Account Settings</span>
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* Main KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Account Name & Type */}
        <div className="apple-card p-6 rounded-2xl border border-[#E5E5EA] bg-white shadow-sm">
          <div className="flex items-center justify-between text-[#86868B] mb-3">
            <span className="text-xs font-bold uppercase tracking-wider">Account</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3]">
              {context.accountType === "ENTERPRISE" ? (
                <Building2 className="w-4 h-4" />
              ) : (
                <User className="w-4 h-4" />
              )}
            </div>
          </div>
          <p className="text-2xl font-bold text-[#1D1D1F] truncate">{context.accountName}</p>
          <span className="inline-block text-[10px] font-mono px-2.5 py-0.5 mt-2 rounded-full bg-blue-50 text-[#0071E3] font-bold border border-blue-100 uppercase">
            {context.accountType}
          </span>
        </div>

        {/* User Role */}
        <div className="apple-card p-6 rounded-2xl border border-[#E5E5EA] bg-white shadow-sm">
          <div className="flex items-center justify-between text-[#86868B] mb-3">
            <span className="text-xs font-bold uppercase tracking-wider">Your Role</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-[#1D1D1F]">{context.roleName}</p>
          <p className="text-xs text-emerald-600 mt-2 flex items-center space-x-1 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Active Permissions</span>
          </p>
        </div>

        {/* Total Account Members */}
        <div className="apple-card p-6 rounded-2xl border border-[#E5E5EA] bg-white shadow-sm">
          <div className="flex items-center justify-between text-[#86868B] mb-3">
            <span className="text-xs font-bold uppercase tracking-wider">Account Members</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-[#1D1D1F]">{memberCount}</p>
          <p className="text-xs text-[#86868B] mt-2">Scoped to {context.accountName}</p>
        </div>

        {/* Created Date */}
        <div className="apple-card p-6 rounded-2xl border border-[#E5E5EA] bg-white shadow-sm">
          <div className="flex items-center justify-between text-[#86868B] mb-3">
            <span className="text-xs font-bold uppercase tracking-wider">Created Date</span>
            <div className="w-8 h-8 rounded-xl bg-cyan-50 border border-cyan-100 flex items-center justify-center text-cyan-600">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <p className="text-xl font-bold text-[#1D1D1F]">{formatDate(context.account.createdAt)}</p>
          <p className="text-xs text-[#86868B] mt-2">Status: {context.account.status}</p>
        </div>
      </div>

      {/* Feature Modules */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="apple-card p-6 rounded-2xl border border-[#E5E5EA] bg-white shadow-sm">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3]">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#1D1D1F]">Trade Documents</h3>
              <p className="text-xs text-[#86868B]">Customs Declarations & Invoices</p>
            </div>
          </div>
          <p className="text-sm text-[#86868B] leading-relaxed mb-4">
            Document processing pipeline and automated HTS classification engine scheduled for Phase 2.
          </p>
        </div>

        <div className="apple-card p-6 rounded-2xl border border-[#E5E5EA] bg-white shadow-sm">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#1D1D1F]">Compliance Rules Engine</h3>
              <p className="text-xs text-[#86868B]">Tariff Schedule & Sanctions Audit</p>
            </div>
          </div>
          <p className="text-sm text-[#86868B] leading-relaxed mb-4">
            Real-time sanction list screening and AI-assisted duty minimization rules scheduled for Phase 2.
          </p>
        </div>
      </div>
    </div>
  );
}
