import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Puzzle, Rss, Image, Mail, Share2, LinkIcon, Search } from "lucide-react";

interface Plugin {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  seo: <Search className="w-5 h-5" />,
  media: <Image className="w-5 h-5" />,
  email: <Mail className="w-5 h-5" />,
  social: <Share2 className="w-5 h-5" />,
  content: <LinkIcon className="w-5 h-5" />,
  general: <Puzzle className="w-5 h-5" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  seo: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  media: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  email: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  social: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  content: "bg-green-500/10 text-green-400 border-green-500/20",
  general: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

export default function Plugins() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: plugins = [], isLoading } = useQuery<Plugin[]>({
    queryKey: ["/api/plugins"],
    queryFn: async () => {
      const res = await fetch("/api/plugins");
      if (!res.ok) throw new Error("Failed to fetch plugins");
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ slug, enabled }: { slug: string; enabled: boolean }) => {
      const res = await fetch(`/api/plugins/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update plugin");
      return res.json();
    },
    onSuccess: (_, { enabled, slug }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/plugins"] });
      const plugin = plugins.find((p) => p.slug === slug);
      toast({ title: `${plugin?.name ?? slug} ${enabled ? "enabled" : "disabled"}` });
    },
    onError: () => toast({ title: "Failed to update plugin", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Plugins</h1>
          <p className="text-muted-foreground mt-1">Manage features and integrations</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-36 rounded-xl bg-card animate-pulse border border-border/50" />
          ))}
        </div>
      </div>
    );
  }

  const grouped = plugins.reduce<Record<string, Plugin[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  const categoryOrder = ["seo", "content", "media", "email", "social", "general"];
  const sortedCategories = categoryOrder.filter((c) => grouped[c]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Plugins</h1>
          <p className="text-muted-foreground mt-1">Enable and configure publishing features</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="text-green-400 font-semibold">{plugins.filter((p) => p.enabled).length}</span>
          <span>of {plugins.length} enabled</span>
        </div>
      </div>

      {sortedCategories.map((category) => (
        <div key={category} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 flex items-center gap-2">
            <span className={`p-1 rounded border ${CATEGORY_COLORS[category]}`}>
              {CATEGORY_ICONS[category]}
            </span>
            {category.charAt(0).toUpperCase() + category.slice(1)}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(grouped[category] ?? []).map((plugin) => (
              <Card key={plugin.slug} className={`border-border/50 transition-all ${plugin.enabled ? "bg-card ring-1 ring-primary/20" : "bg-card/50"}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        {plugin.name}
                        {plugin.enabled && (
                          <Badge variant="outline" className="text-[10px] py-0 h-4 border-green-500/40 text-green-400">
                            Active
                          </Badge>
                        )}
                      </CardTitle>
                    </div>
                    <Switch
                      checked={plugin.enabled}
                      onCheckedChange={(enabled) => toggleMutation.mutate({ slug: plugin.slug, enabled })}
                      disabled={toggleMutation.isPending}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">{plugin.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      <div className="rounded-xl border border-border/50 bg-card/30 p-6">
        <div className="flex items-start gap-3">
          <Rss className="w-5 h-5 text-indigo-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-sm">SEO files are available at:</p>
            <div className="mt-2 space-y-1">
              <code className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded block">/api/seo/sitemap.xml</code>
              <code className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded block">/api/seo/robots.txt</code>
            </div>
            <p className="text-xs text-muted-foreground mt-2">These update automatically whenever a post or page is published.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
