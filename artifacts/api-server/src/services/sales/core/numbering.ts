import type { Queryable } from "./types";

export type NumberKind = "lead" | "account" | "opportunity" | "quotation" | "order";

const PREFIX: Record<NumberKind, string> = { lead: "LD", account: "AC", opportunity: "OP", quotation: "QT", order: "SO" };

export function formatNumber(kind: NumberKind, year: number | null, seq: number, prefix = PREFIX[kind]): string {
  return `${prefix}-${year === null ? "" : year + "-"}${String(seq).padStart(5, "0")}`;
}

/**
 * Atomic, gap-free (within committed transactions) sequence. The single UPSERT row-locks the counter, so two
 * concurrent requests can never receive the same number. Must be called inside the transaction that uses the number.
 */
export async function nextNumber(q: Queryable, kind: NumberKind, now: Date, opts: { yearly?: boolean; prefix?: string } = {}): Promise<string> {
  const yearly = opts.yearly ?? kind !== "account";
  const year = yearly ? now.getUTCFullYear() : null;
  const name = `${kind}:${year ?? "all"}`;
  const r = await q.query<{ value: number | string }>(
    `INSERT INTO sales_counters (name, value) VALUES ($1, 1)
     ON CONFLICT (name) DO UPDATE SET value = sales_counters.value + 1
     RETURNING value`,
    [name],
  );
  return formatNumber(kind, year, Number(r.rows[0]!.value), opts.prefix);
}
