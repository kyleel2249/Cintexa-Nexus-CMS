import { useEffect, useState } from "react";
import { Select, Input } from "./ui";
import { useSalesQuery, useDebounced } from "@/lib/sales/hooks";
import { useSales } from "@/context/SalesContext";

/** Choose a sales member. Falls back to nothing when the viewer cannot list members (reps keep ownership of their own records). */
export function OwnerSelect({ value, onChange, label = "Owner", allowAll = true, className }: { value: string; onChange: (v: string) => void; label?: string; allowAll?: boolean; className?: string }) {
  const { can } = useSales();
  const q = useSalesQuery<{ items: { id: number; display_name: string; active: boolean }[] }>(can("members:read") ? "/members" : null);
  if (!can("members:read")) return null;
  return (
    <Select aria-label={label} className={className ?? "w-44"} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="">{label}: all</option>}
      {!allowAll && <option value="">Select {label.toLowerCase()}…</option>}
      {(q.data?.items ?? []).filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
    </Select>
  );
}

/** Type-ahead account picker backed by /accounts?q= (server-scoped to what the user may see). */
export function AccountPicker({ value, onChange, label = "Account", initialName }: { value: string; onChange: (id: string, name: string) => void; label?: string; initialName?: string }) {
  const [text, setText] = useState(initialName ?? "");
  const [open, setOpen] = useState(false);
  const term = useDebounced(text, 250);
  const q = useSalesQuery<{ items: { id: number; name: string; number: string }[] }>(open ? "/accounts" : null, { q: term || undefined, pageSize: 8 });
  useEffect(() => {
    if (initialName) setText(initialName);
  }, [initialName]);
  return (
    <div className="relative">
      <Input aria-label={label} placeholder="Search accounts…" value={text} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setText(e.target.value); if (value) onChange("", ""); }} autoComplete="off" />
      {open && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-lg">
          {q.loading && <li className="px-3 py-2 text-muted-foreground">Searching…</li>}
          {!q.loading && (q.data?.items ?? []).length === 0 && <li className="px-3 py-2 text-muted-foreground">No accounts found</li>}
          {(q.data?.items ?? []).map((a) => (
            <li key={a.id} role="option" aria-selected={String(a.id) === value} className="cursor-pointer rounded px-3 py-1.5 hover:bg-secondary" onMouseDown={(e) => { e.preventDefault(); onChange(String(a.id), a.name); setText(a.name); setOpen(false); }}>
              {a.name} <span className="text-xs text-muted-foreground">{a.number}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
