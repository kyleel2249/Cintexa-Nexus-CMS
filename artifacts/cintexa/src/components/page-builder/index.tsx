import { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Block, BlockType, BLOCK_PALETTE } from "./types";
import { BlockPreview } from "./block-preview";
import { BlockEditorPanel } from "./block-editor-panel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { motion, AnimatePresence } from "framer-motion";
import {
  GripVertical,
  Trash2,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Wand2,
  Loader2,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

let idCounter = 1;
function uid() {
  return `block-${Date.now()}-${idCounter++}`;
}

function createBlock(type: BlockType, defaultData: object): Block {
  return { type, id: uid(), ...defaultData } as Block;
}

interface SortableBlockProps {
  block: Block;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onChange: (b: Block) => void;
}

function SortableBlock({ block, isSelected, onSelect, onDelete, onChange }: SortableBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 999 : undefined,
  };

  const labelMap: Record<string, string> = {
    hero: "🦸 Hero",
    feature: "⚡ Features",
    cta: "🎯 Call to Action",
    text: "📝 Text",
    image: "🖼️ Image",
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative">
      <div
        onClick={onSelect}
        className={`relative rounded-xl border-2 transition-all cursor-pointer overflow-hidden ${
          isSelected
            ? "border-indigo-500 ring-2 ring-indigo-500/20"
            : "border-border/40 hover:border-border"
        }`}
      >
        <div
          className={`flex items-center justify-between px-3 py-2 text-xs font-medium transition-colors ${
            isSelected ? "bg-indigo-500/10 text-indigo-400" : "bg-secondary/50 text-muted-foreground"
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing hover:text-foreground transition-colors p-0.5"
              onClick={e => e.stopPropagation()}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
            <span>{labelMap[block.type] ?? block.type}</span>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="pointer-events-none select-none bg-background p-3">
          <BlockPreview block={block} />
        </div>
      </div>
    </div>
  );
}

interface PageBuilderProps {
  initialBlocks?: Block[];
  onChange: (blocks: Block[]) => void;
}

export function PageBuilder({ initialBlocks = [], onChange }: PageBuilderProps) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const selectedBlock = blocks.find(b => b.id === selectedId) ?? null;

  const updateBlocks = useCallback((next: Block[]) => {
    setBlocks(next);
    onChange(next);
  }, [onChange]);

  function addBlock(type: BlockType) {
    const palette = BLOCK_PALETTE.find(p => p.type === type)!;
    const block = createBlock(type, palette.defaultData);
    const next = [...blocks, block];
    updateBlocks(next);
    setSelectedId(block.id);
  }

  function deleteBlock(id: string) {
    const next = blocks.filter(b => b.id !== id);
    updateBlocks(next);
    if (selectedId === id) setSelectedId(null);
  }

  function updateBlock(updated: Block) {
    const next = blocks.map(b => b.id === updated.id ? updated : b);
    updateBlocks(next);
  }

  function handleDragStart(e: DragStartEvent) {
    setDragActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setDragActiveId(null);
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const oldIdx = blocks.findIndex(b => b.id === active.id);
      const newIdx = blocks.findIndex(b => b.id === over.id);
      updateBlocks(arrayMove(blocks, oldIdx, newIdx));
    }
  }

  async function generateBlockWithAI(type: BlockType) {
    if (!aiPrompt.trim()) {
      toast({ title: "Enter a prompt first", variant: "destructive" });
      return;
    }
    setAiLoading(type);
    try {
      const res = await fetch("/api/ai/generate-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockType: type, prompt: aiPrompt }),
      });
      const data = await res.json();
      if (data.block) {
        const block = { type, id: uid(), ...data.block } as Block;
        const next = [...blocks, block];
        updateBlocks(next);
        setSelectedId(block.id);
        toast({ title: `AI-generated ${type} block added` });
      }
    } catch {
      toast({ title: "AI generation failed", variant: "destructive" });
    } finally {
      setAiLoading(null);
    }
  }

  const dragActiveBlock = blocks.find(b => b.id === dragActiveId);

  return (
    <div className="flex h-full min-h-[600px] rounded-xl border border-border/50 overflow-hidden bg-background">
      {/* Left: Block Palette */}
      <div className="w-56 border-r border-border/50 bg-card flex-shrink-0 flex flex-col">
        <div className="px-4 py-3 border-b border-border/50">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add Block</p>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1.5">
            {BLOCK_PALETTE.map(item => (
              <button
                key={item.type}
                onClick={() => addBlock(item.type)}
                className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-secondary transition-colors group"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">{item.icon}</span>
                  <div>
                    <div className="text-xs font-semibold text-foreground group-hover:text-indigo-400 transition-colors">
                      {item.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                      {item.description}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <Separator className="mx-3" />

          {/* AI Generate */}
          <div className="p-3 space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              AI Generate
            </p>
            <textarea
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder="Describe your content…"
              className="w-full text-xs bg-secondary/60 border border-border/50 rounded-lg px-2.5 py-2 resize-none min-h-[60px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <div className="grid grid-cols-1 gap-1">
              {BLOCK_PALETTE.map(item => (
                <button
                  key={item.type}
                  onClick={() => generateBlockWithAI(item.type)}
                  disabled={!!aiLoading}
                  className="flex items-center gap-2 text-[11px] px-2.5 py-1.5 rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 transition-colors disabled:opacity-50"
                >
                  {aiLoading === item.type ? (
                    <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
                  ) : (
                    <Wand2 className="h-3 w-3 flex-shrink-0" />
                  )}
                  Generate {item.label}
                </button>
              ))}
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Center: Canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-card">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {blocks.length} block{blocks.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {selectedId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSelectedId(null)}
              >
                <X className="h-3 w-3 mr-1" /> Deselect
              </Button>
            )}
            <Button
              variant={preview ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setPreview(p => !p)}
            >
              {preview ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
              {preview ? "Edit" : "Preview"}
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          {preview ? (
            /* Preview Mode */
            <div className="p-6 space-y-0">
              {blocks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <Eye className="h-10 w-10 mb-3 opacity-30" />
                  <p className="text-sm">No blocks yet — add some from the palette</p>
                </div>
              ) : (
                blocks.map(b => (
                  <div key={b.id} className="mb-0">
                    <BlockPreview block={b} />
                  </div>
                ))
              )}
            </div>
          ) : (
            /* Edit Mode */
            <div className="p-4">
              {blocks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border/40 rounded-xl">
                  <div className="text-4xl mb-3">🧱</div>
                  <p className="text-sm font-medium">Start building your page</p>
                  <p className="text-xs mt-1">Click blocks from the palette to add them</p>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-3">
                      <AnimatePresence initial={false}>
                        {blocks.map(block => (
                          <motion.div
                            key={block.id}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.97 }}
                            transition={{ duration: 0.18 }}
                          >
                            <SortableBlock
                              block={block}
                              isSelected={selectedId === block.id}
                              onSelect={() => setSelectedId(block.id)}
                              onDelete={() => deleteBlock(block.id)}
                              onChange={updateBlock}
                            />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </SortableContext>
                  <DragOverlay>
                    {dragActiveBlock && (
                      <div className="rounded-xl border-2 border-indigo-500 bg-background shadow-2xl overflow-hidden opacity-90">
                        <BlockPreview block={dragActiveBlock} />
                      </div>
                    )}
                  </DragOverlay>
                </DndContext>
              )}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right: Editor Panel */}
      <AnimatePresence>
        {selectedBlock && !preview && (
          <motion.div
            key={selectedBlock.id}
            initial={{ x: 16, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 16, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="w-72 border-l border-border/50 bg-card flex-shrink-0 flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
              <p className="text-xs font-semibold text-foreground capitalize">
                {selectedBlock.type} Settings
              </p>
              <button
                onClick={() => setSelectedId(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <ScrollArea className="flex-1">
              <BlockEditorPanel
                block={selectedBlock}
                onChange={updateBlock}
              />
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function blocksToHtml(blocks: Block[]): string {
  return blocks.map(block => {
    switch (block.type) {
      case "hero":
        return `<section class="hero" style="background-image:url(${block.backgroundImage})"><h1>${block.heading}</h1><p>${block.subheading}</p><a href="${block.ctaUrl}">${block.ctaLabel}</a></section>`;
      case "feature":
        return `<section class="features"><h2>${block.heading}</h2><p>${block.subheading}</p>${block.features.map(f => `<div class="feature"><span>${f.icon}</span><h3>${f.title}</h3><p>${f.description}</p></div>`).join("")}</section>`;
      case "cta":
        return `<section class="cta"><h2>${block.heading}</h2><p>${block.body}</p><a href="${block.primaryUrl}">${block.primaryLabel}</a><a href="${block.secondaryUrl}">${block.secondaryLabel}</a></section>`;
      case "text":
        return `<section class="text-block"><h2>${block.heading}</h2><p>${block.body}</p></section>`;
      case "image":
        return `<figure><img src="${block.src}" alt="${block.alt}" /><figcaption>${block.caption}</figcaption></figure>`;
      default:
        return "";
    }
  }).join("\n");
}

export function htmlToBlocks(html: string): Block[] {
  try {
    if (html.trim().startsWith("[")) {
      const parsed = JSON.parse(html);
      if (Array.isArray(parsed)) return parsed as Block[];
    }
  } catch {
    // not JSON
  }
  return [];
}
