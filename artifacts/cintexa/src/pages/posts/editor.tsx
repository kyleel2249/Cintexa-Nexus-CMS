import { useState, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetPost, useCreatePost, useUpdatePost, useSchedulePost, useUnschedulePost } from "@workspace/api-client-react";
import { SchedulePanel } from "@/components/schedule-panel";
import { ScheduleHistoryPanel } from "@/components/schedule-history-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft, Save, Globe, Image as ImageIcon, History,
  Link2, Plus, Trash2, CheckCircle2, XCircle, Loader2,
  Sparkles, Star, Share2, RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Citation {
  url: string;
  label: string;
  claimText: string;
  valid?: boolean | null;
}

interface PostImage {
  id: number;
  url: string;
  altText: string | null;
  prompt: string | null;
  isPrimary: boolean;
  isThumbnail: boolean;
  createdAt: string;
}

interface Broadcast {
  id: number;
  platform: string;
  status: string;
  externalId: string | null;
  error: string | null;
  sentAt: string | null;
}

function SeoScore({ title, metaTitle, metaDescription, keywords, citations }: {
  title: string; metaTitle: string; metaDescription: string; keywords: string; citations: Citation[];
}) {
  const scores: Array<{ label: string; score: number; max: number; hint: string }> = [
    {
      label: "Meta Title",
      score: metaTitle.length >= 30 && metaTitle.length <= 60 ? 2 : metaTitle.length > 0 ? 1 : 0,
      max: 2,
      hint: `${metaTitle.length}/60 chars`,
    },
    {
      label: "Meta Description",
      score: metaDescription.length >= 100 && metaDescription.length <= 155 ? 2 : metaDescription.length > 0 ? 1 : 0,
      max: 2,
      hint: `${metaDescription.length}/155 chars`,
    },
    {
      label: "Keywords",
      score: keywords.split(",").filter((k) => k.trim()).length >= 3 ? 2 : keywords.length > 0 ? 1 : 0,
      max: 2,
      hint: `${keywords.split(",").filter((k) => k.trim()).length} keyword(s)`,
    },
    {
      label: "Citations",
      score: citations.length >= 3 ? 3 : citations.length > 0 ? Math.min(citations.length, 2) : 0,
      max: 3,
      hint: `${citations.length}/3+ required`,
    },
    {
      label: "Title Length",
      score: title.length >= 40 && title.length <= 70 ? 1 : title.length > 0 ? 0 : 0,
      max: 1,
      hint: `${title.length} chars`,
    },
  ];

  const total = scores.reduce((a, s) => a + s.score, 0);
  const maxTotal = scores.reduce((a, s) => a + s.max, 0);
  const pct = Math.round((total / maxTotal) * 100);

  const color = pct >= 80 ? "text-green-400" : pct >= 50 ? "text-yellow-400" : "text-red-400";
  const barColor = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">SEO Score</span>
        <span className={`text-lg font-bold ${color}`}>{pct}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="space-y-1.5">
        {scores.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              {s.score === s.max
                ? <CheckCircle2 className="w-3 h-3 text-green-400" />
                : s.score > 0
                  ? <CheckCircle2 className="w-3 h-3 text-yellow-400" />
                  : <XCircle className="w-3 h-3 text-muted-foreground" />}
              {s.label}
            </span>
            <span className="text-muted-foreground">{s.hint}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PostEditor() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNew = !id || id === "new";

  const { data: post, isLoading } = useGetPost(Number(id), {
    query: { enabled: !isNew && !!id },
  });

  const createMutation = useCreatePost();
  const updateMutation = useUpdatePost();
  const scheduleMutation = useSchedulePost();
  const unscheduleMutation = useUnschedulePost();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    title: "",
    slug: "",
    excerpt: "",
    content: "",
    metaTitle: "",
    metaDescription: "",
    keywords: "",
  });
  const [citations, setCitations] = useState<Citation[]>([]);
  const [newCitation, setNewCitation] = useState({ url: "", label: "", claimText: "" });
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Images
  const { data: images = [], refetch: refetchImages } = useQuery<PostImage[]>({
    queryKey: [`/api/posts/${id}/images`],
    queryFn: async () => {
      const res = await fetch(`/api/posts/${id}/images`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !isNew && !!id,
  });

  const [generatingImages, setGeneratingImages] = useState(false);

  // Broadcasts
  const { data: broadcasts = [], refetch: refetchBroadcasts } = useQuery<Broadcast[]>({
    queryKey: [`/api/posts/${id}/broadcasts`],
    queryFn: async () => {
      const res = await fetch(`/api/posts/${id}/broadcasts`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !isNew && !!id,
  });

  useEffect(() => {
    if (post && !isNew) {
      setFormData({
        title: post.title || "",
        slug: post.slug || "",
        excerpt: post.excerpt || "",
        content: post.content || "",
        metaTitle: post.metaTitle || "",
        metaDescription: post.metaDescription || "",
        keywords: (post as any).keywords || "",
      });
      const rawCitations = (post as any).citationLinks;
      if (Array.isArray(rawCitations)) setCitations(rawCitations);
    }
  }, [post, isNew]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const title = e.target.value;
    setFormData((prev) => ({
      ...prev,
      title,
      slug: isNew ? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "") : prev.slug,
    }));
  };

  const handleSave = async (status: string = "Draft") => {
    try {
      const payload = { ...formData, citationLinks: citations, keywords: formData.keywords };
      if (isNew) {
        const created = await createMutation.mutateAsync({ data: payload });
        toast({ title: "Post created successfully" });
        setLocation(`/posts/${(created as any).id}/edit`);
      } else {
        await updateMutation.mutateAsync({ id: Number(id), data: { ...payload, status } });
        toast({ title: "Post saved successfully" });
        queryClient.invalidateQueries({ queryKey: [`/api/posts/${id}`] });
      }
    } catch {
      toast({ title: "Error saving post", variant: "destructive" });
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      // Save latest first
      await updateMutation.mutateAsync({ id: Number(id), data: { ...formData, citationLinks: citations, keywords: formData.keywords } });

      const res = await fetch(`/api/posts/${id}/publish`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        toast({ title: err.error ?? "Publish failed", variant: "destructive" });
        return;
      }
      toast({ title: "Post published! Images and alerts are being processed." });
      queryClient.invalidateQueries({ queryKey: [`/api/posts/${id}`] });
      // Refresh images and broadcasts after a short delay
      setTimeout(() => { refetchImages(); refetchBroadcasts(); }, 3000);
    } catch {
      toast({ title: "Publish failed", variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  };

  const validateCitations = async () => {
    if (citations.length === 0) return;
    setValidating(true);
    try {
      const res = await fetch(`/api/posts/${id ?? "0"}/validate-citations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ citations }),
      });
      const data = await res.json();
      const resultMap = new Map(data.results.map((r: any) => [r.url, r.valid]));
      setCitations((prev) => prev.map((c) => ({ ...c, valid: resultMap.get(c.url) as boolean ?? false })));
      toast({ title: `${data.validCount} of ${citations.length} citations are valid` });
    } catch {
      toast({ title: "Validation failed", variant: "destructive" });
    } finally {
      setValidating(false);
    }
  };

  const addCitation = () => {
    if (!newCitation.url || !newCitation.label) return;
    setCitations((prev) => [...prev, { ...newCitation, valid: null }]);
    setNewCitation({ url: "", label: "", claimText: "" });
  };

  const removeCitation = (i: number) => {
    setCitations((prev) => prev.filter((_, idx) => idx !== i));
  };

  const generateImages = async () => {
    if (!id) return;
    setGeneratingImages(true);
    try {
      await fetch(`/api/posts/${id}/images/generate`, { method: "POST" });
      toast({ title: "Generating 4 images... check back in ~30 seconds" });
      setTimeout(() => { refetchImages(); setGeneratingImages(false); }, 30000);
    } catch {
      toast({ title: "Image generation failed", variant: "destructive" });
      setGeneratingImages(false);
    }
  };

  const setImageRole = async (imgId: number, role: "isPrimary" | "isThumbnail") => {
    await fetch(`/api/posts/${id}/images/${imgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [role]: true }),
    });
    refetchImages();
  };

  const broadcastNow = async () => {
    await fetch(`/api/posts/${id}/broadcasts`, { method: "POST" });
    toast({ title: "Broadcasting to social platforms..." });
    setTimeout(() => refetchBroadcasts(), 5000);
  };

  if (isLoading && !isNew) {
    return <div className="p-8 text-center">Loading editor...</div>;
  }

  const citationCount = citations.length;
  const citationColor = citationCount >= 3 ? "text-green-400" : citationCount > 0 ? "text-yellow-400" : "text-muted-foreground";

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-24">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/posts")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-bold">{isNew ? "Create Post" : "Edit Post"}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => handleSave("draft")} disabled={createMutation.isPending || updateMutation.isPending}>
            <Save className="mr-2 h-4 w-4" /> Save Draft
          </Button>
          {!isNew && (
            <Button onClick={handlePublish} disabled={publishing}>
              {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
              Publish
              {citationCount > 0 && (
                <Badge variant="secondary" className={`ml-2 text-[10px] py-0 h-4 ${citationColor}`}>
                  {citationCount} citations
                </Badge>
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ── Main content column ── */}
        <div className="col-span-2 space-y-6">
          <div className="space-y-2">
            <Input
              placeholder="Post Title"
              className="text-4xl font-bold h-16 bg-transparent border-none px-0 shadow-none focus-visible:ring-0 placeholder:text-muted"
              value={formData.title}
              onChange={handleTitleChange}
            />
            <div className="flex items-center gap-2 text-muted-foreground text-sm pl-1">
              <span>/</span>
              <Input
                value={formData.slug}
                onChange={(e) => setFormData((prev) => ({ ...prev, slug: e.target.value }))}
                className="h-6 w-full max-w-[300px] p-0 bg-transparent border-none focus-visible:ring-0 shadow-none"
                placeholder="post-slug"
              />
            </div>
          </div>

          <div className="space-y-2 pt-4 border-t border-border/50">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Excerpt</Label>
            <Textarea
              className="min-h-[80px] bg-card text-sm resize-none"
              placeholder="Brief summary for list views and email alerts..."
              value={formData.excerpt}
              onChange={(e) => setFormData((prev) => ({ ...prev, excerpt: e.target.value }))}
            />
          </div>

          <div className="space-y-2 pt-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Content</Label>
            <Textarea
              className="min-h-[500px] font-mono text-sm leading-relaxed p-4 bg-card"
              placeholder="Write your article here. Every factual claim should be backed by a citation — add them in the Citations panel on the right."
              value={formData.content}
              onChange={(e) => setFormData((prev) => ({ ...prev, content: e.target.value }))}
            />
          </div>

          {/* ── Citations panel ── */}
          <div className="rounded-xl border border-border/50 bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Citations</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] py-0 h-4 ${citationCount >= 3 ? "border-green-500/40 text-green-400" : citationCount > 0 ? "border-yellow-500/40 text-yellow-400" : "border-border text-muted-foreground"}`}
                >
                  {citationCount}/3 required
                </Badge>
              </div>
              {citations.length > 0 && !isNew && (
                <Button variant="outline" size="sm" onClick={validateCitations} disabled={validating}>
                  {validating ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                  Validate
                </Button>
              )}
            </div>

            {citations.length > 0 && (
              <div className="space-y-2">
                {citations.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-secondary/40 group">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        {c.valid === true && <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                        {c.valid === false && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        {c.valid === null || c.valid === undefined ? <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : null}
                        <span className="text-sm font-medium truncate">{c.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{c.url}</p>
                      {c.claimText && <p className="text-xs text-muted-foreground italic truncate">"{c.claimText}"</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                      onClick={() => removeCitation(i)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 pt-1 border-t border-border/40">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="https://source.com/article"
                  value={newCitation.url}
                  onChange={(e) => setNewCitation((p) => ({ ...p, url: e.target.value }))}
                  className="text-xs h-8"
                />
                <Input
                  placeholder="Citation label"
                  value={newCitation.label}
                  onChange={(e) => setNewCitation((p) => ({ ...p, label: e.target.value }))}
                  className="text-xs h-8"
                />
              </div>
              <Input
                placeholder='Claim text: "According to..."'
                value={newCitation.claimText}
                onChange={(e) => setNewCitation((p) => ({ ...p, claimText: e.target.value }))}
                className="text-xs h-8"
              />
              <Button variant="outline" size="sm" onClick={addCitation} disabled={!newCitation.url || !newCitation.label} className="w-full">
                <Plus className="w-3 h-3 mr-1" /> Add Citation
              </Button>
            </div>
          </div>

          {/* ── AI Images panel ── */}
          {!isNew && (
            <div className="rounded-xl border border-border/50 bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">AI-Generated Images</span>
                  {images.length > 0 && (
                    <Badge variant="outline" className="text-[10px] py-0 h-4 border-primary/40 text-primary">
                      {images.length} image{images.length !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={generateImages} disabled={generatingImages}>
                  {generatingImages ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                  {images.length > 0 ? "Regenerate" : "Generate"}
                </Button>
              </div>

              {images.length === 0 ? (
                <div className="border-2 border-dashed border-border/50 rounded-lg p-8 text-center">
                  <ImageIcon className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Click Generate to create 3 article images + thumbnail with DALL-E</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {images.map((img) => (
                    <div key={img.id} className="relative group rounded-lg overflow-hidden border border-border/50">
                      <img src={img.url} alt={img.altText ?? "Generated"} className="w-full h-36 object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button
                          size="sm"
                          variant={img.isPrimary ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() => setImageRole(img.id, "isPrimary")}
                        >
                          <Star className="w-3 h-3 mr-1" /> Primary
                        </Button>
                        <Button
                          size="sm"
                          variant={img.isThumbnail ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() => setImageRole(img.id, "isThumbnail")}
                        >
                          Thumbnail
                        </Button>
                      </div>
                      <div className="absolute top-1.5 left-1.5 flex gap-1">
                        {img.isPrimary && <Badge className="text-[9px] py-0 h-4 bg-primary">Primary</Badge>}
                        {img.isThumbnail && <Badge className="text-[9px] py-0 h-4 bg-indigo-600">Thumb</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}
        <div className="space-y-6">
          <Card className="bg-card border-border/50">
            <CardHeader className="py-4">
              <CardTitle className="text-sm font-medium">Publishing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  post?.status === "published" ? "bg-green-500/15 text-green-400"
                  : post?.status === "scheduled" ? "bg-violet-500/15 text-violet-400"
                  : "bg-yellow-500/15 text-yellow-400"
                }`}>
                  {post?.status || "Draft"}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Reading Time</span>
                <span className="font-medium">{post?.readingTime || 0} min</span>
              </div>

              {!isNew && id && (
                <SchedulePanel
                  entityId={Number(id)}
                  currentScheduledAt={post?.scheduledAt}
                  onSchedule={async (entityId, scheduledAt) => {
                    await scheduleMutation.mutateAsync({ id: entityId, data: { scheduledAt } });
                  }}
                  onUnschedule={async (entityId) => {
                    await unscheduleMutation.mutateAsync({ id: entityId });
                  }}
                  onSuccess={() => queryClient.invalidateQueries({ queryKey: [`/api/posts/${id}`] })}
                />
              )}
            </CardContent>
          </Card>

          {/* SEO Score */}
          <Card className="bg-card border-border/50">
            <CardHeader className="py-4">
              <CardTitle className="text-sm font-medium">SEO Score</CardTitle>
            </CardHeader>
            <CardContent>
              <SeoScore
                title={formData.title}
                metaTitle={formData.metaTitle}
                metaDescription={formData.metaDescription}
                keywords={formData.keywords}
                citations={citations}
              />
            </CardContent>
          </Card>

          <Accordion type="multiple" defaultValue={["seo"]} className="w-full space-y-2">
            <AccordionItem value="seo" className="border border-border/50 rounded-xl px-1">
              <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">SEO Meta</AccordionTrigger>
              <AccordionContent className="space-y-4 px-3 pb-4">
                <div className="space-y-2">
                  <Label className="text-xs">Meta Title <span className={formData.metaTitle.length > 60 ? "text-red-400" : "text-muted-foreground"}>({formData.metaTitle.length}/60)</span></Label>
                  <Input
                    value={formData.metaTitle}
                    onChange={(e) => setFormData((prev) => ({ ...prev, metaTitle: e.target.value }))}
                    placeholder="Search engine title"
                    className="h-8"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Meta Description <span className={formData.metaDescription.length > 155 ? "text-red-400" : "text-muted-foreground"}>({formData.metaDescription.length}/155)</span></Label>
                  <Textarea
                    value={formData.metaDescription}
                    onChange={(e) => setFormData((prev) => ({ ...prev, metaDescription: e.target.value }))}
                    placeholder="Search engine description"
                    className="min-h-[80px] text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Keywords (comma-separated)</Label>
                  <Input
                    value={formData.keywords}
                    onChange={(e) => setFormData((prev) => ({ ...prev, keywords: e.target.value }))}
                    placeholder="seo, content, marketing"
                    className="h-8"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Social Broadcasts */}
            {!isNew && id && broadcasts.length > 0 && (
              <AccordionItem value="broadcasts" className="border border-border/50 rounded-xl px-1">
                <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">
                  <span className="flex items-center gap-1.5">
                    <Share2 className="h-3 w-3" />
                    Social Broadcasts
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-3 pb-4 space-y-2">
                  {broadcasts.map((b) => (
                    <div key={b.id} className="flex items-center justify-between text-xs">
                      <span className="capitalize text-muted-foreground">{b.platform}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] py-0 h-4 ${
                          b.status === "sent" ? "border-green-500/40 text-green-400"
                          : b.status === "failed" ? "border-red-500/40 text-red-400"
                          : "border-border text-muted-foreground"
                        }`}
                      >
                        {b.status}
                      </Badge>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="w-full mt-2" onClick={broadcastNow}>
                    <Share2 className="w-3 h-3 mr-1" /> Broadcast Again
                  </Button>
                </AccordionContent>
              </AccordionItem>
            )}

            {!isNew && id && (
              <AccordionItem value="schedule-history" className="border border-border/50 rounded-xl px-1 overflow-hidden">
                <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">
                  <span className="flex items-center gap-1.5">
                    <History className="h-3 w-3" />
                    Schedule History
                  </span>
                </AccordionTrigger>
                <AccordionContent className="p-0">
                  <ScheduleHistoryPanel entityId={Number(id)} type="post" />
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </div>
      </div>
    </div>
  );
}
