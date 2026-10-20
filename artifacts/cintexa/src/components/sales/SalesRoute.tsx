import type { ComponentType } from "react";
import { useSales } from "@/context/SalesContext";
import { Spinner, PermissionDenied, ErrorState, EmptyState } from "./ui";

/** Gate for every Sales page: waits for the member profile, explains non-members, and checks the page's permission. */
export function SalesRoute({ perm, anyPerm, component: Page, params }: { perm?: string; anyPerm?: string[]; component: ComponentType<any>; params?: Record<string, string> }) {
  const s = useSales();
  if (s.access === "loading") return <div className="flex min-h-[300px] items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  if (s.access === "not_member") {
    return (
      <EmptyState
        title="You are not part of the sales team yet"
        description="Sales Management needs a sales role. Ask a Sales Administrator to add your sign-in email under Sales Settings → Team, or ask your platform administrator to list your email in SALES_ADMIN_EMAILS to bootstrap the first administrator."
      />
    );
  }
  if (s.access === "unauthenticated") return <EmptyState title="Access refused" description="The Sales API refused the request." />;
  if (s.access === "error" && s.error) return <ErrorState error={s.error} onRetry={s.reload} />;
  const needed = anyPerm ?? (perm ? [perm] : []);
  if (needed.length > 0 && !needed.some((p) => s.can(p))) return <PermissionDenied />;
  return <Page {...(params ?? {})} />;
}
