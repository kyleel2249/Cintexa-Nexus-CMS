import { useState } from "react";
import { useAiGenerateContent, useAiGenerateSeo, useAiSuggestTitles } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wand2, Sparkles, Search, MessageSquare, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AiStudio() {
  const { toast } = useToast();
  const generateContentMutation = useAiGenerateContent();
  const generateSeoMutation = useAiGenerateSeo();
  const suggestTitlesMutation = useAiSuggestTitles();

  const [copiedText, setCopiedText] = useState("");

  // Content Generator State
  const [contentPrompt, setContentPrompt] = useState("");
  const [contentType, setContentType] = useState("blog");
  const [contentTone, setContentTone] = useState("professional");
  const [contentResult, setContentResult] = useState<{content: string, wordCount: number} | null>(null);

  // SEO Generator State
  const [seoTitle, setSeoTitle] = useState("");
  const [seoContent, setSeoContent] = useState("");
  const [seoResult, setSeoResult] = useState<{metaTitle: string, metaDescription: string, keywords: string[]} | null>(null);

  // Title Suggester State
  const [titleTopic, setTitleTopic] = useState("");
  const [titleResult, setTitleResult] = useState<{titles: string[]} | null>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    toast({ title: "Copied to clipboard", duration: 2000 });
    setTimeout(() => setCopiedText(""), 2000);
  };

  const handleGenerateContent = async () => {
    if (!contentPrompt) return;
    try {
      const res = await generateContentMutation.mutateAsync({
        data: { prompt: contentPrompt, type: contentType, tone: contentTone, length: "medium" }
      });
      setContentResult(res);
    } catch (e) {
      toast({ title: "Generation failed", variant: "destructive" });
    }
  };

  const handleGenerateSeo = async () => {
    if (!seoTitle || !seoContent) return;
    try {
      const res = await generateSeoMutation.mutateAsync({
        data: { title: seoTitle, content: seoContent }
      });
      setSeoResult(res);
    } catch (e) {
      toast({ title: "Generation failed", variant: "destructive" });
    }
  };

  const handleSuggestTitles = async () => {
    if (!titleTopic) return;
    try {
      const res = await suggestTitlesMutation.mutateAsync({
        data: { topic: titleTopic, count: 5 }
      });
      setTitleResult(res);
    } catch (e) {
      toast({ title: "Generation failed", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-8 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            AI Studio
          </h2>
          <p className="text-muted-foreground mt-1">Accelerate your workflow with AI-powered tools.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Content Generator */}
        <Card className="bg-card border-border/50 col-span-1 xl:col-span-2 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Content Generator
            </CardTitle>
            <CardDescription>Draft articles, landing page copy, or product descriptions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>What should we write about?</Label>
                  <Textarea 
                    value={contentPrompt}
                    onChange={e => setContentPrompt(e.target.value)}
                    placeholder="E.g., A comprehensive guide on React Server Components for beginners..."
                    className="min-h-[120px] resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Format</Label>
                    <Select value={contentType} onValueChange={setContentType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blog">Blog Post</SelectItem>
                        <SelectItem value="landing_page">Landing Page Copy</SelectItem>
                        <SelectItem value="email">Email Newsletter</SelectItem>
                        <SelectItem value="social">Social Media Post</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Tone</Label>
                    <Select value={contentTone} onValueChange={setContentTone}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="casual">Casual & Friendly</SelectItem>
                        <SelectItem value="authoritative">Authoritative</SelectItem>
                        <SelectItem value="persuasive">Persuasive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button 
                  className="w-full" 
                  onClick={handleGenerateContent} 
                  disabled={!contentPrompt || generateContentMutation.isPending}
                >
                  {generateContentMutation.isPending ? "Generating..." : "Generate Content"}
                  <Wand2 className="ml-2 h-4 w-4" />
                </Button>
              </div>

              <div className="bg-secondary/20 rounded-md border border-border/50 p-4 min-h-[300px] flex flex-col relative">
                {contentResult ? (
                  <>
                    <div className="flex justify-between items-center mb-4 pb-2 border-b border-border/50">
                      <Badge variant="secondary" className="bg-primary/10 text-primary">{contentResult.wordCount} words</Badge>
                      <Button variant="ghost" size="sm" onClick={() => handleCopy(contentResult.content)}>
                        {copiedText === contentResult.content ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                        Copy
                      </Button>
                    </div>
                    <div className="prose prose-sm dark:prose-invert max-w-none overflow-y-auto flex-1">
                      {contentResult.content.split('\n').map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm opacity-50">
                    <MessageSquare className="h-8 w-8 mb-2" />
                    <p>Generated content will appear here</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SEO Optimizer */}
        <Card className="bg-card border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              SEO Optimizer
            </CardTitle>
            <CardDescription>Generate optimized meta tags and keywords from your content.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Page Title</Label>
                <Input value={seoTitle} onChange={e => setSeoTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Content Extract</Label>
                <Textarea 
                  value={seoContent} 
                  onChange={e => setSeoContent(e.target.value)}
                  placeholder="Paste the first few paragraphs of your content..."
                  className="min-h-[100px] resize-none text-sm"
                />
              </div>
              <Button 
                className="w-full" 
                onClick={handleGenerateSeo}
                disabled={!seoTitle || !seoContent || generateSeoMutation.isPending}
              >
                {generateSeoMutation.isPending ? "Optimizing..." : "Generate SEO Metadata"}
                <Wand2 className="ml-2 h-4 w-4" />
              </Button>
            </div>

            {seoResult && (
              <div className="bg-secondary/20 rounded-md border border-border/50 p-4 space-y-4 animate-in fade-in slide-in-from-bottom-2">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-muted-foreground uppercase">Meta Title</Label>
                    <span className="text-xs text-muted-foreground">{seoResult.metaTitle.length} chars</span>
                  </div>
                  <div className="flex gap-2">
                    <Input value={seoResult.metaTitle} readOnly className="bg-background" />
                    <Button variant="outline" size="icon" onClick={() => handleCopy(seoResult.metaTitle)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-xs text-muted-foreground uppercase">Meta Description</Label>
                    <span className="text-xs text-muted-foreground">{seoResult.metaDescription.length} chars</span>
                  </div>
                  <div className="flex gap-2">
                    <Textarea value={seoResult.metaDescription} readOnly className="bg-background min-h-[80px]" />
                    <Button variant="outline" size="icon" onClick={() => handleCopy(seoResult.metaDescription)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase">Target Keywords</Label>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {seoResult.keywords.map(kw => (
                      <Badge key={kw} variant="secondary" className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20">{kw}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Title Suggester */}
        <Card className="bg-card border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Headline Suggester
            </CardTitle>
            <CardDescription>Generate catchy, high-converting headlines for any topic.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Topic or core idea</Label>
                <Input 
                  value={titleTopic} 
                  onChange={e => setTitleTopic(e.target.value)}
                  placeholder="E.g., Productivity tips for remote developers" 
                />
              </div>
              <Button 
                className="w-full" 
                onClick={handleSuggestTitles}
                disabled={!titleTopic || suggestTitlesMutation.isPending}
              >
                {suggestTitlesMutation.isPending ? "Brainstorming..." : "Suggest Headlines"}
                <Wand2 className="ml-2 h-4 w-4" />
              </Button>
            </div>

            {titleResult && (
              <div className="bg-secondary/20 rounded-md border border-border/50 p-4 animate-in fade-in slide-in-from-bottom-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Generated Headlines</h4>
                <div className="space-y-3">
                  {titleResult.titles.map((title, i) => (
                    <div key={i} className="flex items-start gap-3 group">
                      <span className="text-muted-foreground font-mono text-xs mt-1 bg-background px-1.5 py-0.5 rounded border border-border">{i+1}</span>
                      <p className="text-sm font-medium flex-1">{title}</p>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={() => handleCopy(title)}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}