import { Block } from "./types";

interface BlockPreviewProps {
  block: Block;
}

export function BlockPreview({ block }: BlockPreviewProps) {
  switch (block.type) {
    case "hero":
      return (
        <div
          className="relative rounded-lg overflow-hidden min-h-[200px] flex items-center justify-center text-white"
          style={{
            backgroundImage: block.backgroundImage
              ? `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url(${block.backgroundImage})`
              : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundColor: block.backgroundImage ? undefined : "#6366f1",
          }}
        >
          <div className="text-center px-8 py-10 max-w-2xl">
            <h2 className="text-2xl font-bold mb-2 drop-shadow">{block.heading}</h2>
            <p className="text-white/80 text-sm mb-4">{block.subheading}</p>
            {block.ctaLabel && (
              <span className="inline-block bg-indigo-500 text-white text-xs font-semibold px-4 py-1.5 rounded-full">
                {block.ctaLabel}
              </span>
            )}
          </div>
        </div>
      );

    case "feature":
      return (
        <div className="py-6 px-4">
          <div className="text-center mb-6">
            <h2 className="text-lg font-bold text-foreground">{block.heading}</h2>
            <p className="text-sm text-muted-foreground mt-1">{block.subheading}</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {block.features.map((f, i) => (
              <div key={i} className="text-center p-3 rounded-lg bg-secondary/60">
                <div className="text-2xl mb-2">{f.icon}</div>
                <div className="font-semibold text-sm text-foreground">{f.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{f.description}</div>
              </div>
            ))}
          </div>
        </div>
      );

    case "cta":
      return (
        <div className="rounded-lg bg-indigo-600 text-white text-center py-8 px-6">
          <h2 className="text-xl font-bold mb-2">{block.heading}</h2>
          <p className="text-white/80 text-sm mb-5">{block.body}</p>
          <div className="flex justify-center gap-3">
            {block.primaryLabel && (
              <span className="inline-block bg-white text-indigo-600 text-xs font-semibold px-4 py-1.5 rounded-full">
                {block.primaryLabel}
              </span>
            )}
            {block.secondaryLabel && (
              <span className="inline-block border border-white/50 text-white text-xs font-semibold px-4 py-1.5 rounded-full">
                {block.secondaryLabel}
              </span>
            )}
          </div>
        </div>
      );

    case "text":
      return (
        <div className="py-6 px-4 max-w-2xl mx-auto">
          <h2 className="text-lg font-bold text-foreground mb-3">{block.heading}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{block.body}</p>
        </div>
      );

    case "image":
      return (
        <div className="overflow-hidden rounded-lg">
          <img
            src={block.src}
            alt={block.alt}
            className="w-full h-40 object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          {block.caption && (
            <p className="text-center text-xs text-muted-foreground py-2 px-4 italic">
              {block.caption}
            </p>
          )}
        </div>
      );

    default:
      return null;
  }
}
