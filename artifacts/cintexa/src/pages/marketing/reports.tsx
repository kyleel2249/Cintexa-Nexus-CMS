import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { marketingIntel } from "@/lib/marketing/api";

export default function MarketingReportsPage() {
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    marketingIntel.ensureSeed();
  }, []);

  const strategies = useQuery({ queryKey: ["mkt", "strategies"], queryFn: () => marketingIntel.listStrategies() });
  const swot = useQuery({ queryKey: ["mkt", "swot"], queryFn: () => marketingIntel.listSwot() });
  const objectives = useQuery({ queryKey: ["mkt", "objectives"], queryFn: () => marketingIntel.listObjectives() });
  const brand = useQuery({ queryKey: ["mkt", "brands"], queryFn: () => marketingIntel.getDefaultBrand() });

  const print = () => {
    window.print();
  };

  const byQ = (q: string) => (swot.data?.items || []).filter((s) => s.quadrant === q);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Strategy, SWOT and OKR — print or Save as PDF via the browser. No external PDF service.
          </p>
        </div>
        <Button size="sm" onClick={print}>Print / Save PDF</Button>
      </div>

      <div ref={printRef} className="space-y-8 print:text-black">
        <header className="border-b pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">CINTEXA Nexus · Marketing Intelligence</p>
          <h2 className="text-xl font-semibold" style={{ color: brand.data?.primary_color || undefined }}>
            {brand.data?.name || "CINTEXA"} Marketing Report
          </h2>
          <p className="text-xs text-muted-foreground">Generated {new Date().toLocaleString()} · Local records only</p>
        </header>

        <section>
          <h3 className="text-lg font-semibold mb-2">1. Strategy</h3>
          {(strategies.data?.items || []).map((s) => (
            <Card key={s.id} className="mb-3 print:shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{s.name} <Badge className="ml-2">{s.status}</Badge></CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {s.vision && <p><strong>Vision:</strong> {s.vision}</p>}
                {s.mission && <p><strong>Mission:</strong> {s.mission}</p>}
                {s.positioning && <p><strong>Positioning:</strong> {s.positioning}</p>}
                {s.value_proposition && <p><strong>Value:</strong> {s.value_proposition}</p>}
                {s.channels?.length > 0 && <p><strong>Channels:</strong> {s.channels.join(", ")}</p>}
              </CardContent>
            </Card>
          ))}
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-2">2. SWOT</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {(["strength", "weakness", "opportunity", "threat"] as const).map((q) => (
              <Card key={q} className="print:shadow-none">
                <CardHeader className="pb-1"><CardTitle className="text-sm capitalize">{q}s</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1">
                  {byQ(q).map((item) => (
                    <div key={item.id}>
                      <p className="font-medium">{item.title}</p>
                      {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                      {item.assumption && <span className="text-[10px]">Assumption</span>}
                    </div>
                  ))}
                  {!byQ(q).length && <p className="text-xs text-muted-foreground">—</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-2">3. OKRs</h3>
          {(objectives.data?.items || []).map((o) => (
            <Card key={o.id} className="mb-3 print:shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {o.name} · {marketingIntel.objectiveProgress(o)}%
                </CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-1">Key result</th>
                      <th>Baseline</th>
                      <th>Target</th>
                      <th>Current</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.key_results.map((kr) => (
                      <tr key={kr.id} className="border-b border-border/40">
                        <td className="py-1">{kr.name}</td>
                        <td>{kr.baseline}</td>
                        <td>{kr.target}</td>
                        <td>{kr.current} {kr.unit}</td>
                        <td>{kr.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </section>

        <footer className="text-[10px] text-muted-foreground border-t pt-3">
          Metrics from local Marketing Store. No external analytics. Assumptions are labelled.
        </footer>
      </div>

      <style>{`
        @media print {
          nav, aside, header, .print\\:hidden { display: none !important; }
          body { background: white; }
        }
      `}</style>
    </div>
  );
}
