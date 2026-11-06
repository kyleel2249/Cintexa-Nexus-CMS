import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { csiGet, csiPost, csiPut, formatCurrency, majorToMinor } from "@/lib/csi/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Mode =
  | "profile"
  | "objectives"
  | "departments"
  | "products"
  | "pricing"
  | "budgets"
  | "allocation"
  | "forecast"
  | "risks"
  | "roadmap";

function Shell({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      {children}
    </div>
  );
}

/** Each mode renders different hooks; keying by mode remounts cleanly on navigation instead of crashing the page. */
export default function CsiPage({ mode }: { mode: Mode }) {
  return <CsiPageInner key={mode} mode={mode} />;
}

function CsiPageInner({ mode }: { mode: Mode }) {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["csi"] });

  if (mode === "profile") {
    const q = useQuery({ queryKey: ["csi", "profile"], queryFn: () => csiGet<any>("/profile") });
    const [form, setForm] = useState<any>(null);
    const p = form || q.data?.profile || {};
    const save = useMutation({
      mutationFn: () => csiPut("/profile", form || q.data?.profile),
      onSuccess: () => {
        inv();
        setForm(null);
      },
    });
    return (
      <Shell title="Corporate profile" desc="Vision, mission and positioning — versioned on each save">
        {q.data?.profile && (
          <div className="space-y-3 max-w-2xl">
            {(["legalName", "tradingName", "vision", "mission", "brandPromise", "positioning", "philosophy", "businessModel"] as const).map(
              (k) => (
                <div key={k}>
                  <label className="text-xs uppercase text-muted-foreground">{k}</label>
                  <Input
                    className="mt-1"
                    value={(form || p)[k] || ""}
                    onChange={(e) => setForm({ ...(form || p), [k]: e.target.value })}
                  />
                </div>
              ),
            )}
            <p className="text-xs text-muted-foreground">Version {p.version}</p>
            <Button disabled={save.isPending || !form} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save profile"}
            </Button>
          </div>
        )}
      </Shell>
    );
  }

  if (mode === "objectives") {
    const q = useQuery({ queryKey: ["csi", "obj"], queryFn: () => csiGet<{ items: any[] }>("/objectives") });
    const [title, setTitle] = useState("");
    const [owner, setOwner] = useState("");
    const [target, setTarget] = useState("100");
    const [actual, setActual] = useState("0");
    const create = useMutation({
      mutationFn: () =>
        csiPost("/objectives", {
          title,
          owner,
          targetValue: Number(target) || 0,
          actualValue: Number(actual) || 0,
          status: "active",
          category: "strategic",
          horizon: "medium",
        }),
      onSuccess: () => {
        inv();
        setTitle("");
      },
    });
    return (
      <Shell title="Strategic objectives" desc="Progress = actual÷target unless override with recorded reason">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Objective title" value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-[200px]" />
          <Input placeholder="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} className="w-40" />
          <Input placeholder="Target" value={target} onChange={(e) => setTarget(e.target.value)} className="w-24" />
          <Input placeholder="Actual" value={actual} onChange={(e) => setActual(e.target.value)} className="w-24" />
          <Button disabled={!title || create.isPending} onClick={() => create.mutate()}>
            Add objective
          </Button>
        </div>
        <div className="space-y-2">
          {(q.data?.items || []).map((o) => (
            <Card key={o.id}>
              <CardContent className="py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">
                    {o.code} · {o.title}
                  </span>
                  <span className="text-xs uppercase text-muted-foreground">{o.status}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Owner {o.owner || "—"} · Progress <strong>{o.progressPct}%</strong> (actual {o.actualValue} / target {o.targetValue})
                </p>
                <div className="mt-2 h-1.5 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, o.progressPct || 0)}%` }} />
                </div>
              </CardContent>
            </Card>
          ))}
          {!q.data?.items?.length && <p className="text-sm text-muted-foreground">No objectives yet — create the first one above.</p>}
        </div>
      </Shell>
    );
  }

  if (mode === "departments") {
    const q = useQuery({ queryKey: ["csi", "dept"], queryFn: () => csiGet<{ items: any[] }>("/departments") });
    const [name, setName] = useState("");
    const [code, setCode] = useState("");
    const create = useMutation({
      mutationFn: () => csiPost("/departments", { name, code }),
      onSuccess: () => {
        inv();
        setName("");
        setCode("");
      },
    });
    return (
      <Shell title="Departments" desc="Organisation structure — budgets in minor units when set">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} className="w-28" />
          <Input placeholder="Department name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>
            Add
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {(q.data?.items || []).map((d) => (
            <Card key={d.id}>
              <CardContent className="py-3 text-sm">
                <p className="font-medium">
                  {d.code} · {d.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  Budget {formatCurrency(d.budgetMinor || 0)} · {d.active ? "Active" : "Archived"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "products") {
    const q = useQuery({ queryKey: ["csi", "prod"], queryFn: () => csiGet<{ items: any[] }>("/products") });
    const [name, setName] = useState("");
    const [code, setCode] = useState("");
    const create = useMutation({
      mutationFn: () => csiPost("/products", { name, code, status: "concept" }),
      onSuccess: () => {
        inv();
        setName("");
      },
    });
    return (
      <Shell title="Product portfolio" desc="Lifecycle: concept → released → active → retired">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} className="w-28" />
          <Input placeholder="Product name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>
            Add product
          </Button>
        </div>
        <div className="space-y-2">
          {(q.data?.items || []).map((p) => (
            <Card key={p.id}>
              <CardContent className="py-3 text-sm flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {p.code} · {p.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.category} · {p.status} · v{p.version}
                  </p>
                </div>
                <span className="tabular-nums text-xs">{formatCurrency(p.pricingMinor || 0)}</span>
              </CardContent>
            </Card>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "pricing") {
    const q = useQuery({ queryKey: ["csi", "prices"], queryFn: () => csiGet<{ items: any[] }>("/prices") });
    const [name, setName] = useState("");
    const [amount, setAmount] = useState("");
    const [tier, setTier] = useState("standard");
    const create = useMutation({
      mutationFn: () =>
        csiPost("/prices", {
          name,
          tier,
          amountMinor: majorToMinor(Number(amount) || 0),
          sku: name.slice(0, 20).toUpperCase().replace(/\s+/g, "-"),
        }),
      onSuccess: () => {
        inv();
        setName("");
        setAmount("");
      },
    });
    return (
      <Shell title="Pricing catalogue" desc="Enter major units (5000 = GH₵ 5,000.00). History is append-only new rows.">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Price name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Tier" value={tier} onChange={(e) => setTier(e.target.value)} className="w-28" />
          <Input placeholder="Amount GHS" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
          <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>
            Add price
          </Button>
        </div>
        <div className="space-y-2 text-sm">
          {(q.data?.items || []).map((e) => (
            <Card key={e.id}>
              <CardContent className="py-3 flex justify-between gap-2">
                <span>
                  {e.name} · {e.tier}
                </span>
                <span className="tabular-nums font-medium">{formatCurrency(e.amountMinor, e.currency)}</span>
              </CardContent>
            </Card>
          ))}
          {!q.data?.items?.length && <p className="text-muted-foreground">No price rows yet.</p>}
        </div>
      </Shell>
    );
  }

  if (mode === "budgets") {
    const q = useQuery({ queryKey: ["csi", "bud"], queryFn: () => csiGet<{ items: any[] }>("/budgets") });
    const [category, setCategory] = useState("");
    const [planned, setPlanned] = useState("");
    const create = useMutation({
      mutationFn: () =>
        csiPost("/budgets", {
          category,
          plannedMinor: majorToMinor(Number(planned) || 0),
          actualMinor: 0,
        }),
      onSuccess: () => {
        inv();
        setCategory("");
        setPlanned("");
      },
    });
    return (
      <Shell title="Budgets" desc="Planning amounts in major units; actuals should be reconciled to Finance expenditure">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <Input placeholder="Planned GHS" value={planned} onChange={(e) => setPlanned(e.target.value)} className="w-32" />
          <Button disabled={!category || create.isPending} onClick={() => create.mutate()}>
            Add line
          </Button>
        </div>
        <div className="space-y-2 text-sm">
          {(q.data?.items || []).map((b) => (
            <Card key={b.id}>
              <CardContent className="py-3 flex justify-between gap-2">
                <span>
                  {b.year} · {b.category}
                </span>
                <span className="tabular-nums">
                  Planned {formatCurrency(b.plannedMinor)} · Actual {formatCurrency(b.actualMinor)}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "allocation") {
    const q = useQuery({ queryKey: ["csi", "alloc"], queryFn: () => csiGet<any>("/allocation") });
    const a = q.data?.allocation;
    const [form, setForm] = useState<any>(null);
    const f = form || a || {};
    const save = useMutation({
      mutationFn: () => csiPut("/allocation", form || a),
      onSuccess: () => {
        inv();
        setForm(null);
      },
    });
    const keys = [
      ["operationsPct", "Operations %"],
      ["marketingPct", "Marketing %"],
      ["personnelPct", "Personnel %"],
      ["expansionPct", "Expansion %"],
      ["reservesPct", "Reserves %"],
      ["retainedPct", "Retained %"],
    ] as const;
    return (
      <Shell title="Resource allocation" desc="Percentages must total 100%. availableCashMinor must reflect real cash, not forecasts.">
        {a && (
          <div className="space-y-3 max-w-lg">
            {keys.map(([k, label]) => (
              <div key={k} className="flex items-center gap-2">
                <label className="text-sm w-36">{label}</label>
                <Input
                  type="number"
                  className="w-28"
                  value={f[k] ?? ""}
                  onChange={(e) => setForm({ ...f, [k]: Number(e.target.value) })}
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <label className="text-sm w-36">Available cash (GHS)</label>
              <Input
                type="number"
                className="w-40"
                value={f.availableCashMinor != null ? f.availableCashMinor / 100 : ""}
                onChange={(e) => setForm({ ...f, availableCashMinor: majorToMinor(Number(e.target.value) || 0) })}
              />
            </div>
            <p className={`text-sm ${q.data?.validation?.balanced ? "text-emerald-600" : "text-rose-600"}`}>
              Sum: {q.data?.validation?.sum ?? "—"}% {q.data?.validation?.balanced ? "(balanced)" : "(must equal 100)"}
            </p>
            <Button disabled={save.isPending || !form} onClick={() => save.mutate()}>
              Save allocation
            </Button>
          </div>
        )}
      </Shell>
    );
  }

  if (mode === "forecast") {
    const [start, setStart] = useState("100000");
    const [growth, setGrowth] = useState("15");
    const [scenario, setScenario] = useState("base");
    const [result, setResult] = useState<any>(null);
    const run = useMutation({
      mutationFn: () =>
        csiPost("/forecast", {
          startRevenueMinor: majorToMinor(Number(start) || 0),
          revenueGrowthPct: Number(growth) || 0,
          scenario,
          years: 5,
        }),
      onSuccess: setResult,
    });
    return (
      <Shell title="Financial forecasts" desc="Projections only — clearly labelled; does not write to the Finance ledger">
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <label className="text-sm">
            Start revenue GHS
            <Input value={start} onChange={(e) => setStart(e.target.value)} className="w-36" />
          </label>
          <label className="text-sm">
            Growth %
            <Input value={growth} onChange={(e) => setGrowth(e.target.value)} className="w-24" />
          </label>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            <option value="conservative">Conservative</option>
            <option value="base">Base</option>
            <option value="growth">Growth</option>
          </select>
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            Run projection
          </Button>
        </div>
        {result && (
          <div className="space-y-2">
            <p className="text-xs text-amber-700 dark:text-amber-400">{result.note}</p>
            {(result.series || []).map((s: any) => (
              <Card key={s.year}>
                <CardContent className="py-2 text-sm flex flex-wrap justify-between gap-2">
                  <span>{s.year}</span>
                  <span className="tabular-nums">
                    Rev {formatCurrency(s.revenueMinor)} · Exp {formatCurrency(s.expenseMinor)} · Profit{" "}
                    {formatCurrency(s.profitMinor)}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Shell>
    );
  }

  if (mode === "risks") {
    const q = useQuery({ queryKey: ["csi", "risk"], queryFn: () => csiGet<{ items: any[] }>("/risks") });
    const [title, setTitle] = useState("");
    const [prob, setProb] = useState("3");
    const [impact, setImpact] = useState("3");
    const create = useMutation({
      mutationFn: () => csiPost("/risks", { title, probability: Number(prob), impact: Number(impact), status: "open" }),
      onSuccess: () => {
        inv();
        setTitle("");
      },
    });
    return (
      <Shell title="Risk register" desc="Score = probability × impact (1–5 each)">
        <div className="flex flex-wrap gap-2 mb-4">
          <Input placeholder="Risk title" value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-[200px]" />
          <Input placeholder="P" value={prob} onChange={(e) => setProb(e.target.value)} className="w-16" />
          <Input placeholder="I" value={impact} onChange={(e) => setImpact(e.target.value)} className="w-16" />
          <Button disabled={!title || create.isPending} onClick={() => create.mutate()}>
            Add risk
          </Button>
        </div>
        <div className="space-y-2">
          {(q.data?.items || []).map((r) => (
            <Card key={r.id} className={r.score >= 15 ? "border-red-500/40" : undefined}>
              <CardContent className="py-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{r.title}</span>
                  <span className="text-xs">Score {r.score}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.category} · {r.status} · P{r.probability} × I{r.impact}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Shell>
    );
  }

  if (mode === "roadmap") {
    const q = useQuery({ queryKey: ["csi", "road"], queryFn: () => csiGet<{ items: any[] }>("/roadmap") });
    return (
      <Shell title="Ten-year roadmap (2026–2035)" desc="Editable annual priorities. Symbolic notes are optional and never drive financial rules.">
        <div className="space-y-2">
          {(q.data?.items || []).map((r) => (
            <Card key={r.id}>
              <CardContent className="py-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {r.year} · {r.title}
                  </span>
                  <span className="text-xs uppercase text-muted-foreground">{r.status}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{r.priorities}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Shell>
    );
  }

  return null;
}
