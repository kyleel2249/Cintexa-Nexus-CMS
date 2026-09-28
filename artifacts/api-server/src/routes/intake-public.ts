import { Router } from "express";
import { randomBytes } from "crypto";
import {
  db,
  pool,
  ensureSchema,
  intakeShareLinksTable,
  intakePublicSubmissionsTable,
  diagnosticProfilesTable,
  diagnosticSessionsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { dispatchWebhook } from "../lib/webhooks";

const router = Router();

/** Ensure all tables exist (idempotent). Avoids hard failure when migrations were not run. */
function ensureTables(): Promise<void> {
  return ensureSchema(pool);
}

function makeToken() {
  return randomBytes(12).toString("base64url");
}

function cleanOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Work out the public origin that share links should point at.
 * Priority: browser-supplied page origin (validated) > PUBLIC_APP_URL env > Origin/Referer
 * > forwarded host > request host. The API host (e.g. localhost:8080) is never used for links.
 */
function publicBaseUrl(req: any, clientBase?: unknown) {
  const fromClient = cleanOrigin(clientBase);
  if (fromClient) return fromClient;

  const fromEnv = cleanOrigin(process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.FRONTEND_URL || "");
  if (fromEnv) return fromEnv;

  const origin = cleanOrigin(req?.headers?.origin);
  if (origin && !origin.includes("localhost:8080")) return origin;

  const referer = cleanOrigin(req?.headers?.referer);
  if (referer && !referer.includes("localhost:8080")) return referer;

  const fwdHost = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  if (fwdHost) {
    const proto = String(req?.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
    return `${proto}://${fwdHost}`;
  }
  return "https://cintexa-nexus-cms.pages.dev";
}

/** Simple per-IP throttle for the public submit endpoint (10 / 10 min). */
const submitHits = new Map<string, { n: number; reset: number }>();
function submitThrottled(key: string): boolean {
  const now = Date.now();
  const hit = submitHits.get(key);
  if (!hit || hit.reset < now) {
    submitHits.set(key, { n: 1, reset: now + 10 * 60_000 });
    return false;
  }
  hit.n += 1;
  return hit.n > 10;
}

function serializeLink(row: typeof intakeShareLinksTable.$inferSelect, base: string, submissionCount = 0) {
  const expired = Boolean(row.expiresAt && row.expiresAt < new Date());
  return {
    submissionCount,
    expired,
    id: row.id,
    token: row.token,
    label: row.label,
    active: row.active,
    createdBy: row.createdBy,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    expiresAt: row.expiresAt
      ? row.expiresAt instanceof Date
        ? row.expiresAt.toISOString()
        : row.expiresAt
      : null,
    shareUrl: `${base}/intake/${row.token}`,
  };
}

/** Admin: create a shareable intake link */
router.post("/share-links", async (req, res) => {
  try {
    await ensureTables();
    const label = String(req.body?.label || "Diagnostic Intake").trim().slice(0, 120) || "Diagnostic Intake";
    const days = Number(req.body?.expiresInDays);
    const expiresAt = Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000) : null;
    const token = makeToken();
    const createdBy = typeof req.auth?.sub === "number" ? req.auth.sub : null;
    const [row] = await db
      .insert(intakeShareLinksTable)
      .values({ token, label, active: true, expiresAt, createdBy })
      .returning();
    if (!row) {
      return res.status(500).json({ error: "Insert returned no row" });
    }
    const base = publicBaseUrl(req, req.body?.baseUrl);
    res.status(201).json(serializeLink(row, base));
  } catch (err: any) {
    console.error("[intake] create share-link failed", err);
    res.status(500).json({
      error: err?.message || "Failed to create share link",
      detail: String(err?.code || err?.cause || ""),
    });
  }
});

/** Admin: list share links (with submission counts) */
router.get("/share-links", async (req, res) => {
  try {
    await ensureTables();
    const rows = await db
      .select()
      .from(intakeShareLinksTable)
      .orderBy(desc(intakeShareLinksTable.createdAt));
    const counts = await pool.query(`SELECT share_link_id, COUNT(*)::int AS n FROM intake_public_submissions GROUP BY share_link_id`);
    const byLink = new Map<number, number>(counts.rows.map((r: any) => [Number(r.share_link_id), Number(r.n)]));
    const base = publicBaseUrl(req, req.query.baseUrl);
    res.json(rows.map((r) => serializeLink(r, base, byLink.get(r.id) ?? 0)));
  } catch (err: any) {
    console.error("[intake] list share-links failed", err);
    res.status(500).json({ error: err?.message || "Failed to list share links" });
  }
});

/** Admin: activate / deactivate a link */
router.patch("/share-links/:id", async (req, res) => {
  try {
    await ensureTables();
    const id = Number(req.params.id);
    const updates: Record<string, unknown> = {};
    if (req.body?.active !== undefined) updates.active = Boolean(req.body.active);
    if (req.body?.label !== undefined) updates.label = String(req.body.label);
    if (req.body?.expiresAt !== undefined) {
      updates.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
    }
    const [row] = await db
      .update(intakeShareLinksTable)
      .set(updates as any)
      .where(eq(intakeShareLinksTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(serializeLink(row, publicBaseUrl(req, req.body?.baseUrl)));
  } catch (err: any) {
    console.error("[intake] patch share-link failed", err);
    res.status(500).json({ error: err?.message || "Failed to update share link" });
  }
});

/** Admin: delete a link (its submissions are removed too) */
router.delete("/share-links/:id", async (req, res) => {
  try {
    await ensureTables();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
    const [row] = await db.delete(intakeShareLinksTable).where(eq(intakeShareLinksTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (err: any) {
    console.error("[intake] delete share-link failed", err);
    res.status(500).json({ error: err?.message || "Failed to delete share link" });
  }
});

/** Public: validate token (no auth) */
router.get("/public/:token", async (req, res) => {
  try {
    await ensureTables();
    const token = req.params.token;
    const [link] = await db
      .select()
      .from(intakeShareLinksTable)
      .where(eq(intakeShareLinksTable.token, token));
    if (!link || !link.active) {
      return res.status(404).json({ error: "Link not found or inactive" });
    }
    if (link.expiresAt && link.expiresAt < new Date()) {
      return res.status(410).json({ error: "Link expired" });
    }
    res.json({ token: link.token, label: link.label });
  } catch (err: any) {
    console.error("[intake] public get failed", err);
    res.status(500).json({ error: err?.message || "Failed to load link" });
  }
});

/** Public: submit filled intake (no auth) — records into Nexus */
router.post("/public/:token/submit", async (req, res) => {
  try {
    await ensureTables();
    const token = req.params.token;
    const [link] = await db
      .select()
      .from(intakeShareLinksTable)
      .where(eq(intakeShareLinksTable.token, token));
    if (!link || !link.active) {
      return res.status(404).json({ error: "Link not found or inactive" });
    }
    if (link.expiresAt && link.expiresAt < new Date()) {
      return res.status(410).json({ error: "Link expired" });
    }

    if (submitThrottled(`${req.ip}:${token}`)) {
      return res.status(429).json({ error: "Too many submissions. Please try again later." });
    }

    const payload = req.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    if (JSON.stringify(payload).length > 400_000) {
      return res.status(413).json({ error: "Submission is too large" });
    }
    // Honeypot: bots fill hidden fields. Pretend success, store nothing.
    if (typeof payload._hp === "string" && payload._hp.trim()) {
      return res.status(201).json({ ok: true, submissionId: null, profileId: null, message: "Thank you." });
    }

    const companyName =
      String(payload.companyName || payload.company_name || "").trim() || null;

    const [sub] = await db
      .insert(intakePublicSubmissionsTable)
      .values({
        shareLinkId: link.id,
        token,
        payload: JSON.stringify(payload),
        companyName,
        status: "received",
      })
      .returning();

    let profileId: number | null = null;
    try {
      const [profile] = await db
        .insert(diagnosticProfilesTable)
        .values({
          companyName: companyName || "Intake submission",
          website: payload.website || null,
          industry: payload.industry || null,
          subIndustry: payload.subIndustry || null,
          businessModel: payload.businessModel || null,
          geographicMarkets: payload.geographicMarkets || null,
          companySize: payload.employees || null,
          revenueRange: payload.revenueRange || null,
          strategicObjectives: payload.strategicObjective || null,
          monthlyRevenue: payload.monthlyRevenue ?? null,
          monthlyLeads: payload.monthlyLeads ?? null,
          monthlyQualifiedLeads: payload.qualifiedLeads ?? null,
          monthlyCustomers: payload.customers ?? null,
          conversionRate: payload.conversion ?? null,
          avgTransactionValue: payload.aov ?? null,
          customerAcquisitionCost: payload.cac ?? null,
          customerChurn: payload.churn ?? null,
          retentionRate: payload.retention ?? null,
          grossMargin: payload.grossMargin ?? null,
          netMargin: payload.netMargin ?? null,
          salesCycleDays: payload.salesCycle ?? null,
          mainCompetitors: payload.competitors || null,
        })
        .returning();
      profileId = profile.id;

      await db.insert(diagnosticSessionsTable).values({
        profileId,
        mode: "standard",
        status: "completed",
        currentStep: 0,
        totalSteps: 1,
        answers: payload.answers || {},
        pillarScores: {},
        completedAt: new Date(),
      });

      if (sub?.id) {
        await db
          .update(intakePublicSubmissionsTable)
          .set({ status: "imported", profileId })
          .where(eq(intakePublicSubmissionsTable.id, sub.id));
      }
    } catch (importErr) {
      console.error("[intake] auto-import into diagnostic failed", importErr);
    }

    dispatchWebhook("intake.submitted", {
      submissionId: sub?.id ?? null,
      profileId,
      companyName,
      label: link.label,
    });

    res.status(201).json({
      ok: true,
      submissionId: sub?.id ?? null,
      profileId,
      message: "Thank you. Your intake has been recorded in Nexus.",
    });
  } catch (err: any) {
    console.error("[intake] public submit failed", err);
    res.status(500).json({ error: err?.message || "Failed to save submission" });
  }
});

/** Admin: list public submissions */
router.get("/submissions", async (_req, res) => {
  try {
    await ensureTables();
    const rows = await db
      .select()
      .from(intakePublicSubmissionsTable)
      .orderBy(desc(intakePublicSubmissionsTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      })),
    );
  } catch (err: any) {
    console.error("[intake] list submissions failed", err);
    res.status(500).json({ error: err?.message || "Failed to list submissions" });
  }
});

export default router;
