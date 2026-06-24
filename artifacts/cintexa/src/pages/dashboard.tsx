import { useGetDashboardSummary, useGetDashboardActivity, useGetDashboardTraffic } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, PenTool, Image as ImageIcon, Users, Globe, FormInput, ArrowUpRight, Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────
type SparklineData = {
  pages:  number[];
  posts:  number[];
  media:  number[];
  users:  number[];
  sites:  number[];
  forms:  number[];
};

// ── Sparkline mini-chart ───────────────────────────────────────────────────
function StatSparkline({ values, color = "hsl(var(--primary))" }: { values: number[]; color?: string }) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="w-full h-10 mt-2 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={`sg-${color.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#sg-${color.replace(/[^a-z0-9]/gi, "")})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: activity, isLoading: isLoadingActivity } = useGetDashboardActivity();
  const { data: traffic, isLoading: isLoadingTraffic } = useGetDashboardTraffic();

  const { data: sparklines, isLoading: isLoadingSparklines } = useQuery<SparklineData>({
    queryKey: ["dashboard", "sparklines"],
    queryFn: () => fetch("/api/dashboard/sparklines").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  // Today vs Yesterday badge computation
  const todayViews     = traffic && traffic.length >= 1 ? traffic[traffic.length - 1].views : null;
  const yesterdayViews = traffic && traffic.length >= 2 ? traffic[traffic.length - 2].views : null;
  const viewsDelta     = todayViews !== null && yesterdayViews !== null && yesterdayViews > 0
    ? Math.round(((todayViews - yesterdayViews) / yesterdayViews) * 100)
    : null;

  // Stat card definitions — sparkline key maps to SparklineData property
  type StatKey = keyof SparklineData;
  const stats: Array<{ label: string; value: number; icon: React.ElementType; trend: string; sparkKey: StatKey }> | null =
    summary
      ? [
          { label: "Total Pages",       value: summary.totalPages,  icon: FileText,   trend: "+12%", sparkKey: "pages" },
          { label: "Total Posts",        value: summary.totalPosts,  icon: PenTool,    trend: "+4%",  sparkKey: "posts" },
          { label: "Media Assets",       value: summary.totalMedia,  icon: ImageIcon,  trend: "+24%", sparkKey: "media" },
          { label: "Active Users",       value: summary.totalUsers,  icon: Users,      trend: "+2%",  sparkKey: "users" },
          { label: "Connected Sites",    value: summary.totalSites,  icon: Globe,      trend: "0%",   sparkKey: "sites" },
          { label: "Form Submissions",   value: summary.totalForms,  icon: FormInput,  trend: "+18%", sparkKey: "forms" },
        ]
      : null;

  const SPARK_COLOR = "hsl(var(--primary))";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground mt-1">Metrics and performance for your connected sites.</p>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoadingSummary ? (
          Array(6).fill(0).map((_, i) => (
            <Card key={i} className="border-border/50 bg-card/50">
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
          ))
        ) : (
          stats!.map((stat, i) => {
            const spark = sparklines?.[stat.sparkKey];
            return (
              <Card key={i} className="border-border/50 bg-card/50 hover:bg-card/80 transition-colors">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.label}
                  </CardTitle>
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <stat.icon className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="text-2xl font-bold">{stat.value.toLocaleString()}</div>

                  {/* Sparkline */}
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
            );
          })
        )}
      </div>

      {/* ── Traffic chart + Activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="col-span-2 border-border/50 bg-card/50">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Traffic Overview</CardTitle>
                <CardDescription>Page views and unique visitors over the last 30 days.</CardDescription>
              </div>
              {isLoadingTraffic ? (
                <Skeleton className="h-7 w-32 rounded-full" />
              ) : viewsDelta !== null && (
                <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shrink-0 ${
                  viewsDelta > 0
                    ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
                    : viewsDelta < 0
                    ? "bg-red-500/10 text-red-400 ring-1 ring-red-500/20"
                    : "bg-muted text-muted-foreground ring-1 ring-border"
                }`}>
                  {viewsDelta > 0 ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : viewsDelta < 0 ? (
                    <TrendingDown className="h-3.5 w-3.5" />
                  ) : (
                    <Minus className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {viewsDelta > 0 ? "+" : ""}{viewsDelta}% vs yesterday
                  </span>
                  <span className="text-[10px] opacity-60 font-normal">
                    ({todayViews?.toLocaleString()} views)
                  </span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="h-[350px]">
            {isLoadingTraffic ? (
              <div className="w-full h-full flex items-center justify-center">
                <Skeleton className="w-full h-full rounded-md" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={traffic || []} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="var(--muted-foreground)"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => format(new Date(value), "MMM d")}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}`}
                  />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: "var(--popover)", borderColor: "var(--border)", borderRadius: "6px" }}
                    itemStyle={{ color: "var(--foreground)" }}
                    labelStyle={{ color: "var(--muted-foreground)", marginBottom: "4px" }}
                  />
                  <Line type="monotone" dataKey="views"    name="Page Views" stroke="hsl(var(--primary))"          strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "hsl(var(--primary))" }} />
                  <Line type="monotone" dataKey="visitors" name="Visitors"   stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest actions across your sites.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingActivity ? (
              <div className="space-y-4">
                {Array(5).fill(0).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {activity?.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-none mb-1 text-foreground">
                        <span className="font-semibold">{item.userName}</span> {item.action.toLowerCase()} <span className="font-semibold">{item.entityTitle}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(item.createdAt), "MMM d, h:mm a")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
