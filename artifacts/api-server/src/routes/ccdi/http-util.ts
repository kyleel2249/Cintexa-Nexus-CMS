/**
 * Small, dependency-free helpers shared by the CCDI route handlers.
 * - Express types route params as `string | string[]`; a repeated param would arrive as an array, so take the first value.
 * - Service results are discriminated by `"error" in result`, but TypeScript can't prove `status` is a number on every branch.
 *   `res.status(undefined)` throws at runtime, so fall back to a server error instead of crashing the handler.
 */
export const pid = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
export const httpStatus = (s: unknown, fallback = 500): number => (typeof s === "number" && Number.isInteger(s) && s >= 100 && s <= 599 ? s : fallback);
