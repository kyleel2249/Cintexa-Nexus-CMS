import { useSalesQuery } from "@/lib/sales/hooks";
import { Input, MoneyInput, Select } from "./ui";
import { RowsEditor } from "./RowsEditor";

export interface LineDraft { product_id: string; description: string; quantity: string; unit_price: string; discount_percent: string }
export const blankLine = (): LineDraft => ({ product_id: "", description: "", quantity: "1", unit_price: "", discount_percent: "0" });

export function linesToDraft(lines: { product_id: number | null; description: string; quantity: string; unit_price: string; discount_percent: string }[]): LineDraft[] {
  return lines.map((l) => ({ product_id: l.product_id ? String(l.product_id) : "", description: l.description, quantity: String(l.quantity), unit_price: String(l.unit_price), discount_percent: String(l.discount_percent) }));
}

/** Validates drafts client-side (the server validates again) and builds the API payload. Blank prices are resolved by the server from price books/promotions. */
export function draftToBody(rows: LineDraft[]): { lines: Record<string, unknown>[]; error?: string } {
  const lines: Record<string, unknown>[] = [];
  for (const [i, r] of rows.entries()) {
    if (!r.product_id && !r.description.trim()) return { lines, error: `Line ${i + 1}: choose a product or enter a description` };
    if (!(Number(r.quantity) > 0)) return { lines, error: `Line ${i + 1}: quantity must be greater than zero` };
    if (!r.product_id && r.unit_price === "") return { lines, error: `Line ${i + 1}: free-text lines need a price` };
    const d = Number(r.discount_percent || 0);
    if (!(d >= 0 && d <= 100)) return { lines, error: `Line ${i + 1}: discount must be between 0 and 100` };
    lines.push({ ...(r.product_id ? { product_id: Number(r.product_id) } : {}), ...(r.description.trim() ? { description: r.description.trim() } : {}), quantity: Number(r.quantity), ...(r.unit_price !== "" ? { unit_price: r.unit_price } : {}), discount_percent: d });
  }
  if (lines.length === 0) return { lines, error: "Add at least one line" };
  return { lines };
}

export function LinesEditor({ rows, onChange }: { rows: LineDraft[]; onChange: (r: LineDraft[]) => void }) {
  const products = useSalesQuery<{ items: { id: number; name: string; sku: string; base_price: string; currency: string }[] }>("/products", { pageSize: 200, status: "active" });
  return (
    <RowsEditor rows={rows} onChange={onChange} blank={blankLine} addLabel="Add line" emptyText="No lines yet."
      render={(r, up) => (
        <>
          <Select aria-label="Product" value={r.product_id} onChange={(e) => up({ product_id: e.target.value })}>
            <option value="">Free-text line…</option>
            {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </Select>
          {!r.product_id && <Input aria-label="Description" placeholder="Description" value={r.description} onChange={(e) => up({ description: e.target.value })} />}
          <Input aria-label="Quantity" type="number" min="0.0001" step="any" value={r.quantity} onChange={(e) => up({ quantity: e.target.value })} />
          <MoneyInput aria-label="Unit price" placeholder={r.product_id ? "Auto (price book)" : "Price"} value={r.unit_price} onChange={(v) => up({ unit_price: v })} />
          <Input aria-label="Discount %" type="number" min="0" max="100" step="any" placeholder="Disc. %" value={r.discount_percent} onChange={(e) => up({ discount_percent: e.target.value })} />
        </>
      )} />
  );
}
