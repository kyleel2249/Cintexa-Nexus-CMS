import { useSyncExternalStore } from "react";

/**
 * Non-sensitive, session-scoped counters and preferences. Secret values are never stored here:
 * only counts, timestamps and flags.
 */
export type GenKind = "password" | "passphrase" | "id" | "token" | "recovery";
export interface SessionStats { generated: Record<GenKind, number>; lastAuditAt: number | null; vaultUnlocked: boolean }
export interface SentinelSettings { autoHideSeconds: number; clipboardClearSeconds: number; vaultLockMinutes: number; showActivity: boolean }

const STATS_KEY = "sentinel-key.session.v1";
const SETTINGS_KEY = "sentinel-key.settings.v1";
export const DEFAULT_SETTINGS: SentinelSettings = { autoHideSeconds: 30, clipboardClearSeconds: 30, vaultLockMinutes: 5, showActivity: true };

const emptyStats = (): SessionStats => ({ generated: { password: 0, passphrase: 0, id: 0, token: 0, recovery: 0 }, lastAuditAt: null, vaultUnlocked: false });

function load<T>(storage: () => Storage, key: string, fallback: () => T): T {
  try {
    const raw = storage().getItem(key);
    return raw ? { ...fallback(), ...JSON.parse(raw) } : fallback();
  } catch { return fallback(); }
}
function save(storage: () => Storage, key: string, value: unknown) {
  try { storage().setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: values stay in memory */ }
}

let stats: SessionStats = load(() => sessionStorage, STATS_KEY, emptyStats);
// vaultUnlocked must never survive a page reload: the key lives only in memory.
stats = { ...stats, vaultUnlocked: false };
let settings: SentinelSettings = load(() => localStorage, SETTINGS_KEY, () => DEFAULT_SETTINGS);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const recordGenerated = (kind: GenKind, n = 1) => {
  stats = { ...stats, generated: { ...stats.generated, [kind]: stats.generated[kind] + n } };
  save(() => sessionStorage, STATS_KEY, stats); emit();
};
export const recordAudit = () => { stats = { ...stats, lastAuditAt: Date.now() }; save(() => sessionStorage, STATS_KEY, stats); emit(); };
export const setVaultUnlocked = (v: boolean) => { stats = { ...stats, vaultUnlocked: v }; emit(); };
export const updateSettings = (patch: Partial<SentinelSettings>) => { settings = { ...settings, ...patch }; save(() => localStorage, SETTINGS_KEY, settings); emit(); };

export const getStats = () => stats;
export const getSettings = () => settings;
export const useSessionStats = () => useSyncExternalStore(subscribe, getStats, getStats);
export const useSentinelSettings = () => useSyncExternalStore(subscribe, getSettings, getSettings);
export const totalGenerated = (s: SessionStats) => Object.values(s.generated).reduce((a, b) => a + b, 0);
