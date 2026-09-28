import { CintexaLogo } from "@/components/SplashScreen";
import { Link } from "wouter";
import { useEffect, useState } from "react";
import { useGetDashboardSummary, useGetDashboardActivity, useGetDashboardTraffic } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText, PenTool, Image as ImageIcon, Users, Globe, FormInput,
  ArrowUpRight, Activity, TrendingUp, TrendingDown, Minus, Mail, Sparkles,
  History, ArrowRight,
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import { motion, type Variants } from "framer-motion";

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

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.08 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 380, damping: 28 },
  },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 320, damping: 30 },
  },
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
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradId})`}
            dot={false}
            isAnimationActive
            animationDuration={900}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: activity, isLoading: isLoadingActivity } = useGetDashboardActivity();
  const { data: traffic, isLoading: isLoadingTraffic } = useGetDashboardTraffic();

  const [diagnosticHistory, setDiagnosticHistory] = useState<Array<{ id: string; taskType: string; title: string; detail?: string; createdAt: string; status: string }>>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("cintexa-diagnostic-task-history");
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setDiagnosticHistory(parsed.slice(0, 12));
    } catch {
      setDiagnosticHistory([]);
    }
    const refresh = () => {
      try {
        const raw = localStorage.getItem("cintexa-diagnostic-task-history");
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) setDiagnosticHistory(parsed.slice(0, 12));
      } catch { /* ignore */ }
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);



  const { data: sparklines, isLoading: isLoadingSparklines } = useQuery<SparklineData>({
    queryKey: ["dashboard", "sparklines"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard/sparklines");
      if (!response.ok) return { pages: [], posts: [], media: [], users: [], sites: [], forms: [] };
      const payload = await response.json().catch(() => null);
      return payload && typeof payload === "object"
        ? (payload as SparklineData)
        : { pages: [], posts: [], media: [], users: [], sites: [], forms: [] };
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: subData, isLoading: isLoadingSubs, dataUpdatedAt } = useQuery<SubscriberSummary>({
    queryKey: ["dashboard", "subscribers-summary"],
    queryFn: async () => {
      const response = await fetch("/api/dashboard/subscribers-summary");
      if (!response.ok) return { total: 0, active: 0, today: 0 };
      const payload = await response.json().catch(() => null);
      return payload && typeof payload === "object"
        ? {
            total: Number((payload as SubscriberSummary).total) || 0,
            active: Number((payload as SubscriberSummary).active) || 0,
            today: Number((payload as SubscriberSummary).today) || 0,
          }
        : { total: 0, active: 0, today: 0 };
    },
    refetchInterval: 30_000,
    staleTime: 29_000,
  });

  const safeTraffic = Array.isArray(traffic) ? traffic : [];
  const safeActivity = Array.isArray(activity) ? activity : [];
  const todayViews = safeTraffic.length >= 1 ? Number(safeTraffic[safeTraffic.length - 1].views) || 0 : null;
  const yesterdayViews = safeTraffic.length >= 2 ? Number(safeTraffic[safeTraffic.length - 2].views) || 0 : null;
  const viewsDelta =
    todayViews !== null && yesterdayViews !== null && yesterdayViews > 0
      ? Math.round(((todayViews - yesterdayViews) / yesterdayViews) * 100)
      : null;

  type StatKey = keyof SparklineData;
  const stats: Array<{ label: string; value: number; icon: React.ElementType; trend: string; sparkKey: StatKey }> =
    summary
      ? [
          { label: "Total Pages", value: Number(summary.totalPages) || 0, icon: FileText, trend: "+12%", sparkKey: "pages" },
          { label: "Total Posts", value: Number(summary.totalPosts) || 0, icon: PenTool, trend: "+4%", sparkKey: "posts" },
          { label: "Media Assets", value: Number(summary.totalMedia) || 0, icon: ImageIcon, trend: "+24%", sparkKey: "media" },
          { label: "Active Users", value: Number(summary.totalUsers) || 0, icon: Users, trend: "+2%", sparkKey: "users" },
          { label: "Connected Sites", value: Number(summary.totalSites) || 0, icon: Globe, trend: "0%", sparkKey: "sites" },
          { label: "Form Submissions", value: Number(summary.totalForms) || 0, icon: FormInput, trend: "+18%", sparkKey: "forms" },
        ]
      : [];

  const SPARK_COLOR = "hsl(var(--primary))";
  const lastPolled = dataUpdatedAt ? format(new Date(dataUpdatedAt), "h:mm:ss a") : null;

  return (
    <motion.div
      className="space-y-8"
      initial="hidden"
      animate="show"
      variants={containerVariants}
    >
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <CintexaLogo size={36} />
            <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
            <motion.span
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.35, type: "spring", stiffness: 400 }}
            >
              <Sparkles className="h-3 w-3" />
              Live
            </motion.span>
          </div>
          <p className="text-muted-foreground mt-1">Metrics and performance for your connected sites.</p>
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card overflow-hidden relative">
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Activity className="h-5 w-5 text-primary" />
                Business Diagnostic
              </CardTitle>
              <CardDescription className="mt-1.5">
                Diagnose the business, research the company online, build strategy and download an execution PDF.
              </CardDescription>
            </div>
            <Link href="/diagnostics">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 py-2 cursor-pointer hover:opacity-90">
                Open diagnostic <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-3 gap-3">
            {[
              { label: "Company profile", hint: "Name, website, niche" },
              { label: "Live research", hint: "Run Search on the public site" },
              { label: "Strategy PDF", hint: "Roadmap + goals export" },
            ].map((x) => (
              <div key={x.label} className="rounded-xl border bg-background/60 p-3">
                <div className="text-sm font-semibold">{x.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{x.hint}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              Diagnostic history
            </CardTitle>
            <CardDescription>Recent diagnostic tasks from this browser</CardDescription>
          </CardHeader>
          <CardContent>
            {diagnosticHistory.length === 0 ? (
              <div className="text-sm text-muted-foreground space-y-3">
                <p>No diagnostic tasks yet.</p>
                <Link href="/diagnostics">
                  <span className="text-primary text-sm font-medium cursor-pointer hover:underline">Start a diagnostic →</span>
                </Link>
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {diagnosticHistory.map((t) => (
                  <div key={t.id} className="border rounded-lg p-2.5 text-sm">
                    <div className="font-medium leading-snug">{t.title}</div>
                    {t.detail ? <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.detail}</div> : null}
                    <div className="text-[10px] text-muted-foreground mt-1 flex justify-between gap-2">
                      <span>{t.taskType}</span>
                      <span>{t.createdAt ? new Date(t.createdAt).toLocaleString() : ""}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3">
              <Link href="/diagnostics">
                <span className="text-xs text-primary font-medium cursor-pointer hover:underline">View full diagnostic & history →</span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>


      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        variants={containerVariants}
      >
        {isLoadingSummary ? (
          Array(6)
            .fill(0)
            .map((_, i) => (
              <motion.div key={i} variants={itemVariants}>
                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-8 rounded-full" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-8 w-16 mb-2" />
                    <Skeleton className="h-10 w-full rounded" />
                    <Skeleton className="h-3 w-20 mt-2" />
                  </CardContent>
                </Card>
              </motion.div>
            ))
        ) : stats.length > 0 ? (
          stats.map((stat) => {
            const spark = sparklines?.[stat.sparkKey];
            return (
              <motion.div key={stat.sparkKey} variants={itemVariants} whileHover={{ y: -3, transition: { duration: 0.2 } }}>
                <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:bg-card/80 hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 group overflow-hidden relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/0 via-primary/0 to-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                  <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 relative">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                    <motion.div
                      className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary/20 transition-colors"
                      whileHover={{ rotate: 8, scale: 1.08 }}
                    >
                      <stat.icon className="h-4 w-4" />
                    </motion.div>
                  </CardHeader>
                  <CardContent className="pb-3 relative">
                    <div className="text-2xl font-bold tracking-tight">{stat.value.toLocaleString()}</div>
                    {isLoadingSparklines ? (
                      <Skeleton className="h-10 w-full rounded mt-2" />
                    ) : spark ? (
                      <StatSparkline values={spark} color={SPARK_COLOR} />
                    ) : null}
                    <div className="flex items-center text-xs text-muted-foreground mt-1.5">
                      <ArrowUpRight className="h-3 w-3 text-emerald-500 mr-1" />
                      <span className="text-emerald-500 font-medium">{stat.trend}</span>
                      <span className="ml-1">from last month</span>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })
        ) : (
          <motion.div className="col-span-full" variants={itemVariants}>
            <Card className="border-border/50 bg-card/50">
              <CardContent className="py-10 text-center">
                <p className="text-sm text-muted-foreground">Dashboard statistics are currently unavailable.</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  The workspace can still be used while the data connection is unavailable.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </motion.div>

      <motion.div className="grid grid-cols-1 lg:grid-cols-3 gap-8" variants={containerVariants}>
        <motion.div className="col-span-2" variants={fadeUp}>
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm h-full overflow-hidden">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Traffic Overview</CardTitle>
                  <CardDescription>Page views and unique visitors over the last 30 days.</CardDescription>
                </div>
                {isLoadingTraffic ? (
                  <Skeleton className="h-7 w-32 rounded-full" />
                ) : viewsDelta !== null ? (
                  <motion.div
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 }}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shrink-0 ${
                      viewsDelta > 0
                        ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
                        : viewsDelta < 0
                          ? "bg-red-500/10 text-red-400 ring-1 ring-red-500/20"
                          : "bg-muted text-muted-foreground ring-1 ring-border"
                    }`}
                  >
                    {viewsDelta > 0 ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : viewsDelta < 0 ? (
                      <TrendingDown className="h-3.5 w-3.5" />
                    ) : (
                      <Minus className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {viewsDelta > 0 ? "+" : ""}
                      {viewsDelta}% vs yesterday
                    </span>
                    <span className="text-[10px] opacity-60 font-normal">({todayViews?.toLocaleString()} views)</span>
                  </motion.div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="h-[350px]">
              {isLoadingTraffic ? (
                <div className="w-full h-full flex items-center justify-center">
                  <Skeleton className="w-full h-full rounded-md" />
                </div>
              ) : safeTraffic.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={safeTraffic} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="var(--muted-foreground)"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => {
                        const date = new Date(v);
                        return Number.isNaN(date.getTime()) ? String(v) : format(date, "MMM d");
                      }}
                    />
                    <YAxis
                      stroke="var(--muted-foreground)"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: "var(--popover)",
                        borderColor: "var(--border)",
                        borderRadius: "8px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                      }}
                      itemStyle={{ color: "var(--foreground)" }}
                      labelStyle={{ color: "var(--muted-foreground)", marginBottom: "4px" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="views"
                      name="Page Views"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, fill: "hsl(var(--primary))", strokeWidth: 0 }}
                      animationDuration={1200}
                    />
                    <Line
                      type="monotone"
                      dataKey="visitors"
                      name="Visitors"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      animationDuration={1200}
                      animationBegin={200}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  No traffic data is available yet.
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div className="flex flex-col gap-6" variants={containerVariants}>
          <motion.div variants={itemVariants}>
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden relative">
              <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-primary/5 blur-2xl pointer-events-none" />
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Subscribers</CardTitle>
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span className="text-[10px] text-muted-foreground">Live · 30s</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoadingSubs ? (
                  <div className="space-y-3">
                    <Skeleton className="h-10 w-24" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ) : subData ? (
                  <>
                    <div className="flex items-end gap-3">
                      <motion.div
                        className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0"
                        whileHover={{ scale: 1.1, rotate: -6 }}
                      >
                        <Mail className="h-5 w-5" />
                      </motion.div>
                      <div>
                        <div className="text-3xl font-bold leading-none">{Number(subData.total || 0).toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {Number(subData.active || 0).toLocaleString()} active
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-border/50" />
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Gained today</p>
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                          </span>
                          <span className="text-2xl font-bold text-emerald-400">
                            +{Number(subData.today || 0).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground mb-0.5">Unsubscribed</p>
                        <span className="text-lg font-semibold text-muted-foreground">
                          {Math.max(0, Number(subData.total || 0) - Number(subData.active || 0)).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {lastPolled && (
                      <p className="text-[10px] text-muted-foreground/50 text-right">Updated {lastPolled}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No subscriber data is available yet.</p>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants} className="flex-1">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm flex-1 h-full">
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest actions across your sites.</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingActivity ? (
                  <div className="space-y-4">
                    {Array(4)
                      .fill(0)
                      .map((_, i) => (
                        <div key={i} className="flex items-center gap-4">
                          <Skeleton className="h-8 w-8 rounded-full" />
                          <div className="space-y-2 flex-1">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-3 w-2/3" />
                          </div>
                        </div>
                      ))}
                  </div>
                ) : safeActivity.length > 0 ? (
                  <div className="space-y-5">
                    {safeActivity.slice(0, 4).map((item, index) => {
                      const created = new Date(item.createdAt);
                      return (
                        <motion.div
                          key={item.id}
                          className="flex items-start gap-3 group"
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.5 + index * 0.08 }}
                        >
                          <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-primary/15 transition-colors">
                            <Activity className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                          <div>
                            <p className="text-sm font-medium leading-snug text-foreground">
                              <span className="font-semibold">{item.userName}</span>{" "}
                              {String(item.action ?? "action").toLowerCase()}{" "}
                              <span className="font-semibold">{item.entityTitle}</span>
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {Number.isNaN(created.getTime()) ? "Unknown time" : format(created, "MMM d, h:mm a")}
                            </p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No recent activity yet.</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
