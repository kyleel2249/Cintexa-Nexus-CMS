/**
 * Shared Brand Intelligence for Content Studio & Email — same canonical Brand Management records.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { marketingIntel } from "@/lib/marketing/api";
import { Copy, Check } from "lucide-react";

type Props = {
  onInsertClaim?: (text: string) => void;
  onSelectTone?: (tone: string) => void;
  compact?: boolean;
};

export function BrandIntelligencePanel({ onInsertClaim, onSelectTone, compact }: Props) {
  const [q, setQ] = useState("");
  const [tone, setTone] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    marketingIntel.ensureSeed();
  }, []);

  const brands = useQuery({ queryKey: ["mkt", "brands"], queryFn: () => marketingIntel.listBrands() });
  const brand = brands.data?.items?.find((b) => b.is_default) || brands.data?.items?.[0];
  const claims = useQuery({
    queryKey: ["mkt", "claims", brand?.id],
    enabled: !!brand?.id,
    queryFn: () => marketingIntel.listClaims(brand!.id),
  });

  const filtered = useMemo(() => {
    const list = claims.data?.items || [];
    if (!q.trim()) return list;
    const s = q.toLowerCase();
    return list.filter((c) => c.text.toLowerCase().includes(s) || c.category.toLowerCase().includes(s));
  }, [claims.data, q]);

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* ignore */ }
  };

  if (!brand) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4 text-xs text-muted-foreground">Brand profile not loaded. Open Brand Management to seed.</CardContent>
      </Card>
    );
  }

  return (
    <Card className={compact ? "border-border/60" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span>Brand Intelligence · {brand.name}</span>
          <Badge variant="outline" className="text-[10px]">Canonical</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground line-clamp-2">{brand.positioning || brand.mission}</p>

        <div className="flex flex-wrap gap-2">
          {[
            ["Primary", brand.primary_color],
            ["Secondary", brand.secondary_color],
            ["Accent", brand.accent_color],
            ["Bg", brand.bg_color],
          ].map(([label, hex]) => (
            <button
              key={label}
              type="button"
              className="flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[10px] hover:bg-muted/50"
              title={`Copy ${hex}`}
              onClick={() => copy(hex, hex)}
            >
              <span className="h-4 w-4 rounded border" style={{ background: hex }} />
              {label} {copied === hex ? <Check className="h-3 w-3" /> : <span className="font-mono">{hex}</span>}
            </button>
          ))}
        </div>

        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Tone guidance</p>
          <div className="flex flex-wrap gap-1">
            {brand.tone.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTone(t);
                  onSelectTone?.(t);
                }}
                className={`rounded-full border px-2 py-0.5 text-[11px] ${tone === t ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted/50"}`}
              >
                {t}
              </button>
            ))}
          </div>
          {tone && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Guidance: write in a <strong>{tone}</strong> voice. Text is not auto-rewritten.
            </p>
          )}
        </div>

        <div>
          <p className="text-[10px] uppercase text-muted-foreground mb-1">Claims library</p>
          <Input className="h-8 text-xs mb-2" placeholder="Search claims…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-48 overflow-y-auto space-y-1.5">
            {filtered.map((c) => (
              <div key={c.id} className="rounded-md border px-2 py-1.5 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs leading-snug">{c.text}</p>
                  <Badge
                    variant={c.status === "approved" ? "default" : "secondary"}
                    className="text-[9px] shrink-0"
                  >
                    {c.status}
                  </Badge>
                </div>
                <div className="flex gap-1">
                  {c.status === "approved" && onInsertClaim && (
                    <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => onInsertClaim(c.text)}>
                      Insert
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => copy(c.text, String(c.id))}>
                    {copied === String(c.id) ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            ))}
            {!filtered.length && <p className="text-[11px] text-muted-foreground">No claims match.</p>}
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Compliance: prefer approved claims only. Restricted/unverified are shown but not marked approved.
        </p>
      </CardContent>
    </Card>
  );
}
