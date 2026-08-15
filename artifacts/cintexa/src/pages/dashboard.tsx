import { useGetDashboardSummary, useGetDashboardActivity, useGetDashboardTraffic } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, PenTool, Image as ImageIcon, Users, Globe, FormInput, ArrowUpRight, Activity, TrendingUp, TrendingDown, Minus, Mail } from "lucide-react";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

type SparklineData = {
  pages: number[];
  posts: number[];
  media: number[];
  users: number[];
  sites: number[];
  forms: number[];
};

type SubscriberSummary = {
  total: number;
  active: number;
  today: number;
};

function StatSparkline({ values, color = "hsl(var(--primary))" }: { values: number[]; color?: string }) {
  const safeValues = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : [];
  const data = safeValues.map((v, i) => ({ i, v }));
  const gradId = `sg-${color.replace(/[^a-z0-9]/gi, "")}`;
  if (data.length === 0) return null;
  return (
    <div className="w-full h-10 mt-2 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: activity, isLoading: isLoadingActivity } = useGetDashboardActivity();
  const { data: traffic, isLoading: isLoadingTraffic } = useGetDashboardTraffic();

  const { data: sparklines, isLoading: isLoadingSparklines } = useQuery<SparklineData>({
    queryKey: ["dashboard", "sparklines"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard/sparklines");
      if (!response.ok) return { pages: [], posts: [], media: [], users: [], sites: [], forms: [] };
      const payload = await response.json().catch(() => null);
      return payload && typeof payload === "object" ? payload as SparklineData : { pages: [], posts: [], media: [], users: [], sites: [], forms: [] };
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: subData, isLoading: isLoadingSubs, dataUpdatedAt } = useQuery<SubscriberSummary>({
    queryKey: ["dashboard", "subscribers-summary"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard/subscribers-summary");
      if (!response.ok) return { total: 0, active: 0, today: 0 };
      const payload = await response.json().catch(() => null);
      return payload && typeof payload === "object" ? {
        total: Number((payload as SubscriberSummary).total) || 0,
        active: Number((payload as SubscriberSummary).active) || 0,
        today: Number((payload as SubscriberSummary).today) || 0,
      } : { total: 0, active: 0, today: 0 };
    },
    refetchInterval: 30_000,
    staleTime: 29_000,
  });

  const safeTraffic = Array.isArray(traffic) ? traffic : [];
  const safeActivity = Array.isArray(activity) ? activity : [];
  const todayViews = safeTraffic.length >= 1 ? Number(safeTraffic[safeTraffic.length - 1].views) || 0 : null;
  const yesterdayViews = safeTraffic.length >= 2 ? Number(safeTraffic[safeTraffic.length - 2].views) || 0 : null;
  const viewsDelta = todayViews !== null && yesterdayViews !== null && yesterdayViews > 0
    ? Math.round(((todayViews - yesterdayViews) / yesterdayViews) * 100)
    : null;

  type StatKey = keyof SparklineData;
  const stats: Array<{ label: string; value: number; icon: React.ElementType; trend: string; sparkKey: StatKey }> = summary ? [
    { label: "Total Pages", value: Number(summary.totalPages) || 0, icon: FileText, trend: "+12%", sparkKey: "pages" },
    { label: "Total Posts", value: Number(summary.totalPosts) || 0, icon: PenTool, trend: "+4%", sparkKey: "posts" },
    { label: "Media Assets", value: Number(summary.totalMedia) || 0, icon: ImageIcon, trend: "+24%", sparkKey: "media" },
    { label: "Active Users", value: Number(summary.totalUsers) || 0, icon: Users, trend: "+2%", sparkKey: "users" },
    { label: "Connected Sites", value: Number(summary.totalSites) || 0, icon: Globe, trend: "0%", sparkKey: "sites" },
    { label: "Form Submissions", value: Number(summary.totalForms) || 0, icon: FormInput, trend: "+18%", sparkKey: "forms" },
  ] : [];

  const SPARK_COLOR = "hsl(var(--primary))";
  const lastPolled = dataUpdatedAt ? format(new Date(dataUpdatedAt), "h:mm:ss a") : null;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground mt-1">Metrics and performance for your connected sites.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoadingSummary ? (
          Array(6).fill(0).map((_, i) => (
            <Card key={i} className="border-border/50 bg-card/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-8 rounded-full" /></CardHeader>
              <CardContent><Skeleton className="h-8 w-16 mb-2" /><Skeleton className="h-10 w-full rounded" /><Skeleton className="h-3 w-20 mt-2" /></CardContent>
            </Card>
          ))
        ) : stats.length > 0 ? (
          stats.map((stat) => {
            const spark = sparklines?.[stat.sparkKey];
            return (
              <Card key={stat.sparkKey} className="border-border/50 bg-card/50 hover:bg-card/80 transition-colors">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary"><stat.icon className="h-4 w-4" /></div>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="text-2xl font-bold">{stat.value.toLocaleString()}</div>
                  {isLoadingSparklines ? <Skeleton className="h-10 w-full rounded mt-2" /> : spark ? <StatSparkline values={spark} color={SPARK_COLOR} /> : null}
                  <div className="flex items-center text-xs text-muted-foreground mt-1.5"><ArrowUpRight className="h-3 w-3 text-emerald-500 mr-1" /><span className="text-emerald-500 font-medium">{stat.trend}</span><span className="ml-1">from last month</span></div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card className="col-span-full border-border/50 bg-card/50">
            <CardContent className="py-10 text-center">
              <p className="text-sm text-muted-foreground">Dashboard statistics are currently unavailable.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">The workspace can still be used while the data connection is unavailable.</p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="col-span-2 border-border/50 bg-card/50">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div><CardTitle>Traffic Overview</CardTitle><CardDescription>Page views and unique visitors over the last 30 days.</CardDescription></div>
              {isLoadingTraffic ? <Skeleton className="h-7 w-32 rounded-full" /> : viewsDelta !== null && (
                <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shrink-0 ${viewsDelta > 0 ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20" : viewsDelta < 0 ? "bg-red-500/10 text-red-400 ring-1 ring-red-500/20" : "bg-muted text-muted-foreground ring-1 ring-border"}`}>
                  {viewsDelta > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : viewsDelta < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                  <span>{viewsDelta > 0 ? "+" : ""}{viewsDelta}% vs yesterday</span><span className="text-[10px] opacity-60 font-normal">({todayViews?.toLocaleString()} views)</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="h-[350px]">
            {isLoadingTraffic ? <div className="w-full h-full flex items-center justify-center"><Skeleton className="w-full h-full rounded-md" /></div> : safeTraffic.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={safeTraffic} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => { const date = new Date(v); return Number.isNaN(date.getTime()) ? String(v) : format(date, "MMM d"); }} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                  <RechartsTooltip contentStyle={{ backgroundColor: "var(--popover)", borderColor: "var(--border)", borderRadius: "6px" }} itemStyle={{ color: "var(--foreground)" }} labelStyle={{ color: "var(--muted-foreground)", marginBottom: "4px" }} />
                  <Line type="monotone" dataKey="views" name="Page Views" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "hsl(var(--primary))" }} />
                  <Line type="monotone" dataKey="visitors" name="Visitors" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No traffic data is available yet.</div>}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="text-base">Subscribers</CardTitle><div className="flex items-center gap-1.5"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span><span className="text-[10px] text-muted-foreground">Live · 30s</span></div></div></CardHeader>
            <CardContent className="space-y-4">
              {isLoadingSubs ? <div className="space-y-3"><Skeleton className="h-10 w-24" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div> : subData ? (
                <>
                  <div className="flex items-end gap-3"><div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0"><Mail className="h-5 w-5" /></div><div><div className="text-3xl font-bold leading-none">{Number(subData.total || 0).toLocaleString()}</div><div className="text-xs text-muted-foreground mt-0.5">{Number(subData.active || 0).toLocaleString()} active</div></div></div>
                  <div className="border-t border-border/50" />
                  <div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground mb-0.5">Gained today</p><div className="flex items-center gap-2"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span><span className="text-2xl font-bold text-emerald-400">+{Number(subData.today || 0).toLocaleString()}</span></div></div><div className="text-right"><p className="text-xs text-muted-foreground mb-0.5">Unsubscribed</p><span className="text-lg font-semibold text-muted-foreground">{Math.max(0, Number(subData.total || 0) - Number(subData.active || 0)).toLocaleString()}</span></div></div>
                  {lastPolled && <p className="text-[10px] text-muted-foreground/50 text-right">Updated {lastPolled}</p>}
                </>
              ) : <p className="text-sm text-muted-foreground">No subscriber data is available yet.</p>}
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/50 flex-1">
            <CardHeader><CardTitle>Recent Activity</CardTitle><CardDescription>Latest actions across your sites.</CardDescription></CardHeader>
            <CardContent>
              {isLoadingActivity ? <div className="space-y-4">{Array(4).fill(0).map((_, i) => <div key={i} className="flex items-center gap-4"><Skeleton className="h-8 w-8 rounded-full" /><div className="space-y-2 flex-1"><Skeleton className="h-4 w-full" /><Skeleton className="h-3 w-2/3" /></div></div>)}</div> : safeActivity.length > 0 ? (
                <div className="space-y-5">{safeActivity.slice(0, 4).map((item) => { const created = new Date(item.createdAt); return <div key={item.id} className="flex items-start gap-3"><div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-0.5"><Activity className="h-3.5 w-3.5 text-muted-foreground" /></div><div><p className="text-sm font-medium leading-snug text-foreground"><span className="font-semibold">{item.userName}</span>{" "}{String(item.action ?? "action").toLowerCase()}{" "}<span className="font-semibold">{item.entityTitle}</span></p><p className="text-xs text-muted-foreground mt-0.5">{Number.isNaN(created.getTime()) ? "Unknown time" : format(created, "MMM d, h:mm a")}</p></div></div>; })}</div>
              ) : <p className="text-sm text-muted-foreground">No recent activity yet.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
