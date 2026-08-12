import { permanentRedirect } from "next/navigation";

// The action queue at /app/actions is now the broker homepage.
export default function CommandCenterPage() {
  permanentRedirect("/app/actions");
}
