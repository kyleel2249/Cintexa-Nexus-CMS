import { cmp, fromMinor, ratioPercent, sub, toMinor, sum } from "../core/money";
import { elapsedFraction, daysBetween, type Range } from "../core/time";

/** Target attainment % = actual ÷ target × 100. A zero target has no meaningful percentage (null) - never Infinity. */
export function attainmentPercent(actual: string, target: string): number | null {
  return ratioPercent(actual, target);
}

/** Remaining target = target − actual. Negative means the target was exceeded. */
export function remaining(target: string, actual: string): string {
  return sub(target, actual);
}

/**
 * Net actual: booked sales less returns and cancellations. Historical actuals are never altered - returns are
 * subtracted from the period in which they are recorded, never written back over the original sale.
 */
export function netActual(booked: string, returns: string, cancellations: string): string {
  return sub(sub(booked, returns), cancellations);
}

export type PaceStatus = "achieved" | "ahead" | "on_track" | "at_risk" | "behind" | "no_target" | "not_started" | "closed";

export interface Pacing {
  target: string;
  actual: string;
  attainmentPercent: number | null;
  remaining: string;
  elapsedPercent: number;
  expectedToDate: string;
  /** actual − expected-to-date (positive = ahead of the straight-line pace) */
  paceVariance: string;
  daysRemaining: number;
  requiredPerDay: string;
  projectedFinal: string;
  projectedAttainmentPercent: number | null;
  status: PaceStatus;
}

/**
 * Straight-line pacing. `projectedFinal` assumes the run-rate so far continues; it is a projection, not a forecast,
 * and is labelled as such in the UI. Thresholds: >=105% of expected is ahead, >=alertThreshold% of expected on track.
 */
export function pacing(args: { target: string; actual: string; range: Range; now: Date; alertThresholdPercent?: number }): Pacing {
  const { target, actual, range, now } = args;
  const frac = elapsedFraction(range, now);
  const targetMinor = toMinor(target);
  const expectedMinor = BigInt(Math.round(Number(targetMinor) * frac));
  const expected = fromMinor(expectedMinor);
  const att = attainmentPercent(actual, target);
  const daysTotal = Math.max(1, daysBetween(range.from, range.to));
  const daysLeft = Math.max(0, Math.ceil((Date.parse(range.to) - now.getTime()) / 86_400_000));
  const rem = remaining(target, actual);
  const remMinor = toMinor(rem);
  const perDay = remMinor > 0n && daysLeft > 0 ? fromMinor(BigInt(Math.ceil(Number(remMinor) / daysLeft))) : "0.00";
  const projected = frac > 0 ? fromMinor(BigInt(Math.round(Number(toMinor(actual)) / frac))) : actual;
  const projAtt = attainmentPercent(projected, target);
  const threshold = args.alertThresholdPercent ?? 70;

  let status: PaceStatus;
  if (targetMinor === 0n) status = "no_target";
  else if (cmp(actual, target) >= 0) status = "achieved";
  else if (now.getTime() >= Date.parse(range.to)) status = "closed";
  else if (now.getTime() < Date.parse(range.from)) status = "not_started";
  else {
    const ratio = expectedMinor === 0n ? 1 : Number(toMinor(actual)) / Number(expectedMinor);
    status = ratio >= 1.05 ? "ahead" : ratio >= threshold / 100 + 0.2 ? "on_track" : ratio >= threshold / 100 ? "at_risk" : "behind";
  }
  void daysTotal;
  return {
    target, actual, attainmentPercent: att, remaining: rem, elapsedPercent: Math.round(frac * 10000) / 100,
    expectedToDate: expected, paceVariance: sub(actual, expected), daysRemaining: daysLeft, requiredPerDay: perDay,
    projectedFinal: projected, projectedAttainmentPercent: projAtt, status,
  };
}

/**
 * Allocate a parent target across children by weights without losing a cent. Re-exported convenience for the
 * target planning screen ("split company target across the team by last year's share").
 */
export { allocate as allocateTarget } from "../core/money";

export function allocationGap(parent: string, children: string[]): string {
  return sub(parent, sum(children));
}
