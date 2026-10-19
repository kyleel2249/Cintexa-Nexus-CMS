import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "./ui";
import type { ReactNode } from "react";

/** Generic editable list of rows (products on an opportunity, competitors, bundle components…). */
export function RowsEditor<R>({ rows, onChange, render, blank, addLabel, emptyText }: { rows: R[]; onChange: (rows: R[]) => void; render: (row: R, update: (patch: Partial<R>) => void, index: number) => ReactNode; blank: () => R; addLabel: string; emptyText?: string }) {
  return (
    <div>
      {rows.length === 0 && <p className="mb-2 text-sm text-muted-foreground">{emptyText ?? "Nothing added yet."}</p>}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-2">
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]">{render(r, (patch) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}</div>
            <IconButton label="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></IconButton>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => onChange([...rows, blank()])}><Plus className="mr-1.5 h-3.5 w-3.5" />{addLabel}</Button>
    </div>
  );
}
