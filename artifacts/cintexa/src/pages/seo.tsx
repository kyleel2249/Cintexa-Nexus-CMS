import { useState, useEffect } from "react";
import { useGetSeoSettings, useUpdateSeoSettings, useGetSeoRedirects } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Save, Search, GitCompare, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function Seo() {
  const { data: seoSettings, isLoading: isLoadingSeo } = useGetSeoSettings();
  const { data: redirects, isLoading: isLoadingRedirects } = useGetSeoRedirects();
  const updateMutation = useUpdateSeoSettings();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    siteTitle: "",
    siteDescription: "",
    robots: "",
    googleAnalyticsId: "",
    googleSearchConsoleId: "",
    twitterHandle: "",
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
      });
    }
  }, [seoSettings]);

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ data: formData });
      toast({ title: "SEO Settings updated successfully" });
    } catch (error) {
      toast({ title: "Error updating settings", variant: "destructive" });
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
                    />
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
              <Button size="sm" variant="outline">Add Redirect</Button>
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
                          <Badge variant={redirect.type === 301 ? "default" : "secondary"}>
                            {redirect.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">Delete</Button>
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