import { Router } from "express";
import { db, formsTable, formSubmissionsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";

const router = Router();

router.get("/", async (_req, res) => {
  const forms = await db.select().from(formsTable).orderBy(formsTable.name);
  const enriched = await Promise.all(
    forms.map(async (f) => {
      const [{ cnt }] = await db.select({ cnt: count() }).from(formSubmissionsTable).where(eq(formSubmissionsTable.formId, f.id));
      return { ...f, submissionCount: Number(cnt), createdAt: f.createdAt.toISOString() };
    })
  );
  res.json(enriched);
});

router.post("/", async (req, res) => {
  const { name, fields } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const [form] = await db.insert(formsTable).values({ name, fields: fields ?? "[]" }).returning();
  res.status(201).json({ ...form, submissionCount: 0, createdAt: form.createdAt.toISOString() });
});

router.patch("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const updates: Record<string, unknown> = {};
  for (const k of ["name", "fields"]) if (req.body[k] !== undefined) updates[k] = req.body[k];
  const [form] = await db.update(formsTable).set(updates as any).where(eq(formsTable.id, id)).returning();
  if (!form) return res.status(404).json({ error: "Not found" });
  const [{ cnt }] = await db.select({ cnt: count() }).from(formSubmissionsTable).where(eq(formSubmissionsTable.formId, form.id));
  res.json({ ...form, submissionCount: Number(cnt), createdAt: form.createdAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [form] = await db.delete(formsTable).where(eq(formsTable.id, id)).returning();
  if (!form) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

router.get("/:id/submissions", async (req, res) => {
  const id = parseInt(req.params.id);
  const subs = await db.select().from(formSubmissionsTable).where(eq(formSubmissionsTable.formId, id)).orderBy(formSubmissionsTable.createdAt);
  res.json(subs.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })));
});

export default router;
