import { Collector, ev, inferred, measured } from "./check";
import { byTag, findAll, textOf, type HNode } from "./html";
import { isProductLike, collectSchemaItems, isArticleLike } from "./analyze-seo";
import type { PageData } from "./page-data";

const ROLES = new Set("alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo definition dialog directory document feed figure form grid gridcell group heading img link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem generic paragraph doc-abstract doc-acknowledgments doc-afterword doc-appendix doc-backlink doc-biblioentry doc-bibliography doc-biblioref doc-chapter doc-colophon doc-conclusion doc-cover doc-credit doc-credits doc-dedication doc-endnote doc-endnotes doc-epigraph doc-epilogue doc-errata doc-example doc-footnote doc-foreword doc-glossary doc-glossref doc-index doc-introduction doc-noteref doc-notice doc-pagebreak doc-pagelist doc-part doc-preface doc-prologue doc-pullquote doc-qna doc-subtitle doc-tip doc-toc".split(" "));

const PLACEHOLDER = /lorem ipsum|dolor sit amet|coming soon|under construction|your (company|text|content) here|insert (text|content|your)|sample (page|text)|placeholder (text|content)|this is a (test|sample) page|just another wordpress site|hello world!?$/i;
const CLAIMS = /\b(best in the world|world['’]?s best|#1|number one|100% (guaranteed|satisfaction|safe|secure|free)|guaranteed results|risk[- ]free|the best|unbeatable|cure[sd]?|miracle|instant(ly)? (results|rich)|no\.? ?1)\b/i;
const FOCUSABLE = (n: HNode) => (n.tag === "a" && n.attrs.href !== undefined) || ["button", "input", "select", "textarea"].includes(n.tag) || (n.attrs.tabindex !== undefined && Number(n.attrs.tabindex) >= 0);

const isHtml = (p: PageData) => p.status !== null && p.status >= 200 && p.status < 300 && (p.contentType === null || /html/i.test(p.contentType));

export function analyzeAccessibilityPage(p: PageData, c: Collector): void {
  const ids = ["a11y.images.alt", "a11y.landmarks.main", "a11y.landmarks.nav", "a11y.skip_link", "a11y.headings.empty", "a11y.forms.labels", "a11y.buttons.names", "a11y.links.names", "a11y.ids.duplicate", "a11y.aria.valid", "a11y.tables.headers", "a11y.iframes.title", "a11y.media.captions", "a11y.viewport.zoom", "a11y.tabindex", "a11y.motion.reduced", "a11y.auth.paste"];
  if (!isHtml(p)) { for (const id of ids) c.na(id, "Not an HTML 2xx response."); return; }
  const root = p.doc.root;

  const imgs = p.images.filter((i) => !i.tiny && !i.decorative);
  const noAlt = imgs.filter((i) => i.alt === null);
  if (!imgs.length) c.na("a11y.images.alt", "No content images.");
  else if (noAlt.length === 0) c.pass("a11y.images.alt", { actual: `${imgs.length} images, all with alt`, ...measured });
  else c.grade("a11y.images.alt", noAlt.length / imgs.length > 0.25 ? "fail" : "warn", { actual: `${noAlt.length} of ${imgs.length} images without an alt attribute`, expected: "alt on every image", evidence: noAlt.slice(0, 4).map((i) => ev("url", "image without alt", i.src)), ...measured });

  const mains = byTag(root, "main").length + findAll(root, (n) => n.attrs.role === "main").length;
  c.check("a11y.landmarks.main", mains >= 1, { actual: `${mains} main landmark(s)`, expected: "One main landmark", ...measured });
  const navs = byTag(root, "nav").length + findAll(root, (n) => n.attrs.role === "navigation").length;
  c.check("a11y.landmarks.nav", navs >= 1, { actual: `${navs} navigation landmark(s)`, ...measured });
  const skip = findAll(root, (n) => n.tag === "a" && /^#/.test(n.attrs.href ?? "") && /skip|jump to|main content/i.test(`${textOf(n)} ${n.attrs["aria-label"] ?? ""}`)).length > 0;
  c.check("a11y.skip_link", skip || (mains >= 1 && navs >= 1), { actual: skip ? "Skip link found" : mains && navs ? "Landmarks present (no skip link)" : "No skip link and no landmarks", ...inferred });
  const emptyH = p.headings.filter((h) => !h.text).length;
  c.check("a11y.headings.empty", emptyH === 0, { actual: `${emptyH} empty heading(s)`, ...measured });

  // forms
  const fields = p.forms.flatMap((f) => f.fields).filter((f) => !f.hidden && !["submit", "button", "image", "reset"].includes(f.type));
  const looseFields = findAll(root, (n) => ["input", "select", "textarea"].includes(n.tag) && !["hidden", "submit", "button", "image", "reset"].includes((n.attrs.type ?? "").toLowerCase()) && !ancestorForm(n));
  const labelFor = new Set(byTag(root, "label").map((l) => l.attrs.for).filter(Boolean) as string[]);
  const unlabeledLoose = looseFields.filter((n) => !(n.attrs["aria-label"] || n.attrs["aria-labelledby"] || n.attrs.title || (n.attrs.id && labelFor.has(n.attrs.id)) || hasLabelAncestor(n)));
  const total = fields.length + looseFields.length;
  const unl = fields.filter((f) => !f.labelled).length + unlabeledLoose.length;
  if (!total) c.na("a11y.forms.labels", "No form controls.");
  else if (unl === 0) c.pass("a11y.forms.labels", { actual: `${total} control(s), all labelled`, ...measured });
  else c.grade("a11y.forms.labels", unl / total > 0.25 ? "fail" : "warn", { actual: `${unl} of ${total} controls without an accessible name`, expected: "Label on every control", ...measured });

  const buttons = findAll(root, (n) => n.tag === "button" || n.attrs.role === "button");
  const unnamedBtn = buttons.filter((b) => !(textOf(b) || b.attrs["aria-label"] || b.attrs["aria-labelledby"] || b.attrs.title || findAll(b, (x) => x.tag === "img" && Boolean(x.attrs.alt)).length));
  if (!buttons.length) c.na("a11y.buttons.names", "No buttons.");
  else c.check("a11y.buttons.names", unnamedBtn.length === 0, { actual: `${unnamedBtn.length} of ${buttons.length} button(s) without a name`, ...measured });
  const unnamedLinks = p.links.filter((l) => l.href && !l.text && !l.ariaLabel);
  if (!p.links.length) c.na("a11y.links.names", "No links.");
  else c.check("a11y.links.names", unnamedLinks.length === 0, { actual: `${unnamedLinks.length} link(s) without a name`, evidence: unnamedLinks.slice(0, 3).map((l) => ev("url", "empty link", l.href)), ...measured });

  const seen = new Map<string, number>();
  for (const id of p.ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  const dups = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  c.check("a11y.ids.duplicate", dups.length === 0, { actual: dups.length ? `Duplicate ids: ${dups.slice(0, 5).join(", ")}` : "All ids unique", ...measured });

  const idSet = new Set(p.ids);
  const ariaProblems: string[] = [];
  for (const n of findAll(root, (x) => x.attrs.role !== undefined || x.attrs["aria-labelledby"] !== undefined || x.attrs["aria-describedby"] !== undefined || x.attrs["aria-hidden"] === "true")) {
    const role = n.attrs.role?.toLowerCase().split(/\s+/)[0];
    if (role && !ROLES.has(role)) ariaProblems.push(`invalid role "${role}"`);
    for (const k of ["aria-labelledby", "aria-describedby"]) for (const ref of (n.attrs[k] ?? "").split(/\s+/).filter(Boolean)) if (!idSet.has(ref)) ariaProblems.push(`${k} references missing id "${ref}"`);
    if (n.attrs["aria-hidden"] === "true" && FOCUSABLE(n)) ariaProblems.push(`aria-hidden on focusable <${n.tag}>`);
  }
  c.check("a11y.aria.valid", ariaProblems.length === 0, { actual: ariaProblems.length ? [...new Set(ariaProblems)].slice(0, 4).join("; ") : "No ARIA problems detected", ...inferred });

  const tables = byTag(root, "table").filter((t) => t.attrs.role !== "presentation" && t.attrs.role !== "none");
  const dataTables = tables.filter((t) => findAll(t, (n) => n.tag === "tr").length >= 2 && findAll(t, (n) => n.tag === "td").length >= 4);
  if (!dataTables.length) c.na("a11y.tables.headers", "No data tables.");
  else c.check("a11y.tables.headers", dataTables.every((t) => findAll(t, (n) => n.tag === "th").length > 0), { actual: `${dataTables.filter((t) => !findAll(t, (n) => n.tag === "th").length).length} of ${dataTables.length} table(s) without header cells`, ...measured });

  if (!p.iframes.length) c.na("a11y.iframes.title", "No frames.");
  else c.check("a11y.iframes.title", p.iframes.every((f) => Boolean(f.title?.trim())), { actual: `${p.iframes.filter((f) => !f.title?.trim()).length} of ${p.iframes.length} frame(s) without a title`, ...measured });

  const videos = byTag(root, "video");
  if (!videos.length) c.na("a11y.media.captions", "No native video.");
  else c.check("a11y.media.captions", videos.every((v) => findAll(v, (n) => n.tag === "track" && /captions|subtitles/i.test(n.attrs.kind ?? "")).length > 0), { actual: `${videos.filter((v) => !findAll(v, (n) => n.tag === "track").length).length} of ${videos.length} video(s) without a captions track`, ...measured });

  const vp = p.meta.viewport;
  if (!vp) c.na("a11y.viewport.zoom", "No viewport meta tag.");
  else {
    const max = /maximum-scale\s*=\s*([\d.]+)/i.exec(vp);
    const blocked = /user-scalable\s*=\s*(no|0)/i.test(vp) || (max !== null && Number(max[1]) < 2);
    c.check("a11y.viewport.zoom", !blocked, { actual: vp, expected: "Zoom not restricted", ...measured });
  }

  const posTab = findAll(root, (n) => n.attrs.tabindex !== undefined && Number(n.attrs.tabindex) > 0).length;
  c.check("a11y.tabindex", posTab === 0, { actual: `${posTab} element(s) with positive tabindex`, ...measured });

  const animates = /@keyframes|animation\s*:|transition\s*:/i.test(p.inlineCss);
  if (!animates) c.pass("a11y.motion.reduced", { actual: "No animation found in inline CSS", ...inferred, note: "External stylesheets were not parsed." });
  else c.check("a11y.motion.reduced", /prefers-reduced-motion/i.test(p.inlineCss), { actual: /prefers-reduced-motion/i.test(p.inlineCss) ? "Reduced-motion query present" : "Animation without a reduced-motion query", ...inferred });

  const authFields = p.forms.flatMap((f) => f.fields).filter((f) => f.type === "password" || /user|email|login/i.test(f.name ?? ""));
  if (!p.forms.some((f) => f.hasPassword)) c.na("a11y.auth.paste", "No login form.");
  else c.check("a11y.auth.paste", !authFields.some((f) => f.autocomplete === "off" || f.onpaste), { actual: authFields.some((f) => f.autocomplete === "off" || f.onpaste) ? "autocomplete=off or paste handler on login fields" : "No restrictions", ...measured });
}

function ancestorForm(n: HNode): boolean { let p = n.parent; while (p) { if (p.tag === "form") return true; p = p.parent; } return false; }
function hasLabelAncestor(n: HNode): boolean { let p = n.parent; while (p) { if (p.tag === "label") return true; p = p.parent; } return false; }

export function analyzeSecurityFunctionalPage(p: PageData, c: Collector): void {
  if (!isHtml(p)) {
    for (const id of ["sec.mixed_content", "sec.forms.https", "sec.sri", "func.forms.submit", "func.embeds.secure", "func.contact.links", "func.anchors", "ux.viewport", "ux.images.responsive_markup"]) c.na(id, "Not an HTML 2xx response.");
    return;
  }
  const https = p.finalUrl.startsWith("https://");
  const insecure = (u: string | null) => Boolean(u && u.startsWith("http://"));
  if (!https) c.na("sec.mixed_content", "Page is not served over HTTPS.");
  else {
    const active = [...p.scripts.filter((s) => insecure(s.absolute)).map((s) => s.absolute as string), ...p.stylesheets.filter((s) => insecure(s.absolute)).map((s) => s.absolute as string), ...p.iframes.filter((f) => insecure(f.src)).map((f) => f.src as string)];
    const passive = p.images.filter((i) => insecure(i.src)).map((i) => i.src);
    c.check("sec.mixed_content", active.length + passive.length === 0, { actual: active.length + passive.length ? `${active.length} active and ${passive.length} passive insecure resource(s)` : "No insecure subresources", evidence: [...active, ...passive].slice(0, 4).map((u) => ev("url", "http:// resource", u)), ...measured });
  }

  const badForms = p.forms.filter((f) => {
    const act = f.action ? safeAbs(f.action, p.finalUrl) : p.finalUrl;
    return (act && act.startsWith("http://") && https) || (f.hasPassword && !https);
  });
  if (!p.forms.length) c.na("sec.forms.https", "No forms.");
  else c.check("sec.forms.https", badForms.length === 0, { actual: badForms.length ? `${badForms.length} form(s) post over HTTP or collect passwords on an insecure page` : "All forms use HTTPS", ...measured });

  const ext = p.scripts.filter((s) => s.absolute && s.host && p.thirdPartyHosts.includes(s.host));
  const sriCandidates = ext.filter((s) => !/googletagmanager|google-analytics|facebook\.net|doubleclick|hotjar|intercom|hubspot|clarity\.ms|segment\.|analytics|gtag|tiktok|linkedin|snap|pinterest|stripe\.com|recaptcha|gstatic\.com\/recaptcha|paypal|cookiebot|onetrust|crisp|tawk|zendesk|drift/i.test(s.absolute as string));
  if (!sriCandidates.length) c.na("sec.sri", "No static third-party scripts.");
  else c.check("sec.sri", sriCandidates.every((s) => s.integrity), { actual: `${sriCandidates.filter((s) => !s.integrity).length} of ${sriCandidates.length} third-party script(s) without integrity`, evidence: sriCandidates.filter((s) => !s.integrity).slice(0, 3).map((s) => ev("url", "script", s.absolute as string)), ...measured });

  if (!p.forms.length) c.na("func.forms.submit", "No forms.");
  else {
    const noSubmit = p.forms.filter((f) => !f.hasSubmit && f.fields.some((x) => !x.hidden));
    c.check("func.forms.submit", noSubmit.length === 0, { actual: `${noSubmit.length} of ${p.forms.length} form(s) without a submit control`, ...measured, note: "Forms are never submitted during passive audits." });
  }

  const insecureEmbeds = p.iframes.filter((f) => insecure(f.src));
  if (!p.iframes.length) c.na("func.embeds.secure", "No embeds.");
  else c.check("func.embeds.secure", insecureEmbeds.length === 0, { actual: `${insecureEmbeds.length} embed(s) over http`, ...measured });

  const contact = p.links.filter((l) => l.scheme === "mailto" || l.scheme === "tel");
  if (!contact.length) c.na("func.contact.links", "No mailto or tel links.");
  else {
    const bad = contact.filter((l) => (l.scheme === "mailto" && !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+/i.test(l.href)) || (l.scheme === "tel" && !/^tel:\+?[\d\s().-]{5,}/i.test(l.href)));
    c.check("func.contact.links", bad.length === 0, { actual: `${bad.length} malformed contact link(s)`, evidence: bad.slice(0, 3).map((l) => ev("text", "link", l.href)), ...measured });
  }
  const frags = p.links.filter((l) => l.fragmentOnly && l.href.length > 1);
  const idSet = new Set([...p.ids, ...findAll(p.doc.root, (n) => n.tag === "a" && n.attrs.name !== undefined).map((n) => n.attrs.name as string)]);
  const missing = frags.filter((l) => !idSet.has(decodeURIComponent(l.href.slice(1))) && l.href !== "#top");
  if (!frags.length) c.na("func.anchors", "No in-page anchors.");
  else c.check("func.anchors", missing.length === 0, { actual: `${missing.length} anchor(s) without a target`, evidence: missing.slice(0, 4).map((l) => ev("text", "missing target", l.href)), ...measured });

  const vp = p.meta.viewport;
  c.check("ux.viewport", Boolean(vp && /width\s*=\s*device-width/i.test(vp)), { actual: vp ?? "No viewport meta tag", expected: "width=device-width, initial-scale=1", ...measured });
  const fixed = p.images.filter((i) => Number(i.width ?? 0) > 480 && !/max-width/i.test(p.inlineCss));
  c.check("ux.images.responsive_markup", fixed.length === 0 || /img\s*\{[^}]*max-width\s*:\s*100%/i.test(p.inlineCss) || p.stylesheets.length > 0 && fixed.length < 3, { actual: `${fixed.length} image(s) with fixed width above 480 px`, ...inferred });
}

function safeAbs(u: string, base: string): string | null { try { return new URL(u, base).toString(); } catch { return null; } }

export function analyzeContentPage(p: PageData, c: Collector): void {
  const ids = ["content.placeholder", "content.thin", "content.readability", "content.claims", "content.testimonials", "content.references", "biz.contact.path", "biz.forms.friction", "ecom.product_schema", "ecom.price_consistency"];
  if (!isHtml(p)) { for (const id of ids) c.na(id, "Not an HTML 2xx response."); return; }
  const text = p.text;
  const ph = PLACEHOLDER.exec(`${p.title ?? ""} ${text}`);
  c.check("content.placeholder", !ph, { actual: ph ? `Found "${ph[0]}"` : "No placeholder text", evidence: ph ? [ev("text", "match", ph[0])] : undefined, ...inferred });

  const utility = /\/(login|signin|sign-in|register|signup|cart|checkout|basket|account|contact|search|thank|404|tag|category|gallery|portfolio)\b/i.test(new URL(p.finalUrl).pathname) || p.forms.some((f) => f.hasPassword);
  if (utility) c.na("content.thin", "Utility page: little text is expected.");
  else c.check("content.thin", p.wordCount >= 50, { actual: `${p.wordCount} words`, expected: "Substantive content", ...inferred });

  if (p.readingEase === null) c.na("content.readability", "Fewer than 100 English words.");
  else c.check("content.readability", p.readingEase >= 30 || p.wordCount < 150, { actual: `Flesch reading ease ${p.readingEase}`, expected: "30 or above", ...inferred });

  const claim = CLAIMS.exec(text);
  c.check("content.claims", !claim, { actual: claim ? `Absolute claim: "${claim[0]}"` : "No unsupported absolute claims found", ...inferred });

  const testimonials = findAll(p.doc.root, (n) => /testimonial|review-card|customer-quote/i.test(`${n.attrs.class ?? ""} ${n.attrs.id ?? ""}`) || n.tag === "blockquote");
  if (!testimonials.length) c.na("content.testimonials", "No testimonials detected.");
  else {
    const unattributed = testimonials.filter((t) => !findAll(t, (n) => n.tag === "cite" || n.tag === "figcaption" || /author|name|cite|attribution|by/i.test(n.attrs.class ?? "") || n.attrs.itemprop === "author").length && !/[-–—]\s*[A-Z][a-z]+/.test(textOf(t)));
    c.check("content.testimonials", unattributed.length === 0, { actual: `${unattributed.length} of ${testimonials.length} testimonial(s) without a named source`, ...inferred });
  }

  if (!isArticleLike(p)) c.na("content.references", "Not an article-like page.");
  else {
    const refs = p.links.filter((l) => !l.internal && (l.scheme === "http" || l.scheme === "https"));
    c.check("content.references", refs.length > 0, { actual: `${refs.length} outbound reference(s)`, ...inferred });
  }

  const hasContact = p.links.some((l) => l.scheme === "tel" || l.scheme === "mailto" || (l.internal && /contact|get-in-touch|support|quote|book|enquir|inquir/i.test(`${l.href} ${l.text}`)));
  c.check("biz.contact.path", hasContact, { actual: hasContact ? "Contact route available" : "No contact route on this page", ...inferred });

  const lead = p.forms.filter((f) => f.fields.filter((x) => !x.hidden && !["submit", "button", "checkbox", "radio"].includes(x.type)).length > 0 && !f.hasPassword);
  if (!lead.length) c.na("biz.forms.friction", "No lead forms.");
  else {
    const max = Math.max(...lead.map((f) => f.fields.filter((x) => !x.hidden && !["submit", "button"].includes(x.type)).length));
    c.check("biz.forms.friction", max <= 7, { actual: `Longest form has ${max} visible field(s)`, expected: "Seven or fewer", ...measured });
  }

  if (!isProductLike(p)) { c.na("ecom.product_schema", "Not a product page."); c.na("ecom.price_consistency", "Not a product page."); return; }
  const products = collectSchemaItems(p).filter((o) => o["@type"] === "Product" || (Array.isArray(o["@type"]) && (o["@type"] as string[]).includes("Product")));
  if (!products.length) c.fail("ecom.product_schema", { actual: "Product-like page without Product markup", expected: "Product JSON-LD with offers", ...inferred });
  else {
    const offer = (products[0].offers ?? null) as Record<string, unknown> | Record<string, unknown>[] | null;
    const first = Array.isArray(offer) ? offer[0] : offer;
    const complete = first && first.price !== undefined && first.priceCurrency && first.availability;
    if (complete) c.pass("ecom.product_schema", { actual: "Product with price, currency and availability", ...inferred });
    else c.warn("ecom.product_schema", { actual: "Product markup present, offer details incomplete", ...inferred });
    const price = first?.price !== undefined ? String(first.price) : null;
    if (!price) c.na("ecom.price_consistency", "No marked-up price.");
    else {
      const num = Number(price);
      const variants = [price, Number.isFinite(num) ? num.toFixed(2) : price, Number.isFinite(num) ? num.toLocaleString("en-US") : price, Number.isFinite(num) ? num.toLocaleString("en-US", { minimumFractionDigits: 2 }) : price];
      c.check("ecom.price_consistency", variants.some((v) => p.text.includes(v)), { actual: `Marked-up price ${price}`, expected: "Price visible on the page", ...inferred });
    }
  }
}
