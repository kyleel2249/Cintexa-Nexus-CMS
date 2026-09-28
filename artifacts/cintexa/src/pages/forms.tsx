import { useMemo, useState } from "react";
import { useGetForms, useCreateForm, useUpdateForm, useDeleteForm, useGetFormSubmissions, getGetFormsQueryKey, getGetFormSubmissionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, FormInput, Inbox, Loader2, Eye, Pencil, Trash2, Code2, Copy, Download } from "lucide-react";
import { API_BASE, apiJson } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_FIELDS = JSON.stringify(
  [
    { id: "name", label: "Name", type: "text", required: true },
    { id: "email", label: "Email", type: "email", required: true },
    { id: "message", label: "Message", type: "textarea", required: false },
  ],
  null,
  2,
);

export default function Forms() {
  const { data: formsData, isLoading, refetch } = useGetForms();
  const forms = useMemo(() => (Array.isArray(formsData) ? formsData : []), [formsData]);
  const create = useCreateForm();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [viewId, setViewId] = useState<number | null>(null);
  const { data: submissions, isLoading: loadingSubs, refetch: refetchSubs } = useGetFormSubmissions(viewId ?? 0, {
    query: { queryKey: getGetFormSubmissionsQueryKey(viewId ?? 0), enabled: Boolean(viewId && viewId > 0) },
  });
  const update = useUpdateForm();
  const remove = useDeleteForm();
  const [editing, setEditing] = useState<any | null>(null);
  const [embedFor, setEmbedFor] = useState<any | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);

  const publicOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const endpointFor = (id: number) => `${API_BASE.startsWith("http") ? API_BASE : publicOrigin + API_BASE}/public/forms/${id}/submissions`;

  function openNew() {
    setEditing(null);
    setName("");
    setFields(DEFAULT_FIELDS);
    setOpen(true);
  }

  function openEdit(form: any) {
    let pretty = form.fields;
    try {
      pretty = JSON.stringify(JSON.parse(form.fields || "[]"), null, 2);
    } catch { /* keep raw */ }
    setEditing(form);
    setName(form.name);
    setFields(pretty);
    setOpen(true);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await remove.mutateAsync({ id: confirmDelete.id });
      await qc.invalidateQueries({ queryKey: getGetFormsQueryKey() });
      toast({ title: "Form deleted", description: confirmDelete.name });
      setConfirmDelete(null);
      void refetch();
    } catch (err: any) {
      toast({ title: err?.message || "Could not delete form", variant: "destructive" });
    }
  }

  async function deleteSubmission(id: number) {
    if (!viewId) return;
    try {
      await apiJson(`/forms/${viewId}/submissions/${id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: getGetFormSubmissionsQueryKey(viewId) });
      void refetchSubs();
      void refetch();
    } catch (err: any) {
      toast({ title: err?.message || "Could not delete submission", variant: "destructive" });
    }
  }

  function exportCsv() {
    const rows = (Array.isArray(submissions) ? submissions : []).map((s: any) => {
      let d: any = {};
      try { d = typeof s.data === "string" ? JSON.parse(s.data) : s.data; } catch { d = { data: s.data }; }
      return { submittedAt: s.createdAt, ...d };
    });
    if (!rows.length) return;
    const cols = Array.from(new Set(rows.flatMap((r: any) => Object.keys(r))));
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...rows.map((r: any) => cols.map((c) => esc(r[c as string])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `form-${viewId}-submissions.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function embedSnippet(form: any) {
    let fieldsArr: any[] = [];
    try { fieldsArr = JSON.parse(form.fields || "[]"); } catch { fieldsArr = []; }
    const inputs = fieldsArr.map((f) => {
      const req = f.required ? " required" : "";
      const label = `<label>${f.label}<br>`;
      if (f.type === "textarea") return `  ${label}<textarea name="${f.id}"${req}></textarea></label>`;
      return `  ${label}<input type="${f.type || "text"}" name="${f.id}"${req}></label>`;
    }).join("\n");
    return `<form id="cintexa-form-${form.id}">\n${inputs}\n  <input type="text" name="_hp" style="display:none" tabindex="-1" autocomplete="off">\n  <button type="submit">Send</button>\n</form>\n<script>\ndocument.getElementById("cintexa-form-${form.id}").addEventListener("submit", async (e) => {\n  e.preventDefault();\n  const data = Object.fromEntries(new FormData(e.target));\n  const r = await fetch("${endpointFor(form.id)}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });\n  alert(r.ok ? "Thank you!" : "Could not send, please try again.");\n  if (r.ok) e.target.reset();\n});\n</script>`;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!Array.isArray(JSON.parse(fields))) throw new Error("not an array");
    } catch {
      toast({ title: "Fields must be a valid JSON array", variant: "destructive" });
      return;
    }
    if (!name.trim()) return;
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: { name: name.trim(), fields } });
      } else {
        await create.mutateAsync({ data: { name: name.trim(), fields } });
      }
      await qc.invalidateQueries({ queryKey: getGetFormsQueryKey() });
      toast({ title: editing ? "Form updated" : "Form created" });
      setEditing(null);
      setOpen(false);
      setName("");
      setFields(DEFAULT_FIELDS);
      void refetch();
    } catch (err: any) {
      toast({ title: err?.message || "Could not create form", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Forms</h2>
          <p className="text-muted-foreground mt-1">Manage data collection and form submissions.</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          Create Form
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array(3).fill(0).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
              </CardHeader>
            </Card>
          ))
        ) : forms?.length ? (
          forms.map((form) => {
            let fieldCount = 0;
            try {
              fieldCount = JSON.parse(form.fields || "[]").length;
            } catch {
              fieldCount = 0;
            }
            return (
              <Card key={form.id} className="border-border/50 bg-card hover:border-primary/50 transition-colors">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2">
                        <FormInput className="h-4 w-4 text-primary" />
                        {form.name}
                      </CardTitle>
                      <CardDescription>{fieldCount} fields</CardDescription>
                    </div>
                    <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                      <Inbox className="h-3 w-3 mr-1" />
                      {form.submissionCount}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-border/50">
                    <span>Created {format(new Date(form.createdAt), "MMM d, yyyy")}</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEdit(form)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Embed code" onClick={() => setEmbedFor(form)}><Code2 className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete" onClick={() => setConfirmDelete(form)}><Trash2 className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => setViewId(form.id)}>
                        <Eye className="h-4 w-4 mr-1" />
                        Submissions
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-border rounded-lg">
            <FormInput className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium">No forms created</h3>
            <p className="text-muted-foreground mb-4">Create your first form to start collecting data.</p>
            <Button onClick={openNew}>Create Form</Button>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit form" : "Create form"}</DialogTitle>
            <DialogDescription>Define fields as JSON. Submissions are stored per form.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Fields (JSON)</Label>
              <textarea
                className="w-full min-h-[140px] rounded-md border bg-background px-3 py-2 text-sm font-mono"
                value={fields}
                onChange={(e) => setFields(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || update.isPending}>
                {(create.isPending || update.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editing ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={viewId != null} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Submissions</DialogTitle>
            <DialogDescription>Responses collected for this form.</DialogDescription>
          </DialogHeader>
          {Array.isArray(submissions) && submissions.length > 0 && (
            <Button size="sm" variant="outline" className="w-fit" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
          )}
          {loadingSubs ? (
            <Skeleton className="h-24 w-full" />
          ) : submissions?.length ? (
            <ul className="space-y-3">
              {(Array.isArray(submissions) ? submissions : []).map((s: any) => (
                <li key={s.id} className="border rounded-lg p-3 text-sm">
                  <div className="text-xs text-muted-foreground mb-1 flex justify-between">
                    <span>{format(new Date(s.createdAt), "PPp")}</span>
                    <button className="text-destructive hover:underline" onClick={() => void deleteSubmission(s.id)}>Delete</button>
                  </div>
                  <pre className="text-xs overflow-auto whitespace-pre-wrap">{typeof s.data === "string" ? s.data : JSON.stringify(s.data, null, 2)}</pre>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">No submissions yet.</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!embedFor} onOpenChange={(o) => !o && setEmbedFor(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Embed “{embedFor?.name}” on any website</DialogTitle>
            <DialogDescription>Paste this snippet into your site. Submissions arrive here and trigger the form.submitted webhook.</DialogDescription>
          </DialogHeader>
          {embedFor && (
            <>
              <pre className="text-xs bg-muted/40 p-3 rounded-md overflow-auto max-h-72 whitespace-pre-wrap">{embedSnippet(embedFor)}</pre>
              <div className="flex gap-2">
                <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(embedSnippet(embedFor)).catch(() => undefined); toast({ title: "Embed code copied" }); }}>
                  <Copy className="h-4 w-4 mr-1" /> Copy code
                </Button>
                <code className="text-[11px] self-center break-all text-muted-foreground">POST {endpointFor(embedFor.id)}</code>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription>The form and its {confirmDelete?.submissionCount ?? 0} submission(s) will be removed permanently.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={remove.isPending}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
