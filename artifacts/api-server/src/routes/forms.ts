import { Router } from "express";
import { db, formsTable, formSubmissionsTable } from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";
import { dispatchWebhook } from "../lib/webhooks";

const router = Router();

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Public (unauthenticated) endpoints so a form can be embedded on any website. */
export const publicFormsRouter = Router();

const publicHits = new Map<string, { n: number; reset: number }>();
function throttled(key: string) {
  const now = Date.now();
  const h = publicHits.get(key);
  if (!h || h.reset < now) {
    publicHits.set(key, { n: 1, reset: now + 10 * 60_000 });
    return false;
  }
  h.n += 1;
  return h.n > 20;
}

publicFormsRouter.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [form] = await db.select().from(formsTable).where(eq(formsTable.id, id));
    if (!form) return res.status(404).json({ error: "Form not found" });
    res.json({ id: form.id, name: form.name, fields: safeParse(form.fields) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to load form" });
  }
});

publicFormsRouter.post("/:id/submissions", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (throttled(`${req.ip}:${id}`)) return res.status(429).json({ error: "Too many submissions. Try again later." });
    const [form] = await db.select().from(formsTable).where(eq(formsTable.id, id));
    if (!form) return res.status(404).json({ error: "Form not found" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (typeof (body as any)._hp === "string" && (body as any)._hp.trim()) return res.status(201).json({ ok: true }); // honeypot
    const payload = (body as any).data ?? body;
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (data.length > 100_000) return res.status(413).json({ error: "Submission is too large" });
    const [sub] = await db.insert(formSubmissionsTable).values({ formId: id, data }).returning();
    dispatchWebhook("form.submitted", { formId: id, formName: form.name, submissionId: sub.id, data: safeParse(data) });
    res.status(201).json({ ok: true, id: sub.id });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to save submission" });
  }
});

router.get("/", async (_req, res) => {
  try {
    const forms = await db.select().from(formsTable).orderBy(formsTable.name);
    const enriched = await Promise.all(
      forms.map(async (f) => {
        const [{ cnt }] = await db
          .select({ cnt: count() })
          .from(formSubmissionsTable)
          .where(eq(formSubmissionsTable.formId, f.id));
        return {
          ...f,
          submissionCount: Number(cnt),
          createdAt: f.createdAt.toISOString(),
        };
      }),
    );
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to list forms" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, fields } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "name required" });
    const [form] = await db
      .insert(formsTable)
      .values({ name, fields: fields ?? "[]" })
      .returning();
    res.status(201).json({
      ...form,
      submissionCount: 0,
      createdAt: form.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to create form" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [form] = await db.select().from(formsTable).where(eq(formsTable.id, id));
    if (!form) return res.status(404).json({ error: "Not found" });
    const [{ cnt }] = await db
      .select({ cnt: count() })
      .from(formSubmissionsTable)
      .where(eq(formSubmissionsTable.formId, form.id));
    res.json({
      ...form,
      submissionCount: Number(cnt),
      createdAt: form.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to get form" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updates: Record<string, unknown> = {};
    for (const k of ["name", "fields"]) if (req.body?.[k] !== undefined) updates[k] = req.body[k];
    const [form] = await db
      .update(formsTable)
      .set(updates as any)
      .where(eq(formsTable.id, id))
      .returning();
    if (!form) return res.status(404).json({ error: "Not found" });
    const [{ cnt }] = await db
      .select({ cnt: count() })
      .from(formSubmissionsTable)
      .where(eq(formSubmissionsTable.formId, form.id));
    res.json({
      ...form,
      submissionCount: Number(cnt),
      createdAt: form.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to update form" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(formSubmissionsTable).where(eq(formSubmissionsTable.formId, id));
    const [form] = await db.delete(formsTable).where(eq(formsTable.id, id)).returning();
    if (!form) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to delete form" });
  }
});

/** Record a form submission (admin or public client) */
router.post("/:id/submissions", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [form] = await db.select().from(formsTable).where(eq(formsTable.id, id));
    if (!form) return res.status(404).json({ error: "Form not found" });
    const data =
      typeof req.body?.data === "string"
        ? req.body.data
        : JSON.stringify(req.body?.data ?? req.body ?? {});
    const [sub] = await db
      .insert(formSubmissionsTable)
      .values({ formId: id, data })
      .returning();
    dispatchWebhook("form.submitted", { formId: id, formName: form.name, submissionId: sub.id, data: safeParse(data) });
    res.status(201).json({
      ...sub,
      createdAt: sub.createdAt.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to save submission" });
  }
});

router.get("/:id/submissions", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const subs = await db
      .select()
      .from(formSubmissionsTable)
      .where(eq(formSubmissionsTable.formId, id))
      .orderBy(desc(formSubmissionsTable.createdAt));
    res.json(subs.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to list submissions" });
  }
});

router.delete("/:id/submissions/:submissionId", async (req, res) => {
  try {
    const submissionId = parseInt(req.params.submissionId, 10);
    const [row] = await db.delete(formSubmissionsTable).where(eq(formSubmissionsTable.id, submissionId)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to delete submission" });
  }
});

export default router;
