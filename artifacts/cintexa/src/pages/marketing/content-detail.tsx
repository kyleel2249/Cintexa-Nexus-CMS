import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { marketingApi } from "@/lib/marketing/api";
import { ArrowLeft } from "lucide-react";
import { useState, useEffect } from "react";

export default function ContentDetail() {
  const [, params] = useRoute("/marketing/content/:id");
  const id = params?.id;
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("DRAFT");

  const { data, isLoading, error } = useQuery({
    queryKey: ["marketing", "content", id],
    enabled: !!id,
    queryFn: () => marketingApi.getContent(Number(id)),
  });

  useEffect(() => {
    if (data) {
      setTitle(data.title || "");
      setBody(data.body || "");
      setStatus(data.status || "DRAFT");
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => marketingApi.updateContent(Number(id), { title, body, status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing", "content"] }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (error || !data) return <div className="p-6 text-sm text-destructive">Content not found.</div>;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/marketing/content"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">{data.title}</h1>
          <div className="flex gap-2 mt-1">
            <Badge variant="outline">{data.type}</Badge>
            <Badge variant="secondary">{data.status}</Badge>
            <span className="text-xs text-muted-foreground">v{data.version || 1}</span>
          </div>
        </div>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Edit</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Status</Label>
            <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              {["DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "ARCHIVED"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Body</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="font-mono text-sm" />
          </div>
          <p className="text-xs text-muted-foreground">
            Export or copy for external channels. Publishing to social/email is manual confirmation only — no external APIs.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
