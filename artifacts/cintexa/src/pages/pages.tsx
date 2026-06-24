import { useState } from "react";
import { useGetPages } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Plus, Search, FileText, MoreHorizontal, MonitorPlay, Clock, CalendarClock, Check, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatePresence } from "framer-motion";
import { SitePreview } from "@/components/site-preview";
import { useToast } from "@/hooks/use-toast";

async function reschedulePage(id: number, newDate: Date): Promise<void> {
  const res = await fetch(`/api/pages/${id}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledAt: newDate.toISOString() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to reschedule");
  }
}

export default function Pages() {
  const { data: pages, isLoading, refetch } = useGetPages();
  const { toast } = useToast();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPageId, setPreviewPageId] = useState<number | undefined>(undefined);

  const [openRescheduleId, setOpenRescheduleId] = useState<number | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<Date | undefined>(undefined);
  const [rescheduleTime, setRescheduleTime] = useState("12:00");
  const [reschedulingId, setReschedulingId] = useState<number | null>(null);

  function openPicker(id: number, currentDate?: string | null) {
    const base = currentDate ? parseISO(currentDate) : new Date();
    setRescheduleDate(base);
    setRescheduleTime(format(base, "HH:mm"));
    setOpenRescheduleId(id);
  }

  async function confirmReschedule(pageId: number, title: string) {
    if (!rescheduleDate) return;
    const [hours, minutes] = rescheduleTime.split(":").map(Number);
    const newDate = new Date(rescheduleDate);
    newDate.setHours(hours, minutes, 0, 0);

    setOpenRescheduleId(null);
    setReschedulingId(pageId);
    try {
      await reschedulePage(pageId, newDate);
      toast({
        title: "Rescheduled",
        description: `"${title}" scheduled for ${format(newDate, "MMM d, yyyy 'at' h:mm a")}`,
      });
      refetch();
    } catch (err: any) {
      toast({ title: err.message || "Reschedule failed", variant: "destructive" });
    } finally {
      setReschedulingId(null);
    }
  }

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
              <TableHead className="w-[100px]"></TableHead>
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
                      {reschedulingId === page.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Popover
                          open={openRescheduleId === page.id}
                          onOpenChange={(open) => {
                            if (open) openPicker(page.id, page.updatedAt);
                            else setOpenRescheduleId(null);
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title="Reschedule"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <CalendarClock className="h-3.5 w-3.5" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-auto p-0"
                            align="end"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="p-3 border-b border-border">
                              <p className="text-xs font-semibold text-foreground">Reschedule Page</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[200px]">{page.title}</p>
                            </div>
                            <Calendar
                              mode="single"
                              selected={rescheduleDate}
                              onSelect={setRescheduleDate}
                              initialFocus
                            />
                            <div className="p-3 border-t border-border space-y-3">
                              <div className="flex items-center gap-2">
                                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <Input
                                  type="time"
                                  value={rescheduleTime}
                                  onChange={(e) => setRescheduleTime(e.target.value)}
                                  className="h-7 text-xs"
                                />
                              </div>
                              <Button
                                size="sm"
                                className="w-full h-7 text-xs gap-1.5"
                                disabled={!rescheduleDate}
                                onClick={() => confirmReschedule(page.id, page.title)}
                              >
                                <Check className="h-3.5 w-3.5" /> Confirm Reschedule
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
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
