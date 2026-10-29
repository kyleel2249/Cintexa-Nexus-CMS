import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Download, Lock, LockOpen, Pencil, Plus, Search, ShieldCheck, Trash2, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, StrengthMeter, TextField } from "./ui-bits";
import { SecretField } from "./SecretField";
import type { EntryInput, VaultApi } from "./useVault";
import { analyzePassword } from "@/lib/sentinel-key/analysis";
import { analyzeUrl, VERDICT_TEXT } from "@/lib/sentinel-key/url-check";
import { DEFAULT_PASSWORD_OPTIONS, generatePassword } from "@/lib/sentinel-key/password";
import { downloadText } from "@/lib/sentinel-key/clipboard";
import { MIN_MASTER_LENGTH, MAX_BACKUP_BYTES, type VaultEntry } from "@/lib/sentinel-key/vault";

const EMPTY: EntryInput = { name: "", username: "", password: "", origin: "", category: "", notes: "" };
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

function MasterForm({ mode, onSubmit }: { mode: "create" | "unlock"; onSubmit: (pw: string) => Promise<void> }) {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const a = analyzePassword(pw);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (mode === "create") { if (pw.length < MIN_MASTER_LENGTH) return setErr(`Use at least ${MIN_MASTER_LENGTH} characters.`); if (pw !== pw2) return setErr("The two passwords do not match."); if (a.level < 2) return setErr("That master password is too weak. Try a passphrase of several random words."); }
    setBusy(true);
    try { await onSubmit(pw); } catch (x) { setErr(msg(x)); } finally { setBusy(false); setPw(""); setPw2(""); }
  };
  return (
    <form onSubmit={submit} className="mx-auto max-w-lg rounded-xl border bg-card p-5 space-y-4">
      <h3 className="font-semibold flex items-center gap-2">{mode === "create" ? <><ShieldCheck className="h-5 w-5 text-primary" aria-hidden />Create your encrypted vault</> : <><Lock className="h-5 w-5 text-primary" aria-hidden />Unlock vault</>}</h3>
      <TextField id="vm-pw" type="password" label="Master password" value={pw} onChange={setPw} autoComplete={mode === "create" ? "new-password" : "current-password"} />
      {mode === "create" && <>
        <TextField id="vm-pw2" type="password" label="Confirm master password" value={pw2} onChange={setPw2} autoComplete="new-password" />
        <StrengthMeter bits={a.entropyBits} estimated />
        <Notice tone="warn" title="There is no recovery">Your master password is never stored or sent. If you forget it, the vault cannot be opened by anyone, including Cintexa. Keep an encrypted backup and remember the password.</Notice>
      </>}
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      <Button type="submit" disabled={busy || !pw}>{busy ? "Working…" : mode === "create" ? "Create vault" : "Unlock"}</Button>
    </form>
  );
}

