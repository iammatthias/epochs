/**
 * Epochs — a frontend for the Epochs contract on Ethereum mainnet.
 *
 * A faithful rebuild of epochs.cosmiccomputation.org, the Cosmic Computation
 * Laboratory site that went offline, reconstructed from that site's own webpack
 * bundles and its Wayback capture. Only the stack is new.
 *
 * Everything is read-only: no wallet, no login, no writes, no database. Epoch
 * values are a pure function of the block height, so the single live input is
 * one number from a JSON-RPC endpoint.
 */

import { DEFAULT_RPCS, CONTRACT, currentEndpoint } from "./chain";
import { commas } from "./epochs";
import { renderPage } from "./render";
import { getReading } from "./state";

export interface Env {
  EPOCHS_RPC_URL?: string;
  EPOCHS_PUBLIC_URL?: string;
  EPOCHS_FONTS_BASE?: string;
}

/** One block time. The page cannot be fresher than the chain it reads. */
const PAGE_MAX_AGE = 12;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    switch (url.pathname) {
      case "/":
        return handlePage(request, env, ctx);
      case "/api/current":
        return handleCurrent(env);
      case "/status":
        return handleStatus(env);
      case "/robots.txt":
        return handleRobots(origin(request, env));
      case "/sitemap.xml":
        return handleSitemap(origin(request, env));
      default:
        return new Response("not found", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * The canonical origin for this deployment: the configured value when there is
 * one, else whatever host the request arrived on. Deriving it is right for
 * workers.dev and preview URLs, where a hardcoded canonical would point every
 * preview at production.
 */
function origin(request: Request, env: Env): string {
  const configured = (env.EPOCHS_PUBLIC_URL ?? "").trim().replace(/\/$/, "");
  return configured || new URL(request.url).origin;
}

/** The RPC endpoint list: EPOCHS_RPC_URL when set, else the public defaults. */
function rpcUrls(env: Env): readonly string[] {
  const raw = (env.EPOCHS_RPC_URL ?? "").trim();
  if (!raw) return DEFAULT_RPCS;
  const urls = raw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return urls.length > 0 ? urls : DEFAULT_RPCS;
}

/**
 * The page. Rendered HTML is held in the edge cache for one block time, so a
 * burst of traffic costs one render per PoP per block rather than one per
 * visitor — the isolate memo already covers the RPC call.
 */
async function handlePage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const cache = (globalThis as { caches?: CacheStorage }).caches?.default;
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }

  const { reading } = await getReading(rpcUrls(env));
  const html = renderPage({
    reading,
    publicUrl: origin(request, env),
    fontsBase: (env.EPOCHS_FONTS_BASE ?? "").trim(),
  });

  const response = new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The loading state is about to change, so let clients revalidate rather
      // than cache the empty page.
      "cache-control": reading
        ? `public, max-age=${PAGE_MAX_AGE}`
        : "no-store",
    },
  });

  if (cache && reading) {
    ctx.waitUntil(cache.put(request, response.clone()));
  }
  return response;
}

/** The live reading as JSON — enough for the page's poller to update in place. */
async function handleCurrent(env: Env): Promise<Response> {
  const { reading } = await getReading(rpcUrls(env));
  if (!reading) {
    return json({ error: "no reading yet" }, 503);
  }
  return json(
    {
      block: reading.block,
      display: commas(reading.block),
      epochs: reading.epochs,
      labels: reading.labels,
      live: reading.live,
    },
    200,
    "no-store",
  );
}

/**
 * Health and provenance. Reports ok as long as the Worker is serving: a wedged
 * upstream RPC is visible in the payload but is not a failure of this service,
 * because the page still renders the last known reading.
 */
async function handleStatus(env: Env): Promise<Response> {
  const { reading, error } = await getReading(rpcUrls(env));
  return json(
    {
      service: "epochs",
      ok: true,
      contract: CONTRACT,
      reading: reading !== null,
      live: reading?.live ?? false,
      ...(reading ? { block: reading.block } : {}),
      // Which provider is actually answering. With failover this is the only
      // way to tell that a configured first choice is being skipped.
      rpc: currentEndpoint(),
      ...(error ? { rpc_error: error } : {}),
    },
    200,
    "no-store",
  );
}

function handleRobots(base: string): Response {
  const body = `User-agent: *
Allow: /

Sitemap: ${base}/sitemap.xml
`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}

function handleSitemap(base: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc></url>
</urlset>
`;
  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

function json(
  payload: unknown,
  status = 200,
  cacheControl = "no-store",
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}
