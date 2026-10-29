/**
 * Sentinel Key store service. Pure SQL + validation: runs unchanged on the API server (Postgres) and in the browser (PGlite).
 *
 *  - Every statement is scoped by `owner_id`; foreign ids from another owner behave exactly like missing ids (404).
 *  - Secrets only ever arrive as client-side AES-256-GCM ciphertext. Nothing here can decrypt anything.
 *  - Generation is a two-step, idempotent workflow: begin (history "pending") -> commit (vault entry + history "saved" in ONE
 *    transaction) or fail. Retrying either step with the same ids never creates duplicates.
 *  - Audit rows record the action and ids only, never values.
 */
import { SkError, type Db, type Queryable, type CredentialType } from "./types";
import * as v from "./validate";

const iso = (x: unknown): string | null => (x instanceof Date ? x.toISOString() : typeof x === "string" ? new Date(x).toISOString() : null);
const notFound = (what: string) => new SkError(404, "not_found", `${what} not found`);

async function audit(q: Queryable, owner: string, action: string, entityType: string, entityId: string | null, meta: Record<string, unknown> = {}) {
  await q.query(`INSERT INTO sk_audit (owner_id, action, entity_type, entity_id, meta) VALUES ($1,$2,$3,$4,$5::jsonb)`, [owner, action, entityType, entityId, JSON.stringify(meta)]);
}

// ───────────────────────── key envelope ─────────────────────────
export async function getKey(db: Queryable, owner: string) {
  const { rows } = await db.query(`SELECT kdf, verifier_iv, verifier_ct, version FROM sk_user_keys WHERE owner_id=$1`, [owner]);
  const r = rows[0];
  return r ? { exists: true, kdf: r.kdf, verifierIv: r.verifier_iv, verifierCt: r.verifier_ct, version: r.version } : { exists: false };
}

export async function createKey(db: Db, owner: string, input: unknown) {
  const b = v.obj(input);
  const kdf = v.obj(b.kdf, "kdf");
  if (kdf.name !== "PBKDF2" || kdf.hash !== "SHA-256" || !Number.isInteger(kdf.iterations) || (kdf.iterations as number) < 200_000 || (kdf.iterations as number) > 5_000_000) throw new SkError(400, "validation_failed", "kdf: unsupported key-derivation settings");
  const clean = { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations, salt: v.b64(kdf.salt, "kdf.salt", 22, 64) };
  const iv = v.b64(b.verifierIv, "verifierIv", 16, 16);
  const ct = v.b64(b.verifierCt, "verifierCt", 24, 200);
  return db.tx(async (q) => {
    const ins = await q.query(`INSERT INTO sk_user_keys (owner_id, kdf, verifier_iv, verifier_ct) VALUES ($1,$2::jsonb,$3,$4) ON CONFLICT (owner_id) DO NOTHING RETURNING owner_id`, [owner, JSON.stringify(clean), iv, ct]);
    if (!ins.rows.length) throw new SkError(409, "key_exists", "A vault key already exists. Unlock it with your master password.");
    await audit(q, owner, "key.create", "key", null);
    return getKey(q, owner);
  });
}

// ───────────────────────── aliases ─────────────────────────
const aliasOut = (r: any) => ({
  id: r.id, name: r.name, category: r.category, service: r.service, project: r.project, environment: r.environment, notes: r.notes,
  tags: r.tags ?? [], expiresAt: iso(r.expires_at), archivedAt: iso(r.archived_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  entryCount: r.entry_count === undefined ? undefined : Number(r.entry_count), eventCount: r.event_count === undefined ? undefined : Number(r.event_count),
});

function aliasInput(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || b.name !== undefined) out.name = v.str(b.name, "name", 120, { required: true });
  for (const [k, max] of [["category", 60], ["service", 80], ["project", 80], ["environment", 40], ["notes", 2000]] as const) if (!partial || b[k] !== undefined) out[k] = v.str(b[k], k, max);
  if (!partial || b.tags !== undefined) out.tags = v.tags(b.tags);
  if (!partial || b.expiresAt !== undefined) out.expires_at = v.date(b.expiresAt, "expiresAt");
  return out;
}

