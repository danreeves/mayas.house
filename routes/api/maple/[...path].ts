import { defineHandler } from 'void';

const UPSTREAM_ORIGIN = 'https://maplestory.io/api';
const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, s-maxage=31536000, immutable';

interface MemoryCacheEntry {
  body: ArrayBuffer;
  contentType: string;
  status: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();
const MAX_MEMORY_CACHE_ENTRIES = 400;

function setMemoryCache(key: string, entry: MemoryCacheEntry) {
  if (memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, entry);
}

export const GET = defineHandler(async (c) => {
  const reqUrl = new URL(c.req.url);
  // Extract raw path after /api/maple/ to preserve URL-encoded segments like character item JSON
  const prefix = '/api/maple/';
  const idx = reqUrl.pathname.indexOf(prefix);
  let rawSubpath = idx >= 0 ? reqUrl.pathname.slice(idx + prefix.length) : (c.req.param('path') || '');

  if (!rawSubpath) {
    return c.json({ error: 'Missing maple resource path' }, 400);
  }

  // GMS/93/map/100000001/render on maplestory.io has a broken render missing the house objects,
  // whereas GMS/94/map/100000001/render has the exact same 1135x827 geometry with the full house.
  if (rawSubpath === 'GMS/93/map/100000001/render') {
    rawSubpath = 'GMS/94/map/100000001/render';
  }

  // Normalize internal retry query param so upstream & cache keys stay clean
  const searchParams = new URLSearchParams(reqUrl.search);
  searchParams.delete('_retry');
  const cleanSearch = searchParams.toString() ? `?${searchParams.toString()}` : '';

  const upstreamUrl = `${UPSTREAM_ORIGIN}/${rawSubpath}${cleanSearch}`;
  const cacheKeyUrl = new URL(upstreamUrl);
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

  // 1. Check Cloudflare Edge Cache API if available
  const cfCache: Cache | undefined =
    typeof caches !== 'undefined' && 'default' in caches
      ? (caches as unknown as { default: Cache }).default
      : undefined;

  if (cfCache) {
    try {
      const cached = await cfCache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('Cache-Control', CACHE_CONTROL_IMMUTABLE);
        headers.set('X-Maple-Cache', 'HIT-CF');
        return new Response(cached.body, {
          status: cached.status,
          headers,
        });
      }
    } catch {
      // Fall through to memory cache / upstream
    }
  }

  // 2. Check in-memory worker/dev cache
  const memHit = memoryCache.get(upstreamUrl);
  if (memHit) {
    return new Response(memHit.body.slice(0), {
      status: memHit.status,
      headers: {
        'Content-Type': memHit.contentType,
        'Cache-Control': CACHE_CONTROL_IMMUTABLE,
        'Access-Control-Allow-Origin': '*',
        'X-Maple-Cache': 'HIT-MEM',
      },
    });
  }

  // 3. Fetch from maplestory.io with up to 3 attempts on transient 5xx/524
  let upstreamRes: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      upstreamRes = await fetch(upstreamUrl, {
        headers: {
          Accept: c.req.header('Accept') || '*/*',
          'User-Agent': 'mayas.house-cloudflare-cache-proxy/1.0',
        },
        cf: {
          cacheEverything: true,
          cacheTtl: 31536000,
        },
      } as RequestInit);

      if (upstreamRes.ok || upstreamRes.status < 500) {
        break;
      }
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    } catch (err) {
      if (attempt === 2) {
        return c.json({ error: 'Upstream fetch failed', detail: String(err) }, 502);
      }
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }

  if (!upstreamRes) {
    return c.json({ error: 'No response from upstream' }, 502);
  }

  const contentType = upstreamRes.headers.get('Content-Type') || 'application/octet-stream';
  const bodyBuffer = await upstreamRes.arrayBuffer();

  if (upstreamRes.ok && bodyBuffer.byteLength > 0) {
    // Store in memory cache if under 2MB
    if (bodyBuffer.byteLength <= 2 * 1024 * 1024) {
      setMemoryCache(upstreamUrl, {
        body: bodyBuffer,
        contentType,
        status: upstreamRes.status,
      });
    }

    // Store in Cloudflare Edge Cache
    if (cfCache) {
      try {
        const responseToCache = new Response(bodyBuffer.slice(0), {
          status: upstreamRes.status,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': CACHE_CONTROL_IMMUTABLE,
            'Access-Control-Allow-Origin': '*',
          },
        });
        await cfCache.put(cacheKey, responseToCache);
      } catch {
        // Ignore cache write errors in local dev
      }
    }
  }

  return new Response(bodyBuffer, {
    status: upstreamRes.status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': upstreamRes.ok ? CACHE_CONTROL_IMMUTABLE : 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Maple-Cache': 'MISS',
    },
  });
});
