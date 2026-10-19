import { useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sales, saveTextFile, type Query, type SalesApiError } from "@/lib/sales/api";
import { useToast } from "@/hooks/use-toast";

/** Downloads a server-generated CSV (the server re-checks the export permission and audits the export). */
export function ExportButton({ path, query, label = "Export CSV" }: { path: string; query?: Query; label?: string }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const r = await sales.text(path, query);
        saveTextFile(r.text, r.filename, r.contentType.includes("csv") ? "text/csv;charset=utf-8" : r.contentType);
      } catch (e) {
        toast({ title: (e as SalesApiError).message, variant: "destructive" });
      } finally {
        setBusy(false);
      }
    }}>
      <Download className="mr-1.5 h-3.5 w-3.5" />{busy ? "Preparing…" : label}
    </Button>
  );
}

/** Small row of action buttons that hides itself when nothing is permitted. */
export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
