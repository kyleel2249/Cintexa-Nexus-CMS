import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { finGet } from "@/lib/finance/api";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype?: string;
  currency: string;
  active: boolean;
  normalBalance: string;
  label: string;
}

interface Props {
  value?: AccountOption | null;
  onChange: (acc: AccountOption | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function AccountSelect({ value, onChange, placeholder = "Search account code or name…", className, disabled }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const search = useQuery({
    queryKey: ["fin", "acc-search", q],
    queryFn: () => finGet<{ items: AccountOption[] }>("/accounts/search", { q: q || undefined }),
    enabled: open,
    staleTime: 10_000,
  });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const items = search.data?.items || [];

  return (
    <div ref={ref} className={cn("relative", className)}>
      <Input
        disabled={disabled}
        value={open ? q : value ? `${value.code} — ${value.name}` : q}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQ(value?.code || "");
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange(null);
        }}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {search.isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Loading accounts…</p>}
          {!search.isLoading && items.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No active accounts match.</p>
          )}
          {items.map((a) => (
            <button
              key={a.id}
              type="button"
              className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onChange(a);
                setQ("");
                setOpen(false);
              }}
            >
              <span className="font-medium">{a.code} — {a.name}</span>
              <span className="text-[11px] text-muted-foreground capitalize">
                {a.type} · normal {a.normalBalance} · {a.currency}
              </span>
            </button>
          ))}
        </div>
      )}
      {value && !open && (
        <p className="mt-0.5 text-[10px] text-muted-foreground capitalize">
          {value.type} · {value.normalBalance} balance · {value.currency}
          {value.subtype ? ` · ${value.subtype}` : ""}
        </p>
      )}
    </div>
  );
}
