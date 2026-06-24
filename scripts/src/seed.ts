/**
 * CINTEXA CMS — Database Seed Script
 * Run: pnpm --filter @workspace/scripts run seed
 *
 * Creates a full demo dataset:
 *   - 1 admin + 3 team members
 *   - 2 live sites
 *   - 5 published pages (with page-builder blocks)
 *   - 6 published posts across 4 categories
 *   - 12 media entries
 *   - 2 nav menus
 *   - 2 forms
 *   - SEO settings
 *   - Activity feed entries
 *
 * Safe to re-run — skips seed if admin already exists (use --force to reset).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import bcrypt from "bcryptjs";
import * as schema from "@workspace/db/schema";

const { Pool } = pg;

const FORCE = process.argv.includes("--force");

if (!process.env.DATABASE_URL) {
  console.error("❌  DATABASE_URL is not set. Aborting.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

// ─── Helpers ────────────────────────────────────────────────────────────────

function blocks(...items: object[]) {
  return JSON.stringify(items);
}

function hero(
  heading: string,
  subheading: string,
  ctaLabel: string,
  ctaUrl: string,
  bg: string,
) {
  return { type: "hero", heading, subheading, ctaLabel, ctaUrl, backgroundImage: bg };
}

function features(heading: string, subheading: string, items: { icon: string; title: string; description: string }[]) {
  return { type: "feature", heading, subheading, features: items };
}

function cta(heading: string, body: string, primaryLabel: string, primaryUrl: string, secondaryLabel: string, secondaryUrl: string) {
  return { type: "cta", heading, body, primaryLabel, primaryUrl, secondaryLabel, secondaryUrl };
}

function textBlock(heading: string, body: string) {
  return { type: "text", heading, body };
}

function imageBlock(src: string, alt: string, caption: string) {
  return { type: "image", src, alt, caption };
}

function menuItems(...items: { label: string; url: string; children?: { label: string; url: string }[] }[]) {
  return JSON.stringify(items);
}

function formFields(...fields: { id: string; type: string; label: string; placeholder?: string; required?: boolean; options?: string[] }[]) {
  return JSON.stringify(fields);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱  CINTEXA CMS seed script starting…\n");

  // Guard: skip if already seeded
  if (!FORCE) {
    const existing = await db.select({ id: schema.usersTable.id }).from(schema.usersTable).limit(1);
    if (existing.length > 0) {
      console.log("✅  Database already seeded. Run with --force to reset.\n");
      await pool.end();
      return;
    }
  }

  if (FORCE) {
    console.log("⚠️   --force: truncating existing data…");
    await db.delete(schema.activityTable);
    await db.delete(schema.formSubmissionsTable);
    await db.delete(schema.formsTable);
    await db.delete(schema.menusTable);
    await db.delete(schema.redirectsTable);
    await db.delete(schema.seoSettingsTable);
    await db.delete(schema.mediaTable);
    await db.delete(schema.postTagsTable);
    await db.delete(schema.tagsTable);
    await db.delete(schema.postsTable);
    await db.delete(schema.pageRevisionsTable);
    await db.delete(schema.pagesTable);
    await db.delete(schema.categoriesTable);
    await db.delete(schema.sitesTable);
    await db.delete(schema.usersTable);
    console.log("   Done.\n");
  }

  // ── 1. Users ──────────────────────────────────────────────────────────────
  console.log("👤  Creating users…");

  const adminHash = await bcrypt.hash("Admin@123456", 12);
  const editorHash = await bcrypt.hash("Editor@123456", 12);

  const [admin] = await db.insert(schema.usersTable).values({
    name: "Alex Admin",
    email: "admin@cintexa.com",
    role: "admin",
    status: "active",
    passwordHash: adminHash,
    bio: "Platform administrator and lead architect of the CINTEXA CMS.",
    avatar: "https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=80&h=80&fit=crop",
  }).returning();

  const [sarah] = await db.insert(schema.usersTable).values({
    name: "Sarah Chen",
    email: "sarah@cintexa.com",
    role: "editor",
    status: "active",
    passwordHash: editorHash,
    bio: "Senior content strategist with 8 years of digital publishing experience.",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop",
  }).returning();

  const [marcus] = await db.insert(schema.usersTable).values({
    name: "Marcus Rivera",
    email: "marcus@cintexa.com",
    role: "editor",
    status: "active",
    passwordHash: editorHash,
    bio: "Technical writer and SEO specialist.",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop",
  }).returning();

  await db.insert(schema.usersTable).values({
    name: "Priya Patel",
    email: "priya@cintexa.com",
    role: "editor",
    status: "active",
    passwordHash: editorHash,
    bio: "Product marketing lead and visual content creator.",
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&h=80&fit=crop",
  });

  console.log("   ✓ 4 users created (admin + 3 editors)\n");

  // ── 2. Sites ──────────────────────────────────────────────────────────────
  console.log("🌐  Creating sites…");

  const [mainSite] = await db.insert(schema.sitesTable).values({
    name: "CINTEXA Main",
    domain: "cintexa.com",
    description: "Primary marketing and product site for CINTEXA CMS.",
    status: "active",
    primaryColor: "#6366f1",
    language: "en",
    timezone: "America/New_York",
    favicon: "/favicon.svg",
  }).returning();

  const [blogSite] = await db.insert(schema.sitesTable).values({
    name: "CINTEXA Blog",
    domain: "blog.cintexa.com",
    description: "Insights, tutorials, and product updates from the CINTEXA team.",
    status: "active",
    primaryColor: "#8b5cf6",
    language: "en",
    timezone: "America/New_York",
  }).returning();

  console.log("   ✓ 2 sites created\n");

  // ── 3. Categories ─────────────────────────────────────────────────────────
  console.log("📂  Creating categories…");

  const [catProduct] = await db.insert(schema.categoriesTable).values({ name: "Product Updates", slug: "product-updates", description: "New features, improvements, and release notes." }).returning();
  const [catTutorials] = await db.insert(schema.categoriesTable).values({ name: "Tutorials", slug: "tutorials", description: "Step-by-step guides for getting the most out of CINTEXA." }).returning();
  const [catInsights] = await db.insert(schema.categoriesTable).values({ name: "Insights", slug: "insights", description: "Industry trends, research, and thought leadership." }).returning();
  const [catEngineering] = await db.insert(schema.categoriesTable).values({ name: "Engineering", slug: "engineering", description: "Behind-the-scenes technical deep dives from our team." }).returning();

  console.log("   ✓ 4 categories created\n");

  // ── 4. Tags ───────────────────────────────────────────────────────────────
  console.log("🏷️   Creating tags…");

  const tags = await db.insert(schema.tagsTable).values([
    { name: "AI", slug: "ai" },
    { name: "SEO", slug: "seo" },
    { name: "Page Builder", slug: "page-builder" },
    { name: "Performance", slug: "performance" },
    { name: "Multi-site", slug: "multi-site" },
    { name: "Headless CMS", slug: "headless-cms" },
  ]).returning();

  console.log("   ✓ 6 tags created\n");

  // ── 5. Pages ──────────────────────────────────────────────────────────────
  console.log("📄  Creating pages…");

  const now = new Date();

  await db.insert(schema.pagesTable).values({
    siteId: mainSite.id,
    title: "Home",
    slug: "home",
    status: "published",
    template: "default",
    metaTitle: "CINTEXA CMS — AI-Powered Enterprise Content Management",
    metaDescription: "Build, manage, and scale your content with CINTEXA's AI-powered CMS featuring a visual page builder and multi-site management.",
    featuredImage: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200",
    publishedAt: now,
    content: blocks(
      hero(
        "Content Management, Reimagined",
        "Build stunning websites with CINTEXA's AI-powered page builder, multi-site management, and enterprise-grade content tools — all in one platform.",
        "Get Started Free",
        "/signup",
        "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200",
      ),
      features(
        "Everything You Need to Publish at Scale",
        "From AI content generation to drag-and-drop page building, CINTEXA gives your team the tools to move fast.",
        [
          { icon: "🤖", title: "AI Content Studio", description: "Generate blog posts, SEO metadata, and page copy in seconds with built-in GPT-4o-mini integration." },
          { icon: "🧱", title: "Visual Page Builder", description: "Drag and drop Hero, Features, CTA, Text, and Image blocks to create pixel-perfect pages without code." },
          { icon: "🌐", title: "Multi-Site Management", description: "Manage unlimited sites, domains, and content from a single unified dashboard." },
          { icon: "📊", title: "Real-Time Analytics", description: "Track traffic, page views, and engagement with built-in 30-day dashboards and activity feeds." },
          { icon: "🔒", title: "Role-Based Access", description: "Keep your team organised with Admin and Editor roles, per-user permissions, and audit trails." },
          { icon: "⚡", title: "Lightning Fast", description: "Built on Vite, Express 5, and PostgreSQL — designed for speed from dev to production." },
        ],
      ),
      cta(
        "Ready to Transform Your Content Workflow?",
        "Join teams already using CINTEXA to publish faster, rank higher, and manage content at scale.",
        "Start Building Today",
        "/signup",
        "View Live Demo",
        "/demo",
      ),
    ),
  });

  await db.insert(schema.pagesTable).values({
    siteId: mainSite.id,
    title: "Features",
    slug: "features",
    status: "published",
    template: "default",
    metaTitle: "CINTEXA CMS Features — Page Builder, AI, Multi-Site",
    metaDescription: "Explore CINTEXA's full feature set: visual drag-and-drop builder, AI content generation, multi-site management, SEO tools, and more.",
    featuredImage: "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=1200",
    publishedAt: now,
    content: blocks(
      hero(
        "Built for Modern Content Teams",
        "Explore the full power of CINTEXA — from AI-assisted writing to granular multi-site control.",
        "See All Features",
        "#features",
        "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=1200",
      ),
      textBlock(
        "AI-Powered Content Generation",
        "CINTEXA's AI Studio connects to OpenRouter to generate blog posts, page copy, SEO titles, and meta descriptions on demand. Choose your tone, length, and content type — the AI handles the rest. Perfect for teams that need to move fast without sacrificing quality.",
      ),
      imageBlock(
        "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200",
        "AI content studio interface",
        "Generate content, optimise SEO, and suggest titles — all from the CINTEXA AI Studio.",
      ),
      textBlock(
        "Drag-and-Drop Page Builder",
        "Build full pages visually using CINTEXA's block-based page builder. Add Hero sections, Feature grids, CTA banners, rich text blocks, and image sections. Reorder with drag and drop, edit inline, and preview instantly — no code required.",
      ),
      features(
        "Enterprise-Ready from Day One",
        "Everything your team needs to scale content operations across multiple brands and markets.",
        [
          { icon: "🌍", title: "Multi-Language Support", description: "Configure language and timezone per site to serve global audiences." },
          { icon: "📅", title: "Content Scheduling", description: "Schedule pages and posts to publish at the perfect time." },
          { icon: "🔗", title: "SEO & Redirects", description: "Manage global SEO settings, robots.txt, and 301/302 redirects from one place." },
          { icon: "📬", title: "Form Builder", description: "Create and manage contact, lead, and survey forms with custom field types." },
        ],
      ),
    ),
  });

  await db.insert(schema.pagesTable).values({
    siteId: mainSite.id,
    title: "Pricing",
    slug: "pricing",
    status: "published",
    template: "default",
    metaTitle: "CINTEXA CMS Pricing — Simple, Transparent Plans",
    metaDescription: "Choose the CINTEXA plan that fits your team. Start free, upgrade as you grow.",
    publishedAt: now,
    content: blocks(
      hero(
        "Simple Pricing, No Surprises",
        "Start free and scale with your team. Every plan includes the full page builder, AI studio, and multi-site support.",
        "Start Free Today",
        "/signup",
        "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=1200",
      ),
      textBlock(
        "Free Forever for Small Teams",
        "Up to 2 sites, 50 pages, and 100 posts — completely free. No credit card required. Perfect for freelancers, startups, and personal projects.",
      ),
      cta(
        "Need More? Upgrade Anytime.",
        "Pro and Enterprise plans unlock unlimited sites, advanced analytics, priority support, and custom domains.",
        "View Pro Plans",
        "/plans",
        "Talk to Sales",
        "/contact",
      ),
    ),
  });

  await db.insert(schema.pagesTable).values({
    siteId: mainSite.id,
    title: "About",
    slug: "about",
    status: "published",
    template: "default",
    metaTitle: "About CINTEXA — Our Story and Mission",
    metaDescription: "CINTEXA was built to give content teams the tools they deserve — fast, AI-powered, and beautifully designed.",
    publishedAt: now,
    content: blocks(
      hero(
        "Built for the People Who Build the Web",
        "CINTEXA started as a simple idea: content management shouldn't require a team of engineers to maintain.",
        "Meet the Team",
        "#team",
        "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200",
      ),
      textBlock(
        "Our Mission",
        "We believe every content team — from solo creators to enterprise publishers — deserves a CMS that keeps up with them. CINTEXA combines the power of AI, the simplicity of visual editing, and the reliability of enterprise infrastructure into one cohesive platform.",
      ),
      textBlock(
        "Built on Replit",
        "CINTEXA is proudly built and hosted on Replit, combining a React + Vite frontend with an Express 5 API server and a PostgreSQL database. Our contract-first API design ensures consistency from spec to production.",
      ),
    ),
  });

  await db.insert(schema.pagesTable).values({
    siteId: blogSite.id,
    title: "Blog Home",
    slug: "blog",
    status: "published",
    template: "default",
    metaTitle: "CINTEXA Blog — Insights, Tutorials & Product Updates",
    metaDescription: "Stay up to date with CINTEXA's latest product updates, tutorials, and content strategy insights.",
    publishedAt: now,
    content: blocks(
      hero(
        "The CINTEXA Blog",
        "Insights on content strategy, product updates, engineering deep-dives, and tutorials from the CINTEXA team.",
        "Read Latest Posts",
        "/posts",
        "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1200",
      ),
    ),
  });

  console.log("   ✓ 5 pages created\n");

  // ── 6. Posts ──────────────────────────────────────────────────────────────
  console.log("✍️   Creating posts…");

  const post1Content = `Artificial intelligence is transforming the way content teams work. From automated drafting to intelligent SEO suggestions, AI tools are no longer a luxury — they're becoming essential for teams that need to publish at scale.

At CINTEXA, we've integrated OpenRouter's GPT-4o-mini directly into the platform to power three core workflows: **content generation**, **SEO optimisation**, and **title suggestions**.

## Content Generation

With a single prompt, CINTEXA's AI Studio can produce a full blog post, product description, email campaign, or social caption — in the tone and length you specify. The output is editable, so your team keeps full creative control.

## SEO Optimisation

Paste in a page title and some content, and CINTEXA generates a meta title, meta description, and a set of target keywords — all tuned for search engines. No more guessing.

## Title Suggestions

Stuck on a headline? Provide a topic and CINTEXA suggests 5–10 SEO-friendly titles, ranked by engagement potential.

AI doesn't replace your team — it accelerates them.`;

  const [post1] = await db.insert(schema.postsTable).values({
    title: "How AI Is Transforming Content Management in 2025",
    slug: "ai-transforming-content-management-2025",
    status: "published",
    excerpt: "From automated drafting to intelligent SEO, AI tools are becoming essential for content teams that need to publish at scale.",
    content: post1Content,
    authorId: sarah.id,
    categoryId: catInsights.id,
    featuredImage: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200",
    metaTitle: "How AI Is Transforming Content Management in 2025",
    metaDescription: "From automated drafting to intelligent SEO, AI tools are becoming essential for content teams that need to publish at scale. Here's what's changing.",
    keywords: "AI content management, CMS AI, content automation, GPT CMS",
    readingTime: 5,
    publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  }).returning();

  const post2Content = `The CINTEXA page builder uses a block-based architecture that stores page structure as JSON in the database. Each block has a \`type\` and a set of properties specific to that block type.

## Block Types

**Hero** — Full-width banner with heading, subheading, CTA button, and background image.

**Feature** — A feature grid displaying 3–6 feature cards, each with an icon, title, and description.

**CTA** — A call-to-action banner with a primary and secondary button.

**Text** — A rich text section with a heading and body paragraph.

**Image** — A standalone image with optional alt text and caption.

## Building a Page

1. Open the Pages section and click **New Page**
2. Switch to **Visual** mode using the toggle in the toolbar
3. Click **+ Add Block** to insert any block type
4. Edit blocks inline — click any text to edit
5. Drag blocks to reorder them
6. Click **Publish** when you're ready

You can also generate entire blocks using the AI button — type a prompt and CINTEXA fills in the content automatically.`;

  const [post2] = await db.insert(schema.postsTable).values({
    title: "Getting Started with the CINTEXA Page Builder",
    slug: "getting-started-cintexa-page-builder",
    status: "published",
    excerpt: "Learn how to build stunning pages with CINTEXA's visual drag-and-drop page builder — no code required.",
    content: post2Content,
    authorId: marcus.id,
    categoryId: catTutorials.id,
    featuredImage: "https://images.unsplash.com/photo-1547082299-de196ea013d6?w=1200",
    metaTitle: "Getting Started with the CINTEXA Page Builder — Step by Step",
    metaDescription: "A complete walkthrough of CINTEXA's drag-and-drop page builder: block types, editing, reordering, and AI-assisted content generation.",
    keywords: "CINTEXA page builder, drag and drop CMS, visual page editor",
    readingTime: 4,
    publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
  }).returning();

  const [post3] = await db.insert(schema.postsTable).values({
    title: "Managing Multiple Sites with a Single CMS Dashboard",
    slug: "managing-multiple-sites-single-cms-dashboard",
    status: "published",
    excerpt: "CINTEXA's multi-site architecture lets you manage unlimited domains, brands, and content pipelines from one place.",
    content: `Multi-site management is one of the most requested features in enterprise CMS platforms — and one of the hardest to get right. CINTEXA solves it with a clean, site-scoped data model that keeps your content organised without sacrificing flexibility.

## How Multi-Site Works

Every piece of content in CINTEXA is associated with a **Site**. Sites have their own domain, language, timezone, brand colour, and settings. You can switch between sites from the top navigation bar without logging out.

## Creating a New Site

Go to **Sites → New Site** and fill in the domain, name, and optional description. Your new site immediately appears in the navigation and is ready for pages and posts.

## Per-Site Content

Pages and posts can be scoped to a specific site. This means your marketing site, blog, and documentation hub can all live in the same CINTEXA instance — with separate content, separate SEO settings, and separate menus.

## When to Use Multi-Site vs. Multi-Page

Use separate sites when you need different domains, brands, or editorial teams. Use separate pages within one site when the content is part of the same product experience.`,
    authorId: sarah.id,
    categoryId: catInsights.id,
    featuredImage: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200",
    metaTitle: "Managing Multiple Sites with CINTEXA — Multi-Site CMS Guide",
    metaDescription: "CINTEXA's multi-site architecture lets you manage unlimited domains and brands from one dashboard. Here's how it works.",
    keywords: "multi-site CMS, manage multiple websites, enterprise CMS",
    readingTime: 4,
    publishedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
  }).returning();

  const [post4] = await db.insert(schema.postsTable).values({
    title: "CINTEXA v2.0: Page Builder, AI Studio, and More",
    slug: "cintexa-v2-page-builder-ai-studio",
    status: "published",
    excerpt: "Our biggest release yet — introducing the visual page builder, AI Studio, media library enhancements, and a redesigned dashboard.",
    content: `We're thrilled to announce CINTEXA v2.0 — our most significant release to date. Here's everything that's new.

## Visual Page Builder

The headline feature: a fully visual, drag-and-drop page builder with five block types. Build complete landing pages without writing a single line of HTML.

## AI Studio

Three new AI-powered tools: content generator, SEO optimiser, and title suggester — all powered by OpenRouter's GPT-4o-mini.

## Media Library Enhancements

The media library now supports type filtering, hover previews, and alt text editing inline. Managing your asset library has never been faster.

## Redesigned Dashboard

A live stats grid shows total pages, posts, media, users, sites, and forms at a glance. The new 30-day traffic chart and activity feed give you instant visibility into what's happening across your content operations.

## What's Next

We're working on comment management, subscriber lists, and advanced analytics integrations. Stay tuned.`,
    authorId: admin.id,
    categoryId: catProduct.id,
    featuredImage: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200",
    metaTitle: "CINTEXA v2.0 Release Notes — Page Builder, AI Studio & More",
    metaDescription: "CINTEXA v2.0 ships with a visual page builder, AI Studio, media library upgrades, and a redesigned live dashboard. Here's everything new.",
    keywords: "CINTEXA v2, CMS release, page builder, AI studio",
    readingTime: 3,
    publishedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
  }).returning();

  const [post5] = await db.insert(schema.postsTable).values({
    title: "Contract-First API Design with OpenAPI and Orval",
    slug: "contract-first-api-design-openapi-orval",
    status: "published",
    excerpt: "How CINTEXA uses an OpenAPI spec as the single source of truth to auto-generate React Query hooks and Zod validators.",
    content: `At CINTEXA, every API route starts with a spec. We use OpenAPI 3.1 as the contract between our Express backend and our React frontend — and Orval to generate type-safe hooks and validators automatically.

## Why Contract-First?

Writing the API spec first forces you to think about the interface before the implementation. It catches inconsistencies early, generates documentation automatically, and lets frontend and backend development happen in parallel.

## The CINTEXA Toolchain

1. **OpenAPI spec** (\`lib/api-spec/openapi.yaml\`) — the single source of truth
2. **Orval** — generates React Query hooks (\`lib/api-client-react\`) and Zod schemas (\`lib/api-zod\`) from the spec
3. **Drizzle ORM** — type-safe database queries with schema defined in \`lib/db\`
4. **Zod v4** — runtime validation at the API boundary

## Keeping Everything in Sync

After any spec change, run:
\`\`\`
pnpm --filter @workspace/api-spec run codegen
\`\`\`
This regenerates all hooks and validators. TypeScript then catches any component that uses a deprecated or renamed field at compile time.`,
    authorId: admin.id,
    categoryId: catEngineering.id,
    featuredImage: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200",
    metaTitle: "Contract-First API Design with OpenAPI and Orval — CINTEXA Engineering",
    metaDescription: "How CINTEXA uses OpenAPI 3.1 and Orval to auto-generate React Query hooks and Zod validators, keeping backend and frontend perfectly in sync.",
    keywords: "OpenAPI, Orval, contract-first API, React Query, Zod, TypeScript",
    readingTime: 6,
    publishedAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000),
  }).returning();

  const [post6] = await db.insert(schema.postsTable).values({
    title: "10 SEO Best Practices for CMS-Driven Websites",
    slug: "seo-best-practices-cms-websites",
    status: "published",
    excerpt: "From meta tags to redirect management, here are ten SEO practices every content team should implement in their CMS.",
    content: `Search engine optimisation starts in your CMS — not after the fact. Here are ten practices that should be built into your content workflow from day one.

1. **Write unique meta titles and descriptions** for every page and post. Never leave them blank.
2. **Use canonical URLs** to avoid duplicate content penalties across multi-site setups.
3. **Compress and alt-tag every image** before uploading to your media library.
4. **Configure a global robots.txt** and review it before each major deployment.
5. **Redirect all old URLs** when restructuring your site — every broken link is a lost ranking signal.
6. **Structure headings hierarchically** — one H1 per page, logical H2/H3 nesting.
7. **Target long-tail keywords** in your content strategy — they convert better and are easier to rank.
8. **Use schema markup** on key pages (articles, products, FAQs) to qualify for rich results.
9. **Monitor Core Web Vitals** — LCP, CLS, and INP all affect ranking.
10. **Publish consistently** — search engines reward sites with regular, fresh, high-quality content.

CINTEXA's SEO module handles items 1, 4, and 5 out of the box.`,
    authorId: marcus.id,
    categoryId: catInsights.id,
    featuredImage: "https://images.unsplash.com/photo-1432888498266-38ffec3eaf0a?w=1200",
    metaTitle: "10 SEO Best Practices for CMS-Driven Websites in 2025",
    metaDescription: "From meta tags to redirect management, here are ten SEO practices every content team should implement in their CMS workflow.",
    keywords: "SEO best practices, CMS SEO, on-page SEO, meta tags, redirects",
    readingTime: 5,
    publishedAt: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000),
  }).returning();

  // Post tags
  await db.insert(schema.postTagsTable).values([
    { postId: post1.id, tagId: tags[0].id }, // AI
    { postId: post1.id, tagId: tags[1].id }, // SEO
    { postId: post2.id, tagId: tags[2].id }, // Page Builder
    { postId: post3.id, tagId: tags[4].id }, // Multi-site
    { postId: post4.id, tagId: tags[0].id }, // AI
    { postId: post4.id, tagId: tags[2].id }, // Page Builder
    { postId: post5.id, tagId: tags[5].id }, // Headless CMS
    { postId: post5.id, tagId: tags[3].id }, // Performance
    { postId: post6.id, tagId: tags[1].id }, // SEO
  ]);

  console.log("   ✓ 6 posts created with tags\n");

  // ── 7. Media ──────────────────────────────────────────────────────────────
  console.log("🖼️   Creating media entries…");

  await db.insert(schema.mediaTable).values([
    { filename: "hero-dashboard.jpg", originalName: "hero-dashboard.jpg", mimeType: "image/jpeg", size: 284320, url: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200", altText: "CINTEXA dashboard overview", caption: "The CINTEXA CMS main dashboard", width: 1200, height: 675 },
    { filename: "ai-studio.jpg", originalName: "ai-studio.jpg", mimeType: "image/jpeg", size: 198450, url: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200", altText: "AI content generation interface", caption: "AI Studio generating a blog post", width: 1200, height: 800 },
    { filename: "page-builder.jpg", originalName: "page-builder.jpg", mimeType: "image/jpeg", size: 231700, url: "https://images.unsplash.com/photo-1547082299-de196ea013d6?w=1200", altText: "Visual drag-and-drop page builder", caption: "Building a landing page visually", width: 1200, height: 675 },
    { filename: "multi-site.jpg", originalName: "multi-site.jpg", mimeType: "image/jpeg", size: 176800, url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200", altText: "Multi-site management dashboard", caption: "Managing multiple sites from one dashboard", width: 1200, height: 800 },
    { filename: "team-collab.jpg", originalName: "team-collab.jpg", mimeType: "image/jpeg", size: 312400, url: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200", altText: "Team collaborating on content", caption: "Content teams working together in CINTEXA", width: 1200, height: 800 },
    { filename: "seo-tools.jpg", originalName: "seo-tools.jpg", mimeType: "image/jpeg", size: 154600, url: "https://images.unsplash.com/photo-1432888498266-38ffec3eaf0a?w=1200", altText: "SEO analysis and tools", caption: "CINTEXA SEO settings and optimisation tools", width: 1200, height: 800 },
    { filename: "hero-home.jpg", originalName: "hero-home.jpg", mimeType: "image/jpeg", size: 418900, url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200", altText: "Abstract digital background", caption: "Homepage hero background", width: 1200, height: 675 },
    { filename: "pricing-bg.jpg", originalName: "pricing-bg.jpg", mimeType: "image/jpeg", size: 203100, url: "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=1200", altText: "Pricing plan comparison background", caption: "Pricing page header", width: 1200, height: 675 },
    { filename: "blog-home.jpg", originalName: "blog-home.jpg", mimeType: "image/jpeg", size: 267800, url: "https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=1200", altText: "Laptop with blog content", caption: "CINTEXA blog landing page hero", width: 1200, height: 800 },
    { filename: "engineering-code.jpg", originalName: "engineering-code.jpg", mimeType: "image/jpeg", size: 189300, url: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200", altText: "Code editor with TypeScript", caption: "CINTEXA engineering blog header", width: 1200, height: 800 },
    { filename: "product-update.jpg", originalName: "product-update.jpg", mimeType: "image/jpeg", size: 221500, url: "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=1200", altText: "Product feature showcase", caption: "CINTEXA features overview", width: 1200, height: 675 },
    { filename: "cintexa-logo.svg", originalName: "cintexa-logo.svg", mimeType: "image/svg+xml", size: 2480, url: "/favicon.svg", altText: "CINTEXA CMS logo", caption: "Official CINTEXA logo mark", width: 48, height: 48 },
  ]);

  console.log("   ✓ 12 media entries created\n");

  // ── 8. Menus ──────────────────────────────────────────────────────────────
  console.log("🧭  Creating menus…");

  await db.insert(schema.menusTable).values({
    name: "Primary Navigation",
    location: "header",
    items: menuItems(
      { label: "Home", url: "/" },
      { label: "Features", url: "/features", children: [
        { label: "Page Builder", url: "/features#page-builder" },
        { label: "AI Studio", url: "/features#ai-studio" },
        { label: "Multi-Site", url: "/features#multi-site" },
      ]},
      { label: "Pricing", url: "/pricing" },
      { label: "Blog", url: "/blog" },
      { label: "About", url: "/about" },
    ),
  });

  await db.insert(schema.menusTable).values({
    name: "Footer Links",
    location: "footer",
    items: menuItems(
      { label: "Privacy Policy", url: "/privacy" },
      { label: "Terms of Service", url: "/terms" },
      { label: "Documentation", url: "/docs" },
      { label: "GitHub", url: "https://github.com/cintexa" },
      { label: "Status", url: "/status" },
    ),
  });

  console.log("   ✓ 2 menus created\n");

  // ── 9. Forms ──────────────────────────────────────────────────────────────
  console.log("📬  Creating forms…");

  await db.insert(schema.formsTable).values({
    name: "Contact Us",
    fields: formFields(
      { id: "name", type: "text", label: "Full Name", placeholder: "Jane Smith", required: true },
      { id: "email", type: "email", label: "Email Address", placeholder: "jane@company.com", required: true },
      { id: "company", type: "text", label: "Company", placeholder: "Acme Corp" },
      { id: "subject", type: "select", label: "Subject", required: true, options: ["General Enquiry", "Sales", "Technical Support", "Partnership", "Press"] },
      { id: "message", type: "textarea", label: "Message", placeholder: "Tell us how we can help…", required: true },
    ),
  });

  await db.insert(schema.formsTable).values({
    name: "Newsletter Signup",
    fields: formFields(
      { id: "email", type: "email", label: "Email Address", placeholder: "you@example.com", required: true },
      { id: "firstName", type: "text", label: "First Name", placeholder: "Jane" },
      { id: "interests", type: "select", label: "I'm interested in", options: ["Product Updates", "Tutorials", "Engineering", "All of the Above"] },
    ),
  });

  console.log("   ✓ 2 forms created\n");

  // ── 10. SEO Settings ──────────────────────────────────────────────────────
  console.log("🔍  Creating SEO settings…");

  await db.insert(schema.seoSettingsTable).values({
    siteTitle: "CINTEXA CMS — AI-Powered Enterprise Content Management",
    siteDescription: "CINTEXA is an AI-powered enterprise CMS with a visual drag-and-drop page builder, multi-site management, and built-in AI content generation.",
    robots: "index, follow",
    ogImage: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200",
    twitterHandle: "@cintexacms",
  });

  console.log("   ✓ SEO settings created\n");

  // ── 11. Activity Feed ─────────────────────────────────────────────────────
  console.log("📊  Creating activity feed…");

  const activities = [
    { type: "publish", entityType: "post", entityTitle: "10 SEO Best Practices for CMS-Driven Websites", userName: "Marcus Rivera", action: "published post" },
    { type: "publish", entityType: "post", entityTitle: "Contract-First API Design with OpenAPI and Orval", userName: "Alex Admin", action: "published post" },
    { type: "create", entityType: "page", entityTitle: "Pricing", userName: "Alex Admin", action: "created page" },
    { type: "publish", entityType: "post", entityTitle: "CINTEXA v2.0: Page Builder, AI Studio, and More", userName: "Alex Admin", action: "published post" },
    { type: "publish", entityType: "post", entityTitle: "Managing Multiple Sites with a Single CMS Dashboard", userName: "Sarah Chen", action: "published post" },
    { type: "upload", entityType: "media", entityTitle: "hero-dashboard.jpg", userName: "Priya Patel", action: "uploaded media" },
    { type: "publish", entityType: "post", entityTitle: "Getting Started with the CINTEXA Page Builder", userName: "Marcus Rivera", action: "published post" },
    { type: "create", entityType: "site", entityTitle: "CINTEXA Blog", userName: "Alex Admin", action: "created site" },
    { type: "publish", entityType: "post", entityTitle: "How AI Is Transforming Content Management in 2025", userName: "Sarah Chen", action: "published post" },
    { type: "create", entityType: "user", entityTitle: "Priya Patel", userName: "Alex Admin", action: "invited user" },
  ];

  for (let i = 0; i < activities.length; i++) {
    await db.insert(schema.activityTable).values({
      ...activities[i],
      createdAt: new Date(Date.now() - i * 2 * 60 * 60 * 1000),
    });
  }

  console.log("   ✓ 10 activity entries created\n");

  // ─────────────────────────────────────────────────────────────────────────
  console.log("═".repeat(58));
  console.log("🎉  Seed complete! Here are your login credentials:\n");
  console.log("   Admin   → admin@cintexa.com  /  Admin@123456");
  console.log("   Editor  → sarah@cintexa.com  /  Editor@123456");
  console.log("═".repeat(58));
  console.log();

  await pool.end();
}

main().catch((err) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
