import { useState, useEffect } from "react";
import { useGetSeoSettings, useUpdateSeoSettings, useGetSeoRedirects, useCreateRedirect, useDeleteRedirect, getGetSeoRedirectsQueryKey, getGetSeoSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Save, Search, GitCompare, Globe, Plus, Trash2, ExternalLink, Loader2, Share2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function Seo() {
  const { data: seoSettings, isLoading: isLoadingSeo } = useGetSeoSettings();
  const { data: redirects, isLoading: isLoadingRedirects } = useGetSeoRedirects();
  const updateMutation = useUpdateSeoSettings();
  const createRedirect = useCreateRedirect();
  const deleteRedirect = useDeleteRedirect();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [newType, setNewType] = useState(301);
  const apiOrigin = API_BASE.startsWith("http") ? API_BASE : `${typeof window !== "undefined" ? window.location.origin : ""}${API_BASE}`;

  async function addRedirect() {
    const from = newFrom.trim();
    const to = newTo.trim();
    if (!from.startsWith("/")) {
      toast({ title: "'From' must start with /", variant: "destructive" });
      return;
    }
    if (!to) {
      toast({ title: "Enter a destination", variant: "destructive" });
      return;
    }
    try {
      await createRedirect.mutateAsync({ data: { from, to, type: newType } });
      setNewFrom("");
      setNewTo("");
      await qc.invalidateQueries({ queryKey: getGetSeoRedirectsQueryKey() });
      toast({ title: "Redirect added" });
    } catch (err: any) {
      toast({ title: err?.message || "Could not add redirect", variant: "destructive" });
    }
  }

  async function removeRedirect(id: number) {
    try {
      await deleteRedirect.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getGetSeoRedirectsQueryKey() });
      toast({ title: "Redirect removed" });
    } catch (err: any) {
      toast({ title: err?.message || "Could not remove redirect", variant: "destructive" });
    }
  }

  const [formData, setFormData] = useState({
    siteTitle: "",
    siteDescription: "",
    robots: "",
    googleAnalyticsId: "",
    googleSearchConsoleId: "",
    twitterHandle: "",
    ogImage: "",
  });

  useEffect(() => {
    if (seoSettings) {
      setFormData({
        siteTitle: seoSettings.siteTitle || "",
        siteDescription: seoSettings.siteDescription || "",
        robots: seoSettings.robots || "",
        googleAnalyticsId: seoSettings.googleAnalyticsId || "",
        googleSearchConsoleId: seoSettings.googleSearchConsoleId || "",
        twitterHandle: seoSettings.twitterHandle || "",
        ogImage: seoSettings.ogImage || "",
      });
    }
  }, [seoSettings]);

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ data: formData });
      await qc.invalidateQueries({ queryKey: getGetSeoSettingsQueryKey() });
      toast({ title: "SEO Settings updated successfully" });
    } catch (error: any) {
      toast({ title: error?.message || "Error updating settings", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">SEO & Routing</h2>
          <p className="text-muted-foreground mt-1">Manage global search settings and redirects.</p>
        </div>
        <Button onClick={handleSave} disabled={updateMutation.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {updateMutation.isPending ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      <Tabs defaultValue="global" className="space-y-6">
        <TabsList className="bg-card border border-border/50">
          <TabsTrigger value="global" className="flex items-center gap-2">
            <Globe className="h-4 w-4" /> Global SEO
          </TabsTrigger>
          <TabsTrigger value="redirects" className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" /> URL Redirects
          </TabsTrigger>
          <TabsTrigger value="tracking" className="flex items-center gap-2">
            <Search className="h-4 w-4" /> Search Console
          </TabsTrigger>
        </TabsList>

        <TabsContent value="global" className="space-y-6">
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle>Site Defaults</CardTitle>
              <CardDescription>These values will be used when specific pages don't have custom metadata.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoadingSeo ? (
                <div className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Default Site Title</Label>
                    <Input 
                      value={formData.siteTitle} 
                      onChange={e => setFormData(prev => ({...prev, siteTitle: e.target.value}))}
                      placeholder="My Awesome Website" 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Default Meta Description</Label>
                    <Textarea 
                      value={formData.siteDescription} 
                      onChange={e => setFormData(prev => ({...prev, siteDescription: e.target.value}))}
                      placeholder="A short description of what this site is about." 
                      className="min-h-[100px]"
                    />
                  </div>
                  <div className="space-y-2 pt-4 border-t border-border/50">
                    <Label>Robots.txt Content</Label>
                    <Textarea 
                      value={formData.robots} 
                      onChange={e => setFormData(prev => ({...prev, robots: e.target.value}))}
                      className="min-h-[150px] font-mono text-sm"
                      placeholder={"index, follow   — or paste a full robots.txt:\nUser-agent: *\nAllow: /"}
                    />
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => setFormData((p) => ({ ...p, robots: "index, follow" }))}>Allow indexing</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setFormData((p) => ({ ...p, robots: "noindex, nofollow" }))}>Block all (staging)</Button>
                      <Button type="button" size="sm" variant="ghost" asChild><a href={`${apiOrigin}/seo/robots.txt`} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5 mr-1" />View robots.txt</a></Button>
                      <Button type="button" size="sm" variant="ghost" asChild><a href={`${apiOrigin}/seo/sitemap.xml`} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5 mr-1" />View sitemap.xml</a></Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Default social image (Open Graph URL)</Label>
                    <Input value={formData.ogImage} onChange={e => setFormData(prev => ({...prev, ogImage: e.target.value}))} placeholder="https://…/share-image.jpg" />
                  </div>
                  <div className="rounded-lg border p-4 bg-background/50 space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Search className="h-3 w-3" /> Search result preview</p>
                    <p className="text-[#1a0dab] dark:text-sky-400 text-lg leading-tight truncate">{formData.siteTitle || "Your site title"}</p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">{typeof window !== "undefined" ? window.location.host : "example.com"}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">{formData.siteDescription || "Your meta description appears here. Keep it between 120 and 160 characters."}</p>
                    <p className={`text-[11px] ${formData.siteDescription.length > 160 || (formData.siteDescription.length > 0 && formData.siteDescription.length < 70) ? "text-amber-500" : "text-muted-foreground"}`}>
                      Title {formData.siteTitle.length}/60 · Description {formData.siteDescription.length}/160
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="redirects" className="space-y-6">
          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>URL Redirects</CardTitle>
                <CardDescription>Manage 301 and 302 redirects for your site.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Input className="w-40 font-mono text-xs" placeholder="/old-path" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} />
                <Input className="w-48 font-mono text-xs" placeholder="/new-path or https://…" value={newTo} onChange={(e) => setNewTo(e.target.value)} />
                <select className="h-10 rounded-md border bg-background px-2 text-sm" value={newType} onChange={(e) => setNewType(Number(e.target.value))}>
                  <option value={301}>301 permanent</option>
                  <option value={302}>302 temporary</option>
                  <option value={307}>307 temporary</option>
                  <option value={308}>308 permanent</option>
                </select>
                <Button size="sm" onClick={() => void addRedirect()} disabled={createRedirect.isPending}>
                  {createRedirect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}Add
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From Path</TableHead>
                    <TableHead>To URL</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingRedirects ? (
                    <TableRow>
                      <TableCell colSpan={4}><Skeleton className="h-10 w-full" /></TableCell>
                    </TableRow>
                  ) : redirects?.length ? (
                    redirects.map((redirect) => (
                      <TableRow key={redirect.id}>
                        <TableCell className="font-mono text-sm">{redirect.from}</TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">{redirect.to}</TableCell>
                        <TableCell>
                          <Badge variant={redirect.type === 301 || redirect.type === 308 ? "default" : "secondary"}>
                            {redirect.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void removeRedirect(redirect.id)}><Trash2 className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No redirects configured.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tracking" className="space-y-6">
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle>Tracking & Analytics</CardTitle>
              <CardDescription>Connect your site to Google services.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoadingSeo ? (
                <div className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Google Analytics ID</Label>
                    <Input 
                      value={formData.googleAnalyticsId} 
                      onChange={e => setFormData(prev => ({...prev, googleAnalyticsId: e.target.value}))}
                      placeholder="G-XXXXXXXXXX" 
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Google Search Console Verification ID</Label>
                    <Input 
                      value={formData.googleSearchConsoleId} 
                      onChange={e => setFormData(prev => ({...prev, googleSearchConsoleId: e.target.value}))}
                      placeholder="Verification string" 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Twitter Handle</Label>
                    <Input 
                      value={formData.twitterHandle} 
                      onChange={e => setFormData(prev => ({...prev, twitterHandle: e.target.value}))}
                      placeholder="@username" 
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}