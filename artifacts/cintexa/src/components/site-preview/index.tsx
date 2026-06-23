import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGetPages } from "@workspace/api-client-react";
import { htmlToBlocks } from "@/components/page-builder";
import { FullRenderer } from "./full-renderer";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  X,
  Monitor,
  Tablet,
  Smartphone,
  RefreshCw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Globe,
  FileText,
} from "lucide-react";

type Viewport = "desktop" | "tablet" | "mobile";

const VIEWPORT_WIDTHS: Record<Viewport, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 375,
};

interface SitePreviewProps {
  onClose: () => void;
  initialPageId?: number;
}

export function SitePreview({ onClose, initialPageId }: SitePreviewProps) {
  const { data: pages = [], isLoading, refetch } = useGetPages();
  const [selectedPageId, setSelectedPageId] = useState<number | null>(initialPageId ?? null);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const selectedPage = pages.find(p => p.id === selectedPageId) ?? pages[0] ?? null;

  const blocks = useMemo(() => {
    if (!selectedPage?.content) return [];
    return htmlToBlocks(selectedPage.content);
  }, [selectedPage?.content]);

  const currentIndex = pages.findIndex(p => p.id === selectedPage?.id);

  function goToPrev() {
    if (currentIndex > 0) setSelectedPageId(pages[currentIndex - 1].id);
  }
  function goToNext() {
    if (currentIndex < pages.length - 1) setSelectedPageId(pages[currentIndex + 1].id);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.97, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 12 }}
        transition={{ duration: 0.2 }}
        className="w-full h-full max-w-[1400px] max-h-[90vh] bg-[#1a1b1e] rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Top chrome bar */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-[#141518] border-b border-white/10 flex-shrink-0">
          {/* Window buttons */}
          <div className="flex gap-1.5">
            <button
              onClick={onClose}
              className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors"
              title="Close"
            />
            <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
            <div className="w-3 h-3 rounded-full bg-green-500/60" />
          </div>

          {/* Nav arrows */}
          <div className="flex gap-1">
            <button
              onClick={goToPrev}
              disabled={currentIndex <= 0}
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={goToNext}
              disabled={currentIndex >= pages.length - 1}
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* URL bar */}
          <div className="flex-1 flex items-center gap-2 bg-[#2a2b30] rounded-lg px-3 py-1.5 min-w-0">
            <Globe className="h-3 w-3 text-green-400 flex-shrink-0" />
            <span className="text-xs text-gray-300 truncate font-mono">
              {selectedPage
                ? `https://yoursite.com${selectedPage.slug?.startsWith("/") ? selectedPage.slug : `/${selectedPage.slug}`}`
                : "Select a page"}
            </span>
          </div>

          {/* Viewport controls */}
          <div className="flex items-center gap-0.5 bg-[#2a2b30] rounded-lg p-0.5">
            {(["desktop", "tablet", "mobile"] as Viewport[]).map(v => (
              <button
                key={v}
                onClick={() => setViewport(v)}
                className={`p-1.5 rounded-md transition-colors ${
                  viewport === v
                    ? "bg-indigo-500 text-white"
                    : "text-gray-400 hover:text-white hover:bg-white/10"
                }`}
                title={v.charAt(0).toUpperCase() + v.slice(1)}
              >
                {v === "desktop" && <Monitor className="h-3.5 w-3.5" />}
                {v === "tablet" && <Tablet className="h-3.5 w-3.5" />}
                {v === "mobile" && <Smartphone className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>

          {/* Actions */}
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setSidebarOpen(s => !s)}
            className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Toggle pages panel"
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Close preview"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Content area */}
        <div className="flex flex-1 min-h-0">
          {/* Pages sidebar */}
          <AnimatePresence initial={false}>
            {sidebarOpen && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 220, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="border-r border-white/10 bg-[#141518] flex-shrink-0 overflow-hidden"
              >
                <div className="px-3 py-3 border-b border-white/10">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Pages</p>
                </div>
                <ScrollArea className="h-full">
                  <div className="p-2 space-y-0.5">
                    {isLoading ? (
                      Array(5).fill(0).map((_, i) => (
                        <div key={i} className="h-9 bg-white/5 rounded-lg animate-pulse" />
                      ))
                    ) : pages.length === 0 ? (
                      <p className="text-xs text-gray-500 px-2 py-4 text-center">No pages found</p>
                    ) : (
                      pages.map(page => {
                        const isActive = page.id === selectedPage?.id;
                        const pageBlocks = htmlToBlocks(page.content ?? "");
                        return (
                          <button
                            key={page.id}
                            onClick={() => setSelectedPageId(page.id)}
                            className={`w-full text-left rounded-lg px-3 py-2.5 transition-all ${
                              isActive
                                ? "bg-indigo-500/20 text-white"
                                : "text-gray-400 hover:bg-white/5 hover:text-white"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <span className="text-xs font-medium leading-tight truncate">
                                {page.title || "Untitled"}
                              </span>
                              <span
                                className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                                  page.status === "published"
                                    ? "bg-green-500/20 text-green-400"
                                    : "bg-gray-500/20 text-gray-400"
                                }`}
                              >
                                {page.status ?? "draft"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-[10px] text-gray-600 font-mono truncate">
                                {page.slug?.startsWith("/") ? page.slug : `/${page.slug}`}
                              </span>
                              {pageBlocks.length > 0 && (
                                <span className="text-[9px] text-gray-600">
                                  · {pageBlocks.length} block{pageBlocks.length !== 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Viewport frame */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#242529]">
            {/* Viewport label */}
            <div className="flex items-center justify-center gap-2 py-1.5 bg-[#1a1b1e] border-b border-white/10">
              <span className="text-[10px] text-gray-500 font-mono">
                {VIEWPORT_WIDTHS[viewport]}px
              </span>
              <span className="text-[10px] text-gray-600">·</span>
              <span className="text-[10px] text-gray-500 capitalize">{viewport}</span>
            </div>

            {/* The browser viewport with page content */}
            <div className="flex-1 overflow-auto flex justify-center p-6">
              <div
                style={{
                  width: VIEWPORT_WIDTHS[viewport],
                  maxWidth: "100%",
                  minHeight: "100%",
                  transition: "width 0.25s ease",
                }}
                className="bg-white shadow-2xl rounded-lg overflow-hidden flex-shrink-0"
              >
                {!selectedPage ? (
                  <div className="flex flex-col items-center justify-center min-h-[400px] text-gray-300 bg-gray-50">
                    <Globe className="h-12 w-12 mb-4 opacity-20" />
                    <p className="text-base font-medium text-gray-400">Select a page to preview</p>
                    <p className="text-sm text-gray-300 mt-1">
                      Choose a page from the sidebar on the left
                    </p>
                  </div>
                ) : blocks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center min-h-[400px] text-gray-400 bg-gray-50">
                    <FileText className="h-12 w-12 mb-4 opacity-20" />
                    <p className="text-base font-medium text-gray-500">
                      {selectedPage.title || "Untitled page"}
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      This page has no visual blocks yet
                    </p>
                    <p className="text-xs text-gray-300 mt-1">
                      Open the Page Editor and add blocks with the Visual Builder
                    </p>
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={selectedPage.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <FullRenderer blocks={blocks} />
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between px-4 py-1.5 bg-[#141518] border-t border-white/10 text-[10px] text-gray-600 flex-shrink-0">
          <span>
            {selectedPage
              ? `${selectedPage.title} · ${blocks.length} block${blocks.length !== 1 ? "s" : ""}`
              : `${pages.length} page${pages.length !== 1 ? "s" : ""} in this site`}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-green-500/70">● Live preview</span>
            <span>{viewport} · {VIEWPORT_WIDTHS[viewport]}px</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
