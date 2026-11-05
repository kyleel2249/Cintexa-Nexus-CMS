import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { finGet, finPost } from "@/lib/finance/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge2, Field, Notice, Page, Section, Table, Td, TabBar, money, selectCls, toMinor, today, useIdempotencyKey } from "@/components/finance/engine-ui";

type Tab = "stock" | "receive" | "issue" | "returns" | "adjust" | "moves";

export default function InventoryPage() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["fin"] });
  const [tab, setTab] = useState<Tab>("stock");
  const items = useQuery({ queryKey: ["fin", "inv", "items"], queryFn: () => finGet<{ items: any[] }>("/inventory/items") });
  const list = items.data?.items || [];
  return (
    <Page title="Inventory & cost of goods sold" desc="Stock is valued by the costing method in force (FIFO, weighted average or specific). COGS posts only for fulfilled sales, stock can never go negative, and the stock records are reconciled to the general ledger.">
      <TabBar<Tab> value={tab} onChange={setTab} tabs={[
        { key: "stock", label: "Stock & valuation" }, { key: "receive", label: "Receive stock" }, { key: "issue", label: "Sell / issue" },
        { key: "returns", label: "Sales returns" }, { key: "adjust", label: "Adjust · write-down · supplier return" }, { key: "moves", label: "Movements" },
      ]} />
      {tab === "stock" && <Stock refresh={refresh} />}
      {tab === "receive" && <Receive items={list} refresh={refresh} />}
      {tab === "issue" && <Issue items={list} refresh={refresh} />}
      {tab === "returns" && <Returns refresh={refresh} />}
      {tab === "adjust" && <Adjust items={list} refresh={refresh} />}
      {tab === "moves" && <Moves items={list} />}
    </Page>
  );
}

function ItemSelect({ items, value, onChange }: { items: any[]; value: string; onChange: (v: string) => void }) {
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select item…</option>
      {items.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name} ({i.onHand?.qty ?? 0} on hand)</option>)}
    </select>
  );
}

function Stock({ refresh }: { refresh: () => void }) {
  const q = useQuery({ queryKey: ["fin", "inv", "valuation"], queryFn: () => finGet<any>("/inventory/valuation") });
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const add = useMutation({ mutationFn: () => finPost("/inventory/items", { sku, name }), onSuccess: () => { refresh(); setSku(""); setName(""); } });
  const v = q.data;
  return (
    <div className="space-y-4">
      <Section title="Valuation" hint={v ? `Costing method in force: ${String(v.method).replace("_", " ").toLowerCase()}. ${v.note}` : undefined}>
        <Notice error={q.error} />
        {v && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>Stock records: <b>{money(v.subledgerMinor)}</b></span>
              <span>General ledger (1090): <b>{money(v.generalLedgerMinor)}</b></span>
              {v.reconciled ? <Badge2 tone="ok">reconciled</Badge2> : <Badge2 tone="bad">difference {money(v.differenceMinor)}</Badge2>}
            </div>
            <Table head={["SKU", "Item", "Qty", "Cost (GHS)", "Unit cost"]} empty={!v.items.length ? "No items yet. Add one below, then receive stock." : undefined}>
              {v.items.map((r: any) => <tr key={r.itemId} className="border-b"><Td>{r.sku}</Td><Td>{r.name}</Td><Td right>{r.qty}</Td><Td right>{money(r.costMinor)}</Td><Td right>{money(r.unitCostMinor)}</Td></tr>)}
            </Table>
          </>
        )}
      </Section>
      <Section title="Add item">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="SKU"><Input value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Button disabled={!sku || !name || add.isPending} onClick={() => add.mutate()}>Add item</Button>
        </div>
        <Notice error={add.error} />
      </Section>
    </div>
  );
}