export async function createAlias(db: Db, owner: string, input: unknown) {
  const b = v.obj(input);
  const id = v.uuid(b.id, "id");
  const f = aliasInput(b, false) as any;
  return db.tx(async (q) => {
    const existing = await q.query(`SELECT * FROM sk_aliases WHERE id=$1`, [id]);
    if (existing.rows.length) {
      if (existing.rows[0].owner_id !== owner) throw new SkError(409, "conflict", "That id is already in use");
      return aliasOut(existing.rows[0]); // idempotent retry
    }
    const dupe = await q.query(`SELECT 1 FROM sk_aliases WHERE owner_id=$1 AND name_key=$2 AND archived_at IS NULL`, [owner, v.nameKey(f.name)]);
    if (dupe.rows.length) throw new SkError(409, "alias_exists", `An alias named "${f.name}" already exists`);
    const { rows } = await q.query(
      `INSERT INTO sk_aliases (id, owner_id, name, name_key, category, service, project, environment, notes, tags, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11) RETURNING *`,
      [id, owner, f.name, v.nameKey(f.name), f.category, f.service, f.project, f.environment, f.notes, f.tags, f.expires_at]);
    await audit(q, owner, "alias.create", "alias", id);
    return aliasOut(rows[0]);
  });
}

export async function updateAlias(db: Db, owner: string, id: string, input: unknown) {
  id = v.uuid(id, "id");
  const f = aliasInput(v.obj(input), true) as Record<string, unknown>;
  return db.tx(async (q) => {
    const cur = await q.query(`SELECT * FROM sk_aliases WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id, owner]);
    if (!cur.rows.length) throw notFound("Alias");
    const sets: string[] = []; const params: unknown[] = [id, owner];
    const push = (col: string, val: unknown, cast = "") => { params.push(val); sets.push(`${col}=$${params.length}${cast}`); };
    for (const [k, val] of Object.entries(f)) {
      if (k === "name") {
        const key = v.nameKey(val as string);
        if (!cur.rows[0].archived_at) {
          const dupe = await q.query(`SELECT 1 FROM sk_aliases WHERE owner_id=$1 AND name_key=$2 AND archived_at IS NULL AND id<>$3`, [owner, key, id]);
          if (dupe.rows.length) throw new SkError(409, "alias_exists", `An alias named "${val}" already exists`);
        }
        push("name", val); push("name_key", key);
      } else push(k, val, k === "tags" ? "::text[]" : "");
    }
    if (!sets.length) return aliasOut(cur.rows[0]);
    const { rows } = await q.query(`UPDATE sk_aliases SET ${sets.join(", ")}, updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *`, params);
    await audit(q, owner, "alias.update", "alias", id, { renamed: f.name !== undefined });
    return aliasOut(rows[0]);
  });
}

export async function setAliasArchived(db: Db, owner: string, id: string, archived: boolean) {
  id = v.uuid(id, "id");
  return db.tx(async (q) => {
    const cur = await q.query(`SELECT * FROM sk_aliases WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id, owner]);
    if (!cur.rows.length) throw notFound("Alias");
    if (!archived) {
      const dupe = await q.query(`SELECT 1 FROM sk_aliases WHERE owner_id=$1 AND name_key=$2 AND archived_at IS NULL AND id<>$3`, [owner, cur.rows[0].name_key, id]);
      if (dupe.rows.length) throw new SkError(409, "alias_exists", "Another active alias already uses this name. Rename one of them first.");
    }
    const { rows } = await q.query(`UPDATE sk_aliases SET archived_at=${archived ? "now()" : "NULL"}, updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *`, [id, owner]);
    await audit(q, owner, archived ? "alias.archive" : "alias.restore", "alias", id);
    return aliasOut(rows[0]);
  });
}

