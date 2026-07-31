import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import worker, { type Env } from "../src/index";
import { compute } from "../src/epochs";
import { resetEndpoint } from "../src/chain";
import { resetState } from "../src/state";

const BLOCK = 25_648_419;

/** ExecutionContext is not available outside workerd; only waitUntil is used. */
const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

let original: typeof fetch;

function stubChain(ok: boolean): void {
  globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
    if (!ok) throw new TypeError("fetch failed");
    const batch = JSON.parse(String(init?.body)) as { id: number }[];
    return new Response(
      JSON.stringify(
        batch.map((req, i) => ({
          id: req.id,
          result:
            i === 0
              ? "0x" + BLOCK.toString(16)
              : "0x" +
                compute(BLOCK)
                  .map((v) => v.toString(16).padStart(64, "0"))
                  .join(""),
        })),
      ),
    );
  }) as typeof fetch;
}

function get(path: string, env: Env = {}): Promise<Response> {
  return worker.fetch(new Request(`https://epochs.test${path}`), env, ctx);
}

beforeEach(() => {
  original = globalThis.fetch;
  resetEndpoint();
  resetState();
  stubChain(true);
});

afterEach(() => {
  globalThis.fetch = original;
});

describe("routes", () => {
  it("serves the page with one block of freshness", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/html");
    expect(res.headers.get("cache-control")).toBe("public, max-age=12");
    expect(await res.text()).toContain("It is currently");
  });

  it("serves the live reading as JSON", async () => {
    const res = await get("/api/current");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.block).toBe(BLOCK);
    expect(body.display).toBe("25,648,419");
    expect(body.epochs).toEqual(compute(BLOCK));
    expect(body.live).toBe(true);
    expect(body.labels).toHaveLength(12);
  });

  it("reports health, the contract and the endpoint in use", async () => {
    const res = await get("/status");
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.service).toBe("epochs");
    expect(body.ok).toBe(true);
    expect(body.contract).toBe("0xde9f0c369Ef3692B4bF9D40803A9029a3722B9c4");
    expect(body.reading).toBe(true);
    expect(body.block).toBe(BLOCK);
    expect(body.rpc).toBeTruthy();
  });

  it("stays ok but reports the error when the chain is unreachable", async () => {
    stubChain(false);
    const res = await get("/status");
    const body = (await res.json()) as Record<string, unknown>;

    // A wedged upstream is not a failure of this service — the page still
    // renders whatever it last knew.
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.reading).toBe(false);
    expect(body.rpc_error).toBeTruthy();
  });

  it("does not cache the loading state", async () => {
    stubChain(false);
    const res = await get("/");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("Loading");
  });

  it("names the sitemap in robots.txt", async () => {
    const res = await get("/robots.txt");
    const body = await res.text();
    expect(res.headers.get("content-type")).toStartWith("text/plain");
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Sitemap: https://epochs.test/sitemap.xml");
  });

  it("serves a sitemap with an absolute loc", async () => {
    const res = await get("/sitemap.xml");
    const body = await res.text();
    expect(res.headers.get("content-type")).toStartWith("application/xml");
    expect(body).toContain("<loc>https://epochs.test/</loc>");
  });

  it("404s an unknown path", async () => {
    expect((await get("/nope")).status).toBe(404);
  });

  it("405s a write", async () => {
    const res = await worker.fetch(
      new Request("https://epochs.test/", { method: "POST" }),
      {},
      ctx,
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("public URL", () => {
  it("derives the origin from the request when unconfigured", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain('href="https://epochs.test/"');
  });

  it("prefers EPOCHS_PUBLIC_URL once a canonical domain is set", async () => {
    const env: Env = { EPOCHS_PUBLIC_URL: "https://epochs.cosmiccomputation.org/" };
    const html = await (await get("/", env)).text();

    // The trailing slash in the var must not double up.
    expect(html).toContain(
      '<link rel="canonical" href="https://epochs.cosmiccomputation.org/">',
    );
    expect(html).not.toContain("org//");

    const robots = await (await get("/robots.txt", env)).text();
    expect(robots).toContain(
      "Sitemap: https://epochs.cosmiccomputation.org/sitemap.xml",
    );
  });
});
