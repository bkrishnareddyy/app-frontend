import { getAccountContext } from "@/lib/auth";
import { ProtestListClient } from "./ProtestListClient";

export const metadata = {
  title: "Protests (Form 19) | Qubere",
  description: "Challenge CBP liquidation decisions under 19 U.S.C. § 1514 within the 180-day window.",
};

export default async function ProtestListPage() {
  const ctx = await getAccountContext();
  if (!ctx) return null;
  return <ProtestListClient />;
}
