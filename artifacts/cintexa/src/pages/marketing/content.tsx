import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { apiJson } from "@/lib/api";

const TYPES = ["blog", "website", "landing", "social", "video_script", "ad_copy", "email", "newsletter", "press", "product", "case_study", "seo"];
const STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"];

type ContentItem = {
  id: number;
  title: string;
  type: string;
  status: string;
  channel?: string;
  updated_at?: string;
  campaign_id?: number;
};

export default function ContentStudio() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("blog");
  const [body, setBody] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["marketing", "content", typeFilter, statusFilter],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (typeFilter !== "all") q.set("type", typeFilter);
      if (statusFilter !== "all") q.set("status", statusFilter);
      const qs = q.toString() ? `?${q}` : "";
      return apiJson<{ items: ContentItem[]; total: number }>(`/marketing/content${qs}`);
    },
  });

  const create = useMutation({
    mutationFn: () =>
      apiJson("/marketing/content", {
        method: "POST",
        body: JSON.stringify({ title, type, body, status: "DRAFT" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketing", "content"] });
      setOpen(false);
      setTitle("");
      setBody("");
    },
  });

  const items = data?.items || [];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content Studio</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Central content creation for campaigns, web, social and email. Connected to Nexus CMS — no second CMS.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New content</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create content</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Article or post title" />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Body</Label>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Write or paste content…" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? "Creating…" : "Create draft"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto self-center">{data?.total ?? 0} items</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>}
                {!isLoading && items.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No content yet. Create your first draft.</td></tr>
                )}
                {items.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link href={`/marketing/content/${c.id}`} className="font-medium hover:underline">{c.title}</Link>
                    </td>
                    <td className="px-4 py-3"><Badge variant="outline">{c.type}</Badge></td>
                    <td className="px-4 py-3"><Badge variant="secondary">{c.status}</Badge></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.updated_at ? new Date(c.updated_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
