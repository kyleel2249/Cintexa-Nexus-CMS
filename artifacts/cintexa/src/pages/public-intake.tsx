import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emptyIntakeTemplate, type IntakeFormPayload } from "@/lib/diagnostic-intake-form";
import { SOCIAL_AD_PLATFORMS, questionBank } from "@/lib/business-diagnostic";
import { CheckCircle2, Loader2 } from "lucide-react";

const API = (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

export default function PublicIntake() {
  const [, params] = useRoute("/intake/:token");
  const token = params?.token || "";
  const [meta, setMeta] = useState<{ label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<IntakeFormPayload>(() => emptyIntakeTemplate());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/intake/public/${encodeURIComponent(token)}`);
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error((body as any).error || (r.status === 410 ? "Link expired" : "This intake link is invalid or has expired."));
        }
        if (!cancelled) setMeta(body);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "This intake link is invalid or has expired.");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  function setField<K extends keyof IntakeFormPayload>(key: K, value: IntakeFormPayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/intake/public/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || "Submit failed");
      }
      setDone(true);
    } catch (err: any) {
      setError(err?.message || "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (error && !meta) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center text-destructive">{error}</CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
        <Card className="max-w-md w-full">
          <CardContent className="p-10 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
            <h2 className="text-2xl font-bold">Intake recorded</h2>
            <p className="text-muted-foreground">
              Your answers have been saved in Nexus and are ready for analysis.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{meta?.label || "Diagnostic Intake"}</h1>
          <p className="text-muted-foreground">
            Complete the form below. Your responses are saved directly into Nexus.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Company profile</CardTitle>
              <CardDescription>Basic identity and context.</CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
              {(
                [
                  ["companyName", "Company name"],
                  ["website", "Website"],
                  ["industry", "Industry"],
                  ["subIndustry", "Sub-industry"],
                  ["businessModel", "Business model"],
                  ["geographicMarkets", "Geographic markets"],
                  ["employees", "Employees"],
                  ["revenueRange", "Revenue range"],
                  ["strategicObjective", "Strategic objective"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <Label>{label}</Label>
                  <Input
                    className="mt-1.5"
                    value={(form as any)[key] ?? ""}
                    onChange={(e) => setField(key as any, e.target.value)}
                  />
                </div>
              ))}
              <div className="sm:col-span-2">
                <Label>Competitors (comma or name|website)</Label>
                <Input
                  className="mt-1.5"
                  value={form.competitors ?? ""}
                  onChange={(e) => setField("competitors", e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Notes</Label>
                <textarea
                  className="mt-1.5 w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.notes ?? ""}
                  onChange={(e) => setField("notes", e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Key metrics</CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-3 gap-4">
              {(
                [
                  ["monthlyRevenue", "Monthly revenue"],
                  ["monthlyLeads", "Monthly leads"],
                  ["qualifiedLeads", "Qualified leads"],
                  ["customers", "New customers / mo"],
                  ["conversion", "Conversion %"],
                  ["aov", "AOV"],
                  ["cac", "CAC"],
                  ["churn", "Churn %"],
                  ["retention", "Retention %"],
                  ["grossMargin", "Gross margin %"],
                  ["netMargin", "Net margin %"],
                  ["salesCycle", "Sales cycle (days)"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <Label>{label}</Label>
                  <Input
                    type="number"
                    step="any"
                    className="mt-1.5"
                    value={form[key] ?? ""}
                    onChange={(e) =>
                      setField(key, e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assessment questions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {questionBank.map((q) => (
                <div key={q.id} className="space-y-1.5">
                  <Label className="text-sm">
                    [{q.pillar}] {q.text}
                  </Label>
                  {q.type === "boolean" || q.type === "scale" || (q.type === "select" && q.options) ? (
                    <select
                      className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                      value={String(form.answers?.[q.id] ?? "")}
                      onChange={(e) => {
                        const v = e.target.value;
                        const parsed =
                          q.type === "boolean"
                            ? v === "true"
                            : q.type === "scale"
                              ? Number(v)
                              : v;
                        setForm((prev) => ({
                          ...prev,
                          answers: { ...prev.answers, [q.id]: parsed },
                        }));
                      }}
                    >
                      <option value="">—</option>
                      {q.type === "boolean" && (
                        <>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </>
                      )}
                      {q.type === "scale" &&
                        [1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      {q.type === "select" &&
                        q.options?.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <Input
                      type={q.type === "number" ? "number" : "text"}
                      value={String(form.answers?.[q.id] ?? "")}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          answers: {
                            ...prev.answers,
                            [q.id]:
                              q.type === "number"
                                ? e.target.value === ""
                                  ? 0
                                  : Number(e.target.value)
                                : e.target.value,
                          },
                        }))
                      }
                    />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Paid social platforms</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {SOCIAL_AD_PLATFORMS.map((p) => {
                const s = form.social?.[p.id] || {};
                return (
                  <div key={p.id} className="border rounded-lg p-4 space-y-3">
                    <label className="flex items-center gap-2 font-medium">
                      <input
                        type="checkbox"
                        checked={!!s.enabled}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            social: {
                              ...prev.social,
                              [p.id]: { ...s, enabled: e.target.checked },
                            },
                          }))
                        }
                      />
                      {p.label}{" "}
                      <span className="text-muted-foreground text-sm">({p.channel})</span>
                    </label>
                    {s.enabled && (
                      <div className="grid sm:grid-cols-4 gap-3">
                        {(
                          [
                            "monthlySpend",
                            "impressions",
                            "clicks",
                            "leads",
                            "conversions",
                            "roas",
                            "cpc",
                            "cpl",
                          ] as const
                        ).map((field) => (
                          <div key={field}>
                            <Label className="text-xs capitalize">
                              {field.replace(/([A-Z])/g, " $1")}
                            </Label>
                            <Input
                              type="number"
                              step="any"
                              className="mt-1"
                              value={s[field] ?? ""}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  social: {
                                    ...prev.social,
                                    [p.id]: {
                                      ...s,
                                      [field]:
                                        e.target.value === "" ? null : Number(e.target.value),
                                    },
                                  },
                                }))
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {error && <p className="text-sm text-destructive text-center">{error}</p>}

          <div className="flex justify-center pb-12">
            <Button type="submit" size="lg" disabled={saving} className="min-w-[200px]">
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                "Save & submit to Nexus"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
