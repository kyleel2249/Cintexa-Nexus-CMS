/** Internal share-pack text for published posts. No network calls: the editor shows the text and the user posts it. */

export type SharePlatform = "twitter" | "facebook" | "linkedin";
export const SHARE_PLATFORMS: SharePlatform[] = ["twitter", "facebook", "linkedin"];

const LIMITS: Record<SharePlatform, number> = { twitter: 280, facebook: 600, linkedin: 700 };

export function buildShareText(platform: SharePlatform, post: { title: string; excerpt?: string | null; slug?: string | null }): string {
  const title = (post.title ?? "").trim();
  const excerpt = (post.excerpt ?? "").trim();
  const tag = platform === "linkedin" ? "\n\n#content #insights" : platform === "twitter" ? "\n\n#cms" : "";
  const body = excerpt ? `${title}\n\n${excerpt}` : title;
  const full = `${body}${tag}`;
  const limit = LIMITS[platform];
  if (full.length <= limit) return full;
  const room = limit - tag.length - 1;
  return `${body.slice(0, Math.max(room, 0)).replace(/\s+\S*$/, "").trimEnd()}…${tag}`;
}
