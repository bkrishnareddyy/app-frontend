import { db } from "@/lib/db";
import { verifyUploadToken } from "@/lib/uploadToken";
import { UploadForm } from "./UploadForm";
import { ShieldCheck, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function UploadPage({ params }: PageProps) {
  const { token } = await params;

  let payload;
  try {
    payload = await verifyUploadToken(token);
  } catch {
    return <ErrorPage message="This upload link is invalid or has expired. Please ask the sender for a new link." />;
  }

  const shipment = await db.shipment.findFirst({
    where: { id: payload.shipmentId, accountId: payload.accountId },
    select: { shipmentNumber: true },
  });

  if (!shipment) {
    return <ErrorPage message="The shipment associated with this link could not be found." />;
  }

  const shipmentRef = shipment.shipmentNumber ?? payload.shipmentId.slice(0, 8).toUpperCase();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="bg-indigo-600 px-6 py-5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-white/80 shrink-0" />
            <div>
              <h1 className="text-lg font-bold text-white">Secure Document Upload</h1>
              <p className="text-sm text-white/70">Powered by Qubere</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl space-y-1">
            <p className="text-xs font-extrabold uppercase tracking-wider text-indigo-400">Document Requested</p>
            <p className="text-base font-bold text-indigo-900">{payload.documentType}</p>
            <p className="text-xs text-indigo-600">Shipment {shipmentRef}</p>
          </div>

          <UploadForm token={token} documentType={payload.documentType} shipmentRef={shipmentRef} />
        </div>

        <div className="px-6 pb-5">
          <p className="text-[11px] text-gray-400 text-center">
            Your file is encrypted in transit and stored securely. This link expires in 7 days.
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-gray-200 p-8 text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto" />
        <h1 className="text-lg font-bold text-gray-900">Link Unavailable</h1>
        <p className="text-sm text-gray-500">{message}</p>
      </div>
    </div>
  );
}
