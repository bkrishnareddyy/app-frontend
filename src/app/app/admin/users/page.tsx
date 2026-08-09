import { redirect } from "next/navigation";
import Link from "next/link";
import { getAccountContext } from "@/lib/auth";
import { canAccessHref } from "@/lib/navigation";
import { db } from "@/lib/db";
import { UserManagementTable } from "./UserManagementTable";
import { SortableHeader } from "@/components/table/SortableHeader";
import {
  buildOrderBy,
  pageCount,
  parseTableQuery,
  tableHref,
  tableSkip,
  type SortSpec,
} from "@/modules/tables/tableQuery";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

type MemberColumn = "user.email" | "user.lastName" | "status" | "createdAt";

const SORT_SPEC: SortSpec<MemberColumn> = {
  // A membership now holds many roles, so there is no single role column to
  // order by.
  columns: ["user.email", "user.lastName", "status", "createdAt"],
  fallback: "createdAt",
  fallbackDirection: "desc",
};

const STATUSES = ["ACTIVE", "INACTIVE", "DISABLED"];

export default async function AdminUsersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAccountContext();

  if (!context) {
    redirect("/sign-in");
  }

  if (!canAccessHref(context, "/app/admin/users")) {
    redirect("/app/work");
  }

  const rawParams = await props.searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === "string") params.set(key, value);
  }

  const query = parseTableQuery(params, SORT_SPEC, { pageSizeDefault: 25 });
  const statusFilter = params.get("status")?.trim().toUpperCase() ?? "";
  const roleFilter = params.get("role")?.trim().toUpperCase() ?? "";

  const where = {
    accountId: context.accountId,
    // A deleted membership is not a member, and counting one overstates the account.
    deletedAt: null,
    ...(STATUSES.includes(statusFilter) ? { status: statusFilter } : {}),
    ...(roleFilter ? { roles: { some: { role: { name: roleFilter } } } } : {}),
    ...(query.search
      ? {
          OR: [
            { user: { email: { contains: query.search, mode: "insensitive" as const } } },
            { user: { firstName: { contains: query.search, mode: "insensitive" as const } } },
            { user: { lastName: { contains: query.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [memberships, total, roles] = await Promise.all([
    db.accountMembership.findMany({
      where,
      include: { user: true, roles: { include: { role: true } } },
      orderBy: [buildOrderBy(query), { id: "desc" }],
      skip: tableSkip(query),
      take: query.pageSize,
    }),
    db.accountMembership.count({ where }),
    db.role.findMany({
      where: { OR: [{ isSystem: true }, { accountId: context.accountId }] },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const formattedMembers = memberships.map((m) => ({
    membershipId: m.id,
    userId: m.user.id,
    email: m.user.email,
    firstName: m.user.firstName,
    lastName: m.user.lastName,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    roleNames: m.roles.map((mr) => mr.role.name),
  }));

  const pages = pageCount(total, query.pageSize);
  const rangeStart = total === 0 ? 0 : tableSkip(query) + 1;
  const rangeEnd = Math.min(tableSkip(query) + query.pageSize, total);
  const href = (patch: Record<string, string | number | null>) =>
    tableHref("/app/admin/users", params, patch);
  const filtered = Boolean(query.search || statusFilter || roleFilter);

  // Sorting is a link so the order lives in the URL, but the table is a client
  // component because changing a role is a mutation. The headers cross that line
  // as a slot rather than duplicating the sort logic on both sides.
  const sortHeaders = (
    <>
      <SortableHeader
        column="user.lastName"
        label="User Identity"
        query={query}
        params={params}
        basePath="/app/admin/users"
      />
      <th scope="col" className="px-6 py-4">
        Roles
      </th>
      <SortableHeader
        column="status"
        label="Status"
        query={query}
        params={params}
        basePath="/app/admin/users"
      />
      <SortableHeader
        column="createdAt"
        label="Joined Date"
        query={query}
        params={params}
        basePath="/app/admin/users"
      />
    </>
  );

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      <div>
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[#0071E3] text-xs font-semibold mb-3">
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Account Members & Access</span>
        </div>
        <h1 className="text-3xl font-extrabold text-[#1D1D1F] tracking-tight">User Management</h1>
        <p className="text-[#86868B] text-sm mt-1">
          Manage account members, assign roles, and send invitations for {context.accountName}.
          Members can hold multiple roles at once.{" "}
          <Link href="/app/admin/roles" className="font-semibold text-[#0071E3] hover:underline">
            What each role is allowed to do
          </Link>
        </p>
      </div>

      <form
        action="/app/admin/users"
        method="get"
        className="bg-white p-4 rounded-2xl border border-[#E5E5EA] shadow-2xs flex flex-wrap items-end gap-3"
      >
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="member-search" className="block text-xs font-semibold text-[#6E6E73] mb-1">
            Search by name or email
          </label>
          <input
            id="member-search"
            name="q"
            type="search"
            defaultValue={query.search ?? ""}
            className="w-full px-3 py-2 rounded-xl border border-[#E5E5EA] text-sm focus:outline-none focus:border-[#0071E3]"
          />
        </div>

        <div>
          <label htmlFor="member-role" className="block text-xs font-semibold text-[#6E6E73] mb-1">
            Role
          </label>
          <select
            id="member-role"
            name="role"
            defaultValue={roleFilter}
            className="px-3 py-2 rounded-xl border border-[#E5E5EA] text-sm bg-white"
          >
            <option value="">Any role</option>
            {roles.map((role) => (
              <option key={role.name} value={role.name}>
                {role.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="member-status" className="block text-xs font-semibold text-[#6E6E73] mb-1">
            Status
          </label>
          <select
            id="member-status"
            name="status"
            defaultValue={STATUSES.includes(statusFilter) ? statusFilter : ""}
            className="px-3 py-2 rounded-xl border border-[#E5E5EA] text-sm bg-white"
          >
            <option value="">Any status</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white text-sm font-semibold rounded-xl"
        >
          Search
        </button>

        {filtered && (
          <Link
            href="/app/admin/users"
            className="px-4 py-2 text-sm font-semibold text-[#0071E3] hover:underline"
          >
            Clear
          </Link>
        )}
      </form>

      <UserManagementTable
        members={formattedMembers}
        currentUserId={context.userId}
        total={total}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        filtered={filtered}
        roleOptions={roles.map((role) => role.name)}
        sortHeaders={sortHeaders}
      />

      <nav
        aria-label="Member pages"
        className="flex items-center justify-between text-sm text-[#6E6E73]"
      >
        <span>
          {total === 0
            ? filtered
              ? "No members match this search"
              : "No members in this account"
            : `Showing ${rangeStart}\u2013${rangeEnd} of ${total}`}
        </span>
        <div className="flex items-center gap-3">
          {query.page > 1 ? (
            <Link
              href={href({ page: query.page - 1 })}
              className="font-semibold text-[#0071E3] hover:underline"
            >
              Previous
            </Link>
          ) : (
            <span className="text-[#C7C7CC]">Previous</span>
          )}
          <span>
            Page {query.page} of {pages}
          </span>
          {query.page < pages ? (
            <Link
              href={href({ page: query.page + 1 })}
              className="font-semibold text-[#0071E3] hover:underline"
            >
              Next
            </Link>
          ) : (
            <span className="text-[#C7C7CC]">Next</span>
          )}
        </div>
      </nav>
    </div>
  );
}