function EntryForm({ initial, onSave, onCancel }: { initial: EntryInput; onSave: (e: EntryInput) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState(initial); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (p: Partial<EntryInput>) => setV((x) => ({ ...x, ...p }));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (!v.name.trim() || !v.password) return setErr("A name and a password are required."); setBusy(true); try { await onSave({ ...v, name: v.name.trim() }); } catch (x) { setErr(msg(x)); setBusy(false); } };
  return (
    <form onSubmit={submit} className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="ve-name" label="Service name" value={v.name} onChange={(name) => set({ name })} maxLength={200} />
        <TextField id="ve-user" label="Username or email" value={v.username} onChange={(username) => set({ username })} maxLength={320} autoComplete="off" />
        <TextField id="ve-origin" label="Website address" value={v.origin} onChange={(origin) => set({ origin })} maxLength={2048} placeholder="https://example.com" hint="Used to warn you when you are on a different site." />
        <TextField id="ve-cat" label="Category" value={v.category} onChange={(category) => set({ category })} maxLength={64} />
      </div>
      <div className="space-y-1.5">
        <TextField id="ve-pw" label="Password" type="password" value={v.password} onChange={(password) => set({ password })} maxLength={1024} autoComplete="new-password" />
        <div className="flex items-center gap-3"><Button type="button" variant="outline" size="sm" onClick={() => set({ password: generatePassword(DEFAULT_PASSWORD_OPTIONS).value })}><Wand2 /> Generate strong password</Button><div className="flex-1"><StrengthMeter bits={analyzePassword(v.password).entropyBits} estimated /></div></div>
      </div>
      <div className="space-y-1.5"><label htmlFor="ve-notes" className="text-sm font-medium">Notes</label><textarea id="ve-notes" value={v.notes} maxLength={4000} onChange={(e) => set({ notes: e.target.value })} rows={3} className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" /></div>
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>Save to vault</Button><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}

function EntryRow({ e, onEdit, onDelete, flags }: { e: VaultEntry; onEdit: () => void; onDelete: () => void; flags: string[] }) {
  const [verify, setVerify] = useState(false); const [addr, setAddr] = useState("");
  const [confirm, setConfirm] = useState(false);
  const r = verify && addr.trim() ? analyzeUrl(addr, e.origin) : null;
  return (
    <li className="rounded-xl border bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="font-medium truncate">{e.name}</p><p className="text-xs text-muted-foreground break-all">{e.username || "No username"}{e.origin ? ` · ${e.origin}` : ""}{e.category ? ` · ${e.category}` : ""}</p></div>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="icon" onClick={onEdit} aria-label={`Edit ${e.name}`}><Pencil /></Button>
          {confirm ? <Button type="button" variant="destructive" size="sm" onClick={onDelete}>Confirm delete</Button> : <Button type="button" variant="outline" size="icon" onClick={() => setConfirm(true)} aria-label={`Delete ${e.name}`}><Trash2 /></Button>}
        </div>
      </div>
      <SecretField label={`Password for ${e.name}`} value={e.password} />
      {flags.length > 0 && <p className="text-xs text-amber-500">{flags.join(" · ")}</p>}
      {e.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{e.notes}</p>}
      {e.origin && <div className="space-y-2"><Button type="button" variant="ghost" size="sm" onClick={() => setVerify((v) => !v)} aria-expanded={verify}>Verify the address I am on</Button>
        {verify && <div className="space-y-2"><TextField id={`vf-${e.id}`} label="Current address" value={addr} onChange={setAddr} maxLength={2048} placeholder="Paste the address from your browser" />
          {r && <p role="status" className="text-sm"><b>{VERDICT_TEXT[r.verdict]}.</b> {r.findings.find((f) => f.id === "origin-mismatch")?.detail ?? r.findings.find((f) => f.id === "origin-match")?.detail}</p>}</div>}</div>}
    </li>
  );
}

export function VaultPanel({ vault }: { vault: VaultApi }) {
  const reduce = useReducedMotion();
  const [q, setQ] = useState(""); const [editing, setEditing] = useState<string | "new" | null>(null);
  const [err, setErr] = useState<string | null>(null); const [note, setNote] = useState("");
  const [newMaster, setNewMaster] = useState(""); const [showMaster, setShowMaster] = useState(false);
  const [importJson, setImportJson] = useState<string | null>(null); const [importPw, setImportPw] = useState("");
  const [wipe, setWipe] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const entries = vault.session?.data.entries ?? [];
  const reusedIds = useMemo(() => { const m = new Map<string, string[]>(); entries.forEach((e) => m.set(e.password, [...(m.get(e.password) ?? []), e.id])); return new Set(Array.from(m.values()).filter((l) => l.length > 1).flat()); }, [entries]);
  const filtered = entries.filter((e) => `${e.name} ${e.username} ${e.origin} ${e.category}`.toLowerCase().includes(q.toLowerCase()));
  const run = async (fn: () => Promise<unknown>, ok = "") => { setErr(null); setNote(""); try { await fn(); if (ok) setNote(ok); } catch (x) { setErr(msg(x)); } };

  if (!vault.exists && !vault.session) return (
    <div className="space-y-4"><MasterForm mode="create" onSubmit={vault.create} />
      <div className="mx-auto max-w-lg"><Notice>The vault is optional. It stores encrypted data in this browser only (AES-256-GCM, key derived from your master password with PBKDF2). Nothing is uploaded. Basic generation works without it.</Notice></div></div>
  );
  if (!vault.session) return <div className="space-y-4"><MasterForm mode="unlock" onSubmit={vault.unlock} /><p className="text-center text-xs text-muted-foreground">Have a backup file? Unlock first, then use Import from the vault toolbar. Forgotten master passwords cannot be recovered.</p></div>;

  const editEntry = editing && editing !== "new" ? entries.find((e) => e.id === editing) : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden /><input aria-label="Search vault" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, user, website" className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" /></div>
        <Button type="button" onClick={() => setEditing("new")}><Plus /> Add</Button>
        <Button type="button" variant="outline" onClick={() => run(async () => downloadText(`sentinel-key-vault-${new Date().toISOString().slice(0, 10)}.json`, await vault.exportBackup(), "application/json"), "Encrypted backup downloaded. It needs your master password to open.")}><Download /> Backup</Button>
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><Upload /> Import</Button>
        <Button type="button" variant="outline" onClick={vault.lock}><LockOpen /> Lock</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Choose vault backup file" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (f.size > MAX_BACKUP_BYTES) return setErr("That file is too large to be a vault backup."); setImportJson(await f.text()); setImportPw(""); }} />
      </div>
      <p className="text-xs text-muted-foreground" role="status" aria-live="polite">{note}</p>
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      {importJson && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
          <p className="text-sm font-medium">Importing replaces the vault in this browser with the backup. Enter the master password the backup was made with.</p>
          <TextField id="im-pw" type="password" label="Backup master password" value={importPw} onChange={setImportPw} autoComplete="off" />
          <div className="flex gap-2"><Button type="button" onClick={() => run(async () => { await vault.importBackup(importJson, importPw); setImportJson(null); setImportPw(""); }, "Backup imported and verified.")}>Replace vault</Button><Button type="button" variant="outline" onClick={() => { setImportJson(null); setImportPw(""); }}>Cancel</Button></div>
        </div>
      )}
      <AnimatePresence>{editing && <motion.div initial={reduce ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden"><EntryForm initial={editEntry ? { name: editEntry.name, username: editEntry.username, password: editEntry.password, origin: editEntry.origin, category: editEntry.category, notes: editEntry.notes } : EMPTY} onCancel={() => setEditing(null)} onSave={async (v) => { if (editEntry) await vault.updateEntry(editEntry.id, v); else await vault.addEntry(v); setEditing(null); }} /></motion.div>}</AnimatePresence>
      {entries.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Your vault is empty. Add a credential or generate one in the Generate tab.</div>
        : filtered.length === 0 ? <p className="text-sm text-muted-foreground">No credentials match your search.</p>
        : <ul className="grid gap-3 md:grid-cols-2">{filtered.map((e) => { const a = analyzePassword(e.password); const flags = [reusedIds.has(e.id) ? "Reused password" : "", a.level <= 1 ? "Weak password" : "", a.length < 12 ? "Short password" : ""].filter(Boolean); return <EntryRow key={e.id} e={e} flags={flags} onEdit={() => setEditing(e.id)} onDelete={() => run(() => vault.removeEntry(e.id))} />; })}</ul>}
      <details className="rounded-xl border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Vault settings and danger zone</summary>
        <div className="mt-3 space-y-4">
          <div className="space-y-2"><TextField id="nm-pw" type={showMaster ? "text" : "password"} label="New master password" value={newMaster} onChange={setNewMaster} autoComplete="new-password" />
            <div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setShowMaster((s) => !s)}>{showMaster ? "Hide" : "Show"}</Button><Button type="button" size="sm" disabled={newMaster.length < MIN_MASTER_LENGTH} onClick={() => run(async () => { await vault.changeMaster(newMaster); setNewMaster(""); }, "Master password changed. Older backups still need the old password.")}>Change master password</Button></div></div>
          <Notice tone="warn" title="Delete vault">Permanently erases the encrypted vault from this browser. Backups you downloaded are not affected.</Notice>
          {wipe ? <div className="flex gap-2"><Button type="button" variant="destructive" size="sm" onClick={() => { vault.destroy(); setWipe(false); }}>Yes, delete everything</Button><Button type="button" variant="outline" size="sm" onClick={() => setWipe(false)}>Cancel</Button></div> : <Button type="button" variant="destructive" size="sm" onClick={() => setWipe(true)}>Delete entire vault</Button>}
        </div>
      </details>
    </div>
  );
}
