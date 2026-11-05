/**
 * Premium animated KPI card for CINTEXA Financial Intelligence.
 * Uses Framer Motion for smooth number transitions and depth hover.
 * Figures always come from real ledger data — never fabricated.
 */
import { motion, useReducedMotion } from "framer-motion";
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

const toneGlow: Record<KpiTone, string> = {
  default: "",
  positive: "shadow-[0_0_24px_-8px_rgba(16,185,129,0.35)]",
  caution: "shadow-[0_0_24px_-8px_rgba(234,179,8,0.3)]",
  critical: "shadow-[0_0_24px_-8px_rgba(239,68,68,0.35)]",
  gold: "shadow-[0_0_24px_-8px_rgba(245,158,11,0.35)]",
};

interface AnimatedKpiCardProps {
  label: string;
  value: string;
  href?: string;
  tone?: KpiTone;
  subtitle?: string;
  className?: string;
}

export function AnimatedKpiCard({
  label,
  value,
  href,
  tone = "default",
  subtitle,
  className,
}: AnimatedKpiCardProps) {
  const reduceMotion = useReducedMotion();

  const inner = (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      whileHover={reduceMotion ? undefined : { y: -2, scale: 1.01 }}
      className={cn("h-full", className)}
    >
      <Card
        className={cn(
          "h-full bg-gradient-to-br from-card/90 via-card to-card/80 backdrop-blur-sm",
          "transition-colors duration-200",
          toneBorder[tone],
          toneGlow[tone],
        )}
      >
        <CardContent className="pt-4 pb-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
          <motion.p
            key={value}
            initial={reduceMotion ? false : { opacity: 0.4, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight text-foreground"
          >
            {value}
          </motion.p>
          {subtitle && (
            <p className="mt-1 text-[11px] text-muted-foreground/80">{subtitle}</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}
