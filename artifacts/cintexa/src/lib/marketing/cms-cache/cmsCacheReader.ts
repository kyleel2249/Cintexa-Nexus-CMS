/**
 * Read-only React Query cache reader for CMS Media and Pages.
 * Never calls fetchQuery / prefetch / invalidate / refetch.
 *
 * Query keys (from @workspace/api-client-react generated client):
 * - Media: ['/api/media'] or ['/api/media', params]
 * - Pages: ['/api/pages'] or ['/api/pages', params]
 *
 * Response shapes:
 * - Media: MediaItem[] (array)
 * - Pages: Page[] (array) — may also be nested depending on client version; handled defensively
 */
import type { QueryClient, Query } from "@tanstack/react-query";

export type CachedMediaOption = {
  cmsMediaId: number;
  name: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  width?: number | null;
  height?: number | null;
  thumbnailUrl?: string | null;
};

export type CachedPageOption = {
  cmsPageId: number;
  title: string;
  slug?: string;
  status?: string;
  template?: string | null;
  updatedAt?: string;
  url?: string | null;
};

function keyRoot(key: unknown): string | null {
  if (!Array.isArray(key) || key.length === 0) return null;
  const root = key[0];
  return typeof root === "string" ? root : null;
}

function isMediaKey(key: unknown): boolean {
  const root = keyRoot(key);
  return root === "/api/media";
}

function isPagesKey(key: unknown): boolean {
  const root = keyRoot(key);
  return root === "/api/pages";
}

function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.pages)) return o.pages;
    if (Array.isArray(o.media)) return o.media;
  }
  return [];
}

function normalizeMedia(row: unknown): CachedMediaOption | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = Number(r.id);
  if (!Number.isFinite(id)) return null;
  const originalName = typeof r.originalName === "string" ? r.originalName : undefined;
  const filename = typeof r.filename === "string" ? r.filename : undefined;
  const name = originalName || filename || `Media #${id}`;
  const mimeType = typeof r.mimeType === "string" ? r.mimeType : undefined;
  const url = typeof r.url === "string" ? r.url : undefined;
  return {
    cmsMediaId: id,
    name,
    filename: filename || originalName,
    mimeType,
    size: typeof r.size === "number" ? r.size : undefined,
    width: typeof r.width === "number" ? r.width : null,
    height: typeof r.height === "number" ? r.height : null,
    thumbnailUrl: url || null,
  };
}

function normalizePage(row: unknown): CachedPageOption | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = Number(r.id);
  if (!Number.isFinite(id)) return null;
  const title = typeof r.title === "string" ? r.title : `Page #${id}`;
  const slug = typeof r.slug === "string" ? r.slug : undefined;
  return {
    cmsPageId: id,
    title,
    slug,
    status: typeof r.status === "string" ? r.status : undefined,
    template: typeof r.template === "string" ? r.template : null,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : undefined,
    url: slug ? `/${slug}` : null,
  };
}

function collectFromQueries(
  queries: Query[],
  matchKey: (key: unknown) => boolean,
  normalize: (row: unknown) => CachedMediaOption | CachedPageOption | null,
): { items: (CachedMediaOption | CachedPageOption)[]; queryCount: number } {
  const map = new Map<number, CachedMediaOption | CachedPageOption>();
  let queryCount = 0;
  for (const q of queries) {
    if (!matchKey(q.queryKey)) continue;
    // Only successful, non-fetching cached data — never trigger fetch
    if (q.state.status !== "success") continue;
    const data = q.state.data;
    if (data == null) continue;
    const rows = asArray(data);
    if (rows.length === 0) {
      queryCount += 1;
      continue;
    }
    queryCount += 1;
    for (const row of rows) {
      const n = normalize(row);
      if (!n) continue;
      const id = "cmsMediaId" in n ? n.cmsMediaId : n.cmsPageId;
      map.set(id, n);
    }
  }
  return { items: Array.from(map.values()), queryCount };
}

export function readCachedMedia(queryClient: QueryClient): {
  available: boolean;
  items: CachedMediaOption[];
  sourceQueryCount: number;
} {
  const all = queryClient.getQueryCache().getAll();
  const { items, queryCount } = collectFromQueries(all, isMediaKey, normalizeMedia);
  const mediaItems = items as CachedMediaOption[];
  return {
    available: mediaItems.length > 0,
    items: mediaItems.sort((a, b) => a.name.localeCompare(b.name)),
    sourceQueryCount: queryCount,
  };
}

export function readCachedPages(queryClient: QueryClient): {
  available: boolean;
  items: CachedPageOption[];
  sourceQueryCount: number;
} {
  const all = queryClient.getQueryCache().getAll();
  const { items, queryCount } = collectFromQueries(all, isPagesKey, normalizePage);
  const pageItems = items as CachedPageOption[];
  return {
    available: pageItems.length > 0,
    items: pageItems.sort((a, b) => a.title.localeCompare(b.title)),
    sourceQueryCount: queryCount,
  };
}
