/**
 * Small, tolerant HTML parser purpose-built for auditing. It never executes anything and never
 * fetches anything: it turns markup into a light DOM that the analyzers query.
 */

export interface HNode {
  tag: string; // "#text" for text nodes
  attrs: Record<string, string>;
  children: HNode[];
  parent: HNode | null;
  text?: string;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "noscript"]);
const AUTO_CLOSE: Record<string, string[]> = {
  li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr", "td", "th"], td: ["td", "th"], th: ["td", "th"], option: ["option"], p: ["p"],
  thead: ["tbody", "tfoot", "tr", "td", "th"], tbody: ["thead", "tfoot", "tr", "td", "th"],
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", mdash: "—", ndash: "–", hellip: "…", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", trade: "™", middot: "·", bull: "•", euro: "€", pound: "£", yen: "¥" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, g: string) => {
    if (g[0] === "#") {
      const code = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[g.toLowerCase()] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(src)) && count++ < 80) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

export interface ParsedDoc {
  root: HNode;
  nodeCount: number;
  truncated: boolean;
}

export function parseHtml(html: string, maxNodes = 60_000): ParsedDoc {
  const root: HNode = { tag: "#root", attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  let nodeCount = 0;
  let truncated = false;
  const len = html.length;
  const addText = (t: string) => {
    if (!t) return;
    cur.children.push({ tag: "#text", attrs: {}, children: [], parent: cur, text: t });
  };
  while (i < len) {
    if (nodeCount > maxNodes) { truncated = true; break; }
    const lt = html.indexOf("<", i);
    if (lt === -1) { addText(decodeEntities(html.slice(i))); break; }
    if (lt > i) addText(decodeEntities(html.slice(i, lt)));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      i = end === -1 ? len : end + 1;
      continue;
    }
    if (html[lt + 1] === "/") {
      const end = html.indexOf(">", lt);
      const name = html.slice(lt + 2, end === -1 ? len : end).trim().toLowerCase().split(/\s/)[0];
      i = end === -1 ? len : end + 1;
      let n: HNode | null = cur;
      while (n && n !== root && n.tag !== name) n = n.parent;
      if (n && n !== root) cur = n.parent ?? root;
      continue;
    }
    const m = /^<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/.exec(html.slice(lt, lt + 8192));
    if (!m) { addText("<"); i = lt + 1; continue; }
    const tag = m[1].toLowerCase();
    let attrSrc = m[2];
    const selfClose = attrSrc.endsWith("/");
    if (selfClose) attrSrc = attrSrc.slice(0, -1);
    i = lt + m[0].length;
    const closes = AUTO_CLOSE[tag];
    if (closes && closes.includes(cur.tag)) cur = cur.parent ?? root;
    const node: HNode = { tag, attrs: parseAttrs(attrSrc), children: [], parent: cur };
    cur.children.push(node);
    nodeCount++;
    if (RAW_TEXT.has(tag) && !selfClose) {
      const closeRe = new RegExp(`</${tag}\\s*>`, "i");
      const rest = html.slice(i);
      const cm = closeRe.exec(rest);
      const raw = cm ? rest.slice(0, cm.index) : rest;
      if (raw) node.children.push({ tag: "#text", attrs: {}, children: [], parent: node, text: tag === "textarea" || tag === "title" ? decodeEntities(raw) : raw });
      i += cm ? cm.index + cm[0].length : rest.length;
      continue;
    }
    if (!VOID.has(tag) && !selfClose) cur = node;
  }
  return { root, nodeCount, truncated };
}

export function walk(node: HNode, fn: (n: HNode) => void | false): void {
  const stack: HNode[] = [node];
  while (stack.length) {
    const n = stack.pop() as HNode;
    if (n !== node || n.tag !== "#root") {
      if (fn(n) === false) continue;
    }
    for (let k = n.children.length - 1; k >= 0; k--) stack.push(n.children[k]);
  }
}

export function findAll(root: HNode, pred: (n: HNode) => boolean): HNode[] {
  const out: HNode[] = [];
  walk(root, (n) => { if (n.tag !== "#text" && pred(n)) out.push(n); });
  return out;
}

export const byTag = (root: HNode, ...tags: string[]) => findAll(root, (n) => tags.includes(n.tag));

const HIDDEN_TEXT = new Set(["script", "style", "noscript", "template", "head", "svg"]);

/** Visible-ish text content of a node (scripts, styles and templates excluded). */
export function textOf(node: HNode, includeHidden = false): string {
  const parts: string[] = [];
  walk(node, (n) => {
    if (n.tag === "#text") { parts.push(n.text ?? ""); return; }
    if (!includeHidden && HIDDEN_TEXT.has(n.tag)) return false;
    if (!includeHidden && (n.attrs.hidden !== undefined || n.attrs["aria-hidden"] === "true")) return false;
    return undefined;
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function rawTextOf(node: HNode): string {
  return node.children.filter((c) => c.tag === "#text").map((c) => c.text ?? "").join("");
}

export function attr(n: HNode | undefined | null, name: string): string | null {
  const v = n?.attrs[name];
  return v === undefined ? null : v;
}

export function ancestor(n: HNode, pred: (a: HNode) => boolean): HNode | null {
  let p = n.parent;
  while (p) { if (pred(p)) return p; p = p.parent; }
  return null;
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const s: RegExpMatchArray | null = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, s ? s.length : 1);
}

/** Flesch reading ease for English text. Returns null when there is too little text or the text is not English-like. */
export function fleschReadingEase(text: string): number | null {
  const words: string[] = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  if (words.length < 100) return null;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (letters === 0 || latin / letters < 0.9) return null;
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  const syl = words.reduce<number>((s, w) => s + syllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syl / words.length);
  return Math.round(Math.max(-50, Math.min(120, score)) * 10) / 10;
}

export function shingles(text: string, size = 5, cap = 800): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length && out.size < cap; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
