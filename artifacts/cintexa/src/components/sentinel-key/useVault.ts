import { useCallback, useEffect, useState } from "react";
import { auditEntries, type AuditResult } from "@/lib/sentinel-key/analysis";
import { changeMasterPassword, createVault, deleteVault, exportBackup, importBackup, newEntryId, saveVault, unlockVault, vaultExists, type VaultEntry, type VaultSession } from "@/lib/sentinel-key/vault";
import { recordAudit, setVaultUnlocked, useSentinelSettings } from "@/lib/sentinel-key/session-store";

const BACKUP_KEY = "sentinel-key.last-backup";
const readBackup = (): number | null => { try { const v = Number(localStorage.getItem(BACKUP_KEY)); return v > 0 ? v : null; } catch { return null; } };

export type EntryInput = Omit<VaultEntry, "id" | "createdAt" | "updatedAt">;

/** Holds the unlocked vault in memory only. Navigating away, locking or inactivity drops the key. */
export function useVault() {
  const { vaultLockMinutes } = useSentinelSettings();
  const [session, setSession] = useState<VaultSession | null>(null);
  const [exists, setExists] = useState(() => vaultExists());
  const [audit, setAudit] = useState<(AuditResult & { at: number }) | null>(null);
  const [lastBackup, setLastBackup] = useState<number | null>(() => readBackup());

  const lock = useCallback(() => { setSession(null); setAudit(null); setVaultUnlocked(false); }, []);
  const open = useCallback((s: VaultSession) => { setSession(s); setExists(true); setVaultUnlocked(true); }, []);

  useEffect(() => () => setVaultUnlocked(false), []);
  useEffect(() => {
    if (!session || vaultLockMinutes <= 0) return undefined;
    let timer = setTimeout(lock, vaultLockMinutes * 60_000);
    const reset = () => { clearTimeout(timer); timer = setTimeout(lock, vaultLockMinutes * 60_000); };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [session, vaultLockMinutes, lock]);

  const commit = useCallback(async (entries: VaultEntry[]) => {
    if (!session) return;
    const next: VaultSession = { ...session, data: { entries } };
    await saveVault(next);
    setSession(next); setAudit(null);
  }, [session]);

  return {
    session, exists, audit, lastBackup, lock,
    create: async (master: string) => open(await createVault(master)),
    unlock: async (master: string) => open(await unlockVault(master)),
    addEntry: async (input: EntryInput) => { const now = Date.now(); await commit([...(session?.data.entries ?? []), { ...input, id: newEntryId(), createdAt: now, updatedAt: now }]); },
    updateEntry: async (id: string, input: EntryInput) => commit((session?.data.entries ?? []).map((e) => (e.id === id ? { ...e, ...input, updatedAt: Date.now() } : e))),
    removeEntry: async (id: string) => commit((session?.data.entries ?? []).filter((e) => e.id !== id)),
    exportBackup: async () => { if (!session) throw new Error("Unlock the vault first."); const json = await exportBackup(session); const at = Date.now(); try { localStorage.setItem(BACKUP_KEY, String(at)); } catch { /* ignore */ } setLastBackup(at); return json; },
    importBackup: async (json: string, master: string) => open(await importBackup(json, master)),
    changeMaster: async (next: string) => { if (session) setSession(await changeMasterPassword(session, next)); },
    destroy: () => { deleteVault(); try { localStorage.removeItem(BACKUP_KEY); } catch { /* ignore */ } setExists(false); setLastBackup(null); lock(); },
    runAudit: () => {
      if (!session) return;
      setAudit({ ...auditEntries(session.data.entries.map((e) => ({ id: e.id, name: e.name, password: e.password }))), at: Date.now() });
      recordAudit();
    },
  };
}
export type VaultApi = ReturnType<typeof useVault>;