export async function deleteAlias(db: Db, owner: string, id: string) {
  id = v.uuid(id, "id");
  return db.tx(async (q) => {
    const cur = await q.query(`SELECT id FROM sk_aliases WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id, owner]);
    if (!cur.rows.length) throw notFound("Alias");
    const used = await q.query(`SELECT (SELECT count(*) FROM sk_vault_entries WHERE alias_id=$1 AND owner_id=$2) AS e, (SELECT count(*) FROM sk_history WHERE alias_id=$1 AND owner_id=$2) AS h`, [id, owner]);
    if (Number(used.rows[0].e) + Number(used.rows[0].h) > 0) throw new SkError(409, "alias_in_use", "This alias is linked to saved credentials or history. Archive it instead.");
    await q.query(`DELETE FROM sk_aliases WHERE id=$1 AND owner_id=$2`, [id, owner]);
    await audit(q, owner, "alias.delete", "alias", id);
    return { deleted: true };
  });
}

export async function listAliases(db: Queryable, owner: string, qs: Record<string, string | undefined>) {
  const where = ["a.owner_id=$1"]; const params: unknown[] = [owner];
  const archived = qs.archived === "true" ? "only" : qs.archived === "all" ? "all" : "none";
  if (archived === "none") where.push("a.archived_at IS NULL"); else if (archived === "only") where.push("a.archived_at IS NOT NULL");
  if (qs.q) { params.push(`%${v.escapeLike(qs.q.slice(0, 100).toLowerCase())}%`); where.push(`(a.name_key LIKE $${params.length} ESCAPE '\\' OR lower(coalesce(a.service,'')) LIKE $${params.length} ESCAPE '\\' OR lower(coalesce(a.project,'')) LIKE $${params.length} ESCAPE '\\' OR EXISTS (SELECT 1 FROM unnest(a.tags) t WHERE lower(t) LIKE $${params.length} ESCAPE '\\'))`); }
  for (const [k, col] of [["category", "category"], ["environment", "environment"]] as const) if (qs[k]) { params.push(qs[k]!.slice(0, 80)); where.push(`a.${col}=$${params.length}`); }
  const { rows } = await db.query(
    `SELECT a.*, (SELECT count(*) FROM sk_vault_entries e WHERE e.alias_id=a.id AND e.owner_id=a.owner_id) AS entry_count, (SELECT count(*) FROM sk_history h WHERE h.alias_id=a.id AND h.owner_id=a.owner_id) AS event_count
     FROM sk_aliases a WHERE ${where.join(" AND ")} ORDER BY lower(a.name) ASC LIMIT 500`, params);
  return { items: rows.map(aliasOut) };
}

// ───────────────────────── generation workflow ─────────────────────────
const eventOut = (r: any) => ({
  id: r.id, aliasId: r.alias_id, aliasNameAtGeneration: r.alias_name, aliasName: r.current_alias_name ?? r.alias_name, type: r.type, settings: r.settings ?? {}, itemCount: Number(r.item_count),
  status: r.status, failureCode: r.failure_code, vaultEntryId: r.vault_entry_id, vaultRecordAvailable: !!r.vault_entry_id, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const EVENT_SELECT = `SELECT h.*, a.name AS current_alias_name FROM sk_history h JOIN sk_aliases a ON a.id=h.alias_id`;

export async function beginGeneration(db: Db, owner: string, input: unknown) {
  const b = v.obj(input);
  const id = v.uuid(b.eventId, "eventId");
  const aliasId = v.uuid(b.aliasId, "aliasId"); // an alias is mandatory for every credential type
  const type = v.credentialType(b.type);
  const set = v.settings(b.settings);
  const count = v.int(b.itemCount, 1, 1, 500);
  return db.tx(async (q) => {
    const prior = await q.query(`SELECT owner_id FROM sk_history WHERE id=$1`, [id]);
    if (prior.rows.length) {
      if (prior.rows[0].owner_id !== owner) throw new SkError(409, "conflict", "That id is already in use");
      const { rows } = await q.query(`${EVENT_SELECT} WHERE h.id=$1 AND h.owner_id=$2`, [id, owner]);
      return eventOut(rows[0]); // idempotent retry
    }
    const al = await q.query(`SELECT id, name, archived_at FROM sk_aliases WHERE id=$1 AND owner_id=$2`, [aliasId, owner]);
    if (!al.rows.length) throw new SkError(404, "alias_not_found", "Choose an existing alias or create one first");
    if (al.rows[0].archived_at) throw new SkError(409, "alias_archived", "This alias is archived. Restore it or choose another.");
    await q.query(`INSERT INTO sk_history (id, owner_id, alias_id, alias_name, type, settings, item_count, status) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'pending')`, [id, owner, aliasId, al.rows[0].name, type, JSON.stringify(set), count]);
    await audit(q, owner, "generation.begin", "history", id, { type });
    const { rows } = await q.query(`${EVENT_SELECT} WHERE h.id=$1 AND h.owner_id=$2`, [id, owner]);
    return eventOut(rows[0]);
  });
}

/** Step 2: store the client-encrypted secret AND mark the history event saved - atomically. Safe to retry. */
export async function commitGeneration(db: Db, owner: string, eventId: string, input: unknown) {
  eventId = v.uuid(eventId, "eventId");
  const b = v.obj(input);
  const entryId = v.uuid(b.entryId, "entryId");
  const iv = v.b64(b.iv, "iv", 16, 16);
  const ciphertext = v.b64(b.ciphertext, "ciphertext", 24, v.MAX_CIPHERTEXT);
  if (b.encVersion !== 1) throw new SkError(400, "validation_failed", "encVersion: unsupported");
  return db.tx(async (q) => {
    const ev = await q.query(`SELECT * FROM sk_history WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [eventId, owner]);
    if (!ev.rows.length) throw notFound("Generation event");
    const h = ev.rows[0];
    if (h.status === "saved" && h.vault_entry_id) {
      const { rows } = await q.query(`${EVENT_SELECT} WHERE h.id=$1 AND h.owner_id=$2`, [eventId, owner]);
      return { ...eventOut(rows[0]), alreadySaved: true };
    }
    if (h.status === "saved") throw new SkError(409, "vault_record_deleted", "This credential was saved and its vault record has since been deleted");
    const clash = await q.query(`SELECT owner_id, history_event_id FROM sk_vault_entries WHERE id=$1`, [entryId]);
    if (clash.rows.length && (clash.rows[0].owner_id !== owner || clash.rows[0].history_event_id !== eventId)) throw new SkError(409, "conflict", "That record id is already in use");
    const al = await q.query(`SELECT category FROM sk_aliases WHERE id=$1 AND owner_id=$2`, [h.alias_id, owner]);
    if (!clash.rows.length) {
      await q.query(
        `INSERT INTO sk_vault_entries (id, owner_id, alias_id, history_event_id, type, iv, ciphertext, enc_version, settings, item_count, category) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8::jsonb,$9,$10)`,
        [entryId, owner, h.alias_id, eventId, h.type, iv, ciphertext, JSON.stringify(h.settings ?? {}), h.item_count, al.rows[0]?.category ?? null]);
    }
    await q.query(`UPDATE sk_history SET status='saved', failure_code=NULL, vault_entry_id=$3, updated_at=now() WHERE id=$1 AND owner_id=$2`, [eventId, owner, entryId]);
    await audit(q, owner, "generation.commit", "vault", entryId, { type: h.type });
    const { rows } = await q.query(`${EVENT_SELECT} WHERE h.id=$1 AND h.owner_id=$2`, [eventId, owner]);
    return { ...eventOut(rows[0]), alreadySaved: false };
  });
}

