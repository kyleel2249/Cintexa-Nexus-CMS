import { useState, useEffect, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useGetPage, useCreatePage, useUpdatePage } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Save, Globe, Image as ImageIcon, Layers, Code2, MonitorPlay } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PageBuilder, blocksToHtml, htmlToBlocks } from "@/components/page-builder";
import { Block } from "@/components/page-builder/types";
import { AnimatePresence } from "framer-motion";
import { SitePreview } from "@/components/site-preview";

type EditorMode = "visual" | "html";

export default function PageEditor() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNew = !id || id === "new";
  const [previewOpen, setPreviewOpen] = useState(false);

  const { data: page, isLoading } = useGetPage(Number(id), {
    query: { enabled: !isNew && !!id },
  });

  const createMutation = useCreatePage();
  const updateMutation = useUpdatePage();

  const [editorMode, setEditorMode] = useState<EditorMode>("visual");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [formData, setFormData] = useState({
    title: "",
    slug: "",
    content: "",
    metaTitle: "",
    metaDescription: "",
    template: "default",
  });

  useEffect(() => {
    if (page && !isNew) {
      const parsed = htmlToBlocks(page.content ?? "");
      setBlocks(parsed);
      setFormData({
        title: page.title || "",
        slug: page.slug || "",
        content: page.content || "",
        metaTitle: page.metaTitle || "",
        metaDescription: page.metaDescription || "",
        template: page.template || "default",
      });
    }
  }, [page, isNew]);

  const handleBlocksChange = useCallback((updated: Block[]) => {
    setBlocks(updated);
    setFormData(prev => ({ ...prev, content: JSON.stringify(updated) }));
  }, []);

  const handleHtmlChange = (html: string) => {
    setFormData(prev => ({ ...prev, content: html }));
  };

  const switchMode = (mode: EditorMode) => {
    if (mode === "html" && editorMode === "visual") {
      setFormData(prev => ({ ...prev, content: JSON.stringify(blocks, null, 2) }));
    }
    if (mode === "visual" && editorMode === "html") {
      const parsed = htmlToBlocks(formData.content);
      setBlocks(parsed);
    }
    setEditorMode(mode);
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const title = e.target.value;
    setFormData(prev => ({
      ...prev,
      title,
      slug: isNew
        ? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "")
        : prev.slug,
    }));
  };

  const handleSave = async (status: string = "Draft") => {
    try {
      const payload = { ...formData };
      if (isNew) {
        await createMutation.mutateAsync({ data: payload });
        toast({ title: "Page created successfully" });
        setLocation("/pages");
      } else {
        await updateMutation.mutateAsync({ id: Number(id), data: { ...payload, status } });
        toast({ title: "Page updated successfully" });
      }
    } catch {
      toast({ title: "Error saving page", variant: "destructive" });
    }
  };

  if (isLoading && !isNew) {
    return <div className="p-8 text-center text-muted-foreground">Loading editor...</div>;
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-24">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/pages")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-bold">{isNew ? "Create Page" : "Edit Page"}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setPreviewOpen(true)}>
            <MonitorPlay className="mr-2 h-4 w-4" /> Preview Site
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSave("Draft")}
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            <Save className="mr-2 h-4 w-4" /> Save Draft
          </Button>
          <Button
            onClick={() => handleSave("Published")}
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            <Globe className="mr-2 h-4 w-4" /> Publish
          </Button>
        </div>
      </div>

      {/* Title + Slug */}
      <div className="space-y-1.5">
        <Input
          placeholder="Page Title"
          className="text-3xl font-bold h-14 bg-transparent border-none px-0 shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/40"
          value={formData.title}
          onChange={handleTitleChange}
        />
        <div className="flex items-center gap-1.5 text-muted-foreground text-sm pl-0.5">
          <span className="text-muted-foreground/60">/</span>
          <Input
            value={formData.slug}
            onChange={e => setFormData(prev => ({ ...prev, slug: e.target.value }))}
            className="h-6 w-full max-w-[280px] p-0 bg-transparent border-none focus-visible:ring-0 shadow-none text-indigo-400 font-mono text-sm"
            placeholder="page-slug"
          />
        </div>
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 items-start">
        {/* Editor */}
        <div className="space-y-3">
          {/* Mode switcher */}
          <div className="flex items-center justify-between">
            <Tabs value={editorMode} onValueChange={v => switchMode(v as EditorMode)}>
              <TabsList className="h-8 bg-secondary/60">
                <TabsTrigger value="visual" className="h-6 text-xs gap-1.5">
                  <Layers className="h-3 w-3" /> Visual Builder
                </TabsTrigger>
                <TabsTrigger value="html" className="h-6 text-xs gap-1.5">
                  <Code2 className="h-3 w-3" /> Raw / HTML
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <span className="text-xs text-muted-foreground">
              {editorMode === "visual"
                ? "Drag blocks to reorder • Click to edit • AI generates content"
                : "Edit raw content directly"}
            </span>
          </div>

          {editorMode === "visual" ? (
            <PageBuilder initialBlocks={blocks} onChange={handleBlocksChange} />
          ) : (
            <Textarea
              className="min-h-[500px] font-mono text-xs leading-relaxed p-4 bg-card"
              placeholder="Write raw HTML or paste JSON blocks here..."
              value={formData.content}
              onChange={e => handleHtmlChange(e.target.value)}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="bg-card border-border/50">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Publishing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Status</span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    page?.status === "published"
                      ? "bg-green-500/15 text-green-400"
                      : "bg-yellow-500/15 text-yellow-400"
                  }`}
                >
                  {page?.status ?? "Draft"}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Template</span>
                <span className="text-xs font-medium">{formData.template}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Blocks</span>
                <span className="text-xs font-medium">{blocks.length}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Featured Image
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="border-2 border-dashed border-border/50 rounded-lg p-5 text-center hover:bg-secondary/50 transition-colors cursor-pointer">
                <ImageIcon className="h-6 w-6 mx-auto text-muted-foreground mb-1.5" />
                <span className="text-xs text-muted-foreground">Click to upload</span>
              </div>
            </CardContent>
          </Card>

          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="seo" className="border border-border/50 rounded-xl px-1">
              <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3 py-3">
                SEO Meta
              </AccordionTrigger>
              <AccordionContent className="space-y-3 px-3 pb-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Meta Title
                  </Label>
                  <Input
                    value={formData.metaTitle}
                    onChange={e => setFormData(prev => ({ ...prev, metaTitle: e.target.value }))}
                    placeholder="Search engine title"
                    className="h-8 text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground text-right">
                    {formData.metaTitle.length}/60
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Meta Description
                  </Label>
                  <Textarea
                    value={formData.metaDescription}
                    onChange={e =>
                      setFormData(prev => ({ ...prev, metaDescription: e.target.value }))
                    }
                    placeholder="Search engine description"
                    className="min-h-[72px] text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground text-right">
                    {formData.metaDescription.length}/155
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      <AnimatePresence>
        {previewOpen && (
          <SitePreview
            onClose={() => setPreviewOpen(false)}
            initialPageId={!isNew && id ? Number(id) : undefined}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
