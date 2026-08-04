"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";
import { Users, UserPlus, UserX, UserCheck, Eye, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface MemberItem {
  membershipId: string;
  userId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  status: string;
  createdAt: string;
  roleName: string;
}

interface UserManagementTableProps {
  members: MemberItem[];
  currentUserId: string;
  currentRole: string;
}

export function UserManagementTable({ members, currentUserId, currentRole }: UserManagementTableProps) {
  const router = useRouter();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MEMBER");
  const [inviteLoading, setInviteLoading] = useState(false);

  const [loadingMembershipId, setLoadingMembershipId] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<MemberItem | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, roleName: inviteRole }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `Invitation sent to ${inviteEmail} as ${inviteRole}.` });
        setInviteEmail("");
        router.refresh();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to send invitation" });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Network error occurred." });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRoleChange = async (membershipId: string, newRole: string) => {
    setLoadingMembershipId(membershipId);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId, roleName: newRole }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `Updated user role to ${newRole}. Audit log generated.` });
        router.refresh();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to update user role." });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Network error occurred." });
    } finally {
      setLoadingMembershipId(null);
    }
  };

  const handleStatusToggle = async (membershipId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "ACTIVE" ? "DISABLED" : "ACTIVE";
    setLoadingMembershipId(membershipId);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId, status: nextStatus }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `User membership status set to ${nextStatus}.` });
        router.refresh();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to update status." });
      }
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Network error occurred." });
    } finally {
      setLoadingMembershipId(null);
    }
  };

  return (
    <div className="space-y-8">
      {message && (
        <div
          className={`p-4 rounded-2xl text-sm border flex items-center space-x-3 ${
            message.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-red-600" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Invite Member Card */}
      <div className="apple-card p-6 rounded-3xl border border-[#E5E5EA] bg-white shadow-sm">
        <h3 className="text-sm font-bold text-[#1D1D1F] uppercase tracking-wider mb-4 flex items-center space-x-2">
          <UserPlus className="w-4 h-4 text-[#0071E3]" />
          <span>Invite Member to Account</span>
        </h3>

        <form onSubmit={handleInviteUser} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-1">
            <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Email Address</label>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@company.com"
              required
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-xs focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#1D1D1F] mb-1">Assigned Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#F5F5F7] border border-[#E5E5EA] rounded-xl text-[#1D1D1F] text-xs focus:outline-none focus:border-[#0071E3] font-semibold"
            >
              <option value="ADMIN">ADMIN</option>
              <option value="MEMBER">MEMBER</option>
              <option value="VIEWER">VIEWER</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={inviteLoading}
              className="w-full py-2.5 bg-[#0071E3] hover:bg-[#0077ED] text-white font-semibold rounded-full text-xs flex items-center justify-center space-x-1.5 transition-all shadow-md shadow-[#0071E3]/20 disabled:opacity-50"
            >
              {inviteLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <UserPlus className="w-3.5 h-3.5" />
              )}
              <span>Send Account Invitation</span>
            </button>
          </div>
        </form>
      </div>

      {/* Members Table */}
      <div className="apple-card rounded-3xl border border-[#E5E5EA] bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#E5E5EA]">
          <h3 className="text-lg font-bold text-[#1D1D1F] flex items-center space-x-2">
            <Users className="w-5 h-5 text-[#0071E3]" />
            <span>Account Members ({members.length})</span>
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#1D1D1F]">
            <thead className="bg-[#F5F5F7] border-b border-[#E5E5EA] text-xs uppercase font-bold text-[#86868B]">
              <tr>
                <th className="px-6 py-4">User Identity</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Joined Date</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA]">
              {members.map((m) => {
                const name =
                  m.firstName || m.lastName
                    ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim()
                    : m.email;

                const isSelf = m.userId === currentUserId;

                return (
                  <tr key={m.membershipId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-[#1D1D1F] flex items-center space-x-2">
                        <span>{name}</span>
                        {isSelf && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-50 text-[#0071E3] border border-blue-100 font-mono font-bold">
                            You
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#86868B] font-mono">{m.email}</div>
                    </td>

                    <td className="px-6 py-4">
                      <select
                        value={m.roleName}
                        disabled={loadingMembershipId === m.membershipId || isSelf}
                        onChange={(e) => handleRoleChange(m.membershipId, e.target.value)}
                        className="bg-[#F5F5F7] border border-[#E5E5EA] text-xs font-bold rounded-xl px-3 py-1.5 text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] disabled:opacity-50"
                      >
                        <option value="OWNER">OWNER</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="MEMBER">MEMBER</option>
                        <option value="VIEWER">VIEWER</option>
                      </select>
                    </td>

                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          m.status === "ACTIVE"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-red-50 text-red-700 border-red-200"
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>

                    <td className="px-6 py-4 text-xs text-[#86868B]">
                      {formatDate(m.createdAt)}
                    </td>

                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => setSelectedMember(m)}
                        className="px-3 py-1.5 text-xs bg-[#F5F5F7] hover:bg-slate-100 text-[#1D1D1F] border border-[#E5E5EA] font-semibold rounded-full transition-colors inline-flex items-center space-x-1"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#0071E3]" />
                        <span>Details</span>
                      </button>

                      <button
                        disabled={loadingMembershipId === m.membershipId || isSelf}
                        onClick={() => handleStatusToggle(m.membershipId, m.status)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors inline-flex items-center space-x-1 disabled:opacity-40 border ${
                          m.status === "ACTIVE"
                            ? "bg-red-50 hover:bg-red-100 text-red-700 border-red-200"
                            : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {loadingMembershipId === m.membershipId ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : m.status === "ACTIVE" ? (
                          <>
                            <UserX className="w-3.5 h-3.5" />
                            <span>Disable</span>
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>Enable</span>
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
