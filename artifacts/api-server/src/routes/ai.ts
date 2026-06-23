import { Router } from "express";

const router = Router();

router.post("/generate-content", async (req, res) => {
  const { prompt, type, tone, length } = req.body;
  if (!prompt || !type) return res.status(400).json({ error: "prompt and type required" });

  const lengthMap: Record<string, number> = { short: 150, medium: 350, long: 700 };
  const targetWords = lengthMap[length ?? "medium"] ?? 350;

  const content = generateContent(prompt, type, tone ?? "professional", targetWords);
  res.json({ content, wordCount: content.split(/\s+/).filter(Boolean).length });
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
    `How to Master ${topic} in 2025`,
    `${topic} Best Practices for Modern Teams`,
    `Why ${topic} Matters More Than Ever`,
    `Top 10 Strategies for ${topic}`,
    `Getting Started with ${topic}: A Complete Overview`,
    `${topic} Explained: A Deep Dive`,
    `The Future of ${topic} and What It Means for You`,
    `${topic}: Common Mistakes and How to Avoid Them`,
  ];

  res.json({ titles: templates.slice(0, n) });
});

function generateContent(prompt: string, type: string, tone: string, targetWords: number): string {
  const typeIntros: Record<string, string> = {
    blog: `This comprehensive blog post explores ${prompt}. Understanding this topic is essential for anyone looking to stay ahead in today's rapidly evolving landscape.`,
    product: `Introducing ${prompt} — a solution designed to transform the way you work. Built with precision and crafted for performance, this offering delivers exceptional value at every step.`,
    email: `We're excited to share something important with you about ${prompt}. As a valued member of our community, we wanted you to be among the first to know.`,
    social: `${prompt} — and here's why it matters. We've been thinking deeply about this and wanted to share our perspective with you.`,
    description: `${prompt} is a carefully crafted solution built to meet the demands of modern users. Every detail has been considered to ensure an exceptional experience.`,
  };

  const toneModifiers: Record<string, string> = {
    professional: "This approach reflects industry best practices and has been validated by leading experts in the field.",
    casual: "Honestly, this is something we're pretty excited about and we think you will be too.",
    formal: "It is with great consideration that we present this information for your review and evaluation.",
    friendly: "We love this topic and can't wait to share everything we've learned with you!",
  };

  const body = `

${typeIntros[type] ?? `Here is a piece of content about ${prompt}.`}

When examining ${prompt} more closely, several key considerations emerge. First, it is important to understand the context in which this applies and how it fits within the broader landscape. Organizations and individuals alike have found significant value in exploring this area deeply.

Research and practical experience both point to the same conclusion: a thoughtful, structured approach yields the best results. Whether you are just getting started or looking to refine an existing strategy, the principles outlined here will serve as a reliable foundation.

${toneModifiers[tone] ?? ""}

Moving forward, the most impactful steps involve consistent application of these ideas alongside regular evaluation of outcomes. By committing to this process, you position yourself and your team for sustained success.

In summary, ${prompt} represents a meaningful opportunity that deserves careful attention and deliberate action. The insights shared here are intended to help you navigate this space with confidence and clarity.`;

  const words = body.trim().split(/\s+/);
  if (words.length > targetWords) return words.slice(0, targetWords).join(" ") + ".";
  return body.trim();
}

export default router;
