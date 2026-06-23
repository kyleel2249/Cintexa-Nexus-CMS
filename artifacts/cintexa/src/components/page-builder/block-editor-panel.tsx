import { Block, FeatureItem } from "./types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

interface BlockEditorPanelProps {
  block: Block;
  onChange: (updated: Block) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Label>
      {children}
    </div>
  );
}

export function BlockEditorPanel({ block, onChange }: BlockEditorPanelProps) {
  function update(patch: Partial<Block>) {
    onChange({ ...block, ...patch } as Block);
  }

  if (block.type === "hero") {
    return (
      <div className="space-y-4 p-4">
        <Field label="Heading">
          <Input value={block.heading} onChange={e => update({ heading: e.target.value })} />
        </Field>
        <Field label="Subheading">
          <Textarea
            value={block.subheading}
            onChange={e => update({ subheading: e.target.value })}
            className="min-h-[80px] text-sm"
          />
        </Field>
        <Field label="CTA Button Label">
          <Input value={block.ctaLabel} onChange={e => update({ ctaLabel: e.target.value })} />
        </Field>
        <Field label="CTA Button URL">
          <Input value={block.ctaUrl} onChange={e => update({ ctaUrl: e.target.value })} placeholder="https://" />
        </Field>
        <Field label="Background Image URL">
          <Input
            value={block.backgroundImage}
            onChange={e => update({ backgroundImage: e.target.value })}
            placeholder="https://images.unsplash.com/..."
          />
          {block.backgroundImage && (
            <img
              src={block.backgroundImage}
              className="w-full h-20 object-cover rounded-md mt-2"
              alt="preview"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
        </Field>
      </div>
    );
  }

  if (block.type === "feature") {
    function updateFeature(i: number, patch: Partial<FeatureItem>) {
      const features = block.features.map((f, idx) => idx === i ? { ...f, ...patch } : f);
      onChange({ ...block, features });
    }
    function addFeature() {
      onChange({ ...block, features: [...block.features, { icon: "✨", title: "New Feature", description: "Describe this feature." }] });
    }
    function removeFeature(i: number) {
      onChange({ ...block, features: block.features.filter((_, idx) => idx !== i) });
    }

    return (
      <div className="space-y-4 p-4">
        <Field label="Section Heading">
          <Input value={block.heading} onChange={e => update({ heading: e.target.value })} />
        </Field>
        <Field label="Section Subheading">
          <Input value={block.subheading} onChange={e => update({ subheading: e.target.value })} />
        </Field>
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Features</Label>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={addFeature}>
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          </div>
          {block.features.map((f, i) => (
            <div key={i} className="rounded-lg border border-border/50 bg-secondary/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Feature {i + 1}</span>
                <button onClick={() => removeFeature(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-5 gap-2">
                <Input
                  value={f.icon}
                  onChange={e => updateFeature(i, { icon: e.target.value })}
                  className="col-span-1 text-center text-lg"
                  placeholder="🎯"
                />
                <Input
                  value={f.title}
                  onChange={e => updateFeature(i, { title: e.target.value })}
                  className="col-span-4"
                  placeholder="Feature title"
                />
              </div>
              <Textarea
                value={f.description}
                onChange={e => updateFeature(i, { description: e.target.value })}
                className="min-h-[56px] text-xs"
                placeholder="Feature description"
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (block.type === "cta") {
    return (
      <div className="space-y-4 p-4">
        <Field label="Heading">
          <Input value={block.heading} onChange={e => update({ heading: e.target.value })} />
        </Field>
        <Field label="Body Text">
          <Textarea
            value={block.body}
            onChange={e => update({ body: e.target.value })}
            className="min-h-[80px] text-sm"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Primary Button">
            <Input value={block.primaryLabel} onChange={e => update({ primaryLabel: e.target.value })} placeholder="Label" />
            <Input value={block.primaryUrl} onChange={e => update({ primaryUrl: e.target.value })} placeholder="URL" className="mt-1.5" />
          </Field>
          <Field label="Secondary Button">
            <Input value={block.secondaryLabel} onChange={e => update({ secondaryLabel: e.target.value })} placeholder="Label" />
            <Input value={block.secondaryUrl} onChange={e => update({ secondaryUrl: e.target.value })} placeholder="URL" className="mt-1.5" />
          </Field>
        </div>
      </div>
    );
  }

  if (block.type === "text") {
    return (
      <div className="space-y-4 p-4">
        <Field label="Heading">
          <Input value={block.heading} onChange={e => update({ heading: e.target.value })} />
        </Field>
        <Field label="Body Text">
          <Textarea
            value={block.body}
            onChange={e => update({ body: e.target.value })}
            className="min-h-[200px] text-sm leading-relaxed"
          />
        </Field>
      </div>
    );
  }

  if (block.type === "image") {
    return (
      <div className="space-y-4 p-4">
        <Field label="Image URL">
          <Input
            value={block.src}
            onChange={e => update({ src: e.target.value })}
            placeholder="https://images.unsplash.com/..."
          />
          {block.src && (
            <img
              src={block.src}
              className="w-full h-28 object-cover rounded-md mt-2"
              alt="preview"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
        </Field>
        <Field label="Alt Text">
          <Input value={block.alt} onChange={e => update({ alt: e.target.value })} />
        </Field>
        <Field label="Caption">
          <Input value={block.caption} onChange={e => update({ caption: e.target.value })} />
        </Field>
      </div>
    );
  }

  return null;
}