function Receive({ items, refresh }: { items: any[]; refresh: () => void }) {
  const [f, setF] = useState({ itemId: "", qty: "", cost: "", date: today(), credit: "2010", ref: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const idem = useIdempotencyKey();
  const m = useMutation({
    mutationFn: () => finPost<any>("/inventory/receive", { itemId: f.itemId, qty: Number(f.qty), totalCostMinor: toMinor(f.cost, "GHS", "Total cost"), date: f.date, creditAccountCode: f.credit, reference: f.ref || undefined, idempotencyKey: idem.key }),
    onSuccess: () => { refresh(); idem.reset(); setF((s) => ({ ...s, qty: "", cost: "", ref: "" })); },
  });
  return (
    <Section title="Receive stock" hint="Debits Inventory, credits Accounts Payable (or the cash/bank account you enter). Creates a new cost layer.">
      <div className="flex flex-wrap gap-2">
        <Field label="Item"><ItemSelect items={items} value={f.itemId} onChange={(v) => set("itemId", v)} /></Field>
        <Field label="Quantity"><Input inputMode="numeric" value={f.qty} onChange={(e) => set("qty", e.target.value)} /></Field>
        <Field label="Total cost (GHS)"><Input inputMode="decimal" value={f.cost} onChange={(e) => set("cost", e.target.value)} /></Field>
        <Field label="Date"><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Credit account"><Input value={f.credit} onChange={(e) => set("credit", e.target.value)} /></Field>
        <Field label="Reference"><Input value={f.ref} onChange={(e) => set("ref", e.target.value)} placeholder="Supplier invoice no." /></Field>
      </div>
      <Button disabled={m.isPending || !f.itemId || !f.qty || !f.cost} onClick={() => m.mutate()}>Receive</Button>
      <Notice error={m.error} ok={m.data ? `Received. Journal ${m.data.journal?.number}${m.data.duplicate ? " (duplicate ignored)" : ""}.` : null} />
    </Section>
  );
}

function Issue({ items, refresh }: { items: any[]; refresh: () => void }) {
  const [f, setF] = useState({ itemId: "", qty: "", date: today(), reason: "sale", saleRef: "", fulfilled: false });
  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));
  const idem = useIdempotencyKey();
  const m = useMutation({
    mutationFn: () => finPost<any>("/inventory/issue", { itemId: f.itemId, qty: Number(f.qty), date: f.date, reason: f.reason, saleRef: f.saleRef || undefined, fulfilled: f.reason === "sale" ? f.fulfilled : undefined, idempotencyKey: idem.key }),
    onSuccess: () => { refresh(); idem.reset(); setF((s) => ({ ...s, qty: "", saleRef: "", fulfilled: false })); },
  });
  const sale = f.reason === "sale";
  return (
    <Section title="Sell / issue stock" hint="A sale posts Dr Cost of Goods Sold / Cr Inventory at the cost given by the costing method. Damage and loss go to Inventory Losses, not COGS.">
      <div className="flex flex-wrap gap-2">
        <Field label="Item"><ItemSelect items={items} value={f.itemId} onChange={(v) => set("itemId", v)} /></Field>
        <Field label="Quantity"><Input inputMode="numeric" value={f.qty} onChange={(e) => set("qty", e.target.value)} /></Field>
        <Field label="Date"><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Reason">
          <select className={selectCls} value={f.reason} onChange={(e) => set("reason", e.target.value)}>
            <option value="sale">Sale (COGS)</option><option value="damage">Damaged goods</option><option value="loss">Loss / theft</option><option value="shrinkage">Shrinkage</option>
          </select>
        </Field>
        {sale && <Field label="Sale reference"><Input value={f.saleRef} onChange={(e) => set("saleRef", e.target.value)} placeholder="Order / invoice no." /></Field>}
      </div>
      {sale && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.fulfilled} onChange={(e) => set("fulfilled", e.target.checked)} />
          Goods delivered — control has transferred to the customer (required before COGS is recognised)
        </label>
      )}
      <Button disabled={m.isPending || !f.itemId || !f.qty} onClick={() => m.mutate()}>Post issue</Button>
      <Notice error={m.error} ok={m.data ? `Posted ${m.data.journal?.number}: cost ${money(m.data.movement.costMinor)} (${m.data.movement.method ?? "n/a"}).${m.data.duplicate ? " Duplicate ignored." : ""}` : null} />
    </Section>
  );
}

function Returns({ refresh }: { refresh: () => void }) {
  const mv = useQuery({ queryKey: ["fin", "inv", "moves", "all"], queryFn: () => finGet<{ items: any[] }>("/inventory/movements") });
  const items = useQuery({ queryKey: ["fin", "inv", "items"], queryFn: () => finGet<{ items: any[] }>("/inventory/items") });
  const [id, setId] = useState(""); const [qty, setQty] = useState(""); const [date, setDate] = useState(today());
  const sku = (itemId: string) => items.data?.items.find((i) => i.id === itemId)?.sku || "?";
  const sales = (mv.data?.items || []).filter((m) => m.type === "issue" && m.reason === "sale" && m.returnedQty < m.qty);
  const m = useMutation({ mutationFn: () => finPost<any>("/inventory/return", { movementId: id, qty: Number(qty), date }), onSuccess: () => { refresh(); setQty(""); } });
  return (
    <Section title="Sales return" hint="Restocks at the ORIGINAL cost of the sale and reverses the matching COGS (Dr Inventory / Cr COGS).">
      <div className="flex flex-wrap gap-2">
        <Field label="Original sale">
          <select className={selectCls} value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Select a sale…</option>
            {sales.map((s) => <option key={s.id} value={s.id}>{s.date} · {sku(s.itemId)} ×{s.qty} ({s.qty - s.returnedQty} returnable) · {s.saleRef || ""}</option>)}
          </select>
        </Field>
        <Field label="Quantity returned"><Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Button disabled={m.isPending || !id || !qty} onClick={() => m.mutate()}>Post return</Button>
      <Notice error={m.error} ok={m.data ? `Returned at cost ${money(m.data.movement.costMinor)} · ${m.data.journal?.number}` : null} />
      {mv.data && !sales.length && <p className="text-sm text-muted-foreground">No returnable sales.</p>}
    </Section>
  );
}

