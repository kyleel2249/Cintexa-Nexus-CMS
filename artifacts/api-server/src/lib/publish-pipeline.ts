import { db, postsTable, pagesTable, subscribersTable, activityTable, seoSettingsTable, pluginsTable, postImagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { generateImagesForPost } from "../routes/post-images";
import { broadcastPost } from "../routes/broadcast";

async function isPluginEnabled(slug: string): Promise<boolean> {
  try {
    const [p] = await db.select({ enabled: pluginsTable.enabled }).from(pluginsTable).where(eq(pluginsTable.slug, slug));
    return p?.enabled ?? false;
  } catch {
    return false;
  }
}

export async function generateSitemap(): Promise<string> {
  const [settings] = await db.select().from(seoSettingsTable);
  const baseUrl = process.env.SITE_BASE_URL ?? "https://cintexa.replit.app";

  const publishedPosts = await db.select({ slug: postsTable.slug, updatedAt: postsTable.updatedAt })
    .from(postsTable).where(eq(postsTable.status, "published"));

  const publishedPages = await db.select({ slug: pagesTable.slug, updatedAt: pagesTable.updatedAt })
    .from(pagesTable).where(eq(pagesTable.status, "published"));

  const urls: string[] = [
    `  <url><loc>${baseUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
  ];

  for (const page of publishedPages) {
    urls.push(`  <url><loc>${baseUrl}/${page.slug}</loc><lastmod>${page.updatedAt.toISOString().split("T")[0]}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
  }

  for (const post of publishedPosts) {
    urls.push(`  <url><loc>${baseUrl}/blog/${post.slug}</loc><lastmod>${post.updatedAt.toISOString().split("T")[0]}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
}

async function sendSubscriberEmails(post: typeof postsTable.$inferSelect): Promise<void> {
  if (!(await isPluginEnabled("subscriber-alerts"))) return;

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass) {
    logger.warn("Subscriber alerts plugin enabled but SMTP credentials not configured");
    return;
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT ?? "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: smtpUser, pass: smtpPass },
    });

    const baseUrl = process.env.SITE_BASE_URL ?? "https://cintexa.replit.app";
    const activeSubscribers = await db.select().from(subscribersTable).where(eq(subscribersTable.status, "active"));

    const thumbnail = await db.select({ url: postImagesTable.url })
      .from(postImagesTable)
      .where(eq(postImagesTable.postId, post.id))
      .limit(1);

    const thumbHtml = thumbnail[0]?.url
      ? `<img src="${thumbnail[0].url}" alt="${post.title}" style="width:100%;max-width:600px;border-radius:8px;margin-bottom:16px"/>`
      : "";

    for (const sub of activeSubscribers) {
      const unsubscribeUrl = `${baseUrl}/api/subscribers/unsubscribe?token=${sub.unsubscribeToken}`;
      try {
        await transporter.sendMail({
          from: smtpFrom,
          to: sub.email,
          subject: `New post: ${post.title}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
              <h1 style="font-size:24px;margin-bottom:8px">${post.title}</h1>
              ${thumbHtml}
              ${post.excerpt ? `<p style="font-size:16px;color:#555;margin-bottom:24px">${post.excerpt}</p>` : ""}
              <a href="${baseUrl}/blog/${post.slug}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">Read Article →</a>
              <hr style="margin-top:40px;border:none;border-top:1px solid #eee"/>
              <p style="font-size:12px;color:#999">You're receiving this because you subscribed. <a href="${unsubscribeUrl}" style="color:#999">Unsubscribe</a></p>
            </div>`,
        });
      } catch (err) {
        logger.error({ err, email: sub.email }, "Failed to send subscriber email");
      }
    }
  } catch (err) {
    logger.error({ err }, "Nodemailer error");
  }
}

export async function runPublishPipeline(postId: number): Promise<void> {
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) return;

  logger.info({ postId }, "Running publish pipeline");

  await Promise.allSettled([
    (async () => {
      if (await isPluginEnabled("image-generator")) {
        await generateImagesForPost(postId);
      }
    })(),
    (async () => {
      if (await isPluginEnabled("social-broadcast")) {
        await broadcastPost(postId);
      }
    })(),
    sendSubscriberEmails(post),
  ]);

  logger.info({ postId }, "Publish pipeline complete");
}
