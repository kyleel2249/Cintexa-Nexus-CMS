import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useGetPage, useCreatePage, useUpdatePage } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowLeft, Save, Globe, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function PageEditor() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const isNew = !id || id === "new";
  
  const { data: page, isLoading } = useGetPage(Number(id), { 
    query: { enabled: !isNew && !!id } 
  });

  const createMutation = useCreatePage();
  const updateMutation = useUpdatePage();

  const [formData, setFormData] = useState({
    title: "",
    slug: "",
    content: "",
    metaTitle: "",
    metaDescription: "",
    template: "default"
  });

  useEffect(() => {
    if (page && !isNew) {
      setFormData({
        title: page.title || "",
        slug: page.slug || "",
        content: page.content || "",
        metaTitle: page.metaTitle || "",
        metaDescription: page.metaDescription || "",
        template: page.template || "default"
      });
    }
  }, [page, isNew]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const title = e.target.value;
    setFormData(prev => ({
      ...prev,
      title,
      slug: isNew ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') : prev.slug
    }));
  };

  const handleSave = async (status: string = "Draft") => {
    try {
      if (isNew) {
        await createMutation.mutateAsync({ data: { ...formData } });
        toast({ title: "Page created successfully" });
        setLocation("/pages");
      } else {
        await updateMutation.mutateAsync({ id: Number(id), data: { ...formData, status } });
        toast({ title: "Page updated successfully" });
      }
    } catch (error) {
      toast({ title: "Error saving page", variant: "destructive" });
    }
  };

  if (isLoading && !isNew) {
    return <div className="p-8 text-center">Loading editor...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-24">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/pages")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-bold">{isNew ? "Create Page" : "Edit Page"}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => handleSave("Draft")}>
            <Save className="mr-2 h-4 w-4" /> Save Draft
          </Button>
          <Button onClick={() => handleSave("Published")}>
            <Globe className="mr-2 h-4 w-4" /> Publish
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="col-span-2 space-y-6">
          <div className="space-y-2">
            <Input 
              placeholder="Page Title" 
              className="text-4xl font-bold h-16 bg-transparent border-none px-0 shadow-none focus-visible:ring-0 placeholder:text-muted"
              value={formData.title}
              onChange={handleTitleChange}
            />
            <div className="flex items-center gap-2 text-muted-foreground text-sm pl-1">
              <span>/</span>
              <Input 
                value={formData.slug}
                onChange={e => setFormData(prev => ({...prev, slug: e.target.value}))}
                className="h-6 w-full max-w-[300px] p-0 bg-transparent border-none focus-visible:ring-0 shadow-none"
                placeholder="page-slug"
              />
            </div>
          </div>

          <div className="space-y-2 pt-4 border-t">
            <Label>Content</Label>
            <Textarea 
              className="min-h-[500px] font-mono text-sm leading-relaxed p-4 bg-card"
              placeholder="Write your page content here..."
              value={formData.content}
              onChange={e => setFormData(prev => ({...prev, content: e.target.value}))}
            />
          </div>
        </div>

        <div className="space-y-6">
          <Card className="bg-card border-border/50">
            <CardHeader className="py-4">
              <CardTitle className="text-sm font-medium">Publishing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium">{page?.status || "Draft"}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Template</span>
                <span className="font-medium">{formData.template}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="py-4">
              <CardTitle className="text-sm font-medium">Featured Image</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:bg-secondary/50 transition-colors cursor-pointer">
                <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <span className="text-sm text-muted-foreground">Click to upload</span>
              </div>
            </CardContent>
          </Card>

          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="seo" className="border-border/50">
              <AccordionTrigger className="text-sm font-medium">SEO Meta</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label className="text-xs">Meta Title</Label>
                  <Input 
                    value={formData.metaTitle}
                    onChange={e => setFormData(prev => ({...prev, metaTitle: e.target.value}))}
                    placeholder="Search engine title" 
                    className="h-8"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Meta Description</Label>
                  <Textarea 
                    value={formData.metaDescription}
                    onChange={e => setFormData(prev => ({...prev, metaDescription: e.target.value}))}
                    placeholder="Search engine description" 
                    className="min-h-[80px] text-sm"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </div>
  );
}