export async function failGeneration(db: Db, owner: string, eventId: string, input: unknown) {
  eventId = v.uuid(eventId, "eventId");
  const code = v.failureCode(v.obj(input).code);
  return db.tx(async (q) => {
    const ev = await q.query(`SELECT status FROM sk_history WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [eventId, owner]);
    if (!ev.rows.length) throw notFound("Generation event");
    if (ev.rows[0].status !== "saved") {
      await q.query(`UPDATE sk_history SET status='failed', failure_code=$3, updated_at=now() WHERE id=$1 AND owner_id=$2`, [eventId, owner, code]);
      await audit(q, owner, "generation.fail", "history", eventId, { code });
    }
    const { rows } = await q.query(`${EVENT_SELECT} WHERE h.id=$1 AND h.owner_id=$2`, [eventId, owner]);
    return eventOut(rows[0]);
  });
}

// ───────────────────────── history ─────────────────────────
const SORTS: Record<string, string> = { created: "h.created_at", alias: "lower(h.alias_name)", type: "h.type", status: "h.status" };

export async function listHistory(db: Queryable, owner: string, qs: Record<string, string | undefined>) {
  const where = ["h.owner_id=$1"]; const params: unknown[] = [owner];
  const add = (sql: string, val: unknown) => { params.push(val); where.push(sql.split("?").join(`$${params.length}`)); };
  if (qs.q) add(`(lower(h.alias_name) LIKE ? ESCAPE '\\' OR lower(a.name) LIKE ? ESCAPE '\\')`, `%${v.escapeLike(qs.q.slice(0, 100).toLowerCase())}%`);
  if (qs.id) add("h.id=?", v.uuid(qs.id, "id"));
  if (qs.type) add("h.type=?", v.credentialType(qs.type));
  if (qs.aliasId) add("h.alias_id=?", v.uuid(qs.aliasId, "aliasId"));
  if (qs.status) { if (!["pending", "saved", "failed", "incomplete"].includes(qs.status)) throw new SkError(400, "validation_failed", "status: invalid"); if (qs.status === "incomplete") where.push("h.status IN ('pending','failed')"); else add("h.status=?", qs.status); }
  if (qs.from) add("h.created_at >= ?", v.date(qs.from, "from"));
  if (qs.to) add("h.created_at <= ?", v.date(qs.to, "to"));
  const col = SORTS[qs.sort ?? "created"] ?? SORTS.created; const dir = qs.dir === "asc" ? "ASC" : "DESC";
  const pageSize = v.int(qs.pageSize, 20, 1, 100); const page = v.int(qs.page, 1, 1, 100000);
  const base = `FROM sk_history h JOIN sk_aliases a ON a.id=h.alias_id WHERE ${where.join(" AND ")}`;
  const total = await db.query(`SELECT count(*) AS n ${base}`, params);
  const { rows } = await db.query(`SELECT h.*, a.name AS current_alias_name ${base} ORDER BY ${col} ${dir}, h.id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
  return { items: rows.map(eventOut), total: Number(total.rows[0].n), page, pageSize };
}

export async function getHistory(db: Queryable, owner: string, id: string) {
  const { rows } = await db.query(`${EVENT_SELECT} WHERE h.id=$1 AND h.owner_id=$2`, [v.uuid(id, "id"), owner]);
  if (!rows.length) throw notFound("Generation event");
  return eventOut(rows[0]);
}

/** Deletes the event. The vault record is left alone unless the caller explicitly asks for both. */
export async function deleteHistory(db: Db, owner: string, id: string, alsoVault: boolean) {
  id = v.uuid(id, "id");
  return db.tx(async (q) => {
    const ev = await q.query(`SELECT vault_entry_id FROM sk_history WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id, owner]);
    if (!ev.rows.length) throw notFound("Generation event");
    const entryId = ev.rows[0].vault_entry_id as string | null;
    await q.query(`UPDATE sk_vault_entries SET history_event_id=NULL WHERE history_event_id=$1 AND owner_id=$2`, [id, owner]);
    await q.query(`DELETE FROM sk_history WHERE id=$1 AND owner_id=$2`, [id, owner]);
    if (alsoVault && entryId) await q.query(`DELETE FROM sk_vault_entries WHERE id=$1 AND owner_id=$2`, [entryId, owner]);
    await audit(q, owner, alsoVault ? "history.delete_with_vault" : "history.delete", "history", id);
    return { deleted: true, vaultDeleted: !!(alsoVault && entryId) };
  });
}

// ───────────────────────── vault ─────────────────────────
const entryOut = (r: any) => ({
  id: r.id, type: r.type, aliasId: r.alias_id, aliasName: r.alias_name, settings: r.settings ?? {}, itemCount: Number(r.item_count), category: r.category, tags: r.tags ?? [], notes: r.notes,
  expiresAt: iso(r.expires_at), pinned: r.pinned, favorite: r.favorite, historyEventId: r.history_event_id, lastAccessedAt: iso(r.last_accessed_at), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const ENTRY_SELECT = `SELECT e.*, a.name AS alias_name FROM sk_vault_entries e JOIN sk_aliases a ON a.id=e.alias_id`;
const ESORTS: Record<string, string> = { created: "e.created_at", updated: "e.updated_at", alias: "lower(a.name)", type: "e.type", accessed: "e.last_accessed_at" };

/** Metadata only. Ciphertext is returned solely by getEntry (an explicit reveal). */
export async function listVault(db: Queryable, owner: string, qs: Record<string, string | undefined>) {
  const where = ["e.owner_id=$1"]; const params: unknown[] = [owner];
  const add = (sql: string, val: unknown) => { params.push(val); where.push(sql.split("?").join(`$${params.length}`)); };
  if (qs.q) { const like = `%${v.escapeLike(qs.q.slice(0, 100).toLowerCase())}%`; add(`(lower(a.name) LIKE ? ESCAPE '\\' OR lower(coalesce(e.category,'')) LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM unnest(e.tags) t WHERE lower(t) LIKE ? ESCAPE '\\'))`, like); }
  if (qs.id) add("e.id=?", v.uuid(qs.id, "id"));
  if (qs.type) add("e.type=?", v.credentialType(qs.type));
  if (qs.aliasId) add("e.alias_id=?", v.uuid(qs.aliasId, "aliasId"));
  if (qs.pinned === "true") where.push("e.pinned"); if (qs.favorite === "true") where.push("e.favorite");
  if (qs.expired === "true") where.push("e.expires_at IS NOT NULL AND e.expires_at < now()");
  const col = ESORTS[qs.sort ?? "created"] ?? ESORTS.created; const dir = qs.dir === "asc" ? "ASC" : "DESC";
  const pageSize = v.int(qs.pageSize, 20, 1, 100); const page = v.int(qs.page, 1, 1, 100000);
  const base = `FROM sk_vault_entries e JOIN sk_aliases a ON a.id=e.alias_id WHERE ${where.join(" AND ")}`;
  const total = await db.query(`SELECT count(*) AS n ${base}`, params);
  const { rows } = await db.query(`SELECT e.*, a.name AS alias_name ${base} ORDER BY e.pinned DESC, ${col} ${dir} NULLS LAST, e.id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
  return { items: rows.map(entryOut), total: Number(total.rows[0].n), page, pageSize };
}

/** Explicit reveal: returns the ciphertext (still encrypted) and records the access. */
export async function getEntry(db: Db, owner: string, id: string) {
  id = v.uuid(id, "id");
  return db.tx(async (q) => {
    const { rows } = await q.query(`${ENTRY_SELECT} WHERE e.id=$1 AND e.owner_id=$2 FOR UPDATE OF e`, [id, owner]);
    if (!rows.length) throw notFound("Vault record");
    await q.query(`UPDATE sk_vault_entries SET last_accessed_at=now() WHERE id=$1 AND owner_id=$2`, [id, owner]);
    await audit(q, owner, "vault.reveal", "vault", id);
    return { ...entryOut({ ...rows[0], last_accessed_at: new Date() }), iv: rows[0].iv, ciphertext: rows[0].ciphertext, encVersion: rows[0].enc_version };
  });
}

export async function updateEntry(db: Db, owner: string, id: string, input: unknown) {
  id = v.uuid(id, "id");
  const b = v.obj(input);
  const sets: string[] = []; const params: unknown[] = [id, owner];
  const push = (col: string, val: unknown, cast = "") => { params.push(val); sets.push(`${col}=$${params.length}${cast}`); };
  if (b.pinned !== undefined) push("pinned", v.bool(b.pinned, "pinned"));
  if (b.favorite !== undefined) push("favorite", v.bool(b.favorite, "favorite"));
  if (b.category !== undefined) push("category", v.str(b.category, "category", 60));
  if (b.notes !== undefined) push("notes", v.str(b.notes, "notes", 2000));
  if (b.tags !== undefined) push("tags", v.tags(b.tags), "::text[]");
  if (b.expiresAt !== undefined) push("expires_at", v.date(b.expiresAt, "expiresAt"));
  const aliasId = b.aliasId !== undefined ? v.uuid(b.aliasId, "aliasId") : null;
  return db.tx(async (q) => {
    const cur = await q.query(`SELECT id FROM sk_vault_entries WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id, owner]);
    if (!cur.rows.length) throw notFound("Vault record");
    if (aliasId) {
      const al = await q.query(`SELECT archived_at FROM sk_aliases WHERE id=$1 AND owner_id=$2`, [aliasId, owner]);
      if (!al.rows.length) throw new SkError(404, "alias_not_found", "Alias not found");
      if (al.rows[0].archived_at) throw new SkError(409, "alias_archived", "This alias is archived");
      push("alias_id", aliasId);
    }
    if (sets.length) await q.query(`UPDATE sk_vault_entries SET ${sets.join(", ")}, updated_at=now() WHERE id=$1 AND owner_id=$2`, params);
    await audit(q, owner, "vault.update", "vault", id);
    const { rows } = await q.query(`${ENTRY_SELECT} WHERE e.id=$1 AND e.owner_id=$2`, [id, owner]);
    return entryOut(rows[0]);
  });
}

/** Deletes the vault record. Its history event is kept (marked as having no vault record) unless explicitly requested. */
export async function deleteEntry(db: Db, owner: string, id: string, alsoHistory: boolean) {
  id = v.uuid(id, "id");
  return db.tx(async (q) => {
    const cur = await q.query(`SELECT history_event_id FROM sk_vault_entries WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [id, owner]);
    if (!cur.rows.length) throw notFound("Vault record");
    const evId = cur.rows[0].history_event_id as string | null;
    await q.query(`DELETE FROM sk_vault_entries WHERE id=$1 AND owner_id=$2`, [id, owner]); // history.vault_entry_id -> NULL via FK
    if (alsoHistory && evId) await q.query(`DELETE FROM sk_history WHERE id=$1 AND owner_id=$2`, [evId, owner]);
    await audit(q, owner, alsoHistory ? "vault.delete_with_history" : "vault.delete", "vault", id);
    return { deleted: true, historyDeleted: !!(alsoHistory && evId) };
  });
}

/** Encrypted export: ciphertext and key parameters only. Useless without the master password. */
export async function exportVault(db: Db, owner: string) {
  return db.tx(async (q) => {
    const key = await getKey(q, owner);
    const al = await q.query(`SELECT * FROM sk_aliases WHERE owner_id=$1 ORDER BY created_at`, [owner]);
    const en = await q.query(`${ENTRY_SELECT} WHERE e.owner_id=$1 ORDER BY e.created_at`, [owner]);
    await audit(q, owner, "vault.export", "vault", null, { entries: en.rows.length });
    return {
      format: "sentinel-key-vault-export", version: 1, exportedAt: new Date().toISOString(), key,
      aliases: al.rows.map(aliasOut),
      entries: en.rows.map((r: any) => ({ ...entryOut(r), iv: r.iv, ciphertext: r.ciphertext, encVersion: r.enc_version })),
    };
  });
}

// ───────────────────────── summary (dashboard) ─────────────────────────
export async function summary(db: Queryable, owner: string) {
  const c = await db.query(
    `SELECT (SELECT count(*) FROM sk_vault_entries WHERE owner_id=$1) AS vault, (SELECT count(*) FROM sk_aliases WHERE owner_id=$1 AND archived_at IS NULL) AS aliases,
            (SELECT count(*) FROM sk_history WHERE owner_id=$1) AS history, (SELECT count(*) FROM sk_history WHERE owner_id=$1 AND status='failed') AS failed,
            (SELECT count(*) FROM sk_history WHERE owner_id=$1 AND status='pending') AS pending,
            (SELECT count(*) FROM sk_vault_entries WHERE owner_id=$1 AND expires_at IS NOT NULL AND expires_at < now()) AS expired`, [owner]);
  const recent = await db.query(`${EVENT_SELECT} WHERE h.owner_id=$1 ORDER BY h.created_at DESC LIMIT 5`, [owner]);
  const r = c.rows[0];
  return { vaultEntries: Number(r.vault), aliases: Number(r.aliases), historyEvents: Number(r.history), failed: Number(r.failed), pending: Number(r.pending), expiredEntries: Number(r.expired), incomplete: Number(r.failed) + Number(r.pending), recent: recent.rows.map(eventOut) };
}

export type { CredentialType };
