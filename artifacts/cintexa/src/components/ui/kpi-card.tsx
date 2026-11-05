import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type KpiTone = "default" | "positive" | "caution" | "critical" | "gold";

const toneBorder: Record<KpiTone, string> = {
  default: "border-white/10 hover:border-primary/40",
  positive: "border-emerald-500/30 hover:border-emerald-400/50",
  caution: "border-yellow-500/30 hover:border-yellow-400/50",
  critical: "border-red-500/30 hover:border-red-400/50",
  gold: "border-amber-500/30 hover:border-amber-400/50",
};

interface KpiCardProps {
  label: string;
  value: string;
  href?: string;
  tone?: KpiTone;
  subtitle?: string;
  className?: string;
}

/** Generic labelled-number card. Shows exactly the value it is given. */
export function KpiCard({ label, value, href, tone = "default", subtitle, className }: KpiCardProps) {
  const card = (
    <Card className={cn("h-full transition-colors", toneBorder[tone], className)}>
      <CardContent className="pt-4 pb-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
        {subtitle && <p className="mt-1 text-[11px] text-muted-foreground/80">{subtitle}</p>}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {card}
    </Link>
  ) : (
    card
  );
}
