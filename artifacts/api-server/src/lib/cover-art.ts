/**
 * Internal cover-art generator. Produces deterministic SVG illustrations from a post's title, with no external
 * service. The same title always yields the same artwork; the four variants mirror the image slots the editor expects.
 */

export type CoverKind = "hero" | "pattern" | "abstract" | "thumbnail";

export interface CoverSpec {
  kind: CoverKind;
  width: number;
  height: number;
  label: string;
}

export const COVER_SPECS: CoverSpec[] = [
  { kind: "hero", width: 1792, height: 1024, label: "Hero banner" },
  { kind: "pattern", width: 1792, height: 1024, label: "Pattern illustration" },
  { kind: "abstract", width: 1792, height: 1024, label: "Abstract artwork" },
  { kind: "thumbnail", width: 1024, height: 1024, label: "Square thumbnail" },
];

/** FNV-1a 32-bit hash; stable across runtimes. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** Greedy word wrap into at most `maxLines` lines of about `maxChars` characters; the last line is ellipsised. */
export function wrapTitle(title: string, maxChars: number, maxLines: number): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  const used = lines.join(" ").split(/\s+/).length;
  if (used < words.length && lines.length) lines[lines.length - 1] = lines[lines.length - 1]!.replace(/[.,;:!?\s]+$/, "") + "…";
  return lines.length ? lines : [title.slice(0, maxChars)];
}

function palette(seed: number): { a: string; b: string; c: string; ink: string } {
  const h1 = seed % 360;
  const h2 = (h1 + 40 + ((seed >>> 9) % 80)) % 360;
  const h3 = (h2 + 120) % 360;
  return { a: `hsl(${h1} 70% 32%)`, b: `hsl(${h2} 75% 45%)`, c: `hsl(${h3} 80% 62%)`, ink: "#ffffff" };
}

export function renderCoverSvg(title: string, spec: CoverSpec, salt = ""): string {
  const { width: W, height: H, kind } = spec;
  const seed = hashString(`${title}|${kind}|${salt}`);
  const rand = rng(seed);
  const p = palette(hashString(title));
  const shapes: string[] = [];

  if (kind === "hero") {
    for (let i = 0; i < 7; i++) {
      const x = rand() * W, y = rand() * H, r = 120 + rand() * 360;
      shapes.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" fill="${i % 2 ? p.c : p.b}" opacity="${(0.1 + rand() * 0.18).toFixed(2)}"/>`);
    }
  } else if (kind === "pattern") {
    const step = 96;
    for (let x = step / 2; x < W; x += step) {
      for (let y = step / 2; y < H; y += step) {
        if (rand() > 0.55) shapes.push(`<rect x="${x - 26}" y="${y - 26}" width="52" height="52" rx="${(rand() * 26).toFixed(0)}" fill="${rand() > 0.5 ? p.c : p.b}" opacity="${(0.12 + rand() * 0.25).toFixed(2)}"/>`);
      }
    }
  } else if (kind === "abstract") {
    for (let i = 0; i < 5; i++) {
      const cx = rand() * W, cy = rand() * H;
      const d = `M${(cx - 300).toFixed(0)} ${cy.toFixed(0)} C ${(cx - 120).toFixed(0)} ${(cy - 320).toFixed(0)}, ${(cx + 120).toFixed(0)} ${(cy + 320).toFixed(0)}, ${(cx + 300).toFixed(0)} ${cy.toFixed(0)}`;
      shapes.push(`<path d="${d}" fill="none" stroke="${i % 2 ? p.c : p.b}" stroke-width="${(14 + rand() * 36).toFixed(0)}" stroke-linecap="round" opacity="${(0.25 + rand() * 0.35).toFixed(2)}"/>`);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const r = 140 + i * 130;
      shapes.push(`<circle cx="${W / 2}" cy="${H / 2}" r="${r}" fill="none" stroke="${i % 2 ? p.c : p.b}" stroke-width="22" opacity="${(0.28 - i * 0.05).toFixed(2)}"/>`);
    }
  }

  const square = kind === "thumbnail";
  const lines = wrapTitle(title || "Untitled", square ? 16 : 28, square ? 5 : 3);
  const fontSize = square ? 92 : 96;
  const lineH = fontSize * 1.18;
  const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
  const text = lines
    .map((l, i) => `<tspan x="${W / 2}" y="${(startY + i * lineH).toFixed(0)}">${escapeXml(l)}</tspan>`)
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(title)}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.a}"/><stop offset="1" stop-color="${p.b}"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#g)"/>${shapes.join("")}` +
    `<rect width="${W}" height="${H}" fill="#000" opacity="0.18"/>` +
    `<text text-anchor="middle" dominant-baseline="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="${p.ink}">${text}</text>` +
    `</svg>`
  );
}

export function coverDataUri(title: string, spec: CoverSpec, salt = ""): string {
  return `data:image/svg+xml;base64,${Buffer.from(renderCoverSvg(title, spec, salt), "utf8").toString("base64")}`;
}
