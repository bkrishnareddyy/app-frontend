import { permanentRedirect } from "next/navigation";

// /app/exceptions is superseded by the unified /app/actions inbox.
// Forward deep links so bookmarks and email notifications continue to work.
export default async function ExceptionsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const params = new URLSearchParams();
  const exceptionId = typeof searchParams.exceptionId === "string" ? searchParams.exceptionId : null;
  const shipmentId = typeof searchParams.shipmentId === "string" ? searchParams.shipmentId : null;
  if (exceptionId) params.set("exceptionId", exceptionId);
  if (shipmentId) params.set("shipmentId", shipmentId);
  permanentRedirect(`/app/actions${params.size > 0 ? `?${params}` : ""}`);
}
