import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSales } from "@/context/SalesContext";
import { sales } from "@/lib/sales/api";
import { useSalesMutation, useSalesQuery, useUrlFilter } from "@/lib/sales/hooks";
import { useList, useListState } from "@/lib/sales/list";
import { PRODUCT_KINDS, PRODUCT_STATUSES } from "@/lib/sales/enums";
import { dateOnly, money, percent } from "@/lib/sales/format";
import { PageHeader, Panel, TabBar, FilterBar, SearchBox, Select, DataTable, Pagination, StatusBadge, EmptyState, ErrorState, Skeleton, Tag, Drawer, DefinitionList, ConfirmModal, Modal, Field, Input, MoneyInput,  type Column } from "@/components/sales/ui";
import { FormModal, type FieldDef } from "@/components/sales/forms";
import { RowsEditor } from "@/components/sales/RowsEditor";

interface ProductRow { id: number; sku: string; name: string; category: string | null; kind: string; unit: string; base_price: string; cost_price?: string | null; currency: string; tax_rate: string; status: string; track_stock: boolean; variant_of: number | null }
type Tab = "products" | "books" | "promotions";

const NEW_FIELDS: FieldDef[] = [
  { name: "sku", label: "SKU", required: true, hint: "Letters, digits and . _ - /" },
  { name: "name", label: "Name", required: true },
  { name: "kind", label: "Kind", type: "select", options: PRODUCT_KINDS, required: true },
  { name: "category", label: "Category" },
  { name: "unit", label: "Unit", required: true },
  { name: "currency", label: "Currency (ISO)", required: true },
  { name: "base_price", label: "List price", type: "money", required: true },
  { name: "cost_price", label: "Unit cost", type: "money", hint: "Only visible to roles allowed to see cost" },
  { name: "tax_rate", label: "Tax rate %", type: "number", min: 0, max: 100, required: true },
  { name: "track_stock", label: "Track stock (needs an inventory integration to show availability)", type: "checkbox" },
  { name: "external_ref", label: "External reference" },
  { name: "description", label: "Description", type: "textarea" },
];
const EDIT_FIELDS: FieldDef[] = [
  { name: "name", label: "Name", required: true }, { name: "status", label: "Status", type: "select", options: PRODUCT_STATUSES, required: true },
  { name: "category", label: "Category" }, { name: "unit", label: "Unit", required: true },
  { name: "base_price", label: "List price", type: "money", required: true }, { name: "cost_price", label: "Unit cost", type: "money" },
  { name: "tax_rate", label: "Tax rate %", type: "number", min: 0, max: 100, required: true }, { name: "external_ref", label: "External reference" },
  { name: "track_stock", label: "Track stock", type: "checkbox" }, { name: "description", label: "Description", type: "textarea" },
];

export default function ProductsPage() {
  const { can } = useSales();
  const [tabRaw, setTab] = useUrlFilter("tab", "products");
  const tab = (["products", "books", "promotions"].includes(tabRaw) ? tabRaw : "products") as Tab;
  return (
    <>
      <PageHeader title="Products & price books" description="Catalogue, customer-specific price books with quantity tiers, and time-boxed promotions. Pricing is resolved on the server; stock is shown only when an inventory system is connected." />
      <TabBar<Tab> tabs={[{ key: "products", label: "Products" }, { key: "books", label: "Price books" }, { key: "promotions", label: "Promotions" }]} value={tab} onChange={setTab} />
      {tab === "products" ? <ProductsTab canWrite={can("products:write")} /> : tab === "books" ? <BooksTab canWrite={can("pricebooks:write")} /> : <PromotionsTab canWrite={can("pricebooks:write")} />}
    </>
  );
}

