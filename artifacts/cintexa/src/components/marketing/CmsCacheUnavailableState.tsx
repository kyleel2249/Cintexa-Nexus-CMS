import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export function CmsCacheUnavailableState({
  kind,
}: {
  kind: "media" | "pages" | "forms";
}) {
  const label =
    kind === "media"
      ? { badge: "UNAVAILABLE — OPEN MEDIA FIRST", title: "Media Library unavailable", body: "Open Media first to load your CMS assets. Once Media has been opened and its data is available in this session, return here to select an asset.", href: "/media", cta: "Open Media" }
      : kind === "pages"
        ? { badge: "UNAVAILABLE — OPEN PAGES FIRST", title: "CMS Pages unavailable", body: "Open Pages first to load your CMS pages. Once Pages has been opened and its data is available in this session, return here to select a page.", href: "/pages", cta: "Open Pages" }
        : { badge: "UNAVAILABLE — OPEN FORMS FIRST", title: "Forms unavailable", body: "Open Forms first to load your CMS forms. Once Forms has been opened and its data is available in this session, return here to select a form.", href: "/forms", cta: "Open Forms" };
  return (
    <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center space-y-3">
      <Badge variant="outline" className="text-[10px]">{label.badge}</Badge>
      <div>
        <p className="text-sm font-medium">{label.title}</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{label.body}</p>
        <p className="text-[11px] text-muted-foreground mt-2">
          No network request was made. This picker only reads data already loaded in the CMS cache for this session.
        </p>
      </div>
      <Button size="sm" variant="outline" asChild>
        <Link href={label.href}>{label.cta}</Link>
      </Button>
    </div>
  );
}
