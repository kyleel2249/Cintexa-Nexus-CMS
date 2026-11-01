/** Payment-plan arithmetic (exact, integer minor units). The plan is a SCHEDULE of what is expected; payments are separate immutable records that are allocated against it in date order. */
import { toScaled, fromScaled } from "../fx/rates";

export interface PlanInput { total: string; upfrontPercent?: number; upfrontAmount?: string; instalments: number; bookingDate: string; firstDueOn?: string; upfrontDueOn?: string; label?: string }
export interface PlanItem { seq: number; kind: "upfront" | "instalment"; label: string; due_on: string; amount: string }
export interface Plan { total: string; upfront: string; balance: string; items: PlanItem[]; upfrontPercent: string }

const divRound = (a: bigint, d: bigint) => (a * 2n + d) / (d * 2n);
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const idx = (y * 12 + (m - 1)) + months, ny = Math.floor(idx / 12), nm = idx % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function buildPlan(i: PlanInput): Plan {
  const total = toScaled(i.total, 2);
  if (total < 0n) throw new Error("The order total cannot be negative");
  if (!Number.isInteger(i.instalments) || i.instalments < 0 || i.instalments > 60) throw new Error("Instalments must be between 0 and 60");
  let upfront: bigint;
  if (i.upfrontAmount !== undefined) upfront = toScaled(i.upfrontAmount, 2);
  else { const pct = toScaled(String(i.upfrontPercent ?? 50), 2); upfront = divRound(total * pct, 10000n); }
  if (upfront < 0n || upfront > total) throw new Error("The upfront amount must be between 0 and the order total");
  const balance = total - upfront;
  if (i.instalments === 0 && balance > 0n) throw new Error("With no instalments the upfront payment must cover the whole total");
  const items: PlanItem[] = [];
  const pctLabel = total === 0n ? "0" : String(Number((upfront * 10000n) / total) / 100);
  if (upfront > 0n || i.instalments === 0) items.push({ seq: 0, kind: "upfront", label: i.label ?? `Upfront (${pctLabel}%)`, due_on: i.upfrontDueOn ?? i.bookingDate, amount: fromScaled(upfront, 2) });
  const first = i.firstDueOn ?? addMonths(i.bookingDate, 1);
  if (i.instalments > 0) {
    const base = balance / BigInt(i.instalments);
    for (let k = 1; k <= i.instalments; k++) {
      const amt = k === i.instalments ? balance - base * BigInt(i.instalments - 1) : base; // the last instalment absorbs rounding so the plan always equals the balance exactly
      items.push({ seq: k, kind: "instalment", label: `Month ${k}`, due_on: addMonths(first, k - 1), amount: fromScaled(amt, 2) });
    }
  }
  return { total: fromScaled(total, 2), upfront: fromScaled(upfront, 2), balance: fromScaled(balance, 2), items, upfrontPercent: pctLabel };
}

export type ItemStatus = "paid" | "partial" | "pending" | "overdue";
export interface Allocated extends PlanItem { allocated: string; outstanding: string; status: ItemStatus }
/** Apply the money actually received to the schedule in order (upfront first, then each instalment). Early and extra payments therefore settle the next items automatically. */
export function allocate(items: PlanItem[], paid: string, today: string): { items: Allocated[]; unallocated: string } {
  let left = toScaled(paid, 2);
  const out: Allocated[] = [];
  for (const it of [...items].sort((a, b) => a.seq - b.seq)) {
    const amt = toScaled(it.amount, 2); const take = left >= amt ? amt : left > 0n ? left : 0n; left -= take;
    const rest = amt - take;
    const status: ItemStatus = rest === 0n ? "paid" : it.due_on < today ? "overdue" : take > 0n ? "partial" : "pending";
    out.push({ ...it, allocated: fromScaled(take, 2), outstanding: fromScaled(rest, 2), status });
  }
  return { items: out, unallocated: fromScaled(left, 2) };
}
