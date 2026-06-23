import { useState } from "react";
import { useGetPages } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Search, FileText, MoreHorizontal, MonitorPlay } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatePresence } from "framer-motion";
import { SitePreview } from "@/components/site-preview";

export default function Pages() {
  const { data: pages, isLoading } = useGetPages();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPageId, setPreviewPageId] = useState<number | undefined>(undefined);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Pages</h2>
          <p className="text-muted-foreground mt-1">Create and manage static pages.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setPreviewPageId(undefined); setPreviewOpen(true); }}>
            <MonitorPlay className="mr-2 h-4 w-4" />
            Preview Site
          </Button>
          <Link href="/pages/new" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2">
            <Plus className="mr-2 h-4 w-4" />
            New Page
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-4 py-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search pages..." className="pl-9 bg-card" />
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Last Edited</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-[250px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-[80px] rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                </TableRow>
              ))
            ) : pages?.length ? (
              pages.map((page) => (
                <TableRow key={page.id} className="group cursor-pointer">
                  <TableCell className="font-medium">
                    <Link href={`/pages/${page.id}/edit`} className="flex items-center gap-2 hover:text-primary transition-colors">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {page.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm font-mono">
                    {page.slug?.startsWith("/") ? page.slug : `/${page.slug}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={page.status === "published" ? "default" : "secondary"}>
                      {page.status ?? "draft"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{page.template || "Default"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {page.updatedAt ? format(new Date(page.updatedAt), "MMM d, yyyy") : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Preview page"
                        onClick={() => { setPreviewPageId(page.id); setPreviewOpen(true); }}
                      >
                        <MonitorPlay className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  No pages found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AnimatePresence>
        {previewOpen && (
          <SitePreview
            onClose={() => setPreviewOpen(false)}
            initialPageId={previewPageId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
