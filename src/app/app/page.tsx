import { redirect } from "next/navigation";

// The action queue is the broker's homepage. Navigating to /app lands here.
export default function AppRootPage() {
  redirect("/app/actions");
}
