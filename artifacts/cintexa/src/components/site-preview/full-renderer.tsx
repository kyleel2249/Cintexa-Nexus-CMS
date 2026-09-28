import { Block } from "@/components/page-builder/types";

interface FullRendererProps {
  blocks: Block[];
}

export function FullRenderer({ blocks }: FullRendererProps) {
  if (blocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-gray-400">
        <div className="text-5xl mb-4">🧱</div>
        <p className="text-lg font-medium text-gray-500">No blocks yet</p>
        <p className="text-sm text-gray-400 mt-1">Add blocks in the Visual Builder to see your page here</p>
      </div>
    );
  }

  return (
    <div className="font-sans text-gray-900 bg-white">
      {blocks.map((block) => (
        <BlockSection key={block.id} block={block} />
      ))}
    </div>
  );
}

function BlockSection({ block }: { block: Block }) {
  switch (block.type) {
    case "hero":
      return (
        <section
          className="relative flex items-center justify-center min-h-[520px] text-white overflow-hidden"
          style={{
            backgroundImage: block.backgroundImage
              ? `linear-gradient(135deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.40) 100%), url(${block.backgroundImage})`
              : "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="relative z-10 text-center px-6 max-w-3xl mx-auto py-20">
            <h1
              className="font-bold leading-tight mb-5 drop-shadow-lg"
              style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)" }}
            >
              {block.heading}
            </h1>
            <p
              className="text-white/85 mb-8 leading-relaxed"
              style={{ fontSize: "clamp(1rem, 2vw, 1.25rem)" }}
            >
              {block.subheading}
            </p>
            {block.ctaLabel && (
              <a
                href={block.ctaUrl || "#"}
                className="inline-block bg-white text-indigo-600 font-bold px-8 py-3.5 rounded-full text-base shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
              >
                {block.ctaLabel}
              </a>
            )}
          </div>
        </section>
      );

    case "feature":
      return (
        <section className="py-20 px-6 bg-gray-50">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">{block.heading}</h2>
              <p className="text-xl text-gray-500 max-w-2xl mx-auto">{block.subheading}</p>
            </div>
            <div
              className="grid gap-8"
              style={{ gridTemplateColumns: `repeat(${Math.min(block.features.length, 3)}, 1fr)` }}
            >
              {block.features.map((f, i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
                >
                  <div className="text-4xl mb-4">{f.icon}</div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3">{f.title}</h3>
                  <p className="text-gray-500 leading-relaxed">{f.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      );

    case "cta":
      return (
        <section className="py-20 px-6 bg-indigo-600 text-white">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-4xl font-bold mb-5">{block.heading}</h2>
            <p className="text-xl text-indigo-200 mb-10 leading-relaxed">{block.body}</p>
            <div className="flex flex-wrap justify-center gap-4">
              {block.primaryLabel && (
                <a
                  href={block.primaryUrl || "#"}
                  className="inline-block bg-white text-indigo-600 font-bold px-8 py-3.5 rounded-full text-base shadow hover:shadow-lg transition-all hover:-translate-y-0.5"
                >
                  {block.primaryLabel}
                </a>
              )}
              {block.secondaryLabel && (
                <a
                  href={block.secondaryUrl || "#"}
                  className="inline-block border-2 border-white/40 text-white font-semibold px-8 py-3.5 rounded-full text-base hover:bg-white/10 transition-colors"
                >
                  {block.secondaryLabel}
                </a>
              )}
            </div>
          </div>
        </section>
      );

    case "text":
      return (
        <section className="py-16 px-6">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold text-gray-900 mb-6">{block.heading}</h2>
            <p className="text-lg text-gray-600 leading-relaxed whitespace-pre-wrap">{block.body}</p>
          </div>
        </section>
      );

    case "image":
      return (
        <section className="py-10 px-6">
          <div className="max-w-5xl mx-auto">
            <figure>
              <img
                src={block.src}
                alt={block.alt}
                className="w-full rounded-2xl shadow-lg object-cover"
                style={{ maxHeight: 480 }}
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              {block.caption && (
                <figcaption className="text-center text-sm text-gray-400 mt-4 italic">
                  {block.caption}
                </figcaption>
              )}
            </figure>
          </div>
        </section>
      );

    default:
      return null;
  }
}
