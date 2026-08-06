import { db } from "@/lib/db";
import { getAccountContext } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck, AlertCircle, Building2 } from "lucide-react";

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invitation = await db.invitation.findUnique({
    where: { token },
    include: { account: true, role: true },
  });

  if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date()) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex flex-col justify-center items-center px-6">
        <div className="apple-card p-8 rounded-3xl border border-red-200 bg-white max-w-md text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-extrabold text-[#1D1D1F]">Invalid or Expired Invitation</h1>
          <p className="text-sm text-[#86868B]">
            This invitation link is invalid, expired, or has already been accepted.
          </p>
          <Link
            href="/sign-in"
            className="inline-block px-6 py-3 bg-[#0071E3] hover:bg-[#0077ED] text-white rounded-full text-xs font-semibold shadow-md shadow-[#0071E3]/20"
          >
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  const context = await getAccountContext();

  if (context) {
    // QPR-002: Verify the signed-in user's email matches the invited email.
    // A leaked token must not grant access to a different identity.
    const signedInEmail = context.email.toLowerCase().trim();
    const invitedEmail = invitation.email.toLowerCase().trim();

    if (signedInEmail !== invitedEmail) {
      return (
        <div className="min-h-screen bg-[#F5F5F7] flex flex-col justify-center items-center px-6">
          <div className="apple-card p-8 rounded-3xl border border-red-200 bg-white max-w-md text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-extrabold text-[#1D1D1F]">Email Mismatch</h1>
            <p className="text-sm text-[#86868B]">
              This invitation was sent to{" "}
              <strong className="text-[#1D1D1F]">{invitation.email}</strong>, but you are signed in as{" "}
              <strong className="text-[#1D1D1F]">{context.email}</strong>. Please sign in with the
              correct account or contact your workspace administrator.
            </p>
            <Link
              href="/sign-in"
              className="inline-block px-6 py-3 bg-[#0071E3] hover:bg-[#0077ED] text-white rounded-full text-xs font-semibold shadow-md shadow-[#0071E3]/20"
            >
              Sign In with Different Account
            </Link>
          </div>
        </div>
      );
    }

    // Accept within a single transaction to prevent TOCTOU: re-check expiry and
    // status inside the transaction before creating the membership.
    await db.$transaction(async (tx) => {
      const freshInvitation = await tx.invitation.findUnique({
        where: { id: invitation.id },
      });

      if (
        !freshInvitation ||
        freshInvitation.status !== "PENDING" ||
        freshInvitation.expiresAt < new Date()
      ) {
        // Invitation was concurrently accepted or expired — nothing to do.
        return;
      }

      const existingMembership = await tx.accountMembership.findUnique({
        where: {
          accountId_userId: {
            accountId: invitation.accountId,
            userId: context.userId,
          },
        },
      });

      if (!existingMembership) {
        await tx.accountMembership.create({
          data: {
            accountId: invitation.accountId,
            userId: context.userId,
            roleId: invitation.roleId,
            status: "ACTIVE",
          },
        });
      }

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED" },
      });
    });

    redirect("/app/dashboard");
  }


  return (
    <div className="min-h-screen bg-[#F5F5F7] flex flex-col justify-center items-center px-6 py-12">
      <div className="mb-8 text-center max-w-md">
        <div className="inline-flex items-center space-x-3 group mb-4">
          <div className="w-12 h-12 rounded-2xl bg-[#0071E3] flex items-center justify-center text-white shadow-md shadow-[#0071E3]/20">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <span className="text-2xl font-extrabold tracking-tight text-[#1D1D1F]">Qubere</span>
        </div>
        <h1 className="text-2xl font-bold text-[#1D1D1F]">Account Invitation</h1>
        <p className="text-[#86868B] text-sm mt-1">You have been invited to join an enterprise workspace</p>
      </div>

      <div className="apple-card p-8 rounded-3xl border border-[#E5E5EA] max-w-md w-full text-center space-y-6 bg-white shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#0071E3] mx-auto">
          <Building2 className="w-6 h-6" />
        </div>

        <div>
          <h2 className="text-lg font-bold text-[#1D1D1F]">{invitation.account.name}</h2>
          <p className="text-xs text-[#86868B] mt-1">
            Invited as <strong className="text-[#0071E3]">{invitation.role.name}</strong>
          </p>
          <p className="text-xs text-[#86868B] font-mono mt-2">{invitation.email}</p>
        </div>

        <div className="pt-2 space-y-3">
          <Link
            href={`/sign-in?redirect_url=/invite/${token}`}
            className="w-full py-3 bg-[#0071E3] hover:bg-[#0077ED] text-white font-semibold rounded-full text-sm shadow-md shadow-[#0071E3]/20 flex items-center justify-center space-x-2 transition-all block"
          >
            <span>Accept Invitation & Sign In</span>
          </Link>
          <Link
            href={`/sign-up?redirect_url=/invite/${token}`}
            className="w-full py-3 bg-white hover:bg-slate-50 text-[#1D1D1F] border border-[#E5E5EA] font-semibold rounded-full text-xs block shadow-2xs"
          >
            Create New Account
          </Link>
        </div>
      </div>
    </div>
  );
}