function ProductsTab({ canWrite }: { canWrite: boolean }) {
  const { me, can } = useSales();
  const st = useListState(["category", "kind", "status"]);
  const q = useList<ProductRow, { categories: string[] }>("/products", st);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const showCost = !!me?.canSeeCost;
  const columns: Column<ProductRow>[] = [
    { key: "name", header: "Product", sort: "name", render: (p) => <div className="min-w-0"><p className="truncate font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.sku}{p.variant_of ? " · variant" : ""}</p></div> },
    { key: "kind", header: "Kind", hideOnMobile: true, render: (p) => <StatusBadge status={p.kind} /> },
    { key: "cat", header: "Category", hideOnMobile: true, render: (p) => p.category ?? "—" },
    { key: "price", header: "List price", sort: "price", align: "right", render: (p) => money(p.base_price, p.currency) },
    ...(showCost ? [{ key: "cost", header: "Cost", align: "right" as const, hideOnMobile: true, render: (p: ProductRow) => (p.cost_price ? money(p.cost_price, p.currency) : "—") }] : []),
    { key: "tax", header: "Tax", align: "right", hideOnMobile: true, render: (p) => percent(Number(p.tax_rate), 1) },
    { key: "status", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
  ];
  return (
    <>
      <FilterBar>
        <SearchBox value={st.q} onChange={st.setQ} placeholder="Search name, SKU, category…" />
        <Select aria-label="Kind" className="w-36" value={st.filters.kind ?? ""} onChange={(e) => st.setFilter("kind", e.target.value)}><option value="">Kind: all</option>{PRODUCT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
        <Select aria-label="Category" className="w-44" value={st.filters.category ?? ""} onChange={(e) => st.setFilter("category", e.target.value)}><option value="">Category: all</option>{(q.data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <Select aria-label="Status" className="w-40" value={st.filters.status ?? ""} onChange={(e) => st.setFilter("status", e.target.value)}><option value="">Status: all</option>{PRODUCT_STATUSES.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
        <span className="flex-1" />
        {canWrite && <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New product</Button>}
      </FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton rows={8} /> : (
          <><DataTable caption="Products" columns={columns} rows={q.data.items} rowKey={(p) => p.id} sort={st.sort} onSort={st.setSort} onRowClick={(p) => setOpen(p.id)} empty={<EmptyState title={st.hasFilters ? "No products match" : "No products yet"} description="Add products and services so quotations and orders can be priced." action={!st.hasFilters && canWrite ? <Button size="sm" onClick={() => setCreating(true)}>New product</Button> : undefined} />} />
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={st.setPage} /></>
        )}
      </Panel>
      <FormModal open={creating} onClose={() => setCreating(false)} title="New product" size="lg" fields={NEW_FIELDS} initial={{ kind: "product", unit: "each", currency: me?.business.currency ?? "USD", tax_rate: 0 }} submitLabel="Create" success="Product created" invalidate={["/products"]} submit={(b) => sales.post("/products", b, { idempotent: true })} />
      {open !== null && <ProductDrawer id={open} onClose={() => setOpen(null)} canWrite={canWrite} canCost={can("products:cost") || showCost} />}
    </>
  );
}

function ProductDrawer({ id, onClose, canWrite }: { id: number; onClose: () => void; canWrite: boolean; canCost: boolean }) {
  const q = useSalesQuery<{ product: ProductRow & { description: string | null; external_ref: string | null }; bundle: { product_id: number; quantity: string; sku: string; name: string }[]; tiers: { min_quantity: string; unit_price: string; price_book: string }[]; variants: { id: number; sku: string; variant_label: string; base_price: string }[]; stock: { status: string; message?: string; available?: number; source?: string; asOf?: string } }>(`/products/${id}`);
  const [dlg, setDlg] = useState<null | "edit" | "bundle" | "delete">(null);
  const del = useSalesMutation(() => sales.del(`/products/${id}`), { invalidate: ["/products"], success: "Product archived", onSuccess: onClose });
  const d = q.data;
  return (
    <Drawer open onClose={onClose} title={d?.product.name ?? "Product"} subtitle={d ? d.product.sku : undefined}
      footer={canWrite && d ? <><Button variant="ghost" className="mr-auto text-rose-500" onClick={() => setDlg("delete")}>Archive</Button>{d.product.kind === "bundle" && <Button variant="outline" onClick={() => setDlg("bundle")}>Edit bundle</Button>}<Button onClick={() => setDlg("edit")}>Edit</Button></> : undefined}>
      {q.error ? <ErrorState error={q.error} /> : !d ? <Skeleton rows={6} /> : (
        <div className="space-y-5">
          <DefinitionList items={[{ label: "List price", value: money(d.product.base_price, d.product.currency) }, ...(d.product.cost_price != null ? [{ label: "Unit cost", value: money(d.product.cost_price, d.product.currency) }] : []), { label: "Tax rate", value: percent(Number(d.product.tax_rate)) }, { label: "Unit", value: d.product.unit }, { label: "Kind", value: d.product.kind }, { label: "Category", value: d.product.category }, { label: "External ref", value: d.product.external_ref }]} />
          {d.product.description && <p className="whitespace-pre-wrap text-sm">{d.product.description}</p>}
          <div><h4 className="mb-1 text-sm font-semibold">Stock</h4><p className="text-sm text-muted-foreground">{d.stock.status === "ok" ? `${d.stock.available} available (${d.stock.source}, as of ${d.stock.asOf ? dateOnly(d.stock.asOf) : "now"})` : d.stock.message}</p></div>
          {d.bundle.length > 0 && <div><h4 className="mb-1 text-sm font-semibold">Bundle contents</h4><ul className="text-sm">{d.bundle.map((b) => <li key={b.product_id}>{b.quantity} × {b.name} <span className="text-xs text-muted-foreground">{b.sku}</span></li>)}</ul></div>}
          {d.tiers.length > 0 && <div><h4 className="mb-1 text-sm font-semibold">Price-book prices</h4><ul className="text-sm">{d.tiers.map((t, i) => <li key={i} className="flex justify-between"><span>{t.price_book} · from {t.min_quantity}</span><span className="tabular-nums">{money(t.unit_price, d.product.currency)}</span></li>)}</ul></div>}
          {d.variants.length > 0 && <div><h4 className="mb-1 text-sm font-semibold">Variants</h4><ul className="text-sm">{d.variants.map((v) => <li key={v.id} className="flex justify-between"><span>{v.variant_label} <Tag>{v.sku}</Tag></span><span className="tabular-nums">{money(v.base_price, d.product.currency)}</span></li>)}</ul></div>}
          <FormModal open={dlg === "edit"} onClose={() => setDlg(null)} title="Edit product" size="lg" fields={EDIT_FIELDS} initial={d.product} nullEmpty submit={(b) => sales.patch(`/products/${id}`, b)} success="Product updated" invalidate={["/products"]} />
          {dlg === "bundle" && <BundleEditor id={id} initial={d.bundle} onClose={() => setDlg(null)} />}
          <ConfirmModal open={dlg === "delete"} onClose={() => setDlg(null)} title="Archive product?" message="It can no longer be added to new quotations or orders. Existing documents keep their lines." confirmLabel="Archive" danger pending={del.pending} onConfirm={() => void del.run()} />
        </div>
      )}
    </Drawer>
  );
}

function BundleEditor({ id, initial, onClose }: { id: number; initial: { product_id: number; quantity: string }[]; onClose: () => void }) {
  const list = useSalesQuery<{ items: ProductRow[] }>("/products", { pageSize: 200, status: "active" });
  const [rows, setRows] = useState(initial.map((b) => ({ product_id: String(b.product_id), quantity: String(b.quantity) })));
  const save = useSalesMutation(() => sales.put(`/products/${id}/bundle`, { items: rows.map((r) => ({ product_id: Number(r.product_id), quantity: Number(r.quantity) })) }), { invalidate: [`/products/${id}`], success: "Bundle saved", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title="Bundle contents" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.pending || rows.some((r) => !r.product_id || !(Number(r.quantity) > 0))} onClick={() => void save.run()}>Save</Button></>}>
      <RowsEditor rows={rows} onChange={setRows} blank={() => ({ product_id: "", quantity: "1" })} addLabel="Add component"
        render={(r, up) => (<><select aria-label="Component" className="rounded-md border bg-background px-2 py-2 text-sm" value={r.product_id} onChange={(e) => up({ product_id: e.target.value })}><option value="">Select…</option>{list.data?.items.filter((p) => p.id !== id && p.kind !== "bundle").map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select><Input aria-label="Quantity" type="number" min="0.0001" step="any" value={r.quantity} onChange={(e) => up({ quantity: e.target.value })} /></>)} />
      {save.error && <p role="alert" className="mt-2 text-sm text-rose-500">{save.error.message}</p>}
    </Modal>
  );
}

interface Book { id: number; name: string; currency: string; is_default: boolean; account_id: number | null; account_name: string | null; valid_from: string | null; valid_to: string | null; active: boolean; entries: number }

function BooksTab({ canWrite }: { canWrite: boolean }) {
  const q = useSalesQuery<{ items: Book[] }>("/price-books");
  const { me } = useSales();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Book | null>(null);
  return (
    <>
      <FilterBar><span className="flex-1" />{canWrite && <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New price book</Button>}</FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <DataTable caption="Price books" rows={q.data.items} rowKey={(b) => b.id} onRowClick={setOpen} empty={<EmptyState title="No price books" description="Without a price book, quotations use each product's list price." />} columns={[
            { key: "n", header: "Name", render: (b: Book) => <span>{b.name} {b.is_default && <Tag>Default</Tag>}</span> }, { key: "a", header: "Customer", hideOnMobile: true, render: (b: Book) => b.account_name ?? "All customers" },
            { key: "c", header: "Currency", hideOnMobile: true, render: (b: Book) => b.currency }, { key: "v", header: "Valid", hideOnMobile: true, render: (b: Book) => `${b.valid_from ? dateOnly(b.valid_from) : "any time"} → ${b.valid_to ? dateOnly(b.valid_to) : "open"}` },
            { key: "e", header: "Entries", align: "right", render: (b: Book) => b.entries }, { key: "s", header: "Status", render: (b: Book) => <StatusBadge status={b.active ? "active" : "paused"} /> },
          ]} />
        )}
      </Panel>
      <FormModal open={creating} onClose={() => setCreating(false)} title="New price book" size="md" initial={{ currency: me?.business.currency ?? "USD" }} submitLabel="Create" success="Price book created" invalidate={["/price-books"]}
        fields={[{ name: "name", label: "Name", required: true, wide: true }, { name: "currency", label: "Currency (ISO)", required: true }, { name: "is_default", label: "Use as the default price book", type: "checkbox" }, { name: "valid_from", label: "Valid from", type: "date" }, { name: "valid_to", label: "Valid to", type: "date" }]}
        submit={(b) => sales.post("/price-books", b)} />
      {open && <BookModal book={open} canWrite={canWrite} onClose={() => setOpen(null)} />}
    </>
  );
}

function BookModal({ book, canWrite, onClose }: { book: Book; canWrite: boolean; onClose: () => void }) {
  const q = useSalesQuery<{ entries: { product_id: number; sku: string; name: string; min_quantity: string; unit_price: string; base_price: string }[] }>(`/price-books/${book.id}`);
  const products = useSalesQuery<{ items: ProductRow[] }>("/products", { pageSize: 200, status: "active" });
  const [rows, setRows] = useState<{ product_id: string; min_quantity: string; unit_price: string }[] | null>(null);
  const cur = rows ?? q.data?.entries.map((e) => ({ product_id: String(e.product_id), min_quantity: String(e.min_quantity), unit_price: String(e.unit_price) })) ?? null;
  const save = useSalesMutation(() => sales.put(`/price-books/${book.id}/entries`, { entries: (cur ?? []).map((r) => ({ product_id: Number(r.product_id), min_quantity: Number(r.min_quantity), unit_price: r.unit_price })) }), { invalidate: ["/price-books"], success: "Prices saved", onSuccess: onClose });
  const toggle = useSalesMutation(() => sales.patch(`/price-books/${book.id}`, { active: !book.active }), { invalidate: ["/price-books"], success: "Updated", onSuccess: onClose });
  return (
    <Modal open onClose={onClose} title={book.name} size="xl" description="Quantity tiers: the highest tier whose minimum quantity is met applies."
      footer={canWrite ? <><Button variant="ghost" className="mr-auto" disabled={toggle.pending} onClick={() => void toggle.run()}>{book.active ? "Deactivate" : "Activate"}</Button><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={save.pending || !cur || cur.some((r) => !r.product_id || r.unit_price === "")} onClick={() => void save.run()}>Save prices</Button></> : <Button variant="outline" onClick={onClose}>Close</Button>}>
      {!cur ? <Skeleton /> : (
        <RowsEditor rows={cur} onChange={canWrite ? setRows : () => undefined} blank={() => ({ product_id: "", min_quantity: "1", unit_price: "" })} addLabel="Add price" emptyText="No prices yet."
          render={(r, up) => (
            <>
              <select aria-label="Product" disabled={!canWrite} className="rounded-md border bg-background px-2 py-2 text-sm" value={r.product_id} onChange={(e) => up({ product_id: e.target.value })}><option value="">Select product…</option>{products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select>
              <Input aria-label="Minimum quantity" disabled={!canWrite} type="number" min="0.0001" step="any" value={r.min_quantity} onChange={(e) => up({ min_quantity: e.target.value })} />
              <MoneyInput aria-label="Unit price" disabled={!canWrite} value={r.unit_price} onChange={(x) => up({ unit_price: x })} />
            </>
          )} />
      )}
      {save.error && <p role="alert" className="mt-2 text-sm text-rose-500">{save.error.message}</p>}
    </Modal>
  );
}

function PromotionsTab({ canWrite }: { canWrite: boolean }) {
  const q = useSalesQuery<{ items: { id: number; name: string; product_name: string | null; category: string | null; discount_percent: string; starts_on: string; ends_on: string; active: boolean }[] }>("/promotions");
  const products = useSalesQuery<{ items: ProductRow[] }>("/products", { pageSize: 200, status: "active" });
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState({ product_id: "" });
  const [del, setDel] = useState<number | null>(null);
  const remove = useSalesMutation((id: number) => sales.del(`/promotions/${id}`), { invalidate: ["/promotions"], success: "Promotion removed", onSuccess: () => setDel(null) });
  return (
    <>
      <FilterBar><span className="flex-1" />{canWrite && <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New promotion</Button>}</FilterBar>
      <Panel flush>
        {q.error && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton /> : (
          <DataTable caption="Promotions" rows={q.data.items} rowKey={(p) => p.id} empty={<EmptyState title="No promotions" description="Promotions apply a percentage discount to a product or category between two dates." />} columns={[
            { key: "n", header: "Promotion", render: (p) => p.name }, { key: "t", header: "Applies to", render: (p) => p.product_name ?? (p.category ? `Category: ${p.category}` : "—") },
            { key: "d", header: "Discount", align: "right", render: (p) => percent(Number(p.discount_percent)) }, { key: "w", header: "Runs", hideOnMobile: true, render: (p) => `${dateOnly(p.starts_on)} → ${dateOnly(p.ends_on)}` },
            { key: "s", header: "Status", render: (p) => <StatusBadge status={p.active ? "active" : "paused"} /> }, { key: "x", header: "", render: (p) => canWrite ? <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => setDel(p.id)}>Remove</Button> : null },
          ]} />
        )}
      </Panel>
      <FormModal open={creating} onClose={() => setCreating(false)} title="New promotion" submitLabel="Create" success="Promotion created" invalidate={["/promotions"]}
        fields={[{ name: "name", label: "Name", required: true, wide: true }, { name: "category", label: "Category (if not a single product)" }, { name: "discount_percent", label: "Discount %", type: "number", min: 0.01, max: 100, required: true }, { name: "starts_on", label: "Starts", type: "date", required: true }, { name: "ends_on", label: "Ends", type: "date", required: true }]}
        extra={<Field label="Product (optional)"><Select value={target.product_id} onChange={(e) => setTarget({ product_id: e.target.value })}><option value="">— all in the category —</option>{products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</Select></Field>}
        submit={(b) => sales.post("/promotions", { ...b, ...(target.product_id ? { product_id: Number(target.product_id) } : {}) })} />
      <ConfirmModal open={del !== null} onClose={() => setDel(null)} title="Remove promotion?" message="New quotations stop applying it. Existing documents are unchanged." confirmLabel="Remove" danger pending={remove.pending} onConfirm={() => del !== null && void remove.run(del)} />
    </>
  );
}