function Adjust({ items, refresh }: { items: any[]; refresh: () => void }) {
  const [g, setG] = useState({ itemId: "", qty: "", unit: "", date: today() });
  const [w, setW] = useState({ itemId: "", nrv: "", date: today() });
  const [p, setP] = useState({ itemId: "", qty: "", date: today() });
  const gain = useMutation({ mutationFn: () => finPost<any>("/inventory/adjust", { itemId: g.itemId, qty: Number(g.qty), unitCostMinor: toMinor(g.unit, "GHS", "Unit cost"), date: g.date }), onSuccess: refresh });
  const wd = useMutation({ mutationFn: () => finPost<any>("/inventory/writedown", { itemId: w.itemId, nrvUnitMinor: toMinor(w.nrv, "GHS", "NRV per unit"), date: w.date }), onSuccess: refresh });
  const pr = useMutation({ mutationFn: () => finPost<any>("/inventory/purchase-return", { itemId: p.itemId, qty: Number(p.qty), date: p.date }), onSuccess: refresh });
  return (
    <div className="space-y-4">
      <Section title="Stock-count gain" hint="Adds a cost layer at the unit cost you enter and credits Inventory Losses and Write-downs. Use Sell / issue → Loss for shortages.">
        <div className="flex flex-wrap gap-2">
          <Field label="Item"><ItemSelect items={items} value={g.itemId} onChange={(v) => setG({ ...g, itemId: v })} /></Field>
          <Field label="Quantity"><Input inputMode="numeric" value={g.qty} onChange={(e) => setG({ ...g, qty: e.target.value })} /></Field>
          <Field label="Unit cost (GHS)"><Input inputMode="decimal" value={g.unit} onChange={(e) => setG({ ...g, unit: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={g.date} onChange={(e) => setG({ ...g, date: e.target.value })} /></Field>
        </div>
        <Button disabled={gain.isPending || !g.itemId || !g.qty || !g.unit} onClick={() => gain.mutate()}>Post gain</Button>
        <Notice error={gain.error} ok={gain.data ? `Posted ${gain.data.journal.number}` : null} />
      </Section>
      <Section title="Write-down to net realisable value" hint="Prudence: reduces stock held above NRV. Nothing is posted when cost is already at or below NRV.">
        <div className="flex flex-wrap gap-2">
          <Field label="Item"><ItemSelect items={items} value={w.itemId} onChange={(v) => setW({ ...w, itemId: v })} /></Field>
          <Field label="NRV per unit (GHS)"><Input inputMode="decimal" value={w.nrv} onChange={(e) => setW({ ...w, nrv: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={w.date} onChange={(e) => setW({ ...w, date: e.target.value })} /></Field>
        </div>
        <Button disabled={wd.isPending || !w.itemId || !w.nrv} onClick={() => { if (window.confirm("Post inventory write-down?")) wd.mutate(); }}>Write down</Button>
        <Notice error={wd.error} ok={wd.data ? (wd.data.written_down ? `Written down by ${money(wd.data.movement.costMinor)} · ${wd.data.journal.number}` : wd.data.note) : null} />
      </Section>
      <Section title="Return to supplier" hint="Removes stock at cost and debits Accounts Payable.">
        <div className="flex flex-wrap gap-2">
          <Field label="Item"><ItemSelect items={items} value={p.itemId} onChange={(v) => setP({ ...p, itemId: v })} /></Field>
          <Field label="Quantity"><Input inputMode="numeric" value={p.qty} onChange={(e) => setP({ ...p, qty: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} /></Field>
        </div>
        <Button disabled={pr.isPending || !p.itemId || !p.qty} onClick={() => pr.mutate()}>Post supplier return</Button>
        <Notice error={pr.error} ok={pr.data ? `Returned at cost ${money(pr.data.movement.costMinor)} · ${pr.data.journal.number}` : null} />
      </Section>
    </div>
  );
}

function Moves({ items }: { items: any[] }) {
  const [itemId, setItemId] = useState("");
  const q = useQuery({ queryKey: ["fin", "inv", "moves", itemId], queryFn: () => finGet<{ items: any[] }>("/inventory/movements", { itemId: itemId || undefined }) });
  const sku = (id: string) => items.find((i) => i.id === id)?.sku || "?";
  return (
    <Section title="Stock movements">
      <Field label="Filter by item" className="max-w-xs"><ItemSelect items={items} value={itemId} onChange={setItemId} /></Field>
      <Notice error={q.error} />
      <Table head={["Date", "Item", "Type", "Qty", "Cost (GHS)", "Detail"]} empty={q.data && !q.data.items.length ? "No movements." : undefined}>
        {(q.data?.items || []).map((m) => (
          <tr key={m.id} className="border-b">
            <Td>{m.date}</Td><Td>{sku(m.itemId)}</Td><Td>{m.type}{m.reason ? ` · ${m.reason}` : ""}</Td><Td right>{m.qty}</Td><Td right>{money(m.costMinor)}</Td>
            <Td className="text-xs text-muted-foreground">{m.method ? `${m.method} ` : ""}{m.saleRef || m.ref || ""}</Td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}
