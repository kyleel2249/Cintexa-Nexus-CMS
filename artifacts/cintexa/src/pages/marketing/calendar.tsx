import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { marketingApi, marketingIntel } from "@/lib/marketing/api";
import { useMarketingSubscription } from "@/lib/marketing/useMarketingSubscription";

type CalEvent = {
  id: string;
  title: string;
  type: string;
  date: string;
  href?: string;
  status?: string;
};

function monthMatrix(year: number, month: number) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // Monday-start-ish grid
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function MarketingCalendarPage() {
  useMarketingSubscription();
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [typeFilter, setTypeFilter] = useState("all");

  useEffect(() => {
    marketingIntel.ensureSeed();
  }, []);

  const campaigns = useQuery({ queryKey: ["marketing", "campaigns"], queryFn: () => marketingApi.listCampaigns() });
  const content = useQuery({ queryKey: ["marketing", "content"], queryFn: () => marketingApi.listContent() });
  const social = useQuery({ queryKey: ["marketing", "events"], queryFn: () => marketingApi.listEvents() });
  const email = useQuery({ queryKey: ["marketing", "email"], queryFn: () => marketingApi.listEmails() });
  const objectives = useQuery({ queryKey: ["mkt", "objectives"], queryFn: () => marketingIntel.listObjectives() });

  const events = useMemo(() => {
    const out: CalEvent[] = [];
    for (const c of campaigns.data?.items || []) {
      if (c.start_date) out.push({ id: `cs-${c.id}`, title: c.name, type: "campaign_start", date: String(c.start_date).slice(0, 10), href: `/marketing/campaigns/${c.id}`, status: c.status });
      if (c.end_date) out.push({ id: `ce-${c.id}`, title: `${c.name} (end)`, type: "campaign_end", date: String(c.end_date).slice(0, 10), href: `/marketing/campaigns/${c.id}`, status: c.status });
    }
    for (const x of content.data?.items || []) {
      const d = (x as any).publish_at || (x as any).scheduled_at || (x as any).updated_at;
      if (d) out.push({ id: `ct-${x.id}`, title: x.title || x.name || `Content #${x.id}`, type: "content", date: String(d).slice(0, 10), href: `/marketing/content/${x.id}` });
    }
    for (const x of social.data?.items || []) {
      const d = (x as any).scheduled_at || (x as any).start_at || (x as any).date || (x as any).updated_at;
      if (d) out.push({ id: `sc-${x.id}`, title: (x as any).title || (x as any).caption?.slice?.(0, 40) || `Social #${x.id}`, type: "social", date: String(d).slice(0, 10), href: `/marketing/social` });
    }
    for (const x of email.data?.items || []) {
      const d = (x as any).scheduled_at || (x as any).send_at || (x as any).updated_at;
      if (d) out.push({ id: `em-${x.id}`, title: (x as any).subject || `Email #${x.id}`, type: "email", date: String(d).slice(0, 10), href: `/marketing/email` });
    }
    for (const o of objectives.data?.items || []) {
      const d = (o as any).deadline || (o as any).end_date;
      if (d) out.push({ id: `ok-${o.id}`, title: o.name, type: "okr", date: String(d).slice(0, 10), href: `/marketing/okrs` });
    }
    return typeFilter === "all" ? out : out.filter((e) => e.type.startsWith(typeFilter) || e.type === typeFilter);
  }, [campaigns.data, content.data, social.data, email.data, objectives.data, typeFilter]);

  const days = monthMatrix(cursor.y, cursor.m);
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date)!.push(e);
    }
    return m;
  }, [events]);

  const label = new Date(cursor.y, cursor.m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Marketing Calendar</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Unified view of campaign, content, social, email, and OKR dates from local records — no duplicate schedule store.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setCursor((c) => ({ y: c.m === 0 ? c.y - 1 : c.y, m: c.m === 0 ? 11 : c.m - 1 }))}>Prev</Button>
          <Button size="sm" variant="outline" onClick={() => { const n = new Date(); setCursor({ y: n.getFullYear(), m: n.getMonth() }); }}>Today</Button>
          <Button size="sm" variant="outline" onClick={() => setCursor((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: c.m === 11 ? 0 : c.m + 1 }))}>Next</Button>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            <option value="campaign">Campaigns</option>
            <option value="content">Content</option>
            <option value="social">Social</option>
            <option value="email">Email</option>
            <option value="okr">OKRs</option>
          </select>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{label}</CardTitle>
          <CardDescription>{events.length} dated events in range of loaded records</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-[10px] text-muted-foreground mb-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="px-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const key = ymd(d);
              const inMonth = d.getMonth() === cursor.m;
              const list = byDay.get(key) || [];
              return (
                <div key={key} className={`min-h-[72px] rounded-md border p-1 ${inMonth ? "bg-background" : "bg-muted/30 opacity-60"}`}>
                  <div className="text-[10px] tabular-nums text-muted-foreground">{d.getDate()}</div>
                  <div className="space-y-0.5 mt-0.5">
                    {list.slice(0, 3).map((e) => (
                      <Link key={e.id} href={e.href || "/marketing"}>
                        <div className="truncate rounded px-0.5 text-[10px] bg-primary/10 hover:bg-primary/20" title={e.title}>
                          {e.title}
                        </div>
                      </Link>
                    ))}
                    {list.length > 3 && <div className="text-[9px] text-muted-foreground">+{list.length - 3}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Agenda (this month)</CardTitle></CardHeader>
        <CardContent className="space-y-1 max-h-64 overflow-y-auto">
          {events
            .filter((e) => e.date.startsWith(`${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`))
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((e) => (
              <Link key={e.id} href={e.href || "/marketing"}>
                <div className="flex justify-between gap-2 text-xs border-b border-border/40 py-1 hover:bg-muted/30">
                  <span className="truncate"><Badge variant="outline" className="text-[9px] mr-1">{e.type}</Badge>{e.title}</span>
                  <span className="text-muted-foreground shrink-0">{e.date}</span>
                </div>
              </Link>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
