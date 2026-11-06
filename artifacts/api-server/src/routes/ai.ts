import { Router } from "express";
import { COVER_SPECS, coverDataUri } from "../lib/cover-art";

const router = Router();

router.post("/generate-content", async (req, res) => {
  const { prompt, type, tone, length } = req.body;
  if (!prompt || !type) return res.status(400).json({ error: "prompt and type required" });

  const fallback = generateFallback(prompt, type, tone ?? "professional", length ?? "medium");
  res.json({ content: fallback, wordCount: fallback.split(/\s+/).filter(Boolean).length });
});

router.post("/generate-seo", async (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "title and content required" });

  const metaTitle = title.length > 60 ? title.substring(0, 57) + "..." : title;
  const words = content.replace(/[^a-zA-Z\s]/g, "").toLowerCase().split(/\s+/).filter(Boolean);
  const freq: Record<string, number> = {};
  for (const w of words) if (w.length > 4) freq[w] = (freq[w] ?? 0) + 1;
  const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  const snippet = content.replace(/\s+/g, " ").substring(0, 155);
  const metaDescription = snippet.length === 155 ? snippet + "..." : snippet;

  res.json({ metaTitle, metaDescription, keywords });
});

router.post("/suggest-titles", async (req, res) => {
  const { topic, count } = req.body;
  if (!topic) return res.status(400).json({ error: "topic required" });

  const n = Math.min(count ?? 5, 10);
  const templates = [
    `The Ultimate Guide to ${topic}`,
    `${topic}: Everything You Need to Know`,
    `How to Master ${topic}`,
    `${topic} Best Practices for Modern Teams`,
    `Why ${topic} Matters More Than Ever`,
    `Top 10 Strategies for ${topic}`,
    `Getting Started with ${topic}: A Complete Overview`,
    `${topic} Explained: A Deep Dive`,
    `The Future of ${topic}`,
    `${topic}: Common Mistakes and How to Avoid Them`,
  ];
  res.json({ titles: templates.slice(0, n) });
});

router.post("/generate-block", async (req, res) => {
  const { blockType, prompt } = req.body;
  if (!blockType || !prompt) return res.status(400).json({ error: "blockType and prompt required" });

  const fallbacks: Record<string, object> = {
    hero: { heading: `Welcome to ${prompt}`, subheading: `Discover the power of ${prompt} and how it can transform your workflow.`, ctaLabel: "Get Started", ctaUrl: "#", backgroundImage: coverDataUri(prompt, COVER_SPECS[0]!) },
    feature: { heading: `Why Choose ${prompt}`, subheading: "Everything you need in one platform", features: [{ icon: "⚡", title: "Fast", description: "Built for speed and performance at scale." }, { icon: "🔒", title: "Secure", description: "Enterprise-grade security you can trust." }, { icon: "🌐", title: "Global", description: "Reach audiences anywhere in the world." }] },
    cta: { heading: `Ready to get started with ${prompt}?`, body: "Join thousands of teams already using our platform.", primaryLabel: "Start Free Trial", primaryUrl: "#", secondaryLabel: "Learn More", secondaryUrl: "#" },
    text: { heading: `About ${prompt}`, body: `${prompt} is designed for modern teams who need reliable, scalable solutions. Our approach combines simplicity with powerful capabilities.` },
    image: { src: coverDataUri(prompt, COVER_SPECS[0]!), alt: prompt, caption: `Visual representation of ${prompt}` },
  };

  res.json({ block: fallbacks[blockType] ?? {} });
});

function generateFallback(prompt: string, type: string, tone: string, length: string): string {
  const lengthMap: Record<string, number> = { short: 150, medium: 350, long: 700 };
  const targetWords = lengthMap[length] ?? 350;
  const typeIntros: Record<string, string> = {
    blog: `This comprehensive blog post explores ${prompt}. Understanding this topic is essential for anyone looking to stay ahead.`,
    product: `Introducing ${prompt} — a solution designed to transform the way you work. Built with precision and crafted for performance.`,
    email: `We're excited to share something important with you about ${prompt}. As a valued member of our community, we wanted you to be among the first to know.`,
    social: `${prompt} — and here's why it matters. We've been thinking deeply about this and wanted to share our perspective.`,
    description: `${prompt} is a carefully crafted solution built to meet the demands of modern users.`,
  };
  const toneModifiers: Record<string, string> = {
    professional: "This approach reflects industry best practices validated by leading experts.",
    casual: "Honestly, this is something we're pretty excited about and we think you will be too.",
    formal: "It is with great consideration that we present this information for your review.",
    friendly: "We love this topic and can't wait to share everything we've learned with you!",
  };
  const body = `${typeIntros[type] ?? `Here is content about ${prompt}.`}\n\nWhen examining ${prompt} more closely, several key considerations emerge. A thoughtful, structured approach yields the best results.\n\n${toneModifiers[tone] ?? ""}\n\nIn summary, ${prompt} represents a meaningful opportunity that deserves careful attention.`;
  const words = body.trim().split(/\s+/);
  return words.length > targetWords ? words.slice(0, targetWords).join(" ") + "." : body.trim();
}

export default router;
