import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export function CmsCacheUnavailableState({
  kind,
}: {
  kind: "media" | "pages";
}) {
  const isMedia = kind === "media";
  return (
    <div className="rounded-md border border-dashed bg-muted/20 px-4 py-6 text-center space-y-3">
      <Badge variant="outline" className="text-[10px]">
        {isMedia ? "UNAVAILABLE — OPEN MEDIA FIRST" : "UNAVAILABLE — OPEN PAGES FIRST"}
      </Badge>
      <div>
        <p className="text-sm font-medium">
          {isMedia ? "Media Library unavailable" : "CMS Pages unavailable"}
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
          {isMedia
            ? "Open Media first to load your CMS assets. Once Media has been opened and its data is available in this session, return here to select an asset."
            : "Open Pages first to load your CMS pages. Once Pages has been opened and its data is available in this session, return here to select a page."}
        </p>
        <p className="text-[11px] text-muted-foreground mt-2">
          No network request was made. This picker only reads data already loaded in the CMS cache for this session.
        </p>
      </div>
      <Button size="sm" variant="outline" asChild>
        <Link href={isMedia ? "/media" : "/pages"}>{isMedia ? "Open Media" : "Open Pages"}</Link>
      </Button>
    </div>
  );
}
