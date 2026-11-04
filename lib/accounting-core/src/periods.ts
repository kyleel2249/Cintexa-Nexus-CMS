import type { IsoDate } from "./decimal";

export interface PeriodSpec {
  fiscalYear: number;
  periodNo: number;
  start: IsoDate;
  end: IsoDate;
}

function isoOf(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Twelve monthly periods for a fiscal year. `startMonth` is the calendar month the year begins in (1 = January); the
 * fiscal year is labelled by the calendar year in which it starts.
 */
export function fiscalYearPeriods(fiscalYear: number, startMonth: number = 1): PeriodSpec[] {
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2999) throw new RangeError("fiscalYear must be a whole year between 1900 and 2999");
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new RangeError("startMonth must be 1-12");
  const out: PeriodSpec[] = [];
  for (let i = 0; i < 12; i++) {
    const m = startMonth - 1 + i;
    const year = fiscalYear + Math.floor(m / 12);
    const month = m % 12;
    out.push({ fiscalYear, periodNo: i + 1, start: isoOf(Date.UTC(year, month, 1)), end: isoOf(Date.UTC(year, month + 1, 0)) });
  }
  return out;
}

export function periodForDate<T extends { start: IsoDate; end: IsoDate }>(periods: readonly T[], date: IsoDate): T | undefined {
  return periods.find((p) => p.start <= date && date <= p.end);
}